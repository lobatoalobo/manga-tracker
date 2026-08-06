/**
 * Datos MOCK de la Home de Preventas. Toda la información visible sale de acá; los componentes no hardcodean nada.
 * Sin lógica ni cálculo: valores fijos de ejemplo. Cuando exista data real se reemplaza por una consulta con la
 * misma forma. Reutiliza los tipos `Tone`/`Kpi` del Home para las tarjetas de resumen.
 */
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Clock3, Truck, Package, CircleCheck, WalletCards } from "lucide-react";
import type { Kpi } from "@/components/store-home/mock-home";

/** Los seis KPIs de la fila de resumen (mismos que el mockup). Valores fijos, no se calculan. */
export const PREVENTA_KPIS: Kpi[] = [
  { icon: CalendarDays, value: "5", title: "Preventas activas", sub: "Abiertas al cliente", tone: "violet" },
  { icon: Clock3, value: "2", title: "Por cerrar", sub: "Cierran en 24hs", tone: "amber" },
  { icon: Truck, value: "2", title: "Esperando llegada", sub: "Pedidos realizados", tone: "emerald" },
  { icon: Package, value: "3", title: "Entregando", sub: "Preparando pedidos", tone: "sky" },
  { icon: CircleCheck, value: "12", title: "Finalizadas", sub: "Este mes", tone: "slate" },
  { icon: WalletCards, value: "$245.800", title: "Reservas totales", sub: "Este mes", tone: "rose" },
];

export type PreorderStatus = "ABIERTA" | "ESPERANDO LLEGADA" | "ENTREGANDO" | "FINALIZADA";

/** Columna "Cierre" de cada fila. `label` es el encabezado pequeño ("Cierre" o "—"); el resto son líneas apiladas. */
export interface PreorderClose {
  label?: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
}

export interface PreorderListRow {
  id: string;
  title: string;
  publishers: string;       // "IVREA · Planeta · Distrito Manga"
  extra: string;            // "+2 editoriales"
  estado: PreorderStatus;
  bar: string;              // clase de color de la barra vertical (por fila, según el mockup)
  close: PreorderClose;
  titulos: number;
  reservas: number;
  reservado: string;
  cta: string;              // "Abrir estudio" | "Ver resumen"
  covers: number;
}

export const PREORDER_ROWS: PreorderListRow[] = [
  {
    id: "novedades-7-agosto",
    title: "Novedades 7 de Agosto",
    publishers: "IVREA · Planeta · Distrito Manga",
    extra: "+2 editoriales",
    estado: "ABIERTA",
    bar: "bg-violet-500",
    close: { label: "Cierre", primary: "Lun 11/08", secondary: "15:00 hs", tertiary: "en 2 días" },
    titulos: 18,
    reservas: 42,
    reservado: "$432.100",
    cta: "Abrir estudio",
    covers: 3,
  },
  {
    id: "novedades-8-agosto",
    title: "Novedades 8 de Agosto",
    publishers: "IVREA · Mozztros · Planeta",
    extra: "+1 editorial",
    estado: "ABIERTA",
    bar: "bg-amber-400",
    close: { label: "Cierre", primary: "Mar 12/08", secondary: "15:00 hs", tertiary: "en 3 días" },
    titulos: 22,
    reservas: 58,
    reservado: "$621.300",
    cta: "Abrir estudio",
    covers: 3,
  },
  {
    id: "novedades-1-agosto",
    title: "Novedades 1 de Agosto",
    publishers: "IVREA · Planeta · Distrito Manga",
    extra: "+1 editorial",
    estado: "ESPERANDO LLEGADA",
    bar: "bg-emerald-500",
    close: { label: "—", primary: "Sin fecha" },
    titulos: 16,
    reservas: 58,
    reservado: "$510.200",
    cta: "Abrir estudio",
    covers: 3,
  },
  {
    id: "novedades-25-julio",
    title: "Novedades 25 de Julio",
    publishers: "IVREA · Mozztros · Planeta",
    extra: "+1 editorial",
    estado: "ENTREGANDO",
    bar: "bg-sky-500",
    close: { label: "—", primary: "Sin fecha" },
    titulos: 14,
    reservas: 24,
    reservado: "$289.700",
    cta: "Abrir estudio",
    covers: 3,
  },
  {
    id: "novedades-18-julio",
    title: "Novedades 18 de Julio",
    publishers: "IVREA · Distrito Manga",
    extra: "+1 editorial",
    estado: "FINALIZADA",
    bar: "bg-slate-300",
    close: { primary: "28/07", secondary: "Completada" },
    titulos: 13,
    reservas: 21,
    reservado: "$210.600",
    cta: "Ver resumen",
    covers: 3,
  },
];

/** Badge de estado → paleta pastel (nunca saturado). Cada estado tiene su color semántico. */
export const STATUS_BADGE: Record<PreorderStatus, string> = {
  ABIERTA: "bg-emerald-100 text-emerald-700",
  "ESPERANDO LLEGADA": "bg-sky-100 text-sky-700",
  ENTREGANDO: "bg-indigo-100 text-indigo-700",
  FINALIZADA: "bg-slate-100 text-slate-500",
};

/** Opciones (solo visuales) de la barra de filtros. */
export const STAGE_FILTER = "Todas las etapas";
export const SORT_FILTER = "Ordenar por: Más recientes";

export const PAGINATION = { showing: "Mostrando 5 de 5 preventas" };
