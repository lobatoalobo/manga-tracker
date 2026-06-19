/**
 * Bandera de EE. UU. como SVG inline (versión simplificada). Reemplaza al emoji
 * 🇺🇸, que en Windows no se renderiza como bandera. Igual en todas las
 * plataformas. Usada para marcar ediciones internacionales en inglés (VIZ).
 */
export default function UsaFlag({
  className = "h-3 w-4.5",
}: {
  className?: string;
}) {
  return (
    <svg viewBox="0 0 19 10" className={className} role="img" aria-label="EE. UU.">
      <rect width="19" height="10" fill="#fff" />
      {[0, 2, 4, 6, 8].map((y) => (
        <rect key={y} y={y} width="19" height="1" fill="#B22234" />
      ))}
      <rect width="8" height="5" fill="#3C3B6E" />
    </svg>
  );
}
