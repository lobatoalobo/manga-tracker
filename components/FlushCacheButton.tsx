"use client";

import { useState, useTransition } from "react";
import { flushEditionsCacheAction } from "@/app/actions";

export default function FlushCacheButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() =>
          start(async () => {
            const r = await flushEditionsCacheAction();
            setMsg(`✓ ${r.count} entradas borradas`);
            setTimeout(() => setMsg(null), 3000);
          })
        }
        disabled={pending}
        className="rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
      >
        {pending ? "Vaciando…" : "Vaciar caché de ediciones"}
      </button>
      {msg && <span className="text-sm text-emerald-400">{msg}</span>}
    </div>
  );
}
