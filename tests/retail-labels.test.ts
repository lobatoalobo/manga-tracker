import { describe, it, expect } from "vitest";
import {
  ESTADOS_PROMESA,
  etiquetasDe,
  getClienteLabel,
  getTiendaLabel,
  getTono,
  type EstadoPromesa,
  type EtiquetaPromesa,
} from "@/lib/domain/retail/labels";

// Valores esperados ESCRITOS LITERALMENTE (no importados de la impl): si cambia un
// texto o un tono, falla EXACTAMENTE la fila correspondiente por su nombre.
const ESPERADO: Record<EstadoPromesa, EtiquetaPromesa> = {
  esperando: { cliente: "Esperando — te lo guardamos", tienda: "Reservado · por preparar", tono: "neutral" },
  llegaron_a_pagar: { cliente: "¡Llegó! — falta pagar", tienda: "Listo · a cobrar", tono: "warn" },
  comprobante_por_validar: { cliente: "Comprobante enviado — por validar", tienda: "Por validar", tono: "warn" },
  pagado_a_retirar: { cliente: "Pagado — listo para retirar", tienda: "Listo · pagado", tono: "go" },
  retirada: { cliente: "Retirado ✓", tienda: "Entregado · cumplida", tono: "go" },
  cancelada: { cliente: "Dado de baja", tienda: "Cancelada", tono: "neutral" },
  caida: { cliente: "No pudimos cumplirlo", tienda: "Caída · dado de baja", tono: "warn" },
  vencida: { cliente: "Pedido vencido", tienda: "Vencida", tono: "warn" },
};

describe("labels · traducción de estado de promesa (por fila)", () => {
  it.each(Object.keys(ESPERADO) as EstadoPromesa[])("%s: cliente / tienda / tono", (estado) => {
    const esperado = ESPERADO[estado];
    const actual = etiquetasDe(estado);
    expect(actual.cliente).toBe(esperado.cliente);
    expect(actual.tienda).toBe(esperado.tienda);
    expect(actual.tono).toBe(esperado.tono);
  });
});

describe("labels · exhaustividad e integridad", () => {
  it("ESTADOS_PROMESA cubre exactamente los 8 estados esperados", () => {
    expect([...ESTADOS_PROMESA].sort()).toEqual((Object.keys(ESPERADO) as string[]).sort());
  });

  it("ningún estado devuelve textos vacíos ni tono inválido", () => {
    const tonosValidos = new Set(["neutral", "mark", "warn", "go"]);
    for (const estado of ESTADOS_PROMESA) {
      const e = etiquetasDe(estado);
      expect(e.cliente.length).toBeGreaterThan(0);
      expect(e.tienda.length).toBeGreaterThan(0);
      expect(tonosValidos.has(e.tono)).toBe(true);
    }
  });
});

describe("labels · coherencia de los getters con etiquetasDe", () => {
  it.each([...ESTADOS_PROMESA])("%s: getters == etiquetasDe", (estado) => {
    const e = etiquetasDe(estado);
    expect(getClienteLabel(estado)).toBe(e.cliente);
    expect(getTiendaLabel(estado)).toBe(e.tienda);
    expect(getTono(estado)).toBe(e.tono);
  });
});
