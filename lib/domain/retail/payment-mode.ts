// Traducción del MODO DE PAGO de una preventa/tomo a sus PUNTOS DE COBRO durante
// el ciclo: qué importe se vuelve exigible al reservar (CP1) y al llegar (CP2), y
// cómo se representa un modo con seña. PURO, importes en centavos ARS enteros.
//
// Responsabilidad (SÍ): describir el CRONOGRAMA de cobro de un modo dado un precio.
// La única API pública es `puntosDeCobro(config, totalCents)`.
//
// Responsabilidad (NO): no calcula estados de UI ni emite etiquetas, no consulta
// DB, no valida comprobantes, no mueve dinero, no decide el modo del piloto
// (`pilot.modoPago` no se fija acá), no conoce pantallas ni PromiseView.
//
// El "saldo" de CP2 es el resto PROGRAMADO (total − CP1), no `total − pagado`: por
// eso esta capa solo necesita el precio, nunca el ledger. Conciliar el cronograma
// con lo efectivamente pagado (y el comprobante) es tarea del adapter posterior.
// Ejemplo, SIN construir el adapter real (no pertenece a Fase 0):
//
//   // ADAPTER (fuera de Fase 0) — payment-mode NO conoce PromiseView.
//   function estadoPagoPromesa(config, totalCents, pagadoCents, yaLlego, comprobanteEnviado) {
//     const { cp1, cp2 } = puntosDeCobro(config, totalCents);
//     const exigibleAcum = cp1.montoCents + (yaLlego ? cp2.montoCents : 0);
//     if (exigibleAcum === 0)          return "no_habilitado";
//     if (comprobanteEnviado)          return "comprobante_enviado";
//     if (pagadoCents >= exigibleAcum) return "pagado";
//     return "por_pagar";
//   }

import { MAX_SAFE_TOTAL_CENTS } from "@/lib/domain/retail/payment";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

/** Modo de pago de una preventa/tomo (discriminante público). */
export type ModoPago = "sin_pago_previo" | "sena" | "total";

/**
 * Configuración de pago. La seña necesita `tipo` + `valor` (sin eso, "sena" queda
 * semánticamente incompleta): `valor` son centavos si `monto_fijo`, o el porcentaje
 * (número en (0, 100]) si `porcentaje`.
 */
export type ConfiguracionPago =
  | { modo: "sin_pago_previo" }
  | { modo: "total" }
  | { modo: "sena"; tipo: "monto_fijo" | "porcentaje"; valor: number };

/** Qué representa una celda de cobro. `ninguno` ⇒ montoCents 0. */
export type ConceptoCobro = "ninguno" | "total" | "sena" | "saldo";

/** Regla de un punto de cobro: el concepto + el importe programado ya resuelto. */
export type ReglaDeCobro = { concepto: ConceptoCobro; montoCents: number };

/** Los dos puntos de cobro del ciclo. Invariante: cp1.montoCents + cp2.montoCents === totalCents. */
export type PuntosDeCobro = { cp1: ReglaDeCobro; cp2: ReglaDeCobro };

/**
 * Matriz simbólica (ledger-free) de conceptos por modo. `puntosDeCobro` la resuelve
 * a importes concretos dado el total. Documentada para legibilidad y test directo.
 */
export const MATRIZ_COBRO: Record<ModoPago, { cp1: ConceptoCobro; cp2: ConceptoCobro }> = {
  sin_pago_previo: { cp1: "ninguno", cp2: "total" },
  sena: { cp1: "sena", cp2: "saldo" },
  total: { cp1: "total", cp2: "ninguno" },
};

function assertUnreachable(x: never, msg: string): never {
  throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_MODE_CONFIG, `${msg}: ${JSON.stringify(x)}`);
}

/** Total válido: entero en [0, MAX_SAFE_TOTAL_CENTS]. El 0 es legítimo (ítem sin cargo). PRIVADO. */
function assertValidTotal(totalCents: number): void {
  if (!Number.isInteger(totalCents) || totalCents < 0)
    throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_MODE_CONFIG, "el total debe ser un entero ≥ 0");
  if (totalCents > MAX_SAFE_TOTAL_CENTS)
    throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_MODE_CONFIG, "el total es demasiado grande");
}

/** Configuración válida. Solo la seña tiene parámetros; el resto no lleva `valor`. PRIVADO. */
function assertValidConfig(config: ConfiguracionPago): void {
  switch (config.modo) {
    case "sin_pago_previo":
    case "total":
      return;
    case "sena":
      switch (config.tipo) {
        case "monto_fijo":
          if (!Number.isInteger(config.valor) || config.valor < 1)
            throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_MODE_CONFIG, "la seña fija debe ser un entero ≥ 1");
          if (config.valor > MAX_SAFE_TOTAL_CENTS)
            throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_MODE_CONFIG, "la seña fija es demasiado grande");
          return;
        case "porcentaje":
          if (typeof config.valor !== "number" || !Number.isFinite(config.valor) || config.valor <= 0 || config.valor > 100)
            throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_MODE_CONFIG, "el porcentaje de seña debe estar en (0, 100]");
          return;
        default:
          return assertUnreachable(config.tipo, "tipo de seña no contemplado");
      }
    default:
      return assertUnreachable(config, "modo de pago no contemplado");
  }
}

/**
 * Importe de la seña en centavos. CLAMP con `Math.min(valor, totalCents)`: si la seña
 * configurada supera el precio, CP1 cobra el total y CP2 queda en cero (una seña fija
 * store-wide sobre un tomo barato no es un error). El redondeo del porcentaje se
 * ABSORBE en el saldo (saldo = total − seña) → la suma CP1+CP2 sigue exacta.
 */
function senaCents(config: Extract<ConfiguracionPago, { modo: "sena" }>, totalCents: number): number {
  switch (config.tipo) {
    case "monto_fijo":
      return Math.min(config.valor, totalCents);
    case "porcentaje":
      return Math.min(Math.round((totalCents * config.valor) / 100), totalCents);
    default:
      return assertUnreachable(config.tipo, "tipo de seña no contemplado");
  }
}

/**
 * Puntos de cobro de un modo dado el precio. Única API pública. Los importes forman
 * una partición del total (cp1 + cp2 === total): ninguna celda recobra lo de la otra.
 */
export function puntosDeCobro(config: ConfiguracionPago, totalCents: number): PuntosDeCobro {
  assertValidTotal(totalCents);
  assertValidConfig(config);

  switch (config.modo) {
    case "sin_pago_previo":
      return { cp1: { concepto: "ninguno", montoCents: 0 }, cp2: { concepto: "total", montoCents: totalCents } };
    case "total":
      return { cp1: { concepto: "total", montoCents: totalCents }, cp2: { concepto: "ninguno", montoCents: 0 } };
    case "sena": {
      const sena = senaCents(config, totalCents);
      // Tras validar+clampear, la partición es una identidad interna: si no se
      // cumpliera sería una inconsistencia del módulo y debe fallar, no corregirse.
      const saldo = totalCents - sena;
      return { cp1: { concepto: "sena", montoCents: sena }, cp2: { concepto: "saldo", montoCents: saldo } };
    }
    default:
      return assertUnreachable(config, "modo de pago no contemplado");
  }
}
