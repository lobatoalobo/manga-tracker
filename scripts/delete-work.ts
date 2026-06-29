import { deleteWork } from "@/lib/catalog/mutations/deleteWork";
import { prismaDeleteWorkIO } from "@/lib/infra/work/delete";
import { PrismaAuditSink, PrismaIdempotencyStore } from "@/lib/infra/mutations";
import { CompositeAuditSink, ConsoleAuditSink, runMutation } from "@/lib/mutations";

/**
 * Borra un Work vía el Mutation Framework. Dry-run por default (muestra impacto +
 * warnings); `--execute` aplica de verdad. Irreversible.
 *
 *   npx tsx scripts/delete-work.ts <workId>            # preview
 *   npx tsx scripts/delete-work.ts <workId> --execute  # borra
 */
async function main() {
  const args = process.argv.slice(2);
  const [workId] = args.filter((a) => !a.startsWith("--")).map(Number);
  const execute = args.includes("--execute");
  if (!workId) {
    console.error("uso: delete-work <workId> [--execute]");
    process.exit(1);
  }

  const r = await runMutation(
    deleteWork,
    { workId },
    {
      ...prismaDeleteWorkIO(),
      actor: { type: "script", id: "delete-work" },
      dryRun: !execute,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
      idempotencyStore: new PrismaIdempotencyStore(),
      confirm: async () => true, // CLI: la confirmación la da el flag --execute
    },
  );

  console.log("\n" + (r.preview?.summary.human ?? ""));
  for (const w of r.preview?.warnings ?? []) console.log("⚠ " + w);
  console.log(r.dryRun ? "\nDRY-RUN — usá --execute para borrar." : "\nBORRADO.", r.affected);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
