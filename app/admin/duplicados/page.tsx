import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getDuplicateWorkGroups, getEditionDuplicateGroups } from "@/lib/mergeWorks";
import DuplicateMerger from "@/components/DuplicateMerger";
import ManualMerge from "@/components/ManualMerge";
import EditionDupes from "@/components/EditionDupes";

export const metadata = { title: "Series duplicadas (admin) · Nakama" };

/**
 * Cola de revisión de series duplicadas: Works distintos que comparten anilistId
 * (típico tras un crawl/import, cuando una edición se resolvió a AniList después
 * de crear el Work por título). Fusionar (dup real) o separar (mismapeo).
 */
export default async function DuplicadosPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [groups, edDupes] = await Promise.all([
    getDuplicateWorkGroups(),
    getEditionDuplicateGroups(),
  ]);

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

      <div className="mb-6">
        <ManualMerge />
      </div>

      <h2 className="mb-3 text-sm font-semibold">
        Works duplicados (mismo anilistId)
      </h2>
      <DuplicateMerger groups={groups} />

      <h2 className="mb-3 mt-8 text-sm font-semibold">
        Ediciones duplicadas (misma editorial + título)
      </h2>
      <p className="mb-3 text-xs text-muted">
        Redundantes en el mismo work (se limpian solas) o la misma serie partida en
        works distintos (fusionar). Antes esto estaba en Herramientas.
      </p>
      <EditionDupes groups={edDupes} />
    </main>
  );
}
