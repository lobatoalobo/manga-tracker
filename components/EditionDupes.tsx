"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cleanCatalogDupesAction, mergeWorksAction } from "@/app/actions";
import type { EditionDupGroup } from "@/lib/mergeWorks";

/**
 * Ediciones duplicadas (misma editorial + título). Dos casos:
 *  - mismo Work (redundantes): se auto-resuelven con "Limpiar" (mantiene la
 *    canónica + borra huérfanos).
 *  - Works distintos: la misma serie quedó partida → "Fusionar works".
 * Unifica acá lo que antes estaba en /admin/herramientas (sin copiar IDs).
 */
export default function EditionDupes({ groups }: { groups: EditionDupGroup[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const same = groups.filter((g) => g.sameWork);
  const diff = groups.filter((g) => !g.sameWork);

  const clean = () =>
    start(async () => {
      await cleanCatalogDupesAction();
      router.refresh();
    });

  const mergeGroup = (g: EditionDupGroup) =>
    start(async () => {
      const works = g.editions.filter((e) => e.workId != null);
      // target = la edición con anilistId, si no la de menor workId.
      const target =
        works.find((e) => e.anilistId != null)?.workId ??
        Math.min(...works.map((e) => e.workId as number));
      const sources = [...new Set(works.map((e) => e.workId as number))].filter((id) => id !== target);
      for (const s of sources) await mergeWorksAction(s, target);
      router.refresh();
    });

  if (groups.length === 0)
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        No hay ediciones duplicadas. 🎉
      </p>
    );

  return (
    <div className="space-y-3">
      {same.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm">
            <b>{same.length}</b> con ediciones redundantes en el <b>mismo work</b>{" "}
            (artefactos de slug). Se resuelven solas:
          </p>
          <button
            type="button"
            onClick={clean}
            disabled={pending}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Limpiar redundantes + huérfanos
          </button>
        </div>
      )}
      {diff.map((g) => (
        <div key={`${g.publisher}:${g.normTitle}`} className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">
            {g.publisher} · misma serie en <b>works distintos</b>
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {g.editions.map((e) => (
              <li key={e.id} className="truncate">
                <Link href={`/serie/${e.workId}`} target="_blank" className="text-accent hover:underline">
                  {e.title}
                </Link>{" "}
                <span className="text-xs text-muted">#{e.workId} · {e.slug} · {e.volumes}t</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => mergeGroup(g)}
            disabled={pending}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Fusionar works
          </button>
        </div>
      ))}
    </div>
  );
}
