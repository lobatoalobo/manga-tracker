import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listCustomerOrders } from "@/lib/retail/orders";
import { formatArsCents, orderStatusLabel } from "@/lib/retail/format";

export const metadata = { title: "Mis preventas · Nakama" };

/** Lista de reservas del cliente (§22). Solo las propias (el servicio filtra por userId de sesión). */
export default async function MyPreordersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/mis-compras/preventas");
  const orders = await listCustomerOrders(session.user.id);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="text-2xl font-bold">Mis preventas</h1>
      <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
        {orders.map((o) => (
          <li key={o.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/mis-compras/preventas/${o.publicCode}`} className="min-w-0">
              <span className="block truncate font-medium hover:underline">{o.campaign.title}</span>
              <span className="block text-xs text-muted">{o.store.name} · {o._count.lines} tomos · {o.publicCode}</span>
            </Link>
            <span className="flex shrink-0 items-center gap-3">
              <span className="font-semibold">{formatArsCents(o.totalCents)}</span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs">{orderStatusLabel(o.status)}</span>
            </span>
          </li>
        ))}
        {orders.length === 0 && <li className="px-4 py-3 text-sm text-muted">Todavía no reservaste ninguna preventa.</li>}
      </ul>
    </main>
  );
}
