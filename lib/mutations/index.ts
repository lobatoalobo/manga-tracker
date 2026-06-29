/** Mutation Framework (Fase 0). Ver docs/mutation-framework.md + ADR-002. */
export * from "./types";
export * from "./errors";
export { defineMutation } from "./define";
export { runMutation } from "./run";
export { checkPolicy, confirmationRequired } from "./policy";
export { resolveEnv, newCorrelationId } from "./context";
export { ConsoleAuditSink } from "./audit/console";
export { CompositeAuditSink } from "./audit/composite";
export type { AuditSink } from "./audit/sink";
export {
  type AuditEntry,
  type AuditPhase,
  AUDIT_SCHEMA_VERSION,
  FRAMEWORK_VERSION,
} from "./audit/types";
