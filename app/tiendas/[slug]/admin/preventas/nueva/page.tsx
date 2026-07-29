import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import NewCampaignForm from "./NewCampaignForm";

export const metadata = { title: "Nueva preventa · Admin · Nakama" };

/** Crear una campaña (DRAFT). Requiere miembro OWNER/STAFF y tienda habilitada (CREATE en la política). */
export default async function NewPreorderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: true });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }
  return (
    <main className="mx-auto max-w-xl px-5 py-8">
      <Link href={`/tiendas/${slug}/admin/preventas`} className="text-sm text-accent hover:underline">← Preventas</Link>
      <h1 className="mt-4 text-2xl font-bold">Nueva campaña</h1>
      <NewCampaignForm slug={slug} />
    </main>
  );
}
