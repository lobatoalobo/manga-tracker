import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPurchases, getPurchaseStats } from "@/lib/purchases";
import PurchaseForm from "@/components/PurchaseForm";
import PurchaseActions from "@/components/PurchaseActions";

export const metadata = { title: "Compras · Nakama" };

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export default async function ComprasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [purchases, stats] = await Promise.all([
    getPurchases(session.user.id),
    getPurchaseStats(session.user.id),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Mis compras</h1>
      <p className="mb-6 text-sm text-muted">
        Llevá el registro de lo que compraste y cuánto gastaste.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Este mes" value={ars.format(stats.thisMonth)} />
        <Stat label="Este año" value={ars.format(stats.thisYear)} />
        <Stat label="Total invertido" value={ars.format(stats.total)} />
        <Stat
          label="Compras"
          value={`${stats.count}${stats.pending ? ` · ${stats.pending} pend.` : ""}`}
        />
      </div>

      <div className="mb-6">
        <PurchaseForm />
      </div>

      {purchases.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          Todavía no registraste compras.
        </p>
      ) : (
        <ul className="space-y-2">
          {purchases.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {p.title}
                  {p.volume ? ` #${p.volume}` : ""}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {ars.format(p.price)}
                  {p.edition ? ` · ${p.edition}` : ""}
                  {p.store ? ` · ${p.store}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {p.purchasedAt.toLocaleDateString("es-AR")} ·{" "}
                  {p.status === "RECEIVED" ? "✅ Recibido" : "⏳ Pedido"}
                </p>
              </div>
              <PurchaseActions id={p.id} status={p.status} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
