/**
 * Layout del grupo (browse): home y ficha de serie. La barra de descubrimiento
 * de AniList (DiscoveryBar) se removió con el cutover a catálogo local; el
 * browse/búsqueda vive en /catalogo. No hace falta envoltorio extra.
 */
export default function BrowseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
