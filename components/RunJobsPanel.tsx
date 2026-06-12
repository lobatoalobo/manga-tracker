"use client";

import { useState, useTransition } from "react";
import { runCrawlAction } from "@/app/actions";

const JOBS: { id: string; label: string; desc: string }[] = [
  { id: "whakoom-ovni", label: "Ovni (Whakoom)", desc: "Import completo de Ovni" },
  { id: "whakoom-panini", label: "Panini (Whakoom)", desc: "Import completo de Panini" },
  { id: "ivrea", label: "Ivrea", desc: "Crawl del sitio de Ivrea" },
  { id: "panini", label: "Panini", desc: "Crawl del sitio de Panini" },
  { id: "ovni", label: "Ovni", desc: "Crawl del sitio de Ovni" },
  { id: "mangakas", label: "Mangakas", desc: "Índice de autores" },
  { id: "resolve", label: "Resolver", desc: "Re-mapea las sin mapear por autor" },
];

export default function RunJobsPanel({ actionsUrl }: { actionsUrl: string }) {
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  function run(job: string) {
    setRunning(job);
    setMsg(null);
    start(async () => {
      const res = await runCrawlAction(job);
      setRunning(null);
      if (res.ok) {
        setMsg({ kind: "ok", text: "Disparado. Mirá el progreso en Actions." });
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Ejecutar jobs</h2>
        <a
          href={actionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent hover:underline"
        >
          Ver progreso en Actions ↗
        </a>
      </div>
      <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
        ⚠️ <b>Corre contra PRODUCCIÓN</b> — aunque lo dispares desde staging, el
        crawl modifica la base de datos de prod (corre en GitHub Actions). El
        resultado aparece en &quot;Últimas corridas&quot; cuando termina.
      </div>
      <div className="flex flex-wrap gap-2">
        {JOBS.map((j) => (
          <button
            key={j.id}
            onClick={() => run(j.id)}
            disabled={pending}
            title={j.desc}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
          >
            {running === j.id ? "Disparando…" : j.label}
          </button>
        ))}
      </div>
      {msg && (
        <p
          className={`mt-3 text-sm ${
            msg.kind === "ok" ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {msg.kind === "ok" ? "✓ " : "✗ "}
          {msg.text}
        </p>
      )}
    </div>
  );
}
