import { describe, it, expect } from "vitest";
import { CAMPAIGN_STATUS } from "@/lib/domain/retail/campaign";
import {
  deriveCampaignStage,
  isOpenStage,
  sameMonth,
  STORE_STAGE_LABEL,
  CLOSING_SOON_MS,
  type CampaignFulfillmentTotals,
  type StoreStage,
} from "@/lib/domain/retail/pipeline-stage";

const NOW = new Date("2026-08-06T12:00:00Z");
const totals = (t: Partial<CampaignFulfillmentTotals> = {}): CampaignFulfillmentTotals => ({
  quantity: 0, ordered: 0, arrived: 0, cancelled: 0, prepared: 0, pickedUp: 0, ...t,
});

describe("pipeline-stage · etapa por status (no post-cierre)", () => {
  it("DRAFT → preparando", () => {
    expect(deriveCampaignStage({ status: CAMPAIGN_STATUS.DRAFT, opensAt: null, closesAt: null, totals: totals() }, NOW)).toBe("preparando");
  });

  it("CANCELLED → cancelada", () => {
    expect(deriveCampaignStage({ status: CAMPAIGN_STATUS.CANCELLED, opensAt: null, closesAt: null, totals: totals() }, NOW)).toBe("cancelada");
  });

  it("PUBLISHED con cierre lejano → abierta", () => {
    const closesAt = new Date(NOW.getTime() + 5 * 86_400_000);
    expect(deriveCampaignStage({ status: CAMPAIGN_STATUS.PUBLISHED, opensAt: null, closesAt, totals: totals() }, NOW)).toBe("abierta");
  });

  it("PUBLISHED con cierre dentro de 24h → por_cerrar", () => {
    const closesAt = new Date(NOW.getTime() + CLOSING_SOON_MS - 1000);
    expect(deriveCampaignStage({ status: CAMPAIGN_STATUS.PUBLISHED, opensAt: null, closesAt, totals: totals() }, NOW)).toBe("por_cerrar");
  });

  it("PUBLISHED con cierre ya pasado → por_cerrar", () => {
    const closesAt = new Date(NOW.getTime() - 3_600_000);
    expect(deriveCampaignStage({ status: CAMPAIGN_STATUS.PUBLISHED, opensAt: null, closesAt, totals: totals() }, NOW)).toBe("por_cerrar");
  });

  it("PUBLISHED sin fecha de cierre → abierta", () => {
    expect(deriveCampaignStage({ status: CAMPAIGN_STATUS.PUBLISHED, opensAt: null, closesAt: null, totals: totals() }, NOW)).toBe("abierta");
  });
});

describe("pipeline-stage · progresión post-cierre (CLOSED, por contadores)", () => {
  const closed = (t: Partial<CampaignFulfillmentTotals>): StoreStage =>
    deriveCampaignStage({ status: CAMPAIGN_STATUS.CLOSED, opensAt: null, closesAt: null, totals: totals(t) }, NOW);

  it("cerrada sin nada pedido → pedido_distribuidor", () => {
    expect(closed({ quantity: 10 })).toBe("pedido_distribuidor");
  });

  it("pedido parcial → sigue pedido_distribuidor", () => {
    expect(closed({ quantity: 10, ordered: 6 })).toBe("pedido_distribuidor");
  });

  it("todo pedido, nada llegó → esperando_llegada", () => {
    expect(closed({ quantity: 10, ordered: 10, arrived: 3 })).toBe("esperando_llegada");
  });

  it("todo llegó, nada preparado → preparando_pedidos", () => {
    expect(closed({ quantity: 10, ordered: 10, arrived: 10 })).toBe("preparando_pedidos");
  });

  it("preparado pero no retirado → entregando", () => {
    expect(closed({ quantity: 10, ordered: 10, arrived: 10, prepared: 10, pickedUp: 4 })).toBe("entregando");
  });

  it("todo retirado → finalizada", () => {
    expect(closed({ quantity: 10, ordered: 10, arrived: 10, prepared: 10, pickedUp: 10 })).toBe("finalizada");
  });

  it("todo cancelado (nada a cumplir) → finalizada", () => {
    expect(closed({ quantity: 10, cancelled: 10 })).toBe("finalizada");
  });

  it("cancelaciones descuentan lo cumplible: 10 − 4 cancel, 6 llegaron/preparados/retirados → finalizada", () => {
    expect(closed({ quantity: 10, cancelled: 4, ordered: 6, arrived: 6, prepared: 6, pickedUp: 6 })).toBe("finalizada");
  });
});

describe("pipeline-stage · helpers", () => {
  it("isOpenStage solo es verdadero para 'abierta'", () => {
    const all: StoreStage[] = Object.keys(STORE_STAGE_LABEL) as StoreStage[];
    for (const s of all) expect(isOpenStage(s)).toBe(s === "abierta");
  });

  it("STORE_STAGE_LABEL cubre las 9 etapas con texto no vacío", () => {
    const keys = Object.keys(STORE_STAGE_LABEL);
    expect(keys.length).toBe(9);
    for (const k of keys) expect(STORE_STAGE_LABEL[k as StoreStage].length).toBeGreaterThan(0);
  });

  it("sameMonth compara año+mes (fechas locales)", () => {
    expect(sameMonth(new Date(2026, 7, 1), new Date(2026, 7, 28))).toBe(true);
    expect(sameMonth(new Date(2026, 7, 1), new Date(2026, 8, 1))).toBe(false);
    expect(sameMonth(new Date(2026, 7, 1), new Date(2025, 7, 1))).toBe(false);
  });
});
