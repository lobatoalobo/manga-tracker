// View-model PURO de una PROMESA (persona + un ejemplar + tienda). Deriva, a
// partir de las facetas de la promesa, EXACTAMENTE un EstadoPromesa POR ACTOR y
// las acciones permitidas POR ACTOR. Los textos salen siempre de labels.ts (única
// fuente de copy); acá no se duplica ningún string ni se inventa un noveno estado.
//
// Responsabilidad (SÍ): elegir el estado que cada actor debe ver y qué puede
// hacer, aplicando la precedencia terminal → activa. Es una función de proyección.
//
// Responsabilidad (NO): no muta ni transiciona, no consulta dominio/DB, no calcula
// pagos ni saldos, no conoce modos de pago (eso es payment-mode.ts / el adapter),
// no importa UI/React/Prisma ni servicios (lib/retail). Recibe facetas ya
// normalizadas y devuelve un objeto plano.
//
// Proyección por actor: `avisado` afecta SOLO al cliente. La tienda ve el estado
// operativo real (p. ej. "listo") aunque todavía no haya avisado; el cliente sigue
// viendo "esperando" hasta recibir el aviso. Ambos comparten los mismos 8 estados.
//
// preparar/avisar NO son acciones de este view-model: P-07 las deriva de la faceta
// FINA de cumplimiento (handoff.ts: preparableQuantity / pickupableQuantity), no de
// esta etiqueta gruesa.

import { ORDER_HANDOFF, type OrderHandoff } from "@/lib/domain/retail/handoff";
import {
  etiquetasDe,
  type EstadoPromesa,
  type Tono,
} from "@/lib/domain/retail/labels";

/** Muerte terminal de la promesa. Unión única → sin ambigüedad de causa. */
export type MuertePromesa = "cancelada" | "caida" | "vencida";

/**
 * Faceta de pago POR PROMESA, normalizada y pura. NO es el PaymentStatus agregado
 * del pedido: con entregas parciales y modos por-tomo no son semánticamente
 * equivalentes. Un ADAPTER posterior es responsable de derivarla desde el ledger
 * (StorePayment) y el modelo persistido (modoPago, saldo, comprobante).
 *
 * Invariante DEL ADAPTER (no de este view-model): una vez que la promesa alcanzó
 * READY_FOR_PICKUP, el pago ya está habilitado — nunca entrega `no_habilitado` en
 * esa fase. La regla "listo ⇒ hay cargo" pertenece a payment-mode.ts / al adapter,
 * no acá; este módulo solo declara esa combinación como inalcanzable por contrato.
 */
export type EstadoPagoPromesaVista =
  | "no_habilitado" // sin_cargo — no corresponde pagar (aún)
  | "por_pagar" // hay monto exigible
  | "comprobante_enviado" // enviado, por validar
  | "pagado"; // saldado

/** Facetas de entrada de una promesa. Todas normalizadas y puras. */
export type PromesaFacetas = {
  /** Cumplimiento real a nivel orden (handoff.ts). Incluye listo y retirada. */
  readonly handoff: OrderHandoff;
  /** Pago por promesa (normalizado por el adapter; NO el agregado del pedido). */
  readonly pago: EstadoPagoPromesaVista;
  /** Aviso al cliente. Afecta SOLO la proyección del cliente, no el estado real. */
  readonly avisado: boolean;
  /**
   * Cancelabilidad REAL, inyectada por el llamador (order.ts canCustomerCancel +
   * invariante 5: solo hasta apartado). NO se deriva del titular visible.
   */
  readonly cancelable: boolean;
  /** Muerte terminal, si la hay. Tiene precedencia sobre todo lo demás. */
  readonly muerte?: MuertePromesa;
};

/** Proyección de la promesa para UN actor: estado + su copy + su tono. */
export type PromiseProjection = {
  readonly estado: EstadoPromesa;
  readonly label: string;
  readonly tono: Tono;
};

/** Acciones permitidas del CLIENTE (autoservicio). */
export type AccionCliente = "cancelar" | "adjuntar_comprobante";
/** Acciones permitidas de la TIENDA (mostrador). */
export type AccionTienda =
  | "ver_comprobante"
  | "validar_comprobante"
  | "rechazar_comprobante"
  | "entregar";

/** Salida: una proyección por actor + acciones separadas por actor. */
export type PromiseView = {
  readonly cliente: PromiseProjection;
  readonly tienda: PromiseProjection;
  readonly accionesCliente: readonly AccionCliente[];
  readonly accionesTienda: readonly AccionTienda[];
};

function assertUnreachable(x: never, msg: string): never {
  throw new Error(`${msg}: ${JSON.stringify(x)}`);
}

/** Proyección con el copy del CLIENTE para el estado dado. */
function proyeccionCliente(estado: EstadoPromesa): PromiseProjection {
  const e = etiquetasDe(estado);
  return { estado, label: e.cliente, tono: e.tono };
}
/** Proyección con el copy de la TIENDA para el estado dado. */
function proyeccionTienda(estado: EstadoPromesa): PromiseProjection {
  const e = etiquetasDe(estado);
  return { estado, label: e.tienda, tono: e.tono };
}

/**
 * Estado ACTIVO de la tienda en READY_FOR_PICKUP según la faceta de pago.
 * `no_habilitado` es inalcanzable por contrato en esta fase (invariante del
 * adapter, ver EstadoPagoPromesaVista): se marca como tal sin encodear la regla de
 * pago en este view-model.
 */
function estadoActivo(pago: EstadoPagoPromesaVista): EstadoPromesa {
  switch (pago) {
    case "por_pagar":
      return "llegaron_a_pagar";
    case "comprobante_enviado":
      return "comprobante_por_validar";
    case "pagado":
      return "pagado_a_retirar";
    case "no_habilitado":
      // Inalcanzable POR CONTRATO: el adapter garantiza pago habilitado una vez en
      // listo. No es gramática de este view-model (no conoce el modo de pago); solo
      // hace explícito el invariante para que una violación upstream falle fuerte.
      throw new Error(
        "pago no_habilitado en READY_FOR_PICKUP viola el invariante del adapter (listo ⇒ pago habilitado)",
      );
    default:
      return assertUnreachable(pago, "EstadoPagoPromesaVista no contemplado");
  }
}

function accionesCliente(estadoCliente: EstadoPromesa, cancelable: boolean): readonly AccionCliente[] {
  const acciones: AccionCliente[] = [];
  // cancelar depende de la cancelabilidad REAL, no del titular visible.
  if (cancelable) acciones.push("cancelar");
  // Solo se pide adjuntar cuando el CLIENTE ya ve que llegó y falta pagar
  // (requiere avisado + por_pagar, ambos ya colapsados en estadoCliente).
  if (estadoCliente === "llegaron_a_pagar") acciones.push("adjuntar_comprobante");
  return acciones;
}

function accionesTienda(estadoTienda: EstadoPromesa): readonly AccionTienda[] {
  switch (estadoTienda) {
    case "comprobante_por_validar":
      return ["ver_comprobante", "validar_comprobante", "rechazar_comprobante"];
    case "pagado_a_retirar":
      return ["entregar"];
    default:
      return [];
  }
}

/**
 * Deriva el view-model de una promesa. Precedencia total:
 *   1. muerte           → ambos actores ese estado (guarda: muerte + COMPLETED es imposible)
 *   2. COMPLETED        → ambos = retirada
 *   3. NOT_STARTED/IN_PROGRESS → ambos = esperando
 *   4. READY_FOR_PICKUP → tienda = estado activo por pago; cliente = ese estado si avisado, si no esperando
 */
export function derivePromiseView(f: PromesaFacetas): PromiseView {
  // 1. Muerte terminal: misma proyección para ambos, sin acciones.
  if (f.muerte) {
    if (f.handoff === ORDER_HANDOFF.COMPLETED)
      throw new Error("combinación imposible: promesa muerta y COMPLETED a la vez");
    return {
      cliente: proyeccionCliente(f.muerte),
      tienda: proyeccionTienda(f.muerte),
      accionesCliente: [],
      accionesTienda: [],
    };
  }

  // 2. Retirada: terminal cumplida, sin acciones.
  if (f.handoff === ORDER_HANDOFF.COMPLETED) {
    return {
      cliente: proyeccionCliente("retirada"),
      tienda: proyeccionTienda("retirada"),
      accionesCliente: [],
      accionesTienda: [],
    };
  }

  // 3. Antes de estar listo: ambos ven esperando. El cliente puede cancelar si la
  //    promesa aún es cancelable de verdad.
  if (f.handoff === ORDER_HANDOFF.NOT_STARTED || f.handoff === ORDER_HANDOFF.IN_PROGRESS) {
    return {
      cliente: proyeccionCliente("esperando"),
      tienda: proyeccionTienda("esperando"),
      accionesCliente: accionesCliente("esperando", f.cancelable),
      accionesTienda: [],
    };
  }

  // 4. READY_FOR_PICKUP: verdad operativa de la tienda; el cliente sigue en
  //    esperando hasta el aviso (proyección por actor).
  const estadoTienda = estadoActivo(f.pago);
  const estadoCliente: EstadoPromesa = f.avisado ? estadoTienda : "esperando";
  return {
    cliente: proyeccionCliente(estadoCliente),
    tienda: proyeccionTienda(estadoTienda),
    accionesCliente: accionesCliente(estadoCliente, f.cancelable),
    accionesTienda: accionesTienda(estadoTienda),
  };
}
