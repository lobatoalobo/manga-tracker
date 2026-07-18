import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Rate limiting básico de ventana fija, backed por DB (Postgres) para que
 * funcione en serverless: en Vercel cada request puede caer en otra instancia,
 * así que un contador en memoria no sirve. Pensado para acciones de baja
 * frecuencia (envíos de la comunidad, solicitudes, imports), donde el costo de
 * una escritura extra es despreciable.
 *
 * Identidad: el usuario logueado (`u:<id>`); si es anónimo (p. ej. reporte sin
 * login), la IP del request (`ip:<addr>`). Devuelve un resultado amigable en
 * castellano para que la action lo retorne en su shape `{ ok, error }`.
 */
export type RateLimitResult = { ok: true } | { ok: false; error: string };

async function identity(): Promise<string> {
  const session = await auth();
  if (session?.user?.id) return `u:${session.user.id}`;
  const h = await headers();
  const ip =
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    h.get("x-real-ip") ||
    "anon";
  return `ip:${ip}`;
}

function humanWait(ms: number): string {
  const min = Math.ceil(ms / 60000);
  if (min <= 1) return "en un minuto";
  if (min < 60) return `en ${min} minutos`;
  const h = Math.ceil(min / 60);
  return h <= 1 ? "en una hora" : `en ${h} horas`;
}

/**
 * Consume un cupo de `action` para el llamante. Si se pasó del límite, devuelve
 * `{ ok: false, error }`. Ventana fija: el contador se reinicia al vencer.
 */
export async function enforceRateLimit(
  action: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const key = `${action}:${await identity()}`;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + opts.windowMs);

  const rec = await prisma.rateLimit.findUnique({ where: { key } });

  // Sin registro o ventana vencida → arranca una ventana nueva.
  if (!rec || rec.windowEnd <= now) {
    await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, windowEnd },
      update: { count: 1, windowEnd },
    });
    return { ok: true };
  }

  if (rec.count >= opts.limit) {
    const wait = humanWait(rec.windowEnd.getTime() - now.getTime());
    return {
      ok: false,
      error: `Demasiados intentos. Probá de nuevo ${wait}.`,
    };
  }

  await prisma.rateLimit.update({
    where: { key },
    data: { count: { increment: 1 } },
  });
  return { ok: true };
}

const HOUR = 3_600_000;

/** Presets por acción (límite por ventana). Tuneá acá, no en cada action. */
export const RL = {
  report: { limit: 5, windowMs: HOUR },
  submitStore: { limit: 5, windowMs: HOUR },
  submitIndie: { limit: 5, windowMs: HOUR },
  friendRequest: { limit: 20, windowMs: HOUR },
  comment: { limit: 30, windowMs: 10 * 60_000 },
  importCsv: { limit: 3, windowMs: HOUR },
  createProposal: { limit: 10, windowMs: HOUR },
} as const;
