import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { listStoreCampaigns } from "@/lib/retail/campaigns";

export const metadata = { title: "Preventas · Admin · Nakama" };

/** Panel de preventas de una tienda: lista de campañas (§14). Solo miembros (requireEnabled:false). */
export default async function PreorderListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let ctx;
  try {
    ctx = await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: false });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }
  const campaigns = await listStoreCampaigns(ctx.profileRow.storeId, ctx.userId);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href={`/tiendas/${slug}/admin`} className="text-sm text-accent hover:underline">← Admin</Link>
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Preventas · {ctx.profileRow.store.name}</h1>
        <Link href={`/tiendas/${slug}/admin/preventas/nueva`} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Nueva</Link>
      </div>

      <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
        {campaigns.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/tiendas/${slug}/admin/preventas/${c.id}`} className="font-medium hover:underline">
              {c.title} {c.weekLabel && <span className="text-muted">· {c.weekLabel}</span>}
            </Link>
            <span className="flex items-center gap-3 text-xs text-muted">
              <span>{c._count.offers} ofertas</span>
              <span className="rounded-full bg-surface px-2 py-0.5">{c.status}</span>
            </span>
          </li>
        ))}
        {campaigns.length === 0 && <li className="px-4 py-3 text-sm text-muted">No hay campañas todavía.</li>}
      </ul>
    </main>
  );
}
