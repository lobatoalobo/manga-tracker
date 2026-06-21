"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mergeWorksAction, unlinkWorkAnilistAction } from "@/app/actions";
import type { DupGroup } from "@/lib/mergeWorks";

/**
 * Cola de revisión de series duplicadas (Works que comparten anilistId). Por
 * grupo: elegís cuál conservar y fusionás el resto (dup real), o separás un Work
 * (mismapeo: no es la misma serie).
 */
export default function DuplicateMerger({ groups }: { groups: DupGroup[] }) {
  if (groups.length === 0)
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        No hay series duplicadas (ediciones con el mismo anilistId en Works
        distintos). 🎉
      </p>
    );

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Group key={g.anilistId} group={g} />
      ))}
    </div>
  );
}

function Group({ group }: { group: DupGroup }) {
  // Default: conservar el Work que ya tiene anilistId (el canónico), o el primero.
  const def = group.works.find((w) => w.anilistId != null) ?? group.works[0];
  const [keep, setKeep] = useState<number>(def.id);
  const [pending, start] = useTransition();
  const router = useRouter();

  function merge() {
    if (!confirm(`Fusionar las otras obras en #${keep}? No se puede deshacer.`)) return;
    start(async () => {
      for (const w of group.works) {
        if (w.id === keep) continue;
        await mergeWorksAction(w.id, keep);
      }
      router.refresh();
    });
  }

  function separate(workId: number) {
    if (!confirm(`Desvincular #${workId} de este anilistId (no es la misma serie)?`)) return;
    start(async () => {
      await unlinkWorkAnilistAction(workId);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2">
        <p className="text-xs text-muted">
          AniList <span className="font-mono">{group.anilistId}</span> ·{" "}
          {group.works.length} obras
        </p>
      </div>

      <div className="space-y-2">
        {group.works.map((w) => (
          <div
            key={w.id}
            className={`rounded-lg border p-2.5 transition ${
              keep === w.id ? "border-accent bg-accent/5" : "border-border"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <label className="flex min-w-0 cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name={`keep-${group.anilistId}`}
                  checked={keep === w.id}
                  onChange={() => setKeep(w.id)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <Link
                    href={`/serie/${w.id}`}
                    target="_blank"
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {w.title}
                  </Link>
                  <span className="ml-1 text-xs text-muted">#{w.id}</span>
                  <span className="block truncate text-xs text-muted">
                    {w.editions
                      .map((e) => `${e.publisher} (${e.volumes}t)`)
                      .join(" · ")}
                  </span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => separate(w.id)}
                disabled={pending}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-rose-400 hover:text-rose-400 disabled:opacity-50"
              >
                Separar
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={merge}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Fusionar el resto en #{keep}
        </button>
        <span className="text-xs text-muted">
          el elegido conserva; los demás se borran tras mover sus ediciones
        </span>
      </div>
    </div>
  );
}
