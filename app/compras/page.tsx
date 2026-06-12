import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  getPurchases,
  getPurchaseStats,
  getMonthlySpend,
  getStatsByPublisher,
  getStatsBySeries,
  type PurchaseStatus,
} from "@/lib/purchases";
import { seriesHref } from "@/lib/url";
import {
  PURCHASE_STATUS_META,
  PURCHASE_STATUS_ORDER,
} from "@/lib/purchaseStatus";
import PurchaseForm from "@/components/PurchaseForm";
import EditPurchaseButton from "@/components/EditPurchaseButton";
import PurchaseItemStatus from "@/components/PurchaseItemStatus";
import PeriodNav, { type Period } from "@/components/PeriodNav";
import SpendChart from "@/components/SpendChart";

export const metadata = { title: "Compras · Nakama" };

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; y?: string; m?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const userId = session.user.id;

  const params = await searchParams;
  const now = new Date();
  const mode =
    params.period === "year" ? "year" : params.period === "all" ? "all" : "month";
  const year = Number(params.y) || now.getFullYear();
  const month =
    params.m != null && params.m !== "" ? Number(params.m) : now.getMonth();
  const period: Period =
    mode === "all"
      ? { mode: "all" }
      : mode === "year"
        ? { mode: "year", year }
        : { mode: "month", year, month };

  const [purchases, stats, byPublisher, bySeries] = await Promise.all([
    getPurchases(userId),
    getPurchaseStats(userId),
    getStatsByPublisher(userId),
    getStatsBySeries(userId),
  ]);
  const monthly = mode !== "all" ? await getMonthlySpend(userId, year) : null;

  const inPeriod = purchases.filter((p) => {
    if (mode === "all") return true;
    const d = p.purchasedAt;
    if (d.getFullYear() !== year) return false;
    return mode === "month" ? d.getMonth() === month : true;
  });
  const liveItems = (p: (typeof inPeriod)[number]) =>
    p.items.filter((i) => i.status !== "CANCELLED");
  const liveGross = (p: (typeof inPeriod)[number]) =>
    liveItems(p).reduce((a, i) => a + i.price, 0);
  const liveNet = (p: (typeof inPeriod)[number]) =>
    liveGross(p) * (1 - p.discount / 100);

  const purchasesInPeriod = inPeriod.filter((p) => liveItems(p).length > 0);
  const periodGross = inPeriod.reduce((s, p) => s + liveGross(p), 0);
  const periodTotal = inPeriod.reduce((s, p) => s + liveNet(p), 0);
  const periodSaved = periodGross - periodTotal;
  const periodTomos = inPeriod.reduce((s, p) => s + liveItems(p).length, 0);
  const periodLabel =
    mode === "all" ? "Total" : mode === "year" ? `Año ${year}` : "Este período";

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Mis compras</h1>
      <p className="mb-6 text-sm text-muted">
        Trackeá cuánto gastás en mangas.
      </p>

      <div className="mb-6">
        <PeriodNav period={period} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label={periodLabel}
          value={ars.format(periodTotal)}
          hint={
            periodSaved > 0.5
              ? `sin desc. ${ars.format(periodGross)} · ahorro ${ars.format(periodSaved)}`
              : undefined
          }
        />
        <Stat label="Tomos" value={String(periodTomos)} />
        <Stat label="Compras" value={String(purchasesInPeriod.length)} />
        <Stat label="Promedio mensual" value={ars.format(stats.avgMonthly)} />
        <Stat label="Gasto promedio por tomo" value={ars.format(stats.avgPerVolume)} />
        <Stat
          label="Total histórico"
          value={ars.format(stats.total)}
          hint={stats.pending ? `${stats.pending} en camino` : undefined}
        />
      </div>

      {monthly && (
        <div className="mb-6">
          <SpendChart
            monthly={monthly}
            year={year}
            selectedMonth={mode === "month" ? month : null}
          />
        </div>
      )}

      <div className="mb-6">
        <PurchaseForm />
      </div>

      {(byPublisher.length > 0 || bySeries.length > 0) && (
        <details className="mb-6 rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Ver estadísticas
          </summary>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <Breakdown title="Por editorial" rows={byPublisher} />
            <Breakdown title="Por serie" rows={bySeries.slice(0, 8)} />
          </div>
        </details>
      )}

      {inPeriod.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          No hay compras en este período.
        </p>
      ) : (
        <ul className="space-y-2">
          {inPeriod.map((p) => (
            <li key={p.id}>
              <details className="group rounded-xl border border-border bg-surface">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {p.items.length}{" "}
                      {p.items.length === 1 ? "tomo" : "tomos"} ·{" "}
                      {ars.format(p.total)}
                      {p.discount > 0 && (
                        <>
                          {" "}
                          <span className="text-sm text-muted line-through">
                            {ars.format(p.subtotal)}
                          </span>{" "}
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
                            −{p.discount}%
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {p.purchasedAt.toLocaleDateString("es-AR")}
                      {p.store ? ` · ${p.store}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {PURCHASE_STATUS_ORDER.filter((s) =>
                      p.items.some((i) => i.status === s),
                    ).map((s) => (
                      <StatusChip key={s} status={s} />
                    ))}
                  </div>
                </summary>

                <div className="border-t border-border p-4">
                  <ul className="space-y-2">
                    {p.items.map((it) => (
                      <li key={it.id} className="flex items-center gap-3">
                        {it.coverImage && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.coverImage}
                            alt=""
                            className="h-12 w-9 shrink-0 rounded object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {it.anilistId ? (
                              <Link
                                href={seriesHref(it.anilistId)}
                                className="text-accent hover:underline"
                              >
                                {it.title}
                              </Link>
                            ) : (
                              it.title
                            )}
                            {it.volume ? (
                              <span className="text-muted"> #{it.volume}</span>
                            ) : null}
                          </p>
                          {it.edition && (
                            <p className="text-xs text-muted">{it.edition}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-sm text-muted">
                          {ars.format(it.price)}
                        </span>
                        <PurchaseItemStatus
                          itemId={it.id}
                          status={it.status}
                        />
                      </li>
                    ))}
                  </ul>

                  {p.note && (
                    <p className="mt-3 text-sm text-muted">{p.note}</p>
                  )}

                  <EditPurchaseButton
                    purchase={{
                      id: p.id,
                      store: p.store ?? "",
                      purchasedAt: p.purchasedAt.toISOString().slice(0, 10),
                      note: p.note ?? "",
                      discount: p.discount,
                      items: p.items.map((it) => ({
                        id: it.id,
                        title: it.title,
                        anilistId: it.anilistId,
                        coverImage: it.coverImage,
                        volume: it.volume,
                        edition: it.edition,
                        price: it.price,
                      })),
                    }}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function StatusChip({ status }: { status: PurchaseStatus }) {
  const meta = PURCHASE_STATUS_META[status];
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; total: number }[];
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate">{r.label}</span>
              <span className="shrink-0 text-muted">{ars.format(r.total)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2">
              <div
                className="h-1.5 rounded-full bg-accent/60"
                style={{ width: `${Math.round((r.total / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
