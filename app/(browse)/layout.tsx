import { Suspense } from "react";
import { auth } from "@/auth";
import { BrowseProvider } from "@/components/browse/BrowseProvider";
import DiscoveryBar from "@/components/browse/DiscoveryBar";
import { ANILIST_OFF } from "@/lib/flags";

/**
 * Layout compartido por la home y la ficha de serie. La barra de descubrimiento
 * (buscador + modos de AniList) queda fija arriba. Con AniList apagado NO se
 * muestra: el browse/búsqueda local vive en /catalogo.
 */
export default async function BrowseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <BrowseProvider>
      {!ANILIST_OFF && (
        <div className="mx-auto max-w-6xl px-5 pt-6">
          <Suspense fallback={null}>
            <DiscoveryBar loggedIn={!!session?.user} />
          </Suspense>
        </div>
      )}
      {children}
    </BrowseProvider>
  );
}
