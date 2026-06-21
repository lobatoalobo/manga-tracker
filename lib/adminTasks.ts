import { prisma } from "@/lib/prisma";
import { detectAndNotifyNewVolumes } from "@/lib/catalogNotify";
import { normalizeGenres } from "@/lib/genres";
import { logJobRun } from "@/lib/jobs";

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
  run: (dryRun: boolean) => Promise<TaskResult>;
}

const SAMPLE = 20;

const tasks: AdminTask[] = [
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
    id: "normalize-genres",
    title: "Normalizar géneros (taxonomía canónica)",
    description:
      "Mapea los géneros crudos (MU/MD, inglés) a la taxonomía canónica en español (lib/genres.ts), guarda el crudo en rawGenres (backup) y separa la demografía. Idempotente: re-mapea desde rawGenres si ya existe.",
    async run(dryRun) {
      const works = await prisma.work.findMany({
        select: { id: true, title: true, genres: true, rawGenres: true, demographic: true },
      });
      let changed = 0;
      const samples: string[] = [];
      for (const w of works) {
        const source = w.rawGenres.length ? w.rawGenres : w.genres;
        if (source.length === 0) continue;
        const { genres, demographic } = normalizeGenres(source);
        const sameGenres =
          genres.length === w.genres.length &&
          genres.every((g) => w.genres.includes(g));
        if (sameGenres && w.rawGenres.length > 0 && (w.demographic ?? null) === (demographic ?? null))
          continue;
        changed++;
        if (samples.length < SAMPLE)
          samples.push(
            `${w.title}: [${source.slice(0, 4).join(", ")}] → [${genres.join(", ")}]${demographic ? ` · ${demographic}` : ""}`,
          );
        if (!dryRun)
          await prisma.work.update({
            where: { id: w.id },
            data: {
              rawGenres: w.rawGenres.length ? w.rawGenres : w.genres,
              genres,
              demographic,
            },
          });
      }
      return { scanned: works.length, changed, samples };
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
