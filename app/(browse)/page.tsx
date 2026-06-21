import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import Landing from "@/components/Landing";

/**
 * Home. AniList quedó demovido (ANILIST_OFF en staging y prod): no hay más
 * Hot/A-Z global de AniList. La home es solo:
 *  - logueado sin búsqueda/pestaña → dashboard personal,
 *  - anónimo sin búsqueda/pestaña → landing,
 *  - cualquier búsqueda o navegación → catálogo LOCAL (/catalogo, /autores).
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; tab?: string }>;
}) {
  const session = await auth();
  const loggedIn = !!session;
  const params = await searchParams;
  const query = params.search?.trim();
  const tab = params.tab;

  // Logueado, sin búsqueda ni pestaña → dashboard personal.
  if (loggedIn && session?.user?.id && !query && !tab) {
    return <Dashboard userId={session.user.id} name={session.user.name} />;
  }

  // Anónimo sin intención de búsqueda → landing con propuesta de valor (en vez de
  // tirarlo directo a la grilla del catálogo sin contexto).
  if (!loggedIn && !query && !tab) {
    const works = await prisma.work
      .findMany({
        where: { coverImage: { not: null } },
        select: { coverImage: true },
        orderBy: { updatedAt: "desc" },
        take: 14,
      })
      .catch(() => [] as { coverImage: string | null }[]);
    const covers = works
      .map((w) => w.coverImage)
      .filter((c): c is string => !!c);
    return <Landing covers={covers} />;
  }

  // Navegación heredada de la barra vieja: mangakas → índice local de autores.
  if (tab === "mangaka") redirect("/autores");
  // Búsqueda o cualquier otra pestaña → catálogo local (próximos = tab tomos).
  const qs = query
    ? `?q=${encodeURIComponent(query)}`
    : tab === "proximos"
      ? "?tab=tomos"
      : "";
  redirect(`/catalogo${qs}`);
}
