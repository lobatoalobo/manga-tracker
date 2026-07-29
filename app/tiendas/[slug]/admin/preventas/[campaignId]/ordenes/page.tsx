import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { listStoreOrders } from "@/lib/retail/orders";
import { RetailError } from "@/lib/domain/retail/errors";
import { formatArsCents, orderStatusLabel } from "@/lib/retail/format";

export const metadata = { title: "Órdenes · Admin · Nakama" };

/** Listado admin de órdenes de una campaña (§23). Aísla por tienda (storeId derivado de la campaña). */
export default async function StoreOrdersPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
  const { slug, campaignId } = await params;
  const id = Number(campaignId);

  let ctx;
  try {
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: false });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }

  let data;
  try {
    data = await listStoreOrders(id, ctx.userId);
  } catch (err) {
    if (err instanceof StoreAuthError || err instanceof RetailError) notFound(); // otra tienda / no existe
    throw err;
  }
  if (data.campaign.storeId !== ctx.profileRow.storeId) notFound(); // defensa extra de aislamiento

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href={`/tiendas/${slug}/admin/preventas/${id}`} className="text-sm text-accent hover:underline">← Campaña</Link>
      <h1 className="mt-4 mb-6 text-2xl font-bold">Órdenes · {data.campaign.title}</h1>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {data.orders.map((o) => (
          <li key={o.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/tiendas/${slug}/admin/preventas/${id}/ordenes/${o.id}`} className="min-w-0">
              <span className="block truncate font-medium hover:underline">{o.customerName ?? o.customerEmail ?? "Cliente"}</span>
              <span className="block text-xs text-muted">{new Date(o.createdAt).toLocaleDateString("es-AR")} · {o.lineCount} tomos · {o.units} u · {o.publicCode}</span>
            </Link>
            <span className="flex shrink-0 items-center gap-3">
              <span className="font-semibold">{formatArsCents(o.totalCents)}</span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs">{orderStatusLabel(o.status)}</span>
            </span>
          </li>
        ))}
        {data.orders.length === 0 && <li className="px-4 py-3 text-sm text-muted">No hay órdenes todavía.</li>}
      </ul>
    </main>
  );
}
