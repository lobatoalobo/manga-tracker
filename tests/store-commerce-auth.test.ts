import { describe, it, expect } from "vitest";
import {
  authorizeStoreMember,
  isStoreRole,
  StoreAuthError,
  STORE_ROLE,
  STORE_AUTH_ERROR,
  type AuthorizeInput,
} from "@/lib/domain/store/authorize";
import {
  resultingOwnerUserIds,
  wouldLeaveNoOwner,
  assertKeepsOwner,
  assertBootstrapAllowed,
  StoreMembershipError,
  STORE_MEMBERSHIP_ERROR,
} from "@/lib/domain/store/membership";

// Decisión de autorización PURA (sin DB ni sesión). Cubre OWNER, STAFF, externo, deshabilitada y sin perfil.
const base = (over: Partial<AuthorizeInput> = {}): AuthorizeInput => ({
  userId: "u1",
  profile: { id: 10, enabled: true },
  member: { userId: "u1", role: STORE_ROLE.OWNER },
  ...over,
});

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return "NO_THROW";
  } catch (e) {
    return e instanceof StoreAuthError ? e.code : "WRONG_ERROR";
  }
};

describe("dominio — authorizeStoreMember", () => {
  it("OWNER de una tienda habilitada → autorizado", () => {
    const r = authorizeStoreMember(base());
    expect(r.role).toBe("OWNER");
    expect(r.profile.id).toBe(10);
    expect(r.userId).toBe("u1");
  });

  it("STAFF → autorizado cuando el rol está permitido", () => {
    const r = authorizeStoreMember(base({ member: { userId: "u1", role: STORE_ROLE.STAFF } }));
    expect(r.role).toBe("STAFF");
  });

  it("STAFF → FORBIDDEN_ROLE cuando la operación exige OWNER", () => {
    expect(
      codeOf(() => authorizeStoreMember(base({ member: { userId: "u1", role: STORE_ROLE.STAFF }, allowedRoles: [STORE_ROLE.OWNER] }))),
    ).toBe(STORE_AUTH_ERROR.FORBIDDEN_ROLE);
  });

  it("usuario externo (no miembro) → NOT_A_MEMBER", () => {
    expect(codeOf(() => authorizeStoreMember(base({ member: null })))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
  });

  it("miembro cuyo userId no coincide con el logueado → NOT_A_MEMBER (defensivo)", () => {
    expect(codeOf(() => authorizeStoreMember(base({ member: { userId: "otro", role: STORE_ROLE.OWNER } })))).toBe(
      STORE_AUTH_ERROR.NOT_A_MEMBER,
    );
  });

  it("sin sesión → UNAUTHENTICATED (antes que cualquier otra verificación)", () => {
    expect(codeOf(() => authorizeStoreMember(base({ userId: null, profile: null, member: null })))).toBe(
      STORE_AUTH_ERROR.UNAUTHENTICATED,
    );
  });

  it("tienda sin perfil comercial → PROFILE_NOT_FOUND", () => {
    expect(codeOf(() => authorizeStoreMember(base({ profile: null, member: null })))).toBe(
      STORE_AUTH_ERROR.PROFILE_NOT_FOUND,
    );
  });

  it("tienda deshabilitada + requireEnabled → STORE_DISABLED", () => {
    expect(codeOf(() => authorizeStoreMember(base({ profile: { id: 10, enabled: false }, requireEnabled: true })))).toBe(
      STORE_AUTH_ERROR.STORE_DISABLED,
    );
  });

  it("tienda deshabilitada SIN requireEnabled → autorizado (el admin puede reactivarla)", () => {
    const r = authorizeStoreMember(base({ profile: { id: 10, enabled: false } }));
    expect(r.role).toBe("OWNER");
  });

  it("rol persistido inválido → FORBIDDEN_ROLE (no se cuela un rol desconocido)", () => {
    expect(codeOf(() => authorizeStoreMember(base({ member: { userId: "u1", role: "SUPERADMIN" } })))).toBe(
      STORE_AUTH_ERROR.FORBIDDEN_ROLE,
    );
  });

  it("orden de chequeo: un no-miembro de una tienda deshabilitada recibe NOT_A_MEMBER (no filtra estado)", () => {
    expect(
      codeOf(() => authorizeStoreMember(base({ profile: { id: 10, enabled: false }, member: null, requireEnabled: true }))),
    ).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
  });

  it("isStoreRole reconoce solo OWNER/STAFF", () => {
    expect(isStoreRole("OWNER")).toBe(true);
    expect(isStoreRole("STAFF")).toBe(true);
    expect(isStoreRole("ADMIN")).toBe(false);
    expect(isStoreRole("")).toBe(false);
  });

  it("administrar miembros exige OWNER: un STAFF es rechazado", () => {
    // La operación "gestionar miembros" se autorizará con allowedRoles: [OWNER].
    expect(codeOf(() => authorizeStoreMember(base({ member: { userId: "u1", role: STORE_ROLE.STAFF }, allowedRoles: [STORE_ROLE.OWNER] })))).toBe(
      STORE_AUTH_ERROR.FORBIDDEN_ROLE,
    );
  });
});

// ---------------------------------------------------------------------------
// Invariantes de OWNER (puro) — la infra los aplica bajo tx + lock
// ---------------------------------------------------------------------------
const memCode = (fn: () => unknown): string => {
  try {
    fn();
    return "NO_THROW";
  } catch (e) {
    return e instanceof StoreMembershipError ? e.code : "WRONG_ERROR";
  }
};

describe("dominio — invariantes de OWNER", () => {
  it("promover a OWNER agrega al padrón (idempotente)", () => {
    expect(resultingOwnerUserIds(["a"], { userId: "b", next: "OWNER" }).sort()).toEqual(["a", "b"]);
    expect(resultingOwnerUserIds(["a"], { userId: "a", next: "OWNER" })).toEqual(["a"]); // ya estaba
  });

  it("degradar (STAFF) o quitar (REMOVE) saca del padrón", () => {
    expect(resultingOwnerUserIds(["a", "b"], { userId: "a", next: "STAFF" })).toEqual(["b"]);
    expect(resultingOwnerUserIds(["a", "b"], { userId: "a", next: "REMOVE" })).toEqual(["b"]);
  });

  it("quitar/degradar al ÚNICO owner dejaría el perfil sin OWNER", () => {
    expect(wouldLeaveNoOwner(["a"], { userId: "a", next: "REMOVE" })).toBe(true);
    expect(wouldLeaveNoOwner(["a"], { userId: "a", next: "STAFF" })).toBe(true);
    expect(wouldLeaveNoOwner(["a", "b"], { userId: "a", next: "REMOVE" })).toBe(false);
    expect(wouldLeaveNoOwner(["a"], { userId: "a", next: "OWNER" })).toBe(false); // promover nunca vacía
  });

  it("assertKeepsOwner lanza LAST_OWNER solo cuando corresponde", () => {
    expect(memCode(() => assertKeepsOwner(["a"], { userId: "a", next: "REMOVE" }))).toBe(STORE_MEMBERSHIP_ERROR.LAST_OWNER);
    expect(memCode(() => assertKeepsOwner(["a", "b"], { userId: "a", next: "REMOVE" }))).toBe("NO_THROW");
    expect(memCode(() => assertKeepsOwner(["a"], { userId: "b", next: "REMOVE" }))).toBe("NO_THROW"); // b no es owner
  });

  it("assertBootstrapAllowed: solo admin global", () => {
    expect(memCode(() => assertBootstrapAllowed(true))).toBe("NO_THROW");
    expect(memCode(() => assertBootstrapAllowed(false))).toBe(STORE_MEMBERSHIP_ERROR.BOOTSTRAP_FORBIDDEN);
  });
});
