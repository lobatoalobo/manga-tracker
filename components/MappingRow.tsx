"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setEditionMappingAction,
  resolveEditionMappingAction,
  updateEditionAction,
  deleteEditionAction,
  setEditionNationalOnlyAction,
} from "@/app/actions";
import type { EditionMapping } from "@/lib/catalog";

const input =
  "rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm outline-none focus:border-accent";

export default function MappingRow({
  row,
  anilistVolumes = null,
}: {
  row: EditionMapping;
  anilistVolumes?: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [anilist, setAnilist] = useState(row.anilistId?.toString() ?? "");
  const [title, setTitle] = useState(row.title);
  const [url, setUrl] = useState(row.url);
  const [volumes, setVolumes] = useState(row.volumes.toString());
  const [pending, start] = useTransition();

  const run = (action: () => Promise<void>) =>
    start(async () => {
      await action();
      router.refresh();
    });

  const saveMapping = () =>
    run(() =>
      setEditionMappingAction(row.id, anilist.trim() ? Number(anilist) : null),
    );

  const saveAll = () =>
    run(async () => {
      await updateEditionAction(row.id, {
        title,
        url,
        volumes: Number(volumes) || 0,
        anilistId: anilist.trim() ? Number(anilist) : null,
      });
      setEditing(false);
    });

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={row.title}>
            {row.title}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {row.publisher} · {row.volumes} tomos
            {anilistVolumes != null && anilistVolumes !== row.volumes && (
              <span
                className="text-amber-400/80"
                title="AniList dice otro total (su dato suele estar incompleto). Solo una referencia, no necesariamente un error."
              >
                {" "}
                (AniList: {anilistVolumes})
              </span>
            )}{" "}
            ·{" "}
            {row.anilistId ? (
              <Link
                href={`/manga/${row.anilistId}`}
                target="_blank"
                className="text-accent hover:underline"
              >
                serie #{row.anilistId} ↗
              </Link>
            ) : row.nationalOnly ? (
              <span className="text-sky-300">🇦🇷 nacional-only</span>
            ) : (
              <span className="text-amber-400">sin mapear</span>
            )}{" "}
            ·{" "}
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              ficha ↗
            </a>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <input
            value={anilist}
            onChange={(e) => setAnilist(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="anilistId"
            inputMode="numeric"
            className={`w-24 ${input}`}
          />
          <Btn onClick={saveMapping} disabled={pending} variant="accent">
            Mapear
          </Btn>
          <Btn
            onClick={() => run(() => resolveEditionMappingAction(row.id))}
            disabled={pending}
            title="Resolver automáticamente (verificado por autor)"
          >
            Auto
          </Btn>
          <Btn onClick={() => setEditing((v) => !v)} disabled={pending}>
            {editing ? "Cerrar" : "Editar"}
          </Btn>
          <Btn
            onClick={() =>
              run(() =>
                setEditionNationalOnlyAction(row.id, !row.nationalOnly),
              )
            }
            disabled={pending}
            title="Marcar como obra solo-nacional (no existe en AniList)"
          >
            {row.nationalOnly ? "Quitar nacional" : "Nacional-only"}
          </Btn>
          <Btn
            onClick={() => run(() => deleteEditionAction(row.id))}
            disabled={pending}
            variant="danger"
            title="Borrar esta entrada del catálogo"
          >
            Borrar
          </Btn>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
          <label className="text-xs text-muted">
            Título
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`mt-1 w-full ${input}`}
            />
          </label>
          <label className="text-xs text-muted">
            Tomos
            <input
              value={volumes}
              onChange={(e) => setVolumes(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className={`mt-1 w-full ${input}`}
            />
          </label>
          <label className="text-xs text-muted sm:col-span-2">
            URL de la ficha
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={`mt-1 w-full ${input}`}
            />
          </label>
          <div className="sm:col-span-2">
            <Btn onClick={saveAll} disabled={pending} variant="accent">
              Guardar cambios
            </Btn>
          </div>
        </div>
      )}
    </li>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  title,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "accent" | "danger";
}) {
  const cls =
    variant === "accent"
      ? "border-accent text-accent hover:bg-accent hover:text-white"
      : variant === "danger"
        ? "border-border text-muted hover:border-red-500 hover:text-red-400"
        : "border-border text-muted hover:text-foreground";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
