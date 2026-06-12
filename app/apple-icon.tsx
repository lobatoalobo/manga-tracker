import { brandIcon } from "@/lib/brandIcon";

// iOS no soporta SVG para el ícono de "Agregar a inicio"; generamos un PNG.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandIcon(180);
}
