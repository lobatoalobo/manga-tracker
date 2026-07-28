import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPublicCampaign } from "@/lib/retail/public";
import { formatArsCents } from "@/lib/retail/format";
import ReserveForm from "./ReserveForm";

export const metadata = { title: "Preventa · Nakama" };

const AVAILABILITY_LABEL: Record<string, string> = {
  OPEN: "Preventa abierta",
  NOT_YET: "Aún no abrió",
  ENDED: "Cerró",
  CLOSED: "Campaña cerrada",
};

/** Página PÚBLICA de una campaña publicada (§16/§21). Si está abierta y hay sesión, permite reservar. */
export default async function PublicCampaignPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
  const { slug, campaignId } = await params;
  const c = await getPublicCampaign(slug, Number(campaignId));
  if (!c) notFound(); // DRAFT/CANCELLED/tienda deshabilitada/otra tienda → 404

  const session = await auth();
  const authed = !!session?.user?.id;
  const isOpen = c.availability === "OPEN";
  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "long" }) : null);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/tiendas" className="text-sm text-accent hover:underline">← Tiendas</Link>
      <p className="mt-4 text-sm text-muted">{c.storeName}</p>
      <h1 className="text-2xl font-bold">{c.title}</h1>
      {c.weekLabel && <p className="text-sm text-muted">{c.weekLabel}</p>}
      {c.description && <p className="mt-3 text-sm">{c.description}</p>}
      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className="rounded-full bg-accent/10 px-3 py-1 font-medium text-accent">{AVAILABILITY_LABEL[c.availability]}</span>
        {(c.opensAt || c.closesAt) && (
          <span className="text-muted">
            {fmtDate(c.opensAt) && `Abre ${fmtDate(c.opensAt)}`} {fmtDate(c.closesAt) && `· Cierra ${fmtDate(c.closesAt)}`}
          </span>
        )}
      </div>

      {isOpen && c.offers.length > 0 ? (
        <ReserveForm campaignId={Number(campaignId)} offers={c.offers} authed={authed} loginHref={`/api/auth/signin?callbackUrl=/tiendas/${slug}/preventas/${campaignId}`} />
      ) : (
        <>
          <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
            {c.offers.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{o.title} {o.volumeNumber != null && <span className="font-medium">#{o.volumeNumber}</span>} {o.publisher && <span className="text-muted">· {o.publisher}</span>}</span>
                <span className="flex items-center gap-2">
                  {o.discountPercent > 0 && <span className="text-muted line-through">{formatArsCents(o.listPriceCents)}</span>}
                  <span className="font-semibold">{formatArsCents(o.preorderPriceCents)}</span>
                  {o.discountPercent > 0 && <span className="text-xs text-green-600">-{o.discountPercent}%</span>}
                </span>
              </li>
            ))}
            {c.offers.length === 0 && <li className="px-4 py-3 text-sm text-muted">Sin ofertas activas.</li>}
          </ul>
          <p className="mt-6 text-center text-sm text-muted">
            {c.availability === "NOT_YET" ? "La preventa todavía no abrió." : "La preventa no está abierta."}
          </p>
        </>
      )}
    </main>
  );
}
