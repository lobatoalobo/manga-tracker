"use client";

import { useState } from "react";
import { Section } from "./_gallery/Section";

const COLOR_TOKENS: ReadonlyArray<readonly [token: string, label: string]> = [
  ["--paper", "Papel · fondo"],
  ["--paper-2", "Papel 2"],
  ["--card", "Card"],
  ["--ink", "Tinta · texto"],
  ["--ink-2", "Tinta 2"],
  ["--ink-3", "Tinta 3"],
  ["--hair", "Hairline"],
  ["--hair-2", "Hairline 2"],
  ["--mark", "Acento · mark"],
  ["--mark-soft", "Acento soft"],
  ["--warn", "Atención · warn"],
  ["--warn-soft", "Warn soft"],
  ["--go", "Éxito · go"],
  ["--go-soft", "Go soft"],
];

type Choice = "system" | "light" | "dark";
const CHOICES: readonly Choice[] = ["system", "light", "dark"];
const CHOICE_LABEL: Record<Choice, string> = { system: "Sistema", light: "Claro", dark: "Oscuro" };

export default function RetailKitPreview() {
  const [choice, setChoice] = useState<Choice>("system");
  const dataTheme = choice === "system" ? undefined : choice;

  return (
    <div
      data-retail
      data-theme={dataTheme}
      style={{ minHeight: "100vh", padding: "40px 24px", background: "var(--paper)", color: "var(--ink)" }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--sans)", fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ink-2)", margin: 0 }}>
          Nakama · Retail UI Kit
        </p>
        <h1 style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 600, letterSpacing: "-.015em", margin: "4px 0 0" }}>
          C1 · Tema “Editorial preciso”
        </h1>
        <p style={{ fontFamily: "var(--sans)", fontSize: 13.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.6 }}>
          Tema acotado a <code style={{ fontFamily: "var(--mono)" }}>[data-retail]</code>. No afecta el tema global de Nakama.
          Todavía sin componentes: solo se verifican tokens de color y tipografía en claro/oscuro.
        </p>

        <div role="group" aria-label="Tema de la preview" style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {CHOICES.map((c) => {
            const on = choice === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setChoice(c)}
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  borderRadius: 999,
                  padding: "7px 16px",
                  border: `1.5px solid ${on ? "var(--ink)" : "var(--hair-2)"}`,
                  background: on ? "var(--ink)" : "transparent",
                  color: on ? "var(--paper)" : "var(--ink)",
                }}
              >
                {CHOICE_LABEL[c]}
              </button>
            );
          })}
        </div>

        <Section title="Color">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {COLOR_TOKENS.map(([token, text]) => (
              <div key={token} style={{ border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden", background: "var(--card)" }}>
                <div style={{ height: 56, background: `var(${token})`, borderBottom: "1px solid var(--hair)" }} />
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink)" }}>{text}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>{token}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Tipografía">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: 24, color: "var(--ink)" }}>Serif · Kagurabachi 03 — cuerpo editorial</div>
            <div style={{ fontFamily: "var(--sans)", fontSize: 14, letterSpacing: ".02em", color: "var(--ink-2)" }}>Sans · etiquetas y controles de interfaz</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--ink)" }}>Mono · $3.200 · #81 · 12/08</div>
          </div>
        </Section>
      </div>
    </div>
  );
}
