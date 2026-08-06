"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Pie de la lista: conteo a la izquierda; paginación real (links que preservan filtros) a la derecha. */
export function PreordersPagination({ total, page, pageSize }: { total: number; page: number; pageSize: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  function href(p: number) {
    const sp = new URLSearchParams(params.toString());
    if (p <= 1) sp.delete("page");
    else sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pages;
  const btn = "rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium";

  return (
    <div className="flex flex-col items-center justify-between gap-3 pt-1 sm:flex-row">
      <p className="text-sm text-slate-500">
        Mostrando {from}–{to} de {total} {total === 1 ? "preventa" : "preventas"}
      </p>
      <div className="flex items-center gap-2">
        {prevDisabled
          ? <span className={`${btn} text-slate-300`}>Anterior</span>
          : <Link href={href(page - 1)} className={`${btn} text-slate-600 transition-colors hover:bg-slate-50`}>Anterior</Link>}
        <span aria-current="page" className="grid h-9 min-w-9 place-items-center rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white">{page}</span>
        {nextDisabled
          ? <span className={`${btn} text-slate-300`}>Siguiente</span>
          : <Link href={href(page + 1)} className={`${btn} text-slate-600 transition-colors hover:bg-slate-50`}>Siguiente</Link>}
      </div>
    </div>
  );
}
