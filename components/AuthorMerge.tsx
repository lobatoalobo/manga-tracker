"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameAuthorAction } from "@/app/actions";
import type { AuthorVariantCluster } from "@/lib/authorMerge";

/**
 * Cola de unificación de autores: cada cluster son grafías distintas del mismo
 * mangaka (mismo set de tokens). Elegís/editás la forma canónica y unificás —
 * reescribe Work.author en todas las obras. Reusa renameAuthorAction.
 */
export default function AuthorMerge({ clusters }: { clusters: AuthorVariantCluster[] }) {
  if (clusters.length === 0)
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        No hay autores con grafías múltiples. 🎉
      </p>
    );
  return (
    <div className="space-y-3">
      {clusters.map((c) => (
        <Cluster key={c.key} cluster={c} />
      ))}
    </div>
  );
}

function Cluster({ cluster }: { cluster: AuthorVariantCluster }) {
  const router = useRouter();
  const [canonical, setCanonical] = useState(cluster.suggested);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  function unify() {
    const to = canonical.trim();
    if (!to) return;
    start(async () => {
      const r = await renameAuthorAction(
        cluster.variants.map((v) => v.name),
        to,
      );
      if (r.ok) {
        setDone(r.changed);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {cluster.variants.map((v) => (
          <button
            key={v.name}
            type="button"
            onClick={() => setCanonical(v.name)}
            className="rounded-lg border border-border px-2 py-0.5 text-xs transition hover:border-accent"
            title="Usar esta grafía como canónica"
          >
            {v.name} <span className="text-muted">×{v.count}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Unificar a:</span>
        <input
          value={canonical}
          onChange={(e) => setCanonical(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={unify}
          disabled={pending || !canonical.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Unificar
        </button>
        {done != null && (
          <span className="text-xs text-emerald-400">✓ {done} obras</span>
        )}
      </div>
    </div>
  );
}
