/**
 * EC-2 — Contrato de `isAdmin` (fail-closed). Unit puro: `isAdmin` es función de (email, env), sin DB/IO. Aísla
 * completamente `process.env.ADMIN_EMAIL` (guarda y restaura tras cada test, incluso si falla), distinguiendo
 * ausente (undefined) de string vacío.
 *
 * Regla: `true` SOLO con `ADMIN_EMAIL` configurada (no vacía tras trim) y email === ella. Todo lo demás → `false`.
 * Sin fallback literal, sin normalización del email de sesión.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAdmin } from "@/lib/admin";

describe("isAdmin — fail-closed", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.ADMIN_EMAIL; // undefined si estaba ausente
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = original;
  });

  /** Setea (string) o elimina (undefined) la env, distinguiendo ausente de vacía. */
  const setEnv = (value: string | undefined) => {
    if (value === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = value;
  };

  it("ADMIN_EMAIL configurada + coincidencia exacta → true", () => {
    setEnv("admin@x.com");
    expect(isAdmin("admin@x.com")).toBe(true);
  });

  it("ADMIN_EMAIL configurada + email distinto → false", () => {
    setEnv("admin@x.com");
    expect(isAdmin("other@x.com")).toBe(false);
  });

  it("email undefined/null/vacío → false", () => {
    setEnv("admin@x.com");
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin("")).toBe(false);
  });

  it("ADMIN_EMAIL ausente → false (incluso para el literal del fallback anterior)", () => {
    setEnv(undefined);
    expect(isAdmin("admin@x.com")).toBe(false);
    expect(isAdmin("alobato@evisit.com")).toBe(false); // la puerta trasera vieja ya no existe
  });

  it("ADMIN_EMAIL vacía → false", () => {
    setEnv("");
    expect(isAdmin("admin@x.com")).toBe(false);
    expect(isAdmin("")).toBe(false);
  });

  it("ADMIN_EMAIL solo whitespace → false", () => {
    setEnv("   ");
    expect(isAdmin("admin@x.com")).toBe(false);
    expect(isAdmin("   ")).toBe(false); // no matchea el email contra el env whitespace
  });

  it("ADMIN_EMAIL con espacios externos → true tras trim del env", () => {
    setEnv("  admin@x.com  ");
    expect(isAdmin("admin@x.com")).toBe(true);
  });

  it("email con casing diferente → false (sin normalización de identidad)", () => {
    setEnv("admin@x.com");
    expect(isAdmin("Admin@x.com")).toBe(false);
    expect(isAdmin("ADMIN@X.COM")).toBe(false);
  });

  it("email con espacios externos → false (no se trimea el email de sesión)", () => {
    setEnv("admin@x.com");
    expect(isAdmin(" admin@x.com ")).toBe(false);
  });

  it("email literal del fallback anterior con env ausente → false", () => {
    setEnv(undefined);
    expect(isAdmin("alobato@evisit.com")).toBe(false);
  });
});
