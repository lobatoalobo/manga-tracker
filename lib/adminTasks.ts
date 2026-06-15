import { prisma } from "@/lib/prisma";
import { ovniSearchUrl, isOvniUrl } from "@/lib/ovni";
import { resolveEditionSeries } from "@/lib/resolveSeries";
import { detectAndNotifyNewVolumes } from "@/lib/catalogNotify";
import { logJobRun } from "@/lib/jobs";
import {
  flagComics,
  consolidateDups,
  depurateCatalog,
  splitHomonyms,
} from "@/lib/curation";
import {
  EDITIONS_CACHE_VERSION,
  clearAllEditionsCache,
} from "@/lib/getMangaDetails";

export interface TaskResult {
  scanned: number; // universo evaluado
  changed: number; // cuántas cambiarían / cambiaron
  samples: string[]; // ejemplos legibles
  note?: string;
}

export interface AdminTaskMeta {
  id: string;
  title: string;
  description: string;
  danger?: boolean;
}

interface AdminTask extends AdminTaskMeta {
  invalidatesEditions?: boolean;
  run: (dryRun: boolean) => Promise<TaskResult>;
}

const SAMPLE = 20;

const tasks: AdminTask[] = [
  {
    id: "flag-comics",
    title: "Sacar cómics occidentales",
    description:
      "Detecta y borra ediciones que parecen cómic (Marvel/DC/Star Wars) por título, entre las que NO están mapeadas a AniList. Simular lista; aplicar borra.",
    danger: true,
    invalidatesEditions: true,
    run: (dryRun) => flagComics(dryRun),
  },
  {
    id: "consolidate-dups",
    title: "Consolidar duplicados",
    description:
      "Junta la misma serie cargada por crawl + Whakoom (misma editorial + título + tomos) en UNA edición: anilistId + link real de la editorial. Borra la sobrante.",
    invalidatesEditions: true,
    run: (dryRun) => consolidateDups(dryRun),
  },
  {
    id: "depurate-catalog",
    title: "Depurar: 1 edición regular por serie",
    description:
      "Deja la edición más completa por (obra, editorial); borra specials/duplicados seguros + works huérfanos. Los homónimos ambiguos los marca, no los toca.",
    danger: true,
    invalidatesEditions: true,
    run: (dryRun) => depurateCatalog(dryRun),
  },
  {
    id: "split-homonyms",
    title: "Separar homónimos",
    description:
      "Separa en works distintos los homónimos que quedaron fusionados (p. ej. Citrus vs Citrus+).",
    invalidatesEditions: true,
    run: (dryRun) => splitHomonyms(dryRun),
  },
  {
    id: "fix-volumes-out-of-range",
    title: "Arreglar tomos fuera de rango",
    description:
      "Ediciones de colección donde un tomo poseído supera el total (catálogo desactualizado). Amplía el total al tomo más alto.",
    async run(dryRun) {
      const eds = await prisma.trackedEdition.findMany({
        where: { ownedVolumes: { some: {} } },
        select: {
          id: true,
          label: true,
          totalVolumes: true,
          manga: { select: { romajiTitle: true } },
          ownedVolumes: { select: { volume: true } },
        },
      });
      const targets = eds
        .map((e) => ({ e, max: Math.max(...e.ownedVolumes.map((v) => v.volume), 0) }))
        .filter((x) => x.e.totalVolumes > 0 && x.max > x.e.totalVolumes);
      if (!dryRun)
        for (const { e, max } of targets)
          await prisma.trackedEdition.update({
            where: { id: e.id },
            data: { totalVolumes: max },
          });
      return {
        scanned: eds.length,
        changed: targets.length,
        samples: targets
          .slice(0, SAMPLE)
          .map(
            ({ e, max }) =>
              `${e.manga.romajiTitle} · ${e.label}: ${e.totalVolumes} → ${max}`,
          ),
      };
    },
  },
  {
    id: "backfill-ovni-urls",
    title: "Backfill de URLs de Ovni → OvniPress",
    description:
      "Ediciones de Ovni cuya URL no apunta a OvniPress (p. ej. quedó una de Whakoom). Las reemplaza por una búsqueda en OvniPress.",
    invalidatesEditions: true,
    async run(dryRun) {
      const rows = await prisma.publisherEdition.findMany({
        where: { publisher: "Ovni Press" },
        select: { id: true, title: true, url: true },
      });
      const targets = rows.filter((r) => !isOvniUrl(r.url));
      if (!dryRun)
        for (const r of targets)
          await prisma.publisherEdition.update({
            where: { id: r.id },
            data: { url: ovniSearchUrl(r.title) },
          });
      return {
        scanned: rows.length,
        changed: targets.length,
        samples: targets
          .slice(0, SAMPLE)
          .map((r) => `${r.title} → ${ovniSearchUrl(r.title)}`),
      };
    },
  },
  {
    id: "resolve-unmapped",
    title: "Re-resolver ediciones sin mapear",
    description:
      "Intenta mapear a AniList (verificado por autor) las ediciones sin anilistId que NO son nacional-only. Hace búsquedas en AniList, así que puede tardar.",
    invalidatesEditions: true,
    async run(dryRun) {
      const rows = await prisma.publisherEdition.findMany({
        where: { anilistId: null, nationalOnly: false },
        select: { id: true, publisher: true, slug: true, title: true },
        take: 80, // acota para no abusar del rate-limit de AniList
      });
      let changed = 0;
      const samples: string[] = [];
      for (const r of rows) {
        const id = await resolveEditionSeries(r).catch(() => null);
        if (!id) continue;
        changed++;
        if (samples.length < SAMPLE) samples.push(`${r.title} → #${id}`);
        if (!dryRun)
          await prisma.publisherEdition.update({
            where: { id: r.id },
            data: { anilistId: id },
          });
      }
      return {
        scanned: rows.length,
        changed,
        samples,
        note:
          rows.length >= 80
            ? "Procesa hasta 80 por corrida; repetí si quedan."
            : undefined,
      };
    },
  },
  {
    id: "notify-new-volumes",
    title: "Notificar tomos nuevos",
    description:
      "Detecta ediciones que sumaron tomo desde la última corrida y notifica a quienes las coleccionan. Simular no crea notificaciones.",
    async run(dryRun) {
      const r = await detectAndNotifyNewVolumes(dryRun);
      return {
        scanned: r.scanned,
        changed: r.changed,
        samples: r.samples,
        note: `${r.notifications} notificaciones${dryRun ? " (simuladas)" : ""}`,
      };
    },
  },
  {
    id: "clear-stale-cache",
    title: "Limpiar caché de ediciones vieja",
    description: `Borra entradas de EditionsCache con versión distinta de la actual (v${EDITIONS_CACHE_VERSION}). Se reconstruyen solas al visitar cada ficha.`,
    async run(dryRun) {
      const rows = await prisma.editionsCache.findMany({
        select: { anilistId: true, data: true },
      });
      const stale = rows.filter(
        (r) => (r.data as { _v?: number } | null)?._v !== EDITIONS_CACHE_VERSION,
      );
      if (!dryRun)
        await prisma.editionsCache.deleteMany({
          where: { anilistId: { in: stale.map((s) => s.anilistId) } },
        });
      return {
        scanned: rows.length,
        changed: stale.length,
        samples: stale
          .slice(0, SAMPLE)
          .map(
            (s) =>
              `#${s.anilistId} (v${(s.data as { _v?: number } | null)?._v ?? "?"})`,
          ),
      };
    },
  },
];

export const ADMIN_TASKS: AdminTaskMeta[] = tasks.map(
  ({ id, title, description, danger }) => ({ id, title, description, danger }),
);

export async function runAdminTask(
  id: string,
  dryRun: boolean,
): Promise<TaskResult> {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Tarea desconocida: ${id}`);

  const startedAt = new Date();
  const res = await task.run(dryRun);

  if (!dryRun) {
    if (task.invalidatesEditions && res.changed > 0)
      await clearAllEditionsCache().catch(() => {});
    await logJobRun({
      kind: `task:${id}`,
      label: "apply",
      processed: res.scanned,
      imported: res.changed,
      mapped: res.changed,
      summary: { samples: res.samples.slice(0, SAMPLE) },
      startedAt,
    });
  }

  return res;
}
