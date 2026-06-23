"use client";

import { useState } from "react";
import ExpandableText from "@/components/ExpandableText";

/**
 * Sinopsis con tabs ES / EN (default ES). Si solo hay una versión, la muestra
 * sin tabs. Marca "traducción automática" cuando la versión visible no es la
 * oficial de la fuente. Ver docs/analisis-sistema-datos.md.
 */
export default function SynopsisTabs({
  es,
  en,
  esAuto,
  enAuto,
}: {
  es: string | null;
  en: string | null;
  esAuto: boolean;
  enAuto: boolean;
}) {
  const [lang, setLang] = useState<"es" | "en">(es ? "es" : "en");
  if (!es && !en) return null;

  // Una sola versión → sin tabs.
  if (!es || !en) {
    const text = (es ?? en) as string;
    const auto = es ? esAuto : enAuto;
    return (
      <div className="mt-6">
        <ExpandableText text={text} className="mt-0" />
        {auto && <AutoNote />}
      </div>
    );
  }

  const text = lang === "es" ? es : en;
  const auto = lang === "es" ? esAuto : enAuto;
  return (
    <div className="mt-6">
      <div className="mb-1 flex gap-1">
        <Tab active={lang === "es"} onClick={() => setLang("es")} label="Español" />
        <Tab active={lang === "en"} onClick={() => setLang("en")} label="English" />
      </div>
      <ExpandableText key={lang} text={text} className="mt-1" />
      {auto && <AutoNote />}
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-0.5 text-xs font-medium transition ${
        active ? "bg-accent text-white" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function AutoNote() {
  return (
    <p className="mt-1 text-xs text-muted/70">Traducción automática</p>
  );
}
