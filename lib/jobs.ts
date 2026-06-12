import { prisma } from "@/lib/prisma";

export interface JobRunInput {
  kind: string;
  label?: string | null;
  status?: "OK" | "ERROR";
  processed?: number;
  imported?: number;
  mapped?: number;
  skipped?: number;
  summary?: unknown;
  error?: string | null;
  startedAt: Date;
}

export async function logJobRun(data: JobRunInput) {
  try {
    await prisma.jobRun.create({
      data: {
        kind: data.kind,
        label: data.label ?? null,
        status: data.status ?? "OK",
        processed: data.processed ?? 0,
        imported: data.imported ?? 0,
        mapped: data.mapped ?? 0,
        skipped: data.skipped ?? 0,
        summary: (data.summary ?? undefined) as object | undefined,
        error: data.error ?? null,
        startedAt: data.startedAt,
      },
    });
  } catch (e) {
    console.error("logJobRun falló:", e);
  }
}

export async function getJobRuns(limit = 30) {
  return prisma.jobRun.findMany({
    orderBy: { finishedAt: "desc" },
    take: limit,
  });
}

/**
 * Agrupa los motivos de skip (strings tipo "url — motivo (detalle)") por
 * categoría, para ver de un vistazo por qué se descartaron las entradas.
 */
export function groupSkipReasons(skipped: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of skipped) {
    // "https://… — editorial no soportada (Marvel)" → "editorial no soportada"
    const afterDash = s.split("—").slice(1).join("—").trim() || s;
    const reason = afterDash.replace(/\s*\(.*\)\s*$/, "").trim() || "otro";
    out[reason] = (out[reason] ?? 0) + 1;
  }
  return out;
}
