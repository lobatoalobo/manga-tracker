import type { AuditEntry } from "./types";

/**
 * Destino de auditoría. El framework depende de esta INTERFAZ, no de una
 * implementación. v1: ConsoleAuditSink. A futuro: MutationLogSink (Postgres),
 * SentrySink, CompositeSink — sin tocar el pipeline.
 */
export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}
