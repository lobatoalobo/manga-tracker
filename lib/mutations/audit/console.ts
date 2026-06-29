import type { AuditSink } from "./sink";
import type { AuditEntry } from "./types";

/** Sink por default de v1: imprime la entrada. Detalle de implementación. */
export class ConsoleAuditSink implements AuditSink {
  async record(e: AuditEntry): Promise<void> {
    const a = e.affected;
    const counts = a ? `+${a.creates}/~${a.updates}/-${a.deletes}` : "—";
    const tag = e.dryRun ? "DRY" : e.env.toUpperCase();
    const head = `[mutation:${e.phase}] ${e.name}@v${e.definitionVersion} ${tag} ${counts} (${e.correlationId})`;
    if (e.phase === "failure") console.error(head, e.error);
    else console.log(head);
  }
}
