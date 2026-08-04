import type { CSSProperties, ReactNode } from "react";
import { Cover, type CoverSize } from "@/components/retail/ui/Cover";
import { Money } from "@/components/retail/ui/Money";

// C-06 · Portada — representa la jerarquía editorial de una edición: una principal
// + cero o más secundarias, o vacía (válida, D-006). RECIBE una composición ya
// resuelta: no elige la principal, no reordena (D-010), no enforce D-008. Escala
// por `tamano`; acciones por slot (`accion` por item). Depende de Cover + Money.

export type PortadaTomo = { serie: string; volumen?: number | string; autor?: string; imagen?: string };
export type PortadaItem = { tomo: PortadaTomo; precioCents?: number; aux?: ReactNode; accion?: ReactNode };
export type PortadaTamano = "mini" | "grande";

// Escala de tapas: grande = display público (con texto); mini = reflejo del editor (solo tapas).
const COVER_SIZE: Record<PortadaTamano, { principal: CoverSize; secundaria: CoverSize }> = {
  grande: { principal: "xl", secundaria: "sm" },
  mini: { principal: "sm", secundaria: "xs" },
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--serif)",
  fontSize: 14,
  color: "var(--ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

const secondaryStyle: CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 11.5,
  color: "var(--ink-2)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

function ItemBlock({ item, tamano, rol }: { item: PortadaItem; tamano: PortadaTamano; rol: "principal" | "secundaria" }) {
  const grande = tamano === "grande";
  const size = COVER_SIZE[tamano][rol];
  const { tomo } = item;
  return (
    <div data-retail-portada-item data-rol={rol} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0, maxWidth: 140 }}>
      {/* En grande la tapa es decorativa (el título textual es el nombre accesible);
          en mini no hay texto, así que la tapa queda informativa (alt del Cover). */}
      <span aria-hidden={grande ? true : undefined} style={{ flex: "0 0 auto" }}>
        <Cover serie={tomo.serie} volumen={tomo.volumen} imagen={tomo.imagen} size={size} />
      </span>
      {grande ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0, maxWidth: "100%", textAlign: "center" }}>
          <div style={titleStyle}>
            {tomo.serie}
            {tomo.volumen !== undefined && tomo.volumen !== "" ? <span style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}> · {tomo.volumen}</span> : null}
          </div>
          {tomo.autor ? <div style={secondaryStyle}>{tomo.autor}</div> : null}
          {item.precioCents !== undefined ? <Money cents={item.precioCents} /> : null}
          {item.aux ? <div style={secondaryStyle}>{item.aux}</div> : null}
        </div>
      ) : null}
      {item.accion ? <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 4 }}>{item.accion}</span> : null}
    </div>
  );
}

export function Portada({
  principal,
  secundarias = [],
  tamano = "grande",
  vacio,
}: {
  principal?: PortadaItem | null;
  secundarias?: PortadaItem[];
  tamano?: PortadaTamano;
  vacio?: ReactNode;
}) {
  const vacia = !principal && secundarias.length === 0;

  if (vacia) {
    if (!vacio) return null; // portada vacía = lista pura (D-006): no renderiza nada
    return (
      <div data-retail-portada data-vacia data-tamano={tamano}>
        {vacio}
      </div>
    );
  }

  return (
    <div data-retail-portada data-tamano={tamano} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: tamano === "grande" ? 20 : 12 }}>
      {principal ? <ItemBlock item={principal} tamano={tamano} rol="principal" /> : null}
      {secundarias.length > 0 ? (
        <ul data-retail-portada-secundarias style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: tamano === "grande" ? 16 : 8 }}>
          {secundarias.map((item, i) => (
            <li key={i}>
              <ItemBlock item={item} tamano={tamano} rol="secundaria" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
