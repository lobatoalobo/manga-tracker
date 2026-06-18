/**
 * Bandera argentina como SVG inline. Reemplaza al emoji 🇦🇷, que en Windows
 * (gran parte de los usuarios) NO se renderiza como bandera: se ve como "AR".
 * Esto se ve igual en todas las plataformas.
 */
export default function ArgentinaFlag({
  className = "h-3 w-4.5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 9 6"
      className={className}
      role="img"
      aria-label="Argentina"
    >
      <rect width="9" height="6" fill="#74ACDF" />
      <rect y="2" width="9" height="2" fill="#fff" />
      <circle cx="4.5" cy="3" r="0.78" fill="#F6B40E" />
    </svg>
  );
}
