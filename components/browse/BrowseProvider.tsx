"use client";

import { createContext, useContext, useState } from "react";

/**
 * Estado de filtro compartido del browse: lo escribe el buscador de la barra
 * (DiscoveryBar, en el layout) y lo leen los listados (en la página), así el
 * filtrado es instantáneo client-side y el buscador de arriba "filtra la sección
 * actual" (mangakas, editoriales).
 */
const Ctx = createContext<{ q: string; setQ: (v: string) => void } | null>(null);

export function BrowseProvider({ children }: { children: React.ReactNode }) {
  const [q, setQ] = useState("");
  return <Ctx.Provider value={{ q, setQ }}>{children}</Ctx.Provider>;
}

export function useBrowse() {
  return useContext(Ctx);
}
