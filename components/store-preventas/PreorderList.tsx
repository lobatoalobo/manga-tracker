import { CalendarPlus } from "lucide-react";
import Link from "next/link";
import type { PreorderRow } from "@/lib/retail/preorders-dashboard";
import { PreorderListItem } from "./PreorderListItem";

/** Estado vacío diseñado: sin resultados (por filtro) o sin preventas todavía. */
function EmptyState({ slug, filtered }: { slug: string; filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-100 text-violet-600">
        <CalendarPlus size={22} aria-hidden />
      </span>
      <p className="text-sm font-medium text-slate-700">
        {filtered ? "No hay preventas que coincidan con el filtro." : "Todavía no hay preventas."}
      </p>
      {filtered ? null : (
        <Link href={`/tiendas/${slug}/admin/preventas/nueva`} className="mt-1 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-700">
          Crear la primera preventa
        </Link>
      )}
    </div>
  );
}

/** Lista de preventas: ocupa todo el ancho, una tarjeta por preventa. */
export function PreorderList({ rows, slug, filtered }: { rows: PreorderRow[]; slug: string; filtered: boolean }) {
  if (rows.length === 0) return <EmptyState slug={slug} filtered={filtered} />;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <PreorderListItem key={row.id} row={row} slug={slug} />
      ))}
    </div>
  );
}
