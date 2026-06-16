"use client";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Selector de fecha de salida BORROSA: Año (requerido) + Mes (opcional). Devuelve
 * "YYYY", "YYYY-MM" o "" (sin fecha). Para preventas donde muchas veces solo se
 * sabe el año, o el mes sin día.
 */
export default function ReleaseDatePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (label: string) => void;
  disabled?: boolean;
}) {
  const m = value.match(/^(\d{4})(?:-(\d{2}))?$/);
  const year = m?.[1] ?? "";
  const month = m?.[2] ?? "";

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear + i));

  const sel =
    "rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50";

  return (
    <div className="mt-1 flex gap-2">
      <select
        value={year}
        disabled={disabled}
        onChange={(e) => {
          const y = e.target.value;
          onChange(y ? (month ? `${y}-${month}` : y) : "");
        }}
        className={sel}
      >
        <option value="">— año —</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        value={month}
        disabled={disabled || !year}
        onChange={(e) => {
          const mm = e.target.value;
          onChange(mm ? `${year}-${mm}` : year);
        }}
        className={sel}
      >
        <option value="">— mes (opcional) —</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, "0")}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
