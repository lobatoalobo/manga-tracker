"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSynopsisAction, translateSynopsisAction } from "@/app/actions";

/**
 * Editor de sinopsis ES/EN de una serie (en /admin/sinopsis). Cada idioma tiene
 * su campo; "Traducir →" completa el otro idioma con el LLM (se guarda marcado
 * automático); "Guardar" persiste una edición manual (marcada oficial). Al
 * completar las dos, la serie sale de la lista. Ver docs/analisis-sistema-datos.md.
 */
export default function SynopsisFix({
  workId,
  serieHref,
  title,
  es,
  en,
  esAuto,
  enAuto,
}: {
  workId: number;
  serieHref: string;
  title: string;
  es: string | null;
  en: string | null;
  esAuto: boolean;
  enAuto: boolean;
}) {
  const router = useRouter();
  const [esVal, setEsVal] = useState(es ?? "");
  const [enVal, setEnVal] = useState(en ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const translate = (from: "es" | "en", to: "es" | "en") =>
    start(async () => {
      setErr(null);
      const r = await translateSynopsisAction(workId, from, to);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (to === "es") setEsVal(r.text);
      else setEnVal(r.text);
      router.refresh();
    });

  const save = (lang: "es" | "en", value: string) =>
    start(async () => {
      setErr(null);
      await setSynopsisAction(workId, lang, value);
      router.refresh();
    });

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate font-medium">{title}</span>
        <a
          href={serieHref}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
        >
          Ver ↗
        </a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Español"
          auto={esAuto}
          value={esVal}
          onChange={setEsVal}
          onBlur={() => esVal.trim() !== (es ?? "").trim() && save("es", esVal)}
          onTranslate={enVal.trim() ? () => translate("en", "es") : undefined}
          disabled={pending}
        />
        <Field
          label="English"
          auto={enAuto}
          value={enVal}
          onChange={setEnVal}
          onBlur={() => enVal.trim() !== (en ?? "").trim() && save("en", enVal)}
          onTranslate={esVal.trim() ? () => translate("es", "en") : undefined}
          disabled={pending}
        />
      </div>
      {err && <p className="mt-2 text-xs text-rose-400">✗ {err}</p>}
    </li>
  );
}

function Field({
  label,
  auto,
  value,
  onChange,
  onBlur,
  onTranslate,
  disabled,
}: {
  label: string;
  auto: boolean;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onTranslate?: () => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        {auto && value && <span className="text-xs text-muted/70">(auto)</span>}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={5}
        className="w-full resize-y rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
      />
      {/* Sin botón Guardar: se guarda al salir del campo (onBlur). "Traducir"
          guarda solo. */}
      {onTranslate && !value.trim() && (
        <button
          type="button"
          onClick={onTranslate}
          disabled={disabled}
          className="mt-1 rounded-lg border border-accent/40 px-2 py-1 text-xs text-accent transition hover:bg-accent/10 disabled:opacity-40"
        >
          {disabled ? "…" : "Traducir desde la otra ↻"}
        </button>
      )}
    </div>
  );
}
