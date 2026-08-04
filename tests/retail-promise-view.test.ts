import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  derivePromiseView,
  type PromesaFacetas,
  type EstadoPagoPromesaVista,
} from "@/lib/domain/retail/promise-view";
import {
  getClienteLabel,
  getTiendaLabel,
  getTono,
  type EstadoPromesa,
} from "@/lib/domain/retail/labels";
import { ORDER_HANDOFF } from "@/lib/domain/retail/handoff";

// Base viva pero neutra: promesa reservada, sin cargo, no avisada, cancelable.
// Cada test sobrescribe solo las facetas que le importan.
function facetas(over: Partial<PromesaFacetas> = {}): PromesaFacetas {
  return {
    handoff: ORDER_HANDOFF.NOT_STARTED,
    pago: "no_habilitado",
    avisado: false,
    cancelable: true,
    ...over,
  };
}

describe("promise-view · terminales (misma proyección para ambos actores)", () => {
  it("COMPLETED → ambos retirada, sin acciones", () => {
    const v = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.COMPLETED, cancelable: false }));
    expect(v.cliente.estado).toBe("retirada");
    expect(v.tienda.estado).toBe("retirada");
    expect(v.accionesCliente).toEqual([]);
    expect(v.accionesTienda).toEqual([]);
  });

  it.each(["cancelada", "caida", "vencida"] as const)("muerte %s → ambos ese estado, sin acciones", (muerte) => {
    // cancelable true a propósito: una promesa muerta NUNCA ofrece cancelar.
    const v = derivePromiseView(facetas({ muerte, cancelable: true }));
    expect(v.cliente.estado).toBe(muerte);
    expect(v.tienda.estado).toBe(muerte);
    expect(v.accionesCliente).toEqual([]);
    expect(v.accionesTienda).toEqual([]);
  });
});

describe("promise-view · matriz activa por actor", () => {
  it("NOT_STARTED / IN_PROGRESS → ambos esperando", () => {
    for (const handoff of [ORDER_HANDOFF.NOT_STARTED, ORDER_HANDOFF.IN_PROGRESS] as const) {
      const v = derivePromiseView(facetas({ handoff }));
      expect(v.cliente.estado).toBe("esperando");
      expect(v.tienda.estado).toBe("esperando");
    }
  });

  // (pago EstadoPagoPromesaVista) → estado ACTIVO de la tienda en READY_FOR_PICKUP.
  const ACTIVOS: [EstadoPagoPromesaVista, EstadoPromesa][] = [
    ["por_pagar", "llegaron_a_pagar"],
    ["comprobante_enviado", "comprobante_por_validar"],
    ["pagado", "pagado_a_retirar"],
  ];

  it.each(ACTIVOS)("READY + avisado + %s → ambos %s", (pago, esperado) => {
    const v = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago, avisado: true }));
    expect(v.tienda.estado).toBe(esperado);
    expect(v.cliente.estado).toBe(esperado);
  });

  it.each(ACTIVOS)("READY + NO avisado + %s → tienda %s, cliente esperando", (pago, esperado) => {
    const v = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago, avisado: false }));
    expect(v.tienda.estado).toBe(esperado);
    expect(v.cliente.estado).toBe("esperando");
  });
});

describe("promise-view · combinaciones inválidas (invariantes)", () => {
  it("muerte + COMPLETED → lanza", () => {
    expect(() => derivePromiseView(facetas({ muerte: "cancelada", handoff: ORDER_HANDOFF.COMPLETED }))).toThrow();
  });

  it("READY_FOR_PICKUP + no_habilitado → lanza (invariante del adapter)", () => {
    expect(() =>
      derivePromiseView(facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "no_habilitado", avisado: true })),
    ).toThrow();
  });
});

describe("promise-view · acciones del cliente", () => {
  it("cancelar depende de cancelable REAL, no del titular esperando", () => {
    const conCancel = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.NOT_STARTED, cancelable: true }));
    expect(conCancel.cliente.estado).toBe("esperando");
    expect(conCancel.accionesCliente).toContain("cancelar");

    const sinCancel = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.NOT_STARTED, cancelable: false }));
    expect(sinCancel.cliente.estado).toBe("esperando"); // mismo titular…
    expect(sinCancel.accionesCliente).not.toContain("cancelar"); // …pero no cancelable
  });

  it("adjuntar_comprobante solo cuando el CLIENTE ve llegaron_a_pagar", () => {
    const avisado = derivePromiseView(
      facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "por_pagar", avisado: true, cancelable: false }),
    );
    expect(avisado.cliente.estado).toBe("llegaron_a_pagar");
    expect(avisado.accionesCliente).toContain("adjuntar_comprobante");

    // No avisado: el cliente ve esperando → no se le pide adjuntar.
    const noAvisado = derivePromiseView(
      facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "por_pagar", avisado: false, cancelable: false }),
    );
    expect(noAvisado.cliente.estado).toBe("esperando");
    expect(noAvisado.accionesCliente).not.toContain("adjuntar_comprobante");
  });
});

describe("promise-view · acciones de la tienda", () => {
  it("comprobante_por_validar → ver / validar / rechazar", () => {
    const v = derivePromiseView(
      facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "comprobante_enviado", avisado: true }),
    );
    expect(v.accionesTienda).toEqual(["ver_comprobante", "validar_comprobante", "rechazar_comprobante"]);
  });

  it("pagado_a_retirar → entregar", () => {
    const v = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "pagado", avisado: true }));
    expect(v.accionesTienda).toEqual(["entregar"]);
  });

  it("llegaron_a_pagar → la tienda espera (sin acciones de mostrador)", () => {
    const v = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "por_pagar", avisado: true }));
    expect(v.accionesTienda).toEqual([]);
  });
});

describe("promise-view · las etiquetas salen de labels.ts (por actor, sin duplicar)", () => {
  it("caso convergente (avisado): cada actor con su columna del mismo estado", () => {
    const v = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "pagado", avisado: true }));
    expect(v.cliente.label).toBe(getClienteLabel(v.cliente.estado));
    expect(v.cliente.tono).toBe(getTono(v.cliente.estado));
    expect(v.tienda.label).toBe(getTiendaLabel(v.tienda.estado));
    expect(v.tienda.tono).toBe(getTono(v.tienda.estado));
  });

  it("caso divergente (READY sin avisar): cliente esperando, tienda activa, cada label de su estado", () => {
    const v = derivePromiseView(facetas({ handoff: ORDER_HANDOFF.READY_FOR_PICKUP, pago: "pagado", avisado: false }));
    expect(v.cliente.label).toBe(getClienteLabel("esperando"));
    expect(v.cliente.tono).toBe(getTono("esperando"));
    expect(v.tienda.label).toBe(getTiendaLabel("pagado_a_retirar"));
    expect(v.tienda.tono).toBe(getTono("pagado_a_retirar"));
  });
});

describe("promise-view · pureza (sin dependencias prohibidas)", () => {
  it("no importa react, prisma, componentes ni servicios (lib/retail)", () => {
    const src = readFileSync(fileURLToPath(new URL("../lib/domain/retail/promise-view.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/from ["']react["']/);
    expect(src).not.toMatch(/@prisma\/client|["']\.\.?\/.*prisma/);
    expect(src).not.toMatch(/@\/components\//);
    expect(src).not.toMatch(/@\/lib\/retail\b/); // permite @/lib/domain/retail
  });
});
