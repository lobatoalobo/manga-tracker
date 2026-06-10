import type { IvreaData } from "./providers/ivrea";
import type { PaniniData } from "./providers/panini";
import type { OvniData } from "./providers/ovni";
import type { MangaUpdatesData } from "./providers/mangaupdates";

/**
 * Una "edición" de un manga: cómo lo publica una editorial local, o un formato
 * de la edición original (estándar/kanzenban/etc. según MangaUpdates). Se
 * calcula en vivo al abrir el detalle; no se persiste.
 */
export interface Edition {
  id: string; // key estable (p. ej. "ivrea", "mu-volumes")
  source: string; // nombre legible
  region: "AR" | "JP" | "INT";
  publisher: string | null;
  slug: string | null; // slug de la editorial, si aplica (para re-resolver)
  status: string;
  volumes: number;
  nextVolume: number | null;
  url: string | null;
  note?: string; // aclaración (p. ej. "en catálogo, puede faltar stock")
}

interface AnilistLike {
  status?: string | null;
  volumes?: number | null;
}

export interface BuiltEditions {
  editions: Edition[];
  /** Tomos de la edición estándar (MangaUpdates) para trackear. */
  muVolumes: number | null;
}

/**
 * Arma la lista de ediciones a partir de todas las fuentes:
 *   - Editoriales locales (Ivrea, Panini): quién publica + link + disponibilidad.
 *   - Formatos de MangaUpdates (estándar, kanzenban, combini-ban): conteo autoritativo.
 *   - Respaldo japonés de AniList si MangaUpdates no resolvió.
 */
export function buildEditions(
  anilist: AnilistLike,
  ivrea: IvreaData | null,
  panini: PaniniData | null,
  ovni: OvniData | null,
  mu: MangaUpdatesData | null,
): BuiltEditions {
  const editions: Edition[] = [];

  // --- Editoriales locales (Argentina) ---
  if (ivrea && ivrea.argentinaVolumes > 0) {
    editions.push({
      id: "ivrea",
      source: "Ivrea Argentina",
      region: "AR",
      publisher: "Ivrea Argentina",
      slug: ivrea.slug,
      status: ivrea.argentinaStatus,
      volumes: ivrea.argentinaVolumes,
      nextVolume: ivrea.nextVolume,
      url: ivrea.url,
    });
  }

  if (panini && panini.totalVolumes > 0) {
    editions.push({
      id: "panini",
      source: "Panini Argentina",
      region: "AR",
      publisher: "Panini Argentina",
      slug: null,
      status: "EN CATÁLOGO",
      volumes: panini.totalVolumes,
      nextVolume: null,
      url: panini.url,
      note: `${panini.listed} tomos en catálogo`,
    });
  }

  if (ovni && ovni.totalVolumes > 0) {
    editions.push({
      id: "ovni",
      source: "Ovni Press",
      region: "AR",
      publisher: "Ovni Press",
      slug: null,
      status: "EN CATÁLOGO",
      volumes: ovni.totalVolumes,
      nextVolume: null,
      url: ovni.url,
      note: `${ovni.listed} tomos en catálogo`,
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
    const jpVolumes = Math.max(anilist.volumes ?? 0, ivrea?.japanVolumes ?? 0);
    const jpStatus =
      ivrea?.japanStatus && ivrea.japanStatus !== "UNKNOWN"
        ? ivrea.japanStatus
        : translateStatus(anilist.status);

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

/** Etiqueta legible para un formato de MangaUpdates. */
function formatName(label: string): string {
  const l = label.toLowerCase();
  if (/^volumes?$/.test(l)) return "Edición estándar (japonesa)";
  if (l.includes("kanzenban")) return "Kanzenban (japonesa)";
  if (l.includes("combini") || l.includes("conbini")) return "Combini-ban (japonesa)";
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
