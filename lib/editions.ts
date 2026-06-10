import type { MangaUpdatesData } from "./providers/mangaupdates";

/**
 * Una "edición" de un manga: cómo lo publica una editorial local, o un formato
 * de la edición original (estándar/kanzenban/etc. según MangaUpdates).
 */
export interface Edition {
  id: string;
  source: string;
  region: "AR" | "JP" | "INT";
  publisher: string | null;
  slug: string | null;
  status: string;
  volumes: number;
  nextVolume: number | null;
  url: string | null;
  note?: string;
}

/** Edición local (editorial argentina) ya resuelta, lista para mostrar. */
export interface LocalEdition {
  id: string; // "ivrea" | "panini" | "ovni"
  publisher: string;
  slug: string | null;
  volumes: number;
  status: string;
  url: string | null;
  note?: string;
}

interface AnilistLike {
  status?: string | null;
  volumes?: number | null;
}

export interface BuiltEditions {
  editions: Edition[];
  muVolumes: number | null;
}

export function buildEditions(
  anilist: AnilistLike,
  local: LocalEdition[],
  mu: MangaUpdatesData | null,
): BuiltEditions {
  const editions: Edition[] = [];

  // --- Editoriales locales (Argentina) ---
  for (const le of local) {
    if (le.volumes <= 0) continue;
    editions.push({
      id: le.id,
      source: le.publisher,
      region: "AR",
      publisher: le.publisher,
      slug: le.slug,
      status: le.status,
      volumes: le.volumes,
      nextVolume: null,
      url: le.url,
      note: le.note,
    });
  }

  // --- Formatos originales (MangaUpdates) ---
  if (mu && mu.formats.length > 0) {
    for (const f of mu.formats) {
      editions.push({
        id: `mu-${f.label.toLowerCase().replace(/\s+/g, "-")}`,
        source: formatName(f.label),
        region: "JP",
        publisher: null,
        slug: null,
        status: f.complete ? "COMPLETA" : "EN CURSO",
        volumes: f.count,
        nextVolume: null,
        url: null,
      });
    }
  } else {
    // Respaldo: edición japonesa desde AniList si MU no resolvió.
    const jpVolumes = anilist.volumes ?? 0;
    const jpStatus = translateStatus(anilist.status);
    if (jpVolumes > 0 || jpStatus !== "DESCONOCIDO") {
      editions.push({
        id: "jp",
        source: "Edición japonesa",
        region: "JP",
        publisher: null,
        slug: null,
        status: jpStatus,
        volumes: jpVolumes,
        nextVolume: null,
        url: null,
      });
    }
  }

  return { editions, muVolumes: mu?.standardVolumes ?? null };
}

function formatName(label: string): string {
  const l = label.toLowerCase();
  if (/^volumes?$/.test(l)) return "Edición estándar (japonesa)";
  if (l.includes("kanzenban")) return "Kanzenban (japonesa)";
  if (l.includes("combini") || l.includes("conbini"))
    return "Combini-ban (japonesa)";
  if (l.includes("bunkoban")) return "Bunkoban (japonesa)";
  return `${label} (japonesa)`;
}

function translateStatus(status?: string | null): string {
  switch (status) {
    case "RELEASING":
      return "EN CURSO";
    case "FINISHED":
      return "COMPLETA";
    case "HIATUS":
      return "EN PAUSA";
    case "CANCELLED":
      return "CANCELADA";
    case "NOT_YET_RELEASED":
      return "NO PUBLICADA";
    default:
      return "DESCONOCIDO";
  }
}
