import { ImageResponse } from "next/og";

/**
 * Ícono de marca de Nakama (libros sobre fondo accent) como PNG, en el tamaño
 * pedido. Se usa para los íconos del manifest (192/512) y el apple-icon.
 * Chrome exige PNG (no SVG) para considerar la app instalable.
 */
export function brandIcon(size: number) {
  const barW = Math.round(size * 0.41);
  const barH = Math.round(size * 0.09);
  const gap = Math.round(size * 0.065);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#7c5cff",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: barW,
              height: barH,
              borderRadius: Math.round(barH * 0.33),
              background: "#ffffff",
              marginTop: i === 0 ? 0 : gap,
            }}
          />
        ))}
      </div>
    ),
    { width: size, height: size },
  );
}
