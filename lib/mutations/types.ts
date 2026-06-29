/**
 * Tipos del Mutation Framework (Fase 0). Ver docs/mutation-framework.md.
 * El core NO importa Prisma: el acceso a datos entra por handles opacos
 * (`ctx.read`/`ctx.write`) que la operación castea. Una mutación es un objeto de
 * primer nivel: validate(barato) + preview(genera PLAN) + execute(consume PLAN).
 */

export type ActorType = "script" | "user" | "cron" | "admin" | "import";
export interface Actor {
  readonly type: ActorType;
  readonly id: string;
}

export type Env = "production" | "staging" | "preview" | "development";

/** Referencia a una entidad para lockear filas (SELECT … FOR UPDATE en el adapter). */
export interface EntityRef {
  readonly table: string;
  readonly id: string | number;
}

/**
 * Handle de ESCRITURA (solo presente dentro de `execute`). `client` es opaco (la
 * operación lo castea a su cliente transaccional); `lock` es un primitive de
 * concurrencia que el adapter implementa (no es policy del framework).
 */
export interface DbWriter {
  readonly client: unknown;
  lock(refs: readonly EntityRef[]): Promise<void>;
}

/**
 * Contexto INMUTABLE de una corrida. Nada lo modifica; los resultados viven en
 * `MutationResult`.
 *
 * CONTRATO FUERTE de `read`: es **snapshot-consistente dentro de la fase actual**.
 * En `validate`/`preview` apunta a un cliente de lectura; en `execute` apunta a la
 * **transacción activa** (misma snapshot que las escrituras). El código de lectura
 * compartido entre preview y execute usa `ctx.read` y se comporta consistente en
 * ambas. `write` solo existe en `execute`.
 */
export interface MutationContext {
  readonly actor: Actor;
  readonly env: Env;
  readonly correlationId: string;
  readonly requestId?: string;
  readonly now: Date;
  readonly dryRun: boolean;
  readonly read: unknown;
  readonly write?: DbWriter;
}

export interface AffectedCounts {
  readonly creates: number;
  readonly updates: number;
  readonly deletes: number;
  /** Tablas tocadas (no semántico): carga operativa, no significado de dominio. */
  readonly entities?: readonly string[];
}

/**
 * Resultado de `preview`. Incluye el **PLAN** (`P`, forma de dominio) que
 * `execute` consume — preview decide QUÉ cambiar, execute solo lo APLICA. Esto
 * elimina el drift lógico entre las dos fases.
 */
export interface MutationPreview<P = void> {
  readonly affected: AffectedCounts;
  readonly irreversible: boolean;
  readonly summary: { readonly domain: string; readonly human: string };
  readonly plan: P;
  readonly warnings?: readonly string[];
  readonly estimatedDurationMs?: number;
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

export interface ExecuteOutcome {
  readonly affected?: AffectedCounts;
}

/**
 * Definición tipada y versionada de UNA operación. `I` = input, `P` = forma del
 * plan que preview produce y execute consume.
 */
export interface MutationDefinition<I, P = void> {
  readonly name: string;
  readonly definitionVersion: number;
  readonly kind: string;
  readonly policy?: Policy;
  /** Invariantes baratos (lecturas O(1)). NO cómputo de diff (eso es preview). */
  validate?(ctx: MutationContext, input: I): Promise<void> | void;
  /** Lee y arma el PLAN + el diff. Read-only. */
  preview?(ctx: MutationContext, input: I): Promise<MutationPreview<P>>;
  /** APLICA el plan (vía `ctx.write`). No re-deriva. */
  execute(ctx: MutationContext, input: I, plan: P): Promise<ExecuteOutcome | void>;
  idempotency?(input: I): Idempotency;
}

/** El adapter provee, dentro de la tx, los handles de lectura y escritura. */
export interface TransactionRunner {
  run<T>(fn: (io: { read: unknown; write: DbWriter }) => Promise<T>): Promise<T>;
}

export interface IdempotencyStore {
  wasExecuted(idem: Idempotency, now: Date): Promise<boolean>;
}

export type ConfirmFn = <I, P>(
  ctx: MutationContext,
  definition: MutationDefinition<I, P>,
  preview: MutationPreview<P> | undefined,
) => Promise<boolean>;

export interface MutationHooks {
  beforeValidate?(ctx: MutationContext): void;
  afterValidate?(ctx: MutationContext): void;
  beforeExecute?(ctx: MutationContext): void;
  afterExecute?(ctx: MutationContext): void;
  afterAudit?(ctx: MutationContext): void;
}

export interface RunOptions {
  readonly actor: Actor;
  /** Default: true (dry-run). */
  readonly dryRun?: boolean;
  readonly correlationId?: string;
  readonly requestId?: string;
  /** Cliente de lectura para validate/preview (fuera de la tx). */
  readonly read: unknown;
  readonly transaction: TransactionRunner;
  readonly audit?: import("./audit/sink").AuditSink;
  readonly confirm?: ConfirmFn;
  readonly hooks?: MutationHooks;
  readonly idempotencyStore?: IdempotencyStore;
  /** Para operaciones SIN preview: métricas que la policy usa igual. */
  readonly metadata?: { readonly affected?: AffectedCounts };
  readonly limits?: Partial<Limits>;
}

export interface MutationResult<P = unknown> {
  readonly dryRun: boolean;
  readonly skipped: boolean;
  readonly affected: AffectedCounts | null;
  readonly preview?: MutationPreview<P>;
  readonly correlationId: string;
}
