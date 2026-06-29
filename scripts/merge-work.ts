import { mergeWork } from "@/lib/catalog/mutations/mergeWork";
import {
  PrismaAuditSink,
  PrismaIdempotencyStore,
  prismaMutationIO,
} from "@/lib/mutations/adapters/prisma";
import { CompositeAuditSink, ConsoleAuditSink, runMutation } from "@/lib/mutations";

/**
 * Fusiona dos Works vía el Mutation Framework. Dry-run por default (muestra el
 * preview); `--execute` aplica de verdad.
 *
 *   npx tsx scripts/merge-work.ts <sourceId> <targetId>            # preview
 *   npx tsx scripts/merge-work.ts <sourceId> <targetId> --execute  # aplica
 */
async function main() {
  const args = process.argv.slice(2);
  const [sourceId, targetId] = args.filter((a) => !a.startsWith("--")).map(Number);
  const execute = args.includes("--execute");
  if (!sourceId || !targetId) {
    console.error("uso: merge-work <sourceId> <targetId> [--execute]");
    process.exit(1);
  }

  const r = await runMutation(
    mergeWork,
    { sourceId, targetId },
    {
      ...prismaMutationIO(),
      actor: { type: "script", id: "merge-work" },
      dryRun: !execute,
      // Ve el evento en consola Y lo persiste en MutationLog.
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
      idempotencyStore: new PrismaIdempotencyStore(), // no re-mergear el mismo par
      confirm: async () => true, // CLI: la confirmación la da el flag --execute
    },
  );

  console.log("\n" + (r.preview?.summary.human ?? ""));
  console.log(r.dryRun ? "\nDRY-RUN — usá --execute para aplicar." : "\nAPLICADO.", r.affected);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
