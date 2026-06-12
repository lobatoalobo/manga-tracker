const MONTHS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/** Gráfico de barras del gasto mensual de un año. Resalta el mes seleccionado. */
export default function SpendChart({
  monthly,
  year,
  selectedMonth,
}: {
  monthly: number[];
  year: number;
  selectedMonth: number | null;
}) {
  const max = Math.max(...monthly, 1);
  if (monthly.every((v) => v === 0)) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-3 text-sm font-medium">Gasto mensual · {year}</p>
      <div className="flex items-end gap-1.5" style={{ height: 120 }}>
        {monthly.map((v, i) => (
          <div
            key={i}
            className="group flex flex-1 flex-col items-center justify-end"
            title={`${MONTHS[i]}: ${ars.format(v)}`}
          >
            <div
              className={`w-full rounded-t transition ${
                i === selectedMonth ? "bg-accent" : "bg-accent/40"
              } group-hover:bg-accent`}
              style={{ height: `${Math.round((v / max) * 100)}%`, minHeight: v > 0 ? 3 : 0 }}
            />
            <span className="mt-1 text-[10px] text-muted">{MONTHS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
