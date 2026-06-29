/**
 * Tipos del Mutation Framework (Fase 0). Ver docs/mutation-framework.md.
 * El core NO importa Prisma: el acceso a datos entra por `ctx.db` (opaco) + un
 * `TransactionRunner` inyectado. Una mutación es un objeto de primer nivel:
 * validación + preview(opcional) + policy + confirmación + execute + auditoría.
 */

export type ActorType = "script" | "user" | "cron" | "admin" | "import";
export interface Actor {
  readonly type: ActorType;
  readonly id: string;
}

export type Env = "production" | "staging" | "preview" | "development";

/**
 * Contexto INMUTABLE de una corrida. Nada lo modifica durante la ejecución; los
 * resultados viven en `MutationResult`. `db` es opaco para el framework (la
 * operación lo castea a su cliente, p. ej. Prisma): fuera de tx = lectura, dentro
 * de `execute` = cliente transaccional.
 */
export interface MutationContext {
  readonly actor: Actor;
  readonly env: Env;
  readonly correlationId: string;
  readonly requestId?: string;
  readonly now: Date;
  readonly dryRun: boolean;
  readonly db: unknown;
}

export interface AffectedCounts {
  readonly creates: number;
  readonly updates: number;
  readonly deletes: number;
}

/** Resultado de `preview`. Estructura EXPLÍCITA (no un `metadata` gigante). */
export interface MutationPreview {
  readonly affected: AffectedCounts;
  readonly summary: readonly string[]; // primeras N líneas de diff legible
  readonly warnings?: readonly string[];
  readonly estimatedDurationMs?: number;
  /** Datos propios de la operación, si los necesita. NO usar como cajón de sastre. */
  readonly extra?: unknown;
}

export interface Limits {
  readonly maxAffected?: number;
  readonly maxCreates?: number;
  readonly maxUpdates?: number;
  readonly maxDeletes?: number;
}

export interface Policy extends Limits {
  /** Cuándo exigir confirmación explícita. Default: "never". */
  readonly requiresConfirmation?: "always" | "prod" | "never";
  readonly requiresReview?: boolean;
}

export interface Idempotency {
  readonly key: string;
  readonly scope?: string;
  /** Sin expiración por default (un MERGE no debe re-correr nunca). */
  readonly expiresAt?: Date;
}

/** Lo que `execute` puede devolver para reportar su efecto REAL. */
export interface ExecuteOutcome {
  readonly affected?: AffectedCounts;
}

/**
 * Definición tipada y versionada de UNA operación. `validate`/`preview` son
 * read-only; `execute` escribe (vía `ctx.db` transaccional). El framework solo
 * invoca estas funciones: nunca conoce las reglas de negocio.
 */
export interface MutationDefinition<I> {
  readonly name: string;
  readonly definitionVersion: number;
  /** Categoría libre por operación (MERGE, DELETE, BULK_IMPORT, …). */
  readonly kind: string;
  readonly policy?: Policy;
  validate?(ctx: MutationContext, input: I): Promise<void> | void;
  preview?(ctx: MutationContext, input: I): Promise<MutationPreview>;
  execute(ctx: MutationContext, input: I): Promise<ExecuteOutcome | void>;
  idempotency?(input: I): Idempotency;
}

/** Abstracción de transacción: el core no sabe que abajo hay Prisma. */
export interface TransactionRunner {
  run<T>(fn: (txDb: unknown) => Promise<T>): Promise<T>;
}

/** Resuelve si un `key` de idempotencia ya se ejecutó (no-dry, no expirado). */
export interface IdempotencyStore {
  wasExecuted(idem: Idempotency, now: Date): Promise<boolean>;
}

/** Confirmación explícita; el entry point decide cómo (prompt, flag, …). */
export type ConfirmFn = <I>(
  ctx: MutationContext,
  definition: MutationDefinition<I>,
  preview: MutationPreview | undefined,
) => Promise<boolean>;

/** Hooks de observabilidad (no-op en v1): métricas/tracing/profiling a futuro. */
export interface MutationHooks {
  beforeValidate?(ctx: MutationContext): void;
  afterValidate?(ctx: MutationContext): void;
  beforeExecute?(ctx: MutationContext): void;
  afterExecute?(ctx: MutationContext): void;
  afterAudit?(ctx: MutationContext): void;
}

export interface RunOptions {
  readonly actor: Actor;
  /** Default: true (dry-run). Aplicar requiere intención explícita. */
  readonly dryRun?: boolean;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly db: unknown;
  readonly transaction: TransactionRunner;
  readonly audit?: import("./audit/sink").AuditSink;
  readonly confirm?: ConfirmFn;
  readonly hooks?: MutationHooks;
  readonly idempotencyStore?: IdempotencyStore;
  /** Para operaciones SIN preview: métricas que la policy usa igual. */
  readonly metadata?: { readonly affected?: AffectedCounts };
  /** Override de límites por llamada. */
  readonly limits?: Partial<Limits>;
}

export interface MutationResult {
  readonly dryRun: boolean;
  readonly skipped: boolean; // por idempotencia
  readonly affected: AffectedCounts | null;
  readonly preview?: MutationPreview;
  readonly correlationId: string;
}
