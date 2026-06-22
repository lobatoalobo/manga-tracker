import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getAuthorVariantClusters } from "@/lib/authorMerge";
import AuthorMerge from "@/components/AuthorMerge";

export const metadata = { title: "Autores a unificar (admin) · Nakama" };

/**
 * Cola de unificación de autores: grafías distintas del mismo mangaka (orden y
 * mayúsculas). El autor es texto libre en Work.author, así que el mismo nombre
 * aparece varias veces. Elegís la forma canónica y se reescribe en todas las obras.
 */
export default async function AdminAutoresPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const clusters = await getAuthorVariantClusters();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/admin" className="text-sm text-muted hover:text-foreground">
        ← Admin
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">Autores a unificar</h1>
      <p className="mb-6 text-sm text-muted">
        Grafías distintas del mismo autor (orden nombre/apellido y mayúsculas).
        Elegí una de las variantes o editá el campo, y <b>Unificá</b> — reescribe el
        autor en todas las obras. La sugerencia es la grafía más usada en Title Case.
      </p>
      <AuthorMerge clusters={clusters} />
    </main>
  );
}
