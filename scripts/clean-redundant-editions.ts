import { cleanRedundantEditions } from "@/lib/catalog/mutations/cleanRedundantEditions";
import { prismaCleanEditionsIO } from "@/lib/infra/work/cleanupEditions";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { CompositeAuditSink, ConsoleAuditSink, runMutation } from "@/lib/mutations";

/**
 * Limpia ediciones redundantes vía el Mutation Framework. Dry-run por default
 * (muestra cuántas borraría); `--execute` aplica.
 *
 *   npx tsx scripts/clean-redundant-editions.ts            # preview
 *   npx tsx scripts/clean-redundant-editions.ts --execute  # aplica
 */
async function main() {
  const execute = process.argv.includes("--execute");
  const r = await runMutation(
    cleanRedundantEditions,
    {},
    {
      ...prismaCleanEditionsIO(),
      actor: { type: "script", id: "clean-redundant-editions" },
      dryRun: !execute,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
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
