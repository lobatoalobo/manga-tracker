import type { Actor, AffectedCounts, Env } from "../types";

/** Momento del ciclo que se audita. Se registra el INTENTO y el resultado. */
export type AuditPhase = "attempt" | "success" | "failure" | "skipped";

/**
 * Entrada de auditoría — el contrato que toda `AuditSink` recibe. Versionada
 * (`schemaVersion` + `definitionVersion`) para poder leer logs viejos tras
 * cambiar el formato. La tabla `MutationLog` (paso 4) se modela sobre esto.
 */
export interface AuditEntry {
  readonly schemaVersion: number;
  readonly frameworkVersion: number;
  readonly definitionVersion: number;
  readonly phase: AuditPhase;
  readonly name: string;
  readonly kind: string;
  readonly actor: Actor;
  readonly env: Env;
  readonly correlationId: string;
  readonly requestId?: string;
  readonly dryRun: boolean;
  readonly affected?: AffectedCounts;
  readonly irreversible?: boolean;
  readonly summary?: { readonly domain: string; readonly human: string };
  readonly warnings?: readonly string[];
  readonly mutationKey?: string;
  readonly mutationScope?: string;
  readonly durationMs?: number;
  readonly error?: { readonly name: string; readonly message: string };
  readonly at: Date;
}

export const AUDIT_SCHEMA_VERSION = 1;
export const FRAMEWORK_VERSION = 1;
