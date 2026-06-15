import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getEditionMappings, EDITORIALS } from "@/lib/catalog";
import { getMangaVolumes } from "@/lib/anilist";
import MappingRow from "@/components/MappingRow";
import Pager from "@/components/Pager";

export const metadata = { title: "Mapeos editoriales (admin) · Nakama" };

export default async function AdminMapeosPage({
  searchParams,
}: {
  searchParams: Promise<{
    ed?: string;
    estado?: string;
    q?: string;
    link?: string;
    page?: string;
  }>;
}) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const params = await searchParams;
  const editorial = EDITORIALS.find((e) => e.slug === params.ed);
  const state =
    params.estado === "mapped"
      ? "mapped"
      : params.estado === "unmapped"
        ? "unmapped"
        : params.estado === "national"
          ? "national"
          : undefined;
  const q = params.q?.trim() || undefined;
  const whakoomUrl = params.link === "whakoom";
  const page = Math.max(1, Number(params.page) || 1);

  const { rows, total, lastPage } = await getEditionMappings({
    publisher: editorial?.publisher,
    state,
    q,
    whakoomUrl,
    page,
  });

  // Total de tomos de AniList (referencia) para auditar conteos de esta página.
  const anilistVolumes = await getMangaVolumes(
    rows.flatMap((r) => (r.anilistId ? [r.anilistId] : [])),
  ).catch(() => new Map<number, number>());

  const base =
    `/admin/mapeos?` +
    [
      editorial ? `ed=${editorial.slug}` : "",
      state ? `estado=${state}` : "",
      whakoomUrl ? "link=whakoom" : "",
      q ? `q=${encodeURIComponent(q)}` : "",
    ]
      .filter(Boolean)
      .join("&");

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Mapeos editoriales</h1>
      <p className="mb-5 text-sm text-muted">
        Curá el enlace edición↔serie. <b className="text-foreground">Mapear</b>{" "}
        guarda el anilistId; <b className="text-foreground">Auto</b> intenta
        resolverlo por autor; <b className="text-foreground">Editar</b> corrige
        cualquier dato; <b className="text-foreground">Borrar</b> elimina la
        entrada.
      </p>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap gap-2">
        <Chip href="/admin/mapeos" active={!editorial && !state && !q}>
          Todas
        </Chip>
        {EDITORIALS.map((e) => (
          <Chip
            key={e.slug}
            href={`/admin/mapeos?ed=${e.slug}`}
            active={editorial?.slug === e.slug && !state}
          >
            {e.label}
          </Chip>
        ))}
        <Chip
          href={`/admin/mapeos?estado=unmapped${editorial ? `&ed=${editorial.slug}` : ""}`}
          active={state === "unmapped"}
        >
          Sin mapear
        </Chip>
        <Chip
          href={`/admin/mapeos?estado=mapped${editorial ? `&ed=${editorial.slug}` : ""}`}
          active={state === "mapped"}
        >
          Mapeadas
        </Chip>
        <Chip
          href={`/admin/mapeos?estado=national${editorial ? `&ed=${editorial.slug}` : ""}`}
          active={state === "national"}
        >
          Nacional-only
        </Chip>
        <Chip
          href={`/admin/mapeos?link=whakoom${editorial ? `&ed=${editorial.slug}` : ""}`}
          active={whakoomUrl}
        >
          ⚠ Link Whakoom
        </Chip>
      </div>

      {/* Búsqueda */}
      <form className="mb-5 flex gap-2" action="/admin/mapeos">
        {editorial && <input type="hidden" name="ed" value={editorial.slug} />}
        {state && <input type="hidden" name="estado" value={state} />}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por título…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
          Buscar
        </button>
      </form>

      <p className="mb-3 text-sm text-muted">{total} entradas</p>

      <ul className="space-y-2">
        {rows.map((row) => (
          <MappingRow
            key={row.id}
            row={row}
            anilistVolumes={
              row.anilistId ? anilistVolumes.get(row.anilistId) ?? null : null
            }
          />
        ))}
      </ul>

      {lastPage > 1 && (
        <Pager basePath={base} page={page} lastPage={lastPage} />
      )}
    </main>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm transition ${
        active
          ? "bg-accent text-white"
          : "border border-border text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
