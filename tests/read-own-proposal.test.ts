import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  toOwnCatalogProposalDetail,
  type OwnProposalRow,
  type ViewerRelationship,
} from "@/lib/domain/proposal/ownReadModel";
import { getOwnCatalogProposalDetail } from "@/lib/contributions/readOwnProposal";
import { isEnabled } from "@/lib/featureFlags";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { catalogProposal: { findUnique: vi.fn() } } }));

const findUnique = () => prisma.catalogProposal.findUnique as unknown as ReturnType<typeof vi.fn>;

// Fila con SOLO las contribuciones del viewer (como la deja la query filtrada).
function makeOwnRow(over: Partial<OwnProposalRow> = {}): OwnProposalRow {
  const c1: OwnProposalRow["contributions"][number] = {
    id: 1, createdAt: new Date("2026-01-01T00:00:00.000Z"), visibility: "VISIBLE", withdrawnAt: null,
    claims: [
      { id: 12, attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "x" }, result: "PROPUESTA", resultReason: null },
      { id: 11, attributeKind: "START_DATE", contractVersion: 1, claimOperation: "MARK_UNKNOWN", value: null, result: "PROPUESTA", resultReason: null },
    ],
  };
  const c2: OwnProposalRow["contributions"][number] = {
    id: 2, createdAt: new Date("2026-01-02T00:00:00.000Z"), visibility: "OCULTA",
    withdrawnAt: new Date("2026-01-03T00:00:00.000Z"),
    claims: [{ id: 20, attributeKind: "WORK_TYPE", contractVersion: 1, claimOperation: "SET", value: "MANGA", result: "PROPUESTA", resultReason: null }],
  };
  return {
    id: 5, status: "SUBMITTED", family: "CORRECCION", contentClass: "MANGA",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    targetKind: "WORK", refWorkId: 10, refEditionId: null, refVolumeId: null,
    refWorkBId: null, relationKind: null,
    contributions: [c2, c1], // desordenadas
    ...over,
  };
}
const rel = (o: Partial<ViewerRelationship> = {}): ViewerRelationship => ({ isOriginator: true, isContributor: true, ...o });

describe("toOwnCatalogProposalDetail — mapper propio", () => {
  it("serializa, ordena y expone relationship; incluye OCULTA/retirada propias", () => {
    const d = toOwnCatalogProposalDetail(makeOwnRow(), rel());
    expect(d.id).toBe("5");
    expect(d.createdAt).toBe("2026-01-01T10:00:00.000Z");
    expect(d.relationship).toEqual({ isOriginator: true, isContributor: true });
    expect(d.target.refWorkId).toBe("10");
    expect(d.contributions.map((c) => c.id)).toEqual(["1", "2"]); // createdAt,id
    expect(d.contributions[1].visibility).toBe("OCULTA");
    expect(d.contributions[1].withdrawnAt).toBe("2026-01-03T00:00:00.000Z");
    expect(d.contributions[0].claims.map((c) => c.id)).toEqual(["11", "12"]); // id ASC
    expect(d.contributions[0].claims[0].value).toBeNull(); // MARK_UNKNOWN
    expect(d.contributions[0].claims[1].value).toEqual({ language: "es", text: "x" });
  });

  it("isOriginating: originador → la más antigua propia true; resto false", () => {
    const d = toOwnCatalogProposalDetail(makeOwnRow(), rel({ isOriginator: true }));
    expect(d.contributions.map((c) => c.isOriginating)).toEqual([true, false]);
  });

  it("isOriginating: aportante NO originador → todas false", () => {
    const d = toOwnCatalogProposalDetail(makeOwnRow(), rel({ isOriginator: false }));
    expect(d.contributions.map((c) => c.isOriginating)).toEqual([false, false]);
  });

  it("no expone authorId ni originatorUserId ni otros campos internos", () => {
    const d = toOwnCatalogProposalDetail(makeOwnRow(), rel());
    expect(d.contributions[0]).not.toHaveProperty("authorId");
    expect(Object.keys(d.contributions[0]).sort()).toEqual(
      ["claims", "createdAt", "id", "isOriginating", "visibility", "withdrawnAt"],
    );
    const s = JSON.stringify(d);
    for (const forbidden of ["authorId", "originatorUserId", "idempotencyKey", "version"])
      expect(s).not.toContain(forbidden);
  });
});

describe("getOwnCatalogProposalDetail — flag + sesión + autorización + aislamiento", () => {
  const appRow = (over: Record<string, unknown> = {}) => ({ ...makeOwnRow(), originatorUserId: "u1", ...over });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
    findUnique().mockResolvedValue(appRow());
  });

  it("flag apagado → null, sin query", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    expect(await getOwnCatalogProposalDetail(5)).toBeNull();
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it("sin sesión → null, sin query", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await getOwnCatalogProposalDetail(5)).toBeNull();
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it("id inválido → null, sin query", async () => {
    expect(await getOwnCatalogProposalDetail(0)).toBeNull();
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it("inexistente → null", async () => {
    findUnique().mockResolvedValue(null);
    expect(await getOwnCatalogProposalDetail(5)).toBeNull();
  });

  it("existe pero NO relacionado (ni originador ni aportante) → null", async () => {
    findUnique().mockResolvedValue(appRow({ originatorUserId: "otro", contributions: [] }));
    expect(await getOwnCatalogProposalDetail(5)).toBeNull();
  });

  it("originador → detalle con isOriginator:true", async () => {
    const d = await getOwnCatalogProposalDetail(5);
    expect(d).not.toBeNull();
    expect(d!.relationship).toEqual({ isOriginator: true, isContributor: true });
    expect(d!.contributions).toHaveLength(2);
    expect(d!.contributions[0].isOriginating).toBe(true);
  });

  it("aportante NO originador → isOriginator:false, isContributor:true", async () => {
    findUnique().mockResolvedValue(appRow({ originatorUserId: "otro" }));
    const d = await getOwnCatalogProposalDetail(5);
    expect(d!.relationship).toEqual({ isOriginator: false, isContributor: true });
    expect(d!.contributions.every((c) => c.isOriginating === false)).toBe(true);
  });

  it("aislamiento: la query filtra contribuciones por authorId = viewer (no carga ajenas)", async () => {
    await getOwnCatalogProposalDetail(5);
    expect(findUnique()).toHaveBeenCalledTimes(1);
    const arg = findUnique().mock.calls[0][0] as {
      select: { contributions: { where: { authorId: string } } };
    };
    expect(arg.select.contributions.where).toEqual({ authorId: "u1" });
  });
});
