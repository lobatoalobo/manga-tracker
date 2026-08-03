"use client";

import { useState } from "react";
import { Section } from "./_gallery/Section";
import { Money } from "@/components/retail/ui/Money";
import { Cover, type CoverSize, type CoverState } from "@/components/retail/ui/Cover";
import { Button, type ButtonVariant } from "@/components/retail/ui/Button";
import { Pill, type PillTono } from "@/components/retail/ui/Pill";
import { TomoLine } from "@/components/retail/ui/TomoLine";
import { Portada } from "@/components/retail/ui/Portada";
import { Comprobante } from "@/components/retail/ui/Comprobante";
import { WorkspaceShell } from "@/components/retail/ui/WorkspaceShell";
import { ActionBar } from "@/components/retail/ui/ActionBar";

const PORTADA_CAPTION: React.CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 11,
  letterSpacing: ".04em",
  color: "var(--ink-3)",
  margin: "0 0 12px",
};

// El shell llena su padre; en la galería lo enmarcamos con altura fija.
const SHELL_FRAME: React.CSSProperties = {
  height: 320,
  border: "1px solid var(--hair-2)",
  borderRadius: 12,
  overflow: "hidden",
};

const BUTTON_VARIANTS: readonly ButtonVariant[] = ["primary", "ghost", "warn"];
const PILL_TONOS: readonly PillTono[] = ["neutral", "mark", "warn", "go"];

// Tapa de muestra self-contained (data-URI SVG, CSP-safe): ejercita el modo con imagen.
const COVER_SAMPLE_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="74" height="110">' +
      '<rect width="74" height="110" fill="#c0392b"/>' +
      '<rect x="8" y="70" width="58" height="4" fill="#f4f1ea"/>' +
      '<text x="8" y="26" font-family="serif" font-size="12" fill="#f4f1ea">AKIRA</text>' +
      "</svg>",
  );

const COVER_SIZES: readonly CoverSize[] = ["xs", "sm", "md", "lg", "xl"];
const COVER_STATES: ReadonlyArray<readonly [CoverState, string]> = [
  ["normal", "normal"],
  ["faltante", "faltante"],
  ["atenuada", "atenuada"],
];

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
          Galería de componentes aislados con fixtures — no reconstruye pantallas.
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

        <Section title="Money · C-02">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 24, border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--ink-3)" }}>inline</span>
              <Money cents={320000} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--ink-3)" }}>total</span>
              <Money cents={1875000} variant="total" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--ink-3)" }}>cero</span>
              <Money cents={0} />
            </div>
          </div>
        </Section>

        <Section title="Cover · C-03">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              {COVER_SIZES.map((s) => (
                <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <Cover serie="Chainsaw Man" volumen={17} size={s} />
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)" }}>{s}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              {COVER_STATES.map(([state, labelText]) => (
                <div key={state} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <Cover serie="Berserk" volumen={41} size="lg" estadoVisual={state} />
                  <span style={{ fontFamily: "var(--sans)", fontSize: 10, color: "var(--ink-3)" }}>{labelText}</span>
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <Cover serie="Akira" volumen={1} size="lg" imagen={COVER_SAMPLE_IMG} />
                <span style={{ fontFamily: "var(--sans)", fontSize: 10, color: "var(--ink-3)" }}>con imagen</span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Button · C-01">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              {BUTTON_VARIANTS.map((v) => (
                <Button key={v} variant={v}>
                  {v}
                </Button>
              ))}
              {BUTTON_VARIANTS.map((v) => (
                <Button key={`${v}-sm`} variant={v} size="small">
                  {v} small
                </Button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <Button disabled>disabled</Button>
              <Button loading>Cancelando…</Button>
              <Button variant="ghost" size="small" ariaLabel="Quitar tomo">
                ×
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Pill · C-04">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              {PILL_TONOS.map((t) => (
                <Pill key={t} tono={t} dot>
                  {t}
                </Pill>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <Pill tono="mark" prefijo="+" onClick={() => {}}>
                Sugerida (clickable)
              </Pill>
              <Pill>Principal</Pill>
              <Pill tono="go">Pagado</Pill>
              <Pill tono="warn">Falta pagar</Pill>
            </div>
          </div>
        </Section>

        <Section title="TomoLine · C-05">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--hair)", borderRadius: 10, padding: 12, background: "var(--card)" }}>
            <TomoLine tomo={{ serie: "Chainsaw Man", volumen: 17 }} />
            <TomoLine tomo={{ serie: "Berserk", volumen: 41 }} precioCents={320000} />
            <TomoLine tomo={{ serie: "Vinland Saga", volumen: 12, autor: "Makoto Yukimura", imagen: COVER_SAMPLE_IMG }} precioCents={280000} aux="Edición deluxe" />
            <TomoLine tomo={{ serie: "Akira", volumen: 1 }} cantidad={2} precioCents={450000} />
            <TomoLine tomo={{ serie: "Blame!", volumen: 6 }} estadoVisual="atenuada" precioCents={300000} aux="Debe · retiro parcial" />
            <TomoLine tomo={{ serie: "Dandadan", volumen: 5 }} estadoVisual="faltante" aux="No llegó" />
            <TomoLine tomo={{ serie: "Gantz", volumen: 3 }} estadoVisual="sin-precio" />
            <TomoLine tomo={{ serie: "Spy × Family", volumen: 9 }} precioCents={310000} accion={<Button size="small">Apartar</Button>} />
            <TomoLine
              tomo={{ serie: "Jujutsu Kaisen", volumen: 21 }}
              precioCents={320000}
              accion={
                <>
                  <Button variant="ghost" size="small" ariaLabel="Restar uno">−</Button>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink)", minWidth: 14, textAlign: "center" }}>2</span>
                  <Button variant="ghost" size="small" ariaLabel="Sumar uno">+</Button>
                  <Button variant="ghost" size="small" ariaLabel="Quitar tomo">×</Button>
                </>
              }
            />
            <TomoLine
              tomo={{ serie: "Kaguya-sama: Love Is War — Ultra Romantic Edición Especial Aniversario", volumen: 14, autor: "Aka Akasaka" }}
              precioCents={299000}
              accion={<Button size="small">Apartar</Button>}
            />
          </div>
        </Section>

        <Section title="Portada · C-06">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
              <p style={PORTADA_CAPTION}>vacía (editor invita)</p>
              <Portada vacio={<p style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-3)", textAlign: "center", margin: 0 }}>Sin portada — llevá un tomo</p>} />
            </div>

            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
              <p style={PORTADA_CAPTION}>solo principal</p>
              <Portada principal={{ tomo: { serie: "Berserk", volumen: 41, autor: "Kentaro Miura", imagen: COVER_SAMPLE_IMG }, precioCents: 380000 }} />
            </div>

            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
              <p style={PORTADA_CAPTION}>principal + 1 secundaria</p>
              <Portada
                principal={{ tomo: { serie: "Chainsaw Man", volumen: 17, autor: "Tatsuki Fujimoto" }, precioCents: 320000 }}
                secundarias={[{ tomo: { serie: "Spy × Family", volumen: 9 }, precioCents: 310000 }]}
              />
            </div>

            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
              <p style={PORTADA_CAPTION}>público · principal + varias (responsive)</p>
              <Portada
                principal={{ tomo: { serie: "Vinland Saga", volumen: 12, autor: "Makoto Yukimura" }, precioCents: 340000 }}
                secundarias={[
                  { tomo: { serie: "Akira", volumen: 1 }, precioCents: 500000 },
                  { tomo: { serie: "Blame!", volumen: 6 }, precioCents: 300000 },
                  { tomo: { serie: "Gantz", volumen: 3 }, precioCents: 290000 },
                  { tomo: { serie: "Dandadan", volumen: 5 }, precioCents: 315000 },
                ]}
              />
            </div>

            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
              <p style={PORTADA_CAPTION}>editor · mini con acciones</p>
              <Portada
                tamano="mini"
                principal={{ tomo: { serie: "Berserk", volumen: 41 }, accion: <Button variant="ghost" size="small" ariaLabel="Bajar de portada">↓</Button> }}
                secundarias={[
                  { tomo: { serie: "Gantz", volumen: 3 }, accion: <Button variant="ghost" size="small" ariaLabel="Hacer principal">★</Button> },
                  { tomo: { serie: "Akira", volumen: 1 }, accion: <Button variant="ghost" size="small" ariaLabel="Hacer principal">★</Button> },
                ]}
              />
            </div>

            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 18, background: "var(--card)" }}>
              <p style={PORTADA_CAPTION}>título largo</p>
              <Portada principal={{ tomo: { serie: "Kaguya-sama: Love Is War — Ultra Romantic Edición Especial", volumen: 14, autor: "Aka Akasaka" }, precioCents: 299000 }} />
            </div>
          </div>
        </Section>

        <Section title="Comprobante · C-07">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            <div>
              <p style={PORTADA_CAPTION}>cliente · sin comprobante</p>
              <Comprobante contexto="cliente" estado="sin-comprobante" referencia={<Money cents={320000} variant="total" />} onSeleccionar={() => {}} />
            </div>
            <div>
              <p style={PORTADA_CAPTION}>cliente · seleccionado</p>
              <Comprobante contexto="cliente" estado="seleccionado" archivo={{ nombre: "transferencia-1234.pdf" }} onQuitar={() => {}} onEnviar={() => {}} />
            </div>
            <div>
              <p style={PORTADA_CAPTION}>cliente · enviado (por validar)</p>
              <Comprobante contexto="cliente" estado="enviado" archivo={{ nombre: "comprobante.jpg", fecha: "12/08" }} onVer={() => {}} />
            </div>
            <div>
              <p style={PORTADA_CAPTION}>confirmado</p>
              <Comprobante contexto="cliente" estado="confirmado" archivo={{ nombre: "comprobante.jpg", fecha: "12/08" }} referencia={<Money cents={320000} />} onVer={() => {}} />
            </div>
            <div>
              <p style={PORTADA_CAPTION}>cliente · rechazado</p>
              <Comprobante contexto="cliente" estado="rechazado" nota="El monto no coincide con el pedido." onSeleccionar={() => {}} />
            </div>
            <div>
              <p style={PORTADA_CAPTION}>tienda · por validar</p>
              <Comprobante contexto="tienda" estado="enviado" archivo={{ nombre: "comprobante.jpg", fecha: "12/08" }} referencia={<Money cents={320000} variant="total" />} onVer={() => {}} onConfirmar={() => {}} onRechazar={() => {}} />
            </div>
            <div>
              <p style={PORTADA_CAPTION}>tienda · confirmado</p>
              <Comprobante contexto="tienda" estado="confirmado" archivo={{ nombre: "comprobante.jpg", fecha: "12/08" }} onVer={() => {}} />
            </div>
          </div>
        </Section>

        <Section title="WorkspaceShell · C-08">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <p style={PORTADA_CAPTION}>una columna · nav (Preventa activa, algunas disabled) · pie = ActionBar</p>
              <div style={SHELL_FRAME}>
                <WorkspaceShell
                  edicion={{ numero: 81, semana: "semana del 12/08", estado: { label: "En preventa", tono: "mark" } }}
                  faseActual="preventa"
                  fasesDisponibles={["creacion", "preventa", "cierre"]}
                  onNavegar={() => {}}
                  pie={<ActionBar resumen="Vas a pedir 12 · definiste 8 de 10 tomos" acciones={<Button>Cerrar preventa</Button>} />}
                >
                  <TomoLine tomo={{ serie: "Chainsaw Man", volumen: 17, autor: "Tatsuki Fujimoto" }} precioCents={320000} />
                  <TomoLine tomo={{ serie: "Spy × Family", volumen: 9 }} precioCents={310000} />
                  <TomoLine tomo={{ serie: "Berserk", volumen: 41 }} precioCents={380000} />
                </WorkspaceShell>
              </div>
            </div>

            <div>
              <p style={PORTADA_CAPTION}>dos columnas (main + aside) · fase Creación</p>
              <div style={SHELL_FRAME}>
                <WorkspaceShell
                  edicion={{ numero: 82, semana: "semana del 19/08", estado: { label: "En preparación", tono: "neutral" } }}
                  faseActual="creacion"
                  onNavegar={() => {}}
                  aside={<Portada tamano="mini" principal={{ tomo: { serie: "Berserk", volumen: 41 } }} secundarias={[{ tomo: { serie: "Gantz", volumen: 3 } }]} />}
                  pie={<ActionBar bloqueo="Faltan 2 precios" acciones={<Button disabled>Publicar la edición</Button>} />}
                >
                  <TomoLine tomo={{ serie: "Gantz", volumen: 3 }} estadoVisual="sin-precio" />
                  <TomoLine tomo={{ serie: "Akira", volumen: 1, autor: "Katsuhiro Otomo" }} precioCents={500000} />
                </WorkspaceShell>
              </div>
            </div>
          </div>
        </Section>

        <Section title="ActionBar · C-09">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden" }}>
              <p style={{ ...PORTADA_CAPTION, margin: "10px 14px 0" }}>con CTA + resumen secundario (Money)</p>
              <ActionBar resumen={<>3 tomos · total <Money cents={960000} /></>} acciones={<><Button variant="ghost" size="small">Vaciar</Button><Button>Hacer pedido</Button></>} />
            </div>
            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden" }}>
              <p style={{ ...PORTADA_CAPTION, margin: "10px 14px 0" }}>bloqueada (motivo anunciado)</p>
              <ActionBar bloqueo="Queda un tomo sin definir “A pedir”" acciones={<Button disabled>Cerrar preventa</Button>} />
            </div>
            <div style={{ border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden" }}>
              <p style={{ ...PORTADA_CAPTION, margin: "10px 14px 0" }}>loading (aria-busy)</p>
              <ActionBar loading resumen="Publicando…" acciones={<Button loading>Publicando…</Button>} />
            </div>
            <div style={{ maxWidth: 340, border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden" }}>
              <p style={{ ...PORTADA_CAPTION, margin: "10px 14px 0" }}>angosto / mobile (wrap)</p>
              <ActionBar resumen={<>total <Money cents={960000} variant="total" /></>} acciones={<Button>Hacer pedido</Button>} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
