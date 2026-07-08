import { prisma } from "@/lib/prisma";
import {
  getIvreaProximas,
  getIvreaNews,
  type IvreaProxima,
} from "@/lib/providers/ivrea";
import { findOrCreateWork, normalizeTitle } from "@/lib/catalog";
import { publishedVolumes } from "@/lib/volumes";

export interface ProximasResult {
  cards: number; // tarjetas totales en /proximas/
  snapshot: number; // filas guardadas en IvreaRelease
  mapped: number; // de esas, cuántas mapean a una edición de Ivrea (por slug)
  reissues: number; // tarjetas de "REEDICIONES POR TOMO AGOTADO"
  newSeries: number; // próximas series (debuts) sembradas desde /news/
  debutWorks: number; // works con chip "próximo a salir" (= newSeries)
  clearedStale: number; // works que tenían el chip y se apagaron
  volumeCaps: number; // ediciones cuyo conteo se capó por tomo futuro (sobre-conteo)
}

function kindOf(c: IvreaProxima): string {
  if (c.isReissue) return "reissue";
  if (c.isOneShot) return "oneshot";
  if (c.isNewSeries) return "debut";
  return "volume";
}

export interface EdLite {
  id: number;
  slug: string | null;
  title: string;
}

/**
 * Elige la edición de Ivrea para una tarjeta de /proximas/. El slug del link a
 * veces es genérico (la reedición "NGE ED. DELUXE" linkea a /titulo/evangelion/,
 * la común), así que preferimos el match por TÍTULO usando el RECALL de los
 * tokens de la tarjeta: la edición que cubre más palabras del card gana, y a
 * igualdad, la más precisa (menos tokens de más). Cubre abreviaturas
 * ("ED. DELUXE" → "Edición Deluxe") y cards cortos ("JOJOLION" → título largo).
 */
export function chooseIvreaEdition(
  cardTitle: string,
  cardSlug: string | null,
  editions: EdLite[],
): EdLite | null {
  const norm = normalizeTitle(cardTitle);
  const slugEd = cardSlug
    ? (editions.find((e) => e.slug === cardSlug) ?? null)
    : null;

  // 1) Exacto e inequívoco.
  const exact = editions.filter((e) => normalizeTitle(e.title) === norm);
  if (exact.length === 1) return exact[0];

  // 2) Recall de tokens del card; desempate por menos tokens de más.
  const cardTokens = norm.split(" ").filter(Boolean);
  if (cardTokens.length === 0) return slugEd;
  const measure = (e: EdLite) => {
    const et = new Set(normalizeTitle(e.title).split(" ").filter(Boolean));
    let covered = 0;
    for (const t of cardTokens) if (et.has(t)) covered++;
    return { recall: covered / cardTokens.length, extra: et.size - covered };
  };
  const ranked = editions
    .map((e) => ({ e, ...measure(e) }))
    .sort((a, b) => b.recall - a.recall || a.extra - b.extra);
  const best = ranked[0];
  if (!best || best.recall < 0.5) return slugEd; // sin match confiable
  const slugRecall = slugEd ? measure(slugEd).recall : -1;
  return best.recall >= slugRecall ? best.e : slugEd;
}

/**
 * Refresca todo lo que sale de la página de próximas salidas de Ivrea (única
 * fuente del sistema de próximos por ahora):
 *
 *  1) Snapshot en `IvreaRelease` de TODAS las tarjetas (lanzamiento/debut/tomo
 *     único/reedición) con su fecha, mapeadas a la edición de Ivrea por slug
 *     cuando existe. Reemplazo total (la página es el estado actual).
 *  2) Siembra las PRÓXIMAS SERIES (debuts) desde /news/ como `Work` con
 *     `upcoming=true` + `releaseLabel` (todavía sin edición; cuando salgan, el
 *     crawl les engancha la edición por título). Esas son el set de "próximo a
 *     salir"; el resto se apaga (limpia chips viejos de cualquier editorial).
 */
export interface VolumeCapChange {
  editionId: number;
  title: string;
  from: number;
  to: number;
}

/**
 * Corrige el SOBRE-CONTEO de tomos: el crawl del catálogo cuenta tomos que Ivrea
 * anuncia pero todavía NO salieron (la contradicción "📅 Próximo tomo #2" con "3
 * tomos"). Usa el snapshot YA guardado en `IvreaRelease` (no re-fetchea Ivrea):
 * si una edición tiene un tomo NUEVO con fecha futura en el tomo N, los publicados
 * son N-1 → capa `edition.volumes` y borra los `Volume` fantasma (> N-1).
 *
 * Idempotente: si ya está capado, no hace nada. Solo BAJA el conteo, nunca lo sube.
 * Lo corre el cron de /proximas/ (root fix, se mantiene solo) y el script
 * `fix-volume-overcounts.ts` (one-off). Ver memoria pending-ivrea-recrawl: acá NO
 * asumimos, usamos la fecha futura que la propia Ivrea publicó.
 */
export async function capOvercountedIvreaEditions(
  dryRun = false,
): Promise<VolumeCapChange[]> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  // Próximo tomo NUEVO (no reedición) con fecha futura, por edición.
  const future = await prisma.ivreaRelease.findMany({
    where: { editionId: { not: null }, kind: "volume", releaseDate: { gt: today }, volume: { not: null } },
    select: { editionId: true, volume: true },
  });
  const minNext = new Map<number, number>();
  for (const r of future) {
    const v = r.volume!;
    const cur = minNext.get(r.editionId!);
    if (cur == null || v < cur) minNext.set(r.editionId!, v);
  }
  if (minNext.size === 0) return [];

  const eds = await prisma.publisherEdition.findMany({
    where: { id: { in: [...minNext.keys()] } },
    select: { id: true, title: true, volumes: true },
  });
  const changes: VolumeCapChange[] = [];
  for (const e of eds) {
    const capped = publishedVolumes(e.volumes, minNext.get(e.id)!);
    if (capped >= e.volumes) continue; // ya correcto
    changes.push({ editionId: e.id, title: e.title, from: e.volumes, to: capped });
    if (!dryRun) {
      await prisma.publisherEdition.update({ where: { id: e.id }, data: { volumes: capped } });
      await prisma.volume.deleteMany({ where: { editionId: e.id, number: { gt: capped } } });
    }
  }
  return changes;
}

export async function reconcileIvreaProximas(
  dryRun = false,
): Promise<ProximasResult> {
  const cards = await getIvreaProximas();

  // Ediciones de Ivrea; mapeamos cada tarjeta a una con chooseIvreaEdition
  // (match por título, robusto a slug genérico y abreviaturas).
  const editions = await prisma.publisherEdition.findMany({
    where: { publisher: "Ivrea Argentina" },
    select: { id: true, slug: true, title: true, anilistId: true, workId: true },
  });
  const byId = new Map(editions.map((e) => [e.id, e]));

  const rows = cards.map((c) => {
    const picked = chooseIvreaEdition(c.title, c.slug, editions);
    const ed = picked ? byId.get(picked.id) : undefined;
    return {
      slug: c.slug,
      title: c.title,
      volume: c.volume,
      kind: kindOf(c),
      releaseDate: c.releaseDate ? new Date(c.releaseDate) : null,
      editionId: ed?.id ?? null,
      anilistId: ed?.anilistId ?? null,
    };
  });

  // Próximas SERIES (debuts) = tarjetas de /proximas/ marcadas ¡NUEVA SERIE! o
  // ¡TOMO ÚNICO! (título+portada+fecha limpios, incluye "Historias con aroma de
  // café") UNIDAS con las de /news/ (que aportan autor). Merge por título norm.
  const today = new Date().toISOString().slice(0, 10);
  const news = await getIvreaNews();
  type Debut = { title: string; cover: string | null; releaseLabel: string | null; author: string | null; date: string | null };
  const debuts = new Map<string, Debut>();
  for (const c of cards) {
    if (!c.isNewSeries && !c.isOneShot) continue;
    const k = normalizeTitle(c.title);
    const rl = c.releaseDate ? c.releaseDate.slice(0, 7) : null;
    const ex = debuts.get(k);
    if (ex) {
      if (!ex.cover) ex.cover = c.coverImage;
      if (!ex.releaseLabel) ex.releaseLabel = rl;
      if (!ex.date) ex.date = c.releaseDate;
    } else {
      debuts.set(k, { title: c.title, cover: c.coverImage, releaseLabel: rl, author: null, date: c.releaseDate });
    }
  }
  for (const n of news) {
    const k = normalizeTitle(n.title);
    const ex = debuts.get(k);
    if (ex) {
      if (!ex.cover) ex.cover = n.coverImage;
      if (!ex.author) ex.author = n.author;
      if (!ex.releaseLabel) ex.releaseLabel = n.releaseLabel;
    } else {
      debuts.set(k, { title: n.title, cover: n.coverImage, releaseLabel: n.releaseLabel, author: n.author, date: null });
    }
  }

  const debutWorkIds: number[] = [];
  if (!dryRun) {
    for (const d of debuts.values()) {
      const workId = await findOrCreateWork({
        title: d.title,
        coverImage: d.cover,
        author: d.author,
        incomingType: "MANGA", // Ivrea es fuente manga (guard cross-type)
      }).catch(() => null);
      if (workId == null) continue;
      // "Próxima serie" = anunciada pero TODAVÍA NO PUBLICADA. Ya salió si:
      //  - tiene edición con tomos (volumes>0), o
      //  - su fecha exacta de /proximas/ ya pasó (caso Marriage Toxin: salió pero
      //    Ivrea todavía no la pasó a /catalogo/, así que no hay edición aún), o
      //  - su mes anunciado es anterior al actual.
      // En cualquiera de esos casos NO es upcoming (queda false por el clear).
      const published = await prisma.publisherEdition.count({
        where: { workId, volumes: { gt: 0 } },
      });
      const datePast = d.date != null && d.date <= today;
      const monthPast = d.releaseLabel != null && d.releaseLabel < today.slice(0, 7);
      if (published > 0 || datePast || monthPast) continue;
      await prisma.work.update({
        where: { id: workId },
        data: { upcoming: true, releaseLabel: d.releaseLabel ?? undefined },
      });
      debutWorkIds.push(workId);
    }
  }

  // Las marcadas "próxima" a mano por el admin (curated) NO las apaga este sync:
  // su flag lo gobierna el admin, no el feed de Ivrea. Ver markWorkUpcomingAction.
  const clearWhere = {
    upcoming: true,
    id: { notIn: debutWorkIds },
    NOT: { curated: { has: "upcoming" } },
  };
  const stale = await prisma.work.count({ where: clearWhere });

  if (!dryRun) {
    await prisma.$transaction([
      prisma.ivreaRelease.deleteMany({}),
      prisma.ivreaRelease.createMany({ data: rows }),
    ]);
    // Apagar upcoming en todo lo que no sea una próxima serie vigente (ni curada).
    await prisma.work.updateMany({
      where: clearWhere,
      data: { upcoming: false },
    });
  }

  // Capar el sobre-conteo: ahora que el snapshot de IvreaRelease está fresco,
  // las ediciones con un tomo futuro no deben contar ese tomo como publicado.
  const volumeCaps = (await capOvercountedIvreaEditions(dryRun)).length;

  return {
    cards: cards.length,
    snapshot: rows.length,
    mapped: rows.filter((r) => r.editionId != null).length,
    reissues: cards.filter((c) => c.isReissue).length,
    newSeries: debuts.size,
    debutWorks: debutWorkIds.length,
    clearedStale: stale,
    volumeCaps,
  };
}
