import { normalizeGenres } from "@/lib/catalog/mutations/normalizeGenres";
import { prismaGenreEnrichIO } from "@/lib/infra/work/genres";
import { PrismaAuditSink } from "@/lib/infra/mutations";
import { CompositeAuditSink, ConsoleAuditSink, runMutation } from "@/lib/mutations";

/**
 * Normaliza géneros a la taxonomía canónica vía el Mutation Framework (familia
 * enrich). Dry-run por default; `--execute` aplica. Respeta campos curados.
 *
 *   npx tsx scripts/normalize-genres.ts            # preview
 *   npx tsx scripts/normalize-genres.ts --execute  # aplica
 */
async function main() {
  const execute = process.argv.includes("--execute");
  const r = await runMutation(
    normalizeGenres,
    {},
    {
      ...prismaGenreEnrichIO(),
      actor: { type: "script", id: "normalize-genres" },
      dryRun: !execute,
      audit: new CompositeAuditSink([new ConsoleAuditSink(), new PrismaAuditSink()]),
      confirm: async () => true,
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
