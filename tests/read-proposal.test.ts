import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  toCatalogProposalDetail,
  type ProposalDetailRow,
} from "@/lib/domain/proposal/readModel";
import { getCatalogProposalDetail } from "@/lib/contributions/readProposal";
import { isEnabled } from "@/lib/featureFlags";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/featureFlags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { catalogProposal: { findUnique: vi.fn() } } }));

const findUnique = () => prisma.catalogProposal.findUnique as unknown as ReturnType<typeof vi.fn>;

// Fila del agregado (shape de la query) — contribuciones y claims DESORDENADAS a
// propósito para probar el orden determinista del mapper.
function makeRow(over: Partial<ProposalDetailRow> = {}): ProposalDetailRow {
  const c1: ProposalDetailRow["contributions"][number] = {
    id: 1, createdAt: new Date("2026-01-01T00:00:00.000Z"), visibility: "VISIBLE",
    withdrawnAt: null, authorId: "u1",
    claims: [
      { id: 12, attributeKind: "TITLE_LOCALIZED", contractVersion: 1, claimOperation: "SET", value: { language: "es", text: "x" }, result: "PROPUESTA", resultReason: null },
      { id: 11, attributeKind: "START_DATE", contractVersion: 1, claimOperation: "MARK_UNKNOWN", value: null, result: "PROPUESTA", resultReason: null },
    ],
  };
  const c2: ProposalDetailRow["contributions"][number] = {
    id: 2, createdAt: new Date("2026-01-02T00:00:00.000Z"), visibility: "OCULTA",
    withdrawnAt: new Date("2026-01-03T00:00:00.000Z"), authorId: "u2",
    claims: [{ id: 20, attributeKind: "WORK_TYPE", contractVersion: 1, claimOperation: "SET", value: "MANGA", result: "PROPUESTA", resultReason: null }],
  };
  const c3: ProposalDetailRow["contributions"][number] = {
    id: 3, createdAt: new Date("2026-01-04T00:00:00.000Z"), visibility: "EN_CUARENTENA",
    withdrawnAt: null, authorId: null, claims: [],
  };
  return {
    id: 5, status: "SUBMITTED", family: "CORRECCION", contentClass: "MANGA",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    targetKind: "WORK", refWorkId: 10, refEditionId: null, refVolumeId: null,
    refWorkBId: null, relationKind: null,
    contributions: [c2, c1, c3], // desordenadas
    ...over,
  };
}

describe("toCatalogProposalDetail — mapper puro", () => {
  it("serializa ids como string y fechas como ISO", () => {
    const d = toCatalogProposalDetail(makeRow());
    expect(d.id).toBe("5");
    expect(d.createdAt).toBe("2026-01-01T10:00:00.000Z");
    expect(d.target).toEqual({
      kind: "WORK", refWorkId: "10", refEditionId: null, refVolumeId: null,
      refWorkBId: null, relationKind: null,
    });
    expect(d.contributions[0].id).toBe("1");
    expect(d.contributions[1].withdrawnAt).toBe("2026-01-03T00:00:00.000Z");
    expect(d.contributions[0].withdrawnAt).toBeNull();
  });

  it("ordena contribuciones (createdAt,id) y claims (id) de forma determinista", () => {
    const d = toCatalogProposalDetail(makeRow());
    expect(d.contributions.map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(d.contributions[0].claims.map((c) => c.id)).toEqual(["11", "12"]);
  });

  it("deriva isOriginating (la más antigua = true, resto false)", () => {
    const d = toCatalogProposalDetail(makeRow());
    expect(d.contributions.map((c) => c.isOriginating)).toEqual([true, false, false]);
  });

  it("preserva value JSON y value null sin transformar", () => {
    const d = toCatalogProposalDetail(makeRow());
    expect(d.contributions[0].claims[0].value).toBeNull(); // MARK_UNKNOWN (id 11)
    expect(d.contributions[0].claims[1].value).toEqual({ language: "es", text: "x" }); // id 12
  });

  it("incluye TODAS las contribuciones (retirada / OCULTA / EN_CUARENTENA) sin filtrar", () => {
    const d = toCatalogProposalDetail(makeRow());
    expect(d.contributions.map((c) => c.visibility)).toEqual(["VISIBLE", "OCULTA", "EN_CUARENTENA"]);
    expect(d.contributions.map((c) => c.claims.length)).toEqual([2, 1, 0]);
  });

  it("no expone campos internos (solo las claves del contrato)", () => {
    const d = toCatalogProposalDetail(makeRow());
    expect(Object.keys(d.contributions[0]).sort()).toEqual(
      ["authorId", "claims", "createdAt", "id", "isOriginating", "visibility", "withdrawnAt"],
    );
    expect(Object.keys(d.contributions[0].claims[0]).sort()).toEqual(
      ["attributeKind", "claimOperation", "contractVersion", "id", "result", "resultReason", "value"],
    );
    const s = JSON.stringify(d);
    for (const forbidden of ["idempotencyKey", "createIdempotencyKey", "version", "originatorUserId", "answersInfoRequestId", "resolvedByUserId", "promotedAssetRef"])
      expect(s).not.toContain(forbidden);
  });
});

describe("getCatalogProposalDetail — flag + autorización + query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEnabled).mockResolvedValue(true);
    vi.mocked(auth).mockResolvedValue({ user: { email: "admin@x.com" } } as never);
    vi.mocked(isAdmin).mockReturnValue(true);
    findUnique().mockResolvedValue(makeRow());
  });

  it("flag apagado → null incluso para admin, sin tocar la DB", async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    expect(await getCatalogProposalDetail(5)).toBeNull();
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it("anónimo → null (no revela existencia), sin query", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    vi.mocked(isAdmin).mockReturnValue(false);
    expect(await getCatalogProposalDetail(5)).toBeNull();
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it("autenticado no-admin → null, sin query", async () => {
    vi.mocked(isAdmin).mockReturnValue(false);
    expect(await getCatalogProposalDetail(5)).toBeNull();
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it("id inválido → null, sin query", async () => {
    expect(await getCatalogProposalDetail(0)).toBeNull();
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it("inexistente (admin) → null, mismo resultado externo que forbidden", async () => {
    findUnique().mockResolvedValue(null);
    expect(await getCatalogProposalDetail(5)).toBeNull();
  });

  it("admin + propuesta abierta → detalle completo", async () => {
    const d = await getCatalogProposalDetail(5);
    expect(d).not.toBeNull();
    expect(d!.id).toBe("5");
    expect(d!.status).toBe("SUBMITTED");
    expect(d!.contributions).toHaveLength(3);
    expect(d!.contributions[0].isOriginating).toBe(true);
  });

  it("admin + propuesta terminal → visible", async () => {
    findUnique().mockResolvedValue(makeRow({ status: "ACEPTADA" }));
    const d = await getCatalogProposalDetail(5);
    expect(d!.status).toBe("ACEPTADA");
    expect(d!.contributions).toHaveLength(3);
  });

  it("una sola query con include anidado de contribuciones→claims (sin N+1)", async () => {
    await getCatalogProposalDetail(5);
    expect(findUnique()).toHaveBeenCalledTimes(1);
    const arg = findUnique().mock.calls[0][0] as {
      select: { contributions: { orderBy: unknown; select: { claims: { orderBy: unknown; select: unknown } } } };
    };
    expect(arg.select.contributions.select.claims.select).toBeDefined();
    expect(arg.select.contributions.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(arg.select.contributions.select.claims.orderBy).toEqual({ id: "asc" });
  });
});
