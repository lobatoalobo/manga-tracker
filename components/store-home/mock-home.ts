/**
 * Datos MOCK del Home de la tienda (P — Home SaaS). Toda la información visible sale de acá; los componentes
 * no hardcodean nada. Cuando exista data real, se reemplaza este archivo por una consulta con la misma forma.
 * Sin lógica ni cálculo: son valores fijos de ejemplo.
 */
import type { LucideIcon } from "lucide-react";
import {
  Home, CalendarDays, BookOpen, ClipboardList, Users, CreditCard, Boxes, BarChart3, Settings,
  Calendar, Clock, Truck, Package, CheckCircle2, Wallet, MessageSquare, DollarSign, ShoppingBag, TrendingUp,
} from "lucide-react";

export type Tone = "violet" | "amber" | "emerald" | "sky" | "slate" | "rose";

export interface NavItem { label: string; icon: LucideIcon; active?: boolean }
export const NAV: NavItem[] = [
  { label: "Inicio", icon: Home, active: true },
  { label: "Preventas", icon: CalendarDays },
  { label: "Catálogo", icon: BookOpen },
  { label: "Pedidos", icon: ClipboardList },
  { label: "Clientes", icon: Users },
  { label: "Pagos", icon: CreditCard },
  { label: "Stock", icon: Boxes },
  { label: "Reportes", icon: BarChart3 },
  { label: "Configuración", icon: Settings },
];

export const STORE = { name: "Crumb Manga Store", plan: "Plan Tienda", initial: "C" };
export const USER = { name: "Agustín", role: "Administrador", initial: "A" };
export const GREETING = { hello: "¡Buenas, Agustín! 👋", sub: "Este es el resumen de tu tienda hoy." };

export interface Kpi { icon: LucideIcon; value: string; title: string; sub: string; tone: Tone }
export const KPIS: Kpi[] = [
  { icon: Calendar, value: "2", title: "Preventas activas", sub: "1 cierra hoy", tone: "violet" },
  { icon: Clock, value: "1", title: "Por cerrar", sub: "Cierra en menos de 24h", tone: "amber" },
  { icon: Truck, value: "2", title: "Esperando llegada", sub: "Pedido realizado", tone: "emerald" },
  { icon: Package, value: "3", title: "Entregando", sub: "Pedidos listos", tone: "sky" },
  { icon: CheckCircle2, value: "12", title: "Finalizadas", sub: "Este mes", tone: "slate" },
  { icon: Wallet, value: "$245.800", title: "Cobros pendientes", sub: "8 pedidos", tone: "rose" },
];

export interface Preorder { title: string; estado: string; cierre: string; titulos: number; reservas: number; total: string; covers: number }
export const ACTIVE_PREORDERS: Preorder[] = [
  { title: "Novedades 7 de Agosto", estado: "ABIERTA", cierre: "Cierra el Lunes 11/08 a las 15:00 hs", titulos: 18, reservas: 42, total: "$432.100", covers: 3 },
  { title: "Novedades 8 de Agosto", estado: "ABIERTA", cierre: "Cierra el Martes 12/08 a las 15:00 hs", titulos: 22, reservas: 58, total: "$621.300", covers: 3 },
];
export const UPCOMING: Preorder = { title: "Novedades 9 de Agosto", estado: "PRÓXIMA", cierre: "Cierra mañana a las 15:00 hs", titulos: 14, reservas: 23, total: "$198.700", covers: 1 };

export interface Activity { icon: LucideIcon; text: string; when: string; tone: Tone }
export const ACTIVITY: Activity[] = [
  { icon: Calendar, text: 'Se abrió la preventa "Novedades 7 de Agosto"', when: "Hoy, 09:12", tone: "violet" },
  { icon: Truck, text: "Llegó el pedido de IVREA del 31/07", when: "Ayer, 16:45", tone: "emerald" },
  { icon: Package, text: "24 pedidos fueron marcados como listos", when: "Ayer, 11:03", tone: "sky" },
  { icon: Users, text: "8 clientes realizaron su primer pedido", when: "07/08, 22:18", tone: "amber" },
  { icon: CreditCard, text: "Se registró un cobro por $32.500", when: "07/08, 19:47", tone: "rose" },
];

export interface Task { icon: LucideIcon; title: string; sub: string; badge: number; tone: Tone }
export const TASKS: Task[] = [
  { icon: Clock, title: "Cerrar preventa", sub: "1 preventa lista para cerrar", badge: 1, tone: "amber" },
  { icon: Truck, title: "Confirmar llegada", sub: "2 pedidos llegaron al distribuidor", badge: 2, tone: "emerald" },
  { icon: Package, title: "Preparar pedidos", sub: "24 pedidos listos para preparar", badge: 24, tone: "sky" },
  { icon: MessageSquare, title: "Avisar clientes", sub: "18 pedidos listos para avisar", badge: 18, tone: "violet" },
  { icon: CreditCard, title: "Cobros pendientes", sub: "8 pedidos con cobros pendientes", badge: 8, tone: "rose" },
];

export interface MonthKpi { icon: LucideIcon; title: string; value: string; delta: string; tone: Tone }
export const MONTH = {
  label: "Agosto",
  kpis: [
    { icon: DollarSign, title: "Ventas (confirmadas)", value: "$3.245.800", delta: "+28% vs. Julio", tone: "emerald" },
    { icon: ShoppingBag, title: "Pedidos entregados", value: "162", delta: "+18% vs. Julio", tone: "sky" },
    { icon: Users, title: "Nuevos clientes", value: "38", delta: "+12% vs. Julio", tone: "violet" },
    { icon: TrendingUp, title: "Ticket promedio", value: "$20.061", delta: "+9% vs. Julio", tone: "amber" },
  ] as MonthKpi[],
};

export const FOOTER = "Nakama te ayuda a organizar tu tienda para que te enfoques en lo importante: tus clientes y tu pasión por el manga.";
