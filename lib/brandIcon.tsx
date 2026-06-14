import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

// Logo de Nakama embebido como data URI (Satori necesita la imagen inline).
const logoData = (() => {
  try {
    const buf = readFileSync(join(process.cwd(), "public/hanalogo.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
})();

/**
 * Ícono de marca de Nakama (el logo de la flor sobre fondo) como PNG, en el
 * tamaño pedido. Se usa para los íconos del manifest (192/512) y el apple-icon.
 * Chrome exige PNG (no SVG) para considerar la app instalable; el fondo lleno
 * (sin transparencia) hace que funcione bien como ícono "maskable".
 */
export function brandIcon(size: number) {
  // El logo (3500×5274) tiene margen vacío arriba/abajo. Lo escalamos a lo
  // ancho del ícono y dejamos que sobre-pase en alto: el contenedor con
  // overflow hidden recorta ese margen, así la flor llena el cuadro.
  const w = Math.round(size * 1.02);
  const h = Math.round((w * 5274) / 3500);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0d12",
          overflow: "hidden",
        }}
      >
        {logoData && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoData}
            width={w}
            height={h}
            style={{ objectFit: "contain" }}
            alt=""
          />
        )}
      </div>
    ),
    { width: size, height: size },
  );
}
