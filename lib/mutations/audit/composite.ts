import type { AuditEntry } from "./types";
import type { AuditSink } from "./sink";

/** Reparte cada entrada a varios sinks (ej. consola + DB). Genérico, sin dominio. */
export class CompositeAuditSink implements AuditSink {
  constructor(private readonly sinks: readonly AuditSink[]) {}
  async record(entry: AuditEntry): Promise<void> {
    for (const s of this.sinks) await s.record(entry);
  }
}
