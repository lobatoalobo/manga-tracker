import Link from "next/link";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export type Period =
  | { mode: "month"; year: number; month: number }
  | { mode: "year"; year: number }
  | { mode: "all" };

function href(p: Period): string {
  if (p.mode === "all") return "/compras?period=all";
  if (p.mode === "year") return `/compras?period=year&y=${p.year}`;
  return `/compras?period=month&y=${p.year}&m=${p.month}`;
}

/** Selector de período: ◀ Junio 2026 ▶ con pestañas Mes / Año / Todo. */
export default function PeriodNav({ period }: { period: Period }) {
  let label: string;
  let prev: Period | null = null;
  let next: Period | null = null;

  if (period.mode === "month") {
    label = `${MONTHS[period.month]} ${period.year}`;
    const pm = period.month === 0 ? 11 : period.month - 1;
    const py = period.month === 0 ? period.year - 1 : period.year;
    const nm = period.month === 11 ? 0 : period.month + 1;
    const ny = period.month === 11 ? period.year + 1 : period.year;
    prev = { mode: "month", year: py, month: pm };
    next = { mode: "month", year: ny, month: nm };
  } else if (period.mode === "year") {
    label = `Año ${period.year}`;
    prev = { mode: "year", year: period.year - 1 };
    next = { mode: "year", year: period.year + 1 };
  } else {
    label = "Todo el historial";
  }

  const now = new Date();
  const tab = (p: Period, active: boolean, text: string) => (
    <Link
      href={href(p)}
      className={`rounded-lg px-3 py-1 text-sm transition ${
        active
          ? "bg-accent text-white"
          : "border border-border text-muted hover:text-foreground"
      }`}
    >
      {text}
    </Link>
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {prev ? (
          <Link
            href={href(prev)}
            aria-label="Anterior"
            className="rounded-lg border border-border px-2.5 py-1 text-sm transition hover:border-accent"
          >
            ◀
          </Link>
        ) : (
          <span className="px-2.5 py-1 text-sm opacity-30">◀</span>
        )}
        <span className="min-w-[9rem] text-center font-semibold">{label}</span>
        {next ? (
          <Link
            href={href(next)}
            aria-label="Siguiente"
            className="rounded-lg border border-border px-2.5 py-1 text-sm transition hover:border-accent"
          >
            ▶
          </Link>
        ) : (
          <span className="px-2.5 py-1 text-sm opacity-30">▶</span>
        )}
      </div>

      <div className="flex gap-2">
        {tab(
          { mode: "month", year: now.getFullYear(), month: now.getMonth() },
          period.mode === "month",
          "Mes",
        )}
        {tab(
          { mode: "year", year: now.getFullYear() },
          period.mode === "year",
          "Año",
        )}
        {tab({ mode: "all" }, period.mode === "all", "Todo")}
      </div>
    </div>
  );
}
