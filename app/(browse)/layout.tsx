import { Suspense } from "react";
import { BrowseProvider } from "@/components/browse/BrowseProvider";
import DiscoveryBar from "@/components/browse/DiscoveryBar";

/**
 * Layout compartido por la home y la ficha de serie: la barra de descubrimiento
 * (buscador + modos) queda fija y no se desmonta al abrir una serie — solo
 * cambia el contenido de abajo.
 */
export default function BrowseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <BrowseProvider>
      <div className="mx-auto max-w-6xl px-5 pt-6">
        <Suspense fallback={null}>
          <DiscoveryBar />
        </Suspense>
      </div>
      {children}
    </BrowseProvider>
  );
}
