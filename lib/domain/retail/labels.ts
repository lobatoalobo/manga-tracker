// Traducción de estados de PROMESA al lenguaje de cada actor. Única fuente de
// verdad para los textos cliente/tienda y el tono. Es un LOOKUP PURO: no calcula
// ni deriva estados, no combina cumplimiento+pago (eso es promise-view.ts), no
// consulta dominio/DB, sin fallback "inteligente". Recibe un estado ya elegido.
//
// Dominio puro: NO importa UI (Pill) ni servicios (lib/retail). `Tono` espeja los
// literales de PillTono por VALOR para no invertir la dependencia dominio→UI.
//
// El copy es deliberadamente NEUTRO (singular, sin afirmar "todo el pedido") para
// funcionar tanto en una promesa individual (persona + un ejemplar) como dentro
// de una vista de pedido agregado, sin errores de singular/plural.

export type EstadoPromesa =
  | "esperando"
  | "llegaron_a_pagar"
  | "comprobante_por_validar"
  | "pagado_a_retirar"
  | "retirada"
  | "cancelada"
  | "caida"
  | "vencida";

export type Tono = "neutral" | "mark" | "warn" | "go";

export type EtiquetaPromesa = { cliente: string; tienda: string; tono: Tono };

const ETIQUETAS: Record<EstadoPromesa, EtiquetaPromesa> = {
  esperando: { cliente: "Esperando — te lo guardamos", tienda: "Reservado · por preparar", tono: "neutral" },
  llegaron_a_pagar: { cliente: "¡Llegó! — falta pagar", tienda: "Listo · a cobrar", tono: "warn" },
  comprobante_por_validar: { cliente: "Comprobante enviado — por validar", tienda: "Por validar", tono: "warn" },
  pagado_a_retirar: { cliente: "Pagado — listo para retirar", tienda: "Listo · pagado", tono: "go" },
  retirada: { cliente: "Retirado ✓", tienda: "Entregado · cumplida", tono: "go" },
  cancelada: { cliente: "Dado de baja", tienda: "Cancelada", tono: "neutral" },
  caida: { cliente: "No pudimos cumplirlo", tienda: "Caída · dado de baja", tono: "warn" },
  vencida: { cliente: "Pedido vencido", tienda: "Vencida", tono: "warn" },
};

/** Los 8 estados, para iterar y verificar exhaustividad. */
export const ESTADOS_PROMESA: readonly EstadoPromesa[] = Object.keys(ETIQUETAS) as EstadoPromesa[];

/** Acceso principal: las tres traducciones de un estado. */
export function etiquetasDe(estado: EstadoPromesa): EtiquetaPromesa {
  return ETIQUETAS[estado];
}

export function getClienteLabel(estado: EstadoPromesa): string {
  return ETIQUETAS[estado].cliente;
}

export function getTiendaLabel(estado: EstadoPromesa): string {
  return ETIQUETAS[estado].tienda;
}

export function getTono(estado: EstadoPromesa): Tono {
  return ETIQUETAS[estado].tono;
}
