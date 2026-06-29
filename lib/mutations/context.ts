import type { Env } from "./types";

/**
 * Entorno EXPLÍCITO (`APP_ENV` → `VERCEL_ENV` → `NODE_ENV`). Nunca se infiere de
 * `DATABASE_URL` (el día que cambie Neon, se rompería la detección).
 */
export function resolveEnv(): Env {
  const e = process.env.APP_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (e === "production") return "production";
  if (e === "preview") return "preview";
  if (e === "staging") return "staging";
  return "development";
}

/** Id de correlación. El entry point puede pasar el trace de Sentry; default uuid. */
export function newCorrelationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
