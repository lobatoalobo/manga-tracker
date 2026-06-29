import { PolicyError } from "./errors";
import type { AffectedCounts, Env, Limits, Policy } from "./types";

/** ¿Hay que pedir confirmación explícita para esta operación en este entorno? */
export function confirmationRequired(policy: Policy | undefined, env: Env): boolean {
  const r = policy?.requiresConfirmation ?? "never";
  return r === "always" || (r === "prod" && env === "production");
}

/**
 * Circuit-breaker: aborta ANTES de escribir si las métricas superan los límites
 * de la operación (default por operación + override por llamada). Si no hay
 * métricas (operación sin preview ni metadata), no se puede topar → pasa.
 */
export function checkPolicy(
  policy: Policy | undefined,
  override: Partial<Limits> | undefined,
  affected: AffectedCounts | null,
): void {
  if (!affected) return;
  const lim: Limits = { ...policy, ...override };
  const total = affected.creates + affected.updates + affected.deletes;
  const checks: [number | undefined, number, string][] = [
    [lim.maxAffected, total, "afectadas"],
    [lim.maxCreates, affected.creates, "creates"],
    [lim.maxUpdates, affected.updates, "updates"],
    [lim.maxDeletes, affected.deletes, "deletes"],
  ];
  for (const [max, val, label] of checks) {
    if (max !== undefined && val > max)
      throw new PolicyError(`Circuit-breaker: ${val} ${label} supera el máximo de ${max}.`);
  }
}
