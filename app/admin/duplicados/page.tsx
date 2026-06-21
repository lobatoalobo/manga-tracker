import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getDuplicateWorkGroups } from "@/lib/mergeWorks";
import DuplicateMerger from "@/components/DuplicateMerger";

export const metadata = { title: "Series duplicadas (admin) · Nakama" };

/**
 * Cola de revisión de series duplicadas: Works distintos que comparten anilistId
 * (típico tras un crawl/import, cuando una edición se resolvió a AniList después
 * de crear el Work por título). Fusionar (dup real) o separar (mismapeo).
 */
export default async function DuplicadosPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const groups = await getDuplicateWorkGroups();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/admin" className="text-sm text-muted hover:text-foreground">
        ← Admin
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">Series duplicadas</h1>
      <p className="mb-6 text-sm text-muted">
        Works distintos con el mismo anilistId. Si son la misma serie, elegí cuál
        conservar y <b>Fusionar</b>. Si NO lo son (una novela/spin-off quedó pegada
        al id de otra), <b>Separar</b>.
      </p>
      <DuplicateMerger groups={groups} />
    </main>
  );
}
