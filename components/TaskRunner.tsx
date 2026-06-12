"use client";

import { useState, useTransition } from "react";
import { runAdminTaskAction } from "@/app/actions";
import type { AdminTaskMeta } from "@/lib/adminTasks";

type Result =
  | {
      ok: true;
      dryRun: boolean;
      scanned: number;
      changed: number;
      samples: string[];
      note?: string;
    }
  | { ok: false; error: string };

export default function TaskRunner({ tasks }: { tasks: AdminTaskMeta[] }) {
  return (
    <div className="space-y-3">
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} />
      ))}
    </div>
  );
}

function TaskCard({ task }: { task: AdminTaskMeta }) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"dry" | "apply" | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function run(dryRun: boolean) {
    if (!dryRun && !confirm(`Aplicar "${task.title}" sobre la base actual?`))
      return;
    setMode(dryRun ? "dry" : "apply");
    setResult(null);
    start(async () => {
      const res = (await runAdminTaskAction(task.id, dryRun)) as Result;
      setResult(res);
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-medium">{task.title}</h3>
      <p className="mt-0.5 text-xs text-muted">{task.description}</p>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => run(true)}
          disabled={pending}
          className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
        >
          {pending && mode === "dry" ? "Simulando…" : "Simular"}
        </button>
        <button
          onClick={() => run(false)}
          disabled={pending}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
        >
          {pending && mode === "apply" ? "Aplicando…" : "Aplicar"}
        </button>
      </div>

      {result && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          {result.ok ? (
            <>
              <p>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    result.dryRun
                      ? "bg-sky-500/15 text-sky-300"
                      : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {result.dryRun ? "SIMULACIÓN" : "APLICADO"}
                </span>{" "}
                <span className="text-muted">
                  {result.changed} de {result.scanned}{" "}
                  {result.dryRun ? "cambiarían" : "cambiadas"}
                </span>
              </p>
              {result.note && (
                <p className="mt-1 text-xs text-amber-400">{result.note}</p>
              )}
              {result.samples.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs text-muted">
                  {result.samples.map((s, i) => (
                    <li key={i} className="break-all">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              {result.changed === 0 && (
                <p className="mt-1 text-xs text-muted">Nada para cambiar 👍</p>
              )}
            </>
          ) : (
            <p className="text-red-400">✗ {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
