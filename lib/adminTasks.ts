import { prisma } from "@/lib/prisma";
import { detectAndNotifyNewVolumes } from "@/lib/catalogNotify";
import { logJobRun } from "@/lib/jobs";
import {
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
