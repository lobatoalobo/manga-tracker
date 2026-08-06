/**
 * Capa de PRESENTACIÓN de la Home de Preventas: mapea la etapa derivada (dominio) a colores pastel y arma las
 * tarjetas de indicadores a partir de los datos reales del loader. Sin mocks, sin lógica de negocio.
 */
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Clock3, Truck, Package, CircleCheck, WalletCards } from "lucide-react";
import type { Kpi, Tone } from "@/components/store-home/mock-home";
import { formatArsCents } from "@/lib/retail/format";
import type { StoreStage } from "@/lib/domain/retail/pipeline-stage";
import type { PreorderKpis } from "@/lib/retail/preorders-dashboard";

/** Badge de etapa → paleta pastel (nunca saturado), por color semántico. */
export const STAGE_BADGE: Record<StoreStage, string> = {
  preparando: "bg-slate-100 text-slate-600",
  abierta: "bg-emerald-100 text-emerald-700",
  por_cerrar: "bg-amber-100 text-amber-700",
  pedido_distribuidor: "bg-indigo-100 text-indigo-700",
  esperando_llegada: "bg-sky-100 text-sky-700",
  preparando_pedidos: "bg-violet-100 text-violet-700",
  entregando: "bg-indigo-100 text-indigo-700",
  finalizada: "bg-slate-100 text-slate-500",
  cancelada: "bg-rose-100 text-rose-600",
};

/** Barra vertical de la tarjeta → color de acento por etapa. */
export const STAGE_BAR: Record<StoreStage, string> = {
  preparando: "bg-slate-300",
  abierta: "bg-violet-500",
  por_cerrar: "bg-amber-400",
  pedido_distribuidor: "bg-indigo-500",
  esperando_llegada: "bg-emerald-500",
  preparando_pedidos: "bg-sky-500",
  entregando: "bg-sky-500",
  finalizada: "bg-slate-300",
  cancelada: "bg-rose-300",
};

export interface FilterOption { value: string; label: string }

export const STAGE_FILTER_OPTIONS: FilterOption[] = [
  { value: "", label: "Todas las etapas" },
  { value: "abierta", label: "Abiertas" },
  { value: "por_cerrar", label: "Por cerrar" },
  { value: "esperando_llegada", label: "Esperando llegada" },
  { value: "entregando", label: "Entregando" },
  { value: "finalizada", label: "Finalizadas" },
];

export const SORT_OPTIONS: FilterOption[] = [
  { value: "recientes", label: "Más recientes" },
  { value: "antiguas", label: "Más antiguas" },
  { value: "cierre", label: "Cierre próximo" },
];

interface KpiDescriptor { icon: LucideIcon; tone: Tone; title: string; sub: string }
const KPI_DESCRIPTORS: KpiDescriptor[] = [
  { icon: CalendarDays, tone: "violet", title: "Preventas activas", sub: "Abiertas al cliente" },
  { icon: Clock3, tone: "amber", title: "Por cerrar", sub: "Cierran pronto" },
  { icon: Truck, tone: "emerald", title: "Esperando llegada", sub: "Pedidos realizados" },
  { icon: Package, tone: "sky", title: "Entregando", sub: "Preparando pedidos" },
  { icon: CircleCheck, tone: "slate", title: "Finalizadas", sub: "Este mes" },
  { icon: WalletCards, tone: "rose", title: "Reservas totales", sub: "Este mes" },
];

/** Arma las seis tarjetas de indicadores con los valores reales. */
export function buildKpiCards(k: PreorderKpis): Kpi[] {
  const values = [
    String(k.activas),
    String(k.porCerrar),
    String(k.esperandoLlegada),
    String(k.entregando),
    String(k.finalizadasMes),
    formatArsCents(k.reservadoMesCents),
  ];
  return KPI_DESCRIPTORS.map((d, i) => ({ icon: d.icon, tone: d.tone, title: d.title, sub: d.sub, value: values[i] }));
}
