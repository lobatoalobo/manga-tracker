import { ImageResponse } from "next/og";

// iOS no soporta SVG para el ícono de "Agregar a inicio"; generamos un PNG
// equivalente (mismo diseño que public/icon.svg) con ImageResponse.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
              width: 96,
              height: 18,
              borderRadius: 6,
              background: "#ffffff",
              marginTop: i === 0 ? 0 : 12,
            }}
          />
        ))}
      </div>
    ),
    size,
  );
}
