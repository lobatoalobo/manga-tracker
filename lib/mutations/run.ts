import { ConsoleAuditSink } from "./audit/console";
import {
  AUDIT_SCHEMA_VERSION,
  FRAMEWORK_VERSION,
  type AuditEntry,
  type AuditPhase,
} from "./audit/types";
import { newCorrelationId, resolveEnv } from "./context";
import { ConfirmationRequiredError } from "./errors";
import { checkPolicy, confirmationRequired } from "./policy";
import type {
  AffectedCounts,
  MutationContext,
  MutationDefinition,
  MutationResult,
  RunOptions,
} from "./types";

const sameCounts = (a: AffectedCounts, b: AffectedCounts) =>
  a.creates === b.creates && a.updates === b.updates && a.deletes === b.deletes;
const fmt = (a: AffectedCounts) => `+${a.creates}/~${a.updates}/-${a.deletes}`;

/**
 * Orquesta el pipeline: validate → preview? → policy → confirm → execute(+R1) →
 * audit. Dry-run por default. El core no conoce reglas de negocio ni Prisma.
 */
export async function runMutation<I>(
  definition: MutationDefinition<I>,
  input: I,
  options: RunOptions,
): Promise<MutationResult> {
  const dryRun = options.dryRun ?? true;
  const ctx: MutationContext = Object.freeze({
    actor: options.actor,
    env: resolveEnv(),
    correlationId: options.correlationId ?? newCorrelationId(),
    requestId: options.requestId,
    now: new Date(),
    dryRun,
    db: options.db,
  });

  const sink = options.audit ?? new ConsoleAuditSink();
  const hooks = options.hooks ?? {};
  const idem = definition.idempotency?.(input);
  const started = Date.now();

  const base = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    frameworkVersion: FRAMEWORK_VERSION,
    definitionVersion: definition.definitionVersion,
    name: definition.name,
    kind: definition.kind,
    actor: ctx.actor,
    env: ctx.env,
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
    dryRun,
    mutationKey: idem?.key,
    mutationScope: idem?.scope,
  };
  const audit = (phase: AuditPhase, extra: Partial<AuditEntry> = {}) =>
    sink.record({ ...base, phase, at: new Date(), ...extra });

  // Idempotencia: si ya se ejecutó (no-dry, no expirado), saltar.
  if (idem && !dryRun && options.idempotencyStore) {
    if (await options.idempotencyStore.wasExecuted(idem, ctx.now)) {
      await audit("skipped", { durationMs: Date.now() - started });
      return { dryRun, skipped: true, affected: null, correlationId: ctx.correlationId };
    }
  }

  // 1. VALIDATE (dominio — independiente del conteo)
  hooks.beforeValidate?.(ctx);
  await definition.validate?.(ctx, input);
  hooks.afterValidate?.(ctx);

  // 2. PREVIEW (opcional)
  const preview = definition.preview ? await definition.preview(ctx, input) : undefined;
  const metrics: AffectedCounts | null =
    preview?.affected ?? options.metadata?.affected ?? null;

  // 3. POLICY / circuit-breaker
  checkPolicy(definition.policy, options.limits, metrics);

  // 4. CONFIRM (según operación + entorno)
  if (confirmationRequired(definition.policy, ctx.env)) {
    const ok = options.confirm ? await options.confirm(ctx, definition, preview) : false;
    if (!ok) throw new ConfirmationRequiredError();
  }

  // Dry-run: auditar el intento y parar (execute NO se llama).
  if (dryRun) {
    await audit("attempt", {
      affected: metrics ?? undefined,
      summary: preview?.summary,
      warnings: preview?.warnings,
      durationMs: Date.now() - started,
    });
    return { dryRun, skipped: false, affected: metrics, preview, correlationId: ctx.correlationId };
  }

  // 5. EXECUTE (transacción + R1: re-validar adentro antes de escribir)
  hooks.beforeExecute?.(ctx);
  let actual: AffectedCounts | null = metrics;
  try {
    const outcome = await options.transaction.run(async (txDb) => {
      const txCtx: MutationContext = Object.freeze({ ...ctx, db: txDb });
      await definition.validate?.(txCtx, input); // R1
      return definition.execute(txCtx, input);
    });
    if (outcome && outcome.affected) actual = outcome.affected;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    await audit("failure", {
      error: { name: e.name, message: e.message },
      durationMs: Date.now() - started,
    });
    hooks.afterAudit?.(ctx);
    throw e; // no se envuelve ni se pierde
  }
  hooks.afterExecute?.(ctx);

  // Contrato preview-vs-execute (v1): el mismatch se AUDITA como warning, NO aborta
  // (el preview es orientativo). Test explícito pin-ea este comportamiento.
  const warnings: string[] = [...(preview?.warnings ?? [])];
  if (metrics && actual && !sameCounts(metrics, actual))
    warnings.push(`preview estimó ${fmt(metrics)} pero execute hizo ${fmt(actual)}`);

  // 6. AUDIT success
  await audit("success", {
    affected: actual ?? undefined,
    summary: preview?.summary,
    warnings: warnings.length ? warnings : undefined,
    durationMs: Date.now() - started,
  });
  hooks.afterAudit?.(ctx);
  return { dryRun, skipped: false, affected: actual, preview, correlationId: ctx.correlationId };
}
