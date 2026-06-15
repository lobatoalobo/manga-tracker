import Link from "next/link";
import { prisma } from "@/lib/prisma";
import CatalogRefreshCountdown from "./CatalogRefreshCountdown";

/** Cadencia sugerida de actualización del catálogo (Whakoom), en días. */
const REFRESH_DAYS = 7;

/**
 * Banner solo-admin en el home: muestra cuándo se actualizó por última vez el
 * catálogo desde Whakoom y un contador hacia la próxima actualización sugerida.
 * No es un scheduler: es un recordatorio para correr el job a mano (link a
 * Herramientas). El caller lo monta solo para admin.
 */
export default async function CatalogRefreshBanner() {
  const last = await prisma.jobRun
    .findFirst({
      where: { kind: "whakoom-import" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    })
    .catch(() => null);

  const lastMs = last?.finishedAt ? last.finishedAt.getTime() : null;
  const dueMs = lastMs != null ? lastMs + REFRESH_DAYS * 86_400_000 : null;

  return (
    <Link
      href="/admin/herramientas"
      className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm transition hover:border-accent"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-base">🗂️</span>
        <span className="min-w-0">
          <span className="font-medium">Catálogo (Whakoom)</span>{" "}
          <CatalogRefreshCountdown lastMs={lastMs} dueMs={dueMs} />
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium text-accent">Actualizar →</span>
    </Link>
  );
}
