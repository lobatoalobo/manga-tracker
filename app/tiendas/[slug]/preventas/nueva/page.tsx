import { notFound } from "next/navigation";
import { requireStoreMember } from "@/lib/storeAuth";
import { StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";
import { NuevaPreventaScreen } from "@/components/store-preventas/NuevaPreventaScreen";

export const metadata = { title: "Nueva preventa · Tienda · Nakama" };

/** Alta de preventa en el shell SaaS. Crear requiere miembro OWNER/STAFF y tienda habilitada (política CREATE). */
export default async function NuevaPreventaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    await requireStoreMember(slug, { allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF], requireEnabled: true });
  } catch (err) {
    if (err instanceof StoreAuthError) notFound();
    throw err;
  }
  return <NuevaPreventaScreen slug={slug} />;
}
