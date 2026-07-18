import { describe, it, expect } from "vitest";
import { ValidationError } from "@/lib/mutations";
import {
  createCommittedProposalResultHolder,
  CommittedResultUnavailableError,
  prismaCreateProposalIO,
} from "@/lib/infra/proposal/create";
import {
  assertCompatibleReplay,
  IdempotencyConflictError,
  resolveSeed,
  sameFingerprint,
  fingerprintOfSeed,
  fingerprintOfExisting,
  validateStructure,
  type CatalogProposalSeed,
  type ContentClass,
  type CreateCatalogProposalInput,
  type CreateProposalReadPort,
  type ExistingProposal,
} from "@/lib/domain/proposal/create";

// --- doble de prueba: read-port en memoria (contrato, no Prisma) ---
function fakeRead(over: Partial<{
  work: ContentClass | null;
  edition: ContentClass | null;
  volume: ContentClass | null;
  existing: ExistingProposal | null;
}> = {}): CreateProposalReadPort {
  return {
    findByIdempotencyKey: async () => over.existing ?? null,
    contentClassOfWork: async () => over.work ?? null,
    contentClassOfEdition: async () => over.edition ?? null,
    contentClassOfVolume: async () => over.volume ?? null,
  };
}

const base = (o: Partial<CreateCatalogProposalInput>): CreateCatalogProposalInput => ({
  createIdempotencyKey: "key-1",
  family: "ALTA",
  targetKind: "NEW_WORK",
  contentClass: "MANGA",
  ...o,
});

const USER = "user-abc";

describe("validateStructure — matriz y columnas", () => {
  it("acepta ALTA + NEW_WORK con contentClass", () => {
    expect(() => validateStructure(base({}))).not.toThrow();
  });
  it("acepta REPORTE + STRUCTURAL + DUPLICATE con A≠B", () => {
    expect(() =>
      validateStructure(base({
        family: "REPORTE", targetKind: "STRUCTURAL", relationKind: "DUPLICATE",
        contentClass: null, refWorkId: 10, refWorkBId: 20,
      })),
    ).not.toThrow();
  });
  it("rechaza family × targetKind inválido (ALTA + WORK)", () => {
    expect(() => validateStructure(base({ targetKind: "WORK", refWorkId: 1 })))
      .toThrow(ValidationError);
  });
  it("rechaza NEW_WORK sin contentClass", () => {
    expect(() => validateStructure(base({ contentClass: null }))).toThrow(ValidationError);
  });
  it("rechaza NEW_WORK con refWorkId", () => {
    expect(() => validateStructure(base({ refWorkId: 5 }))).toThrow(ValidationError);
  });
  it("rechaza WORK sin refWorkId", () => {
    expect(() => validateStructure(base({ family: "CORRECCION", targetKind: "WORK", contentClass: null })))
      .toThrow(ValidationError);
  });
  it("rechaza EDITION con refWorkId sobrante", () => {
    expect(() => validateStructure(base({
      family: "CORRECCION", targetKind: "EDITION", contentClass: null, refEditionId: 3, refWorkId: 9,
    }))).toThrow(ValidationError);
  });
  it("rechaza DUPLICATE sin refWorkBId", () => {
    expect(() => validateStructure(base({
      family: "REPORTE", targetKind: "STRUCTURAL", relationKind: "DUPLICATE", contentClass: null, refWorkId: 10,
    }))).toThrow(ValidationError);
  });
  it("rechaza DUPLICATE con A = B", () => {
    expect(() => validateStructure(base({
      family: "REPORTE", targetKind: "STRUCTURAL", relationKind: "DUPLICATE", contentClass: null, refWorkId: 10, refWorkBId: 10,
    }))).toThrow(ValidationError);
  });
  it("rechaza BAD_MERGE con refWorkBId", () => {
    expect(() => validateStructure(base({
      family: "REPORTE", targetKind: "STRUCTURAL", relationKind: "BAD_MERGE", contentClass: null, refWorkId: 10, refWorkBId: 20,
    }))).toThrow(ValidationError);
  });
  it("rechaza enum de familia inválido", () => {
    expect(() => validateStructure(base({ family: "FOO" as never }))).toThrow(ValidationError);
  });
  it("rechaza createIdempotencyKey vacío", () => {
    expect(() => validateStructure(base({ createIdempotencyKey: "  " }))).toThrow(ValidationError);
  });
});

describe("resolveSeed — derivación de contentClass", () => {
  it("ALTA + NEW_WORK usa el contentClass del input", async () => {
    const seed = await resolveSeed(fakeRead(), base({ contentClass: "COMIC" }), USER);
    expect(seed.contentClass).toBe("COMIC");
    expect(seed.originatorUserId).toBe(USER);
    expect(seed.refWorkId).toBeNull();
  });
  it("CORRECCION + WORK deriva contentClass del Work referenciado", async () => {
    const seed = await resolveSeed(
      fakeRead({ work: "COMIC" }),
      base({ family: "CORRECCION", targetKind: "WORK", contentClass: null, refWorkId: 7 }),
      USER,
    );
    expect(seed.contentClass).toBe("COMIC");
    expect(seed.refWorkId).toBe(7);
  });
  it("NEW_VOLUME deriva contentClass de la edición padre", async () => {
    const seed = await resolveSeed(
      fakeRead({ edition: "MANGA" }),
      base({ family: "ALTA", targetKind: "NEW_VOLUME", contentClass: null, refEditionId: 4 }),
      USER,
    );
    expect(seed.contentClass).toBe("MANGA");
  });
  it("VOLUME deriva contentClass del volumen referenciado", async () => {
    const seed = await resolveSeed(
      fakeRead({ volume: "COMIC" }),
      base({ family: "CORRECCION", targetKind: "VOLUME", contentClass: null, refVolumeId: 99 }),
      USER,
    );
    expect(seed.contentClass).toBe("COMIC");
  });
  it("rechaza si la entidad referenciada no existe (read → null)", async () => {
    await expect(
      resolveSeed(fakeRead({ work: null }),
        base({ family: "CORRECCION", targetKind: "WORK", contentClass: null, refWorkId: 7 }), USER),
    ).rejects.toThrow(ValidationError);
  });
  it("rechaza si el contentClass del input no coincide con el derivado", async () => {
    await expect(
      resolveSeed(fakeRead({ work: "MANGA" }),
        base({ family: "CORRECCION", targetKind: "WORK", contentClass: "COMIC", refWorkId: 7 }), USER),
    ).rejects.toThrow(ValidationError);
  });
});

describe("idempotencia — huella y reconciliación", () => {
  const seed: CatalogProposalSeed = {
    family: "ALTA", targetKind: "NEW_WORK", contentClass: "MANGA",
    refWorkId: null, refEditionId: null, refVolumeId: null, refWorkBId: null,
    relationKind: null, createIdempotencyKey: "key-1", originatorUserId: USER,
  };
  const existing = (o: Partial<ExistingProposal> = {}): ExistingProposal => ({
    id: 1, status: "SUBMITTED", originatingContributionId: 11,
    family: "ALTA", targetKind: "NEW_WORK", contentClass: "MANGA",
    refWorkId: null, refEditionId: null, refVolumeId: null, refWorkBId: null, relationKind: null,
    ...o,
  });

  it("huellas iguales → replay compatible (no lanza)", () => {
    expect(sameFingerprint(fingerprintOfSeed(seed), fingerprintOfExisting(existing()))).toBe(true);
    expect(() => assertCompatibleReplay(seed, existing())).not.toThrow();
  });
  it("misma key con huella distinta → IdempotencyConflictError", () => {
    expect(() => assertCompatibleReplay(seed, existing({ contentClass: "COMIC" })))
      .toThrow(IdempotencyConflictError);
  });
});

describe("captura encapsulada — holder y getter", () => {
  const R = { proposalId: 1, contributionId: 11, status: "SUBMITTED" };

  it("get() antes de set() lanza CommittedResultUnavailableError (tipado)", () => {
    const h = createCommittedProposalResultHolder();
    expect(() => h.get()).toThrow(CommittedResultUnavailableError);
  });

  it("una creación exitosa (set) permite obtener el resultado por el getter", () => {
    const h = createCommittedProposalResultHolder();
    h.set(R);
    expect(h.get()).toEqual(R);
  });

  it("el getter no expone estado mutable interno (copia congelada)", () => {
    const h = createCommittedProposalResultHolder();
    h.set(R);
    const out = h.get();
    expect(Object.isFrozen(out)).toBe(true);
    expect(() => {
      (out as { proposalId: number }).proposalId = 999;
    }).toThrow(); // congelado: no se puede mutar
    expect(h.get().proposalId).toBe(1); // el estado interno no cambió
    // cada get() devuelve un objeto NUEVO (no la misma referencia interna)
    expect(h.get()).not.toBe(out);
  });

  it("set() copia la entrada: mutar el objeto original no afecta lo guardado", () => {
    const h = createCommittedProposalResultHolder();
    const input = { proposalId: 5, contributionId: 6, status: "SUBMITTED" };
    h.set(input);
    input.proposalId = 999;
    expect(h.get().proposalId).toBe(5);
  });

  it("dos holders mantienen estado aislado (concurrencia)", () => {
    const a = createCommittedProposalResultHolder();
    const b = createCommittedProposalResultHolder();
    a.set({ proposalId: 1, contributionId: 10, status: "SUBMITTED" });
    b.set({ proposalId: 2, contributionId: 20, status: "NEEDS_INFO" });
    expect(a.get()).toEqual({ proposalId: 1, contributionId: 10, status: "SUBMITTED" });
    expect(b.get()).toEqual({ proposalId: 2, contributionId: 20, status: "NEEDS_INFO" });
  });

  it("prismaCreateProposalIO(): solo expone io + getCommittedResult, sin objeto mutable", () => {
    const handle = prismaCreateProposalIO();
    expect(Object.keys(handle).sort()).toEqual(["getCommittedResult", "io"]);
    expect("captured" in handle).toBe(false);
    // getter antes de correr la mutación → lanza (no hay resultado aún)
    expect(() => handle.getCommittedResult()).toThrow(CommittedResultUnavailableError);
  });

  it("dos instancias de prismaCreateProposalIO() no comparten estado", () => {
    const h1 = prismaCreateProposalIO();
    const h2 = prismaCreateProposalIO();
    expect(() => h1.getCommittedResult()).toThrow(CommittedResultUnavailableError);
    expect(() => h2.getCommittedResult()).toThrow(CommittedResultUnavailableError);
    expect(h1.getCommittedResult).not.toBe(h2.getCommittedResult);
  });
});
