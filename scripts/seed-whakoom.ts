/**
 * Seed bulk del catálogo desde Whakoom (Fase 4). Enumera las páginas `/all` de
 * cada editorial y las importa al catálogo local (PublisherEdition + Work +
 * Volume + portada). NO mapea a AniList (eso se hace después como enriquecimiento)
 * para ser rápido y no depender de su API.
 *
 *   npx tsx scripts/seed-whakoom.ts [ivrea|panini|ovni] [--reset] [--limit N]
 *
 * - Sin editorial: corre las tres.
 * - Resumable: guarda un cursor por editorial en AppState; re-correr retoma donde
 *   quedó. `--reset` arranca de cero esa editorial. `--limit N` corta a N por corrida.
 *
 * Corre desde tu máquina (Whakoom bloquea a Vercel) contra DATABASE_URL (.env).
 */
import { prisma } from "../lib/prisma";
import {
  enumeratePublisherEditions,
  importWhakoomUrls,
} from "../lib/whakoomImport";
import { logJobRun, groupSkipReasons } from "../lib/jobs";

// IDs de publisher en Whakoom (de /publisher/<id>/<slug>). Panini AR: completar
// cuando lo tengamos (el directorio de Whakoom lo renderiza por JS).
const PUBLISHERS: Record<string, { label: string; allUrl: string | null }> = {
  ivrea: {
    label: "Ivrea Argentina",
    allUrl: "https://www.whakoom.com/publisher/27123/ivrea_argentina/all",
  },
  ovni: {
    label: "Ovni Press",
    allUrl: "https://www.whakoom.com/publisher/15389/ovni_press/all",
  },
  panini: {
    label: "Panini Argentina",
    allUrl:
      "https://www.whakoom.com/publisher/20930/panini_comics_argentina/all",
  },
  kemuri: {
    label: "Kemuri Ediciones",
    allUrl: "https://www.whakoom.com/publisher/37785/kemuri_ediciones/all",
  },
  utopia: {
    label: "Utopía Editorial",
    allUrl: "https://www.whakoom.com/publisher/19718/utopia_editorial/all",
  },
  larp: {
    label: "Larp Editores",
    allUrl: "https://www.whakoom.com/publisher/15398/larp_editores/all",
  },
  distrito: {
    label: "Distrito Manga",
    allUrl: "https://www.whakoom.com/publisher/38673/distrito_manga/all",
  },
  planeta: {
    label: "Planeta Cómic",
    allUrl: "https://www.whakoom.com/publisher/102/planeta_comic/all",
  },
};

const cursorKey = (slug: string) => `seed:whakoom:${slug}`;

async function getCursor(slug: string): Promise<number> {
  const row = await prisma.appState.findUnique({ where: { key: cursorKey(slug) } });
  return row ? Number(row.value) || 0 : 0;
}
async function setCursor(slug: string, n: number) {
  await prisma.appState.upsert({
    where: { key: cursorKey(slug) },
    update: { value: String(n) },
    create: { key: cursorKey(slug), value: String(n) },
  });
}

async function seedPublisher(slug: string, limit: number | null, reset: boolean) {
  const cfg = PUBLISHERS[slug];
  if (!cfg) {
    console.log(`✗ editorial desconocida: ${slug}`);
    return;
  }
  if (!cfg.allUrl) {
    console.log(`⏭ ${cfg.label}: sin allUrl configurada, salteo.`);
    return;
  }

  const startedAt = new Date();
  if (reset) await setCursor(slug, 0);

  console.log(`\n== ${cfg.label} ==`);
  console.log("Enumerando ediciones…");
  const all = await enumeratePublisherEditions(cfg.allUrl, {
    throttleMs: 600,
    onPage: (p, total) => {
      if (p % 5 === 0) console.log(`  página ${p}, ${total} ediciones`);
    },
  });
  console.log(`Total en Whakoom: ${all.length}`);

  const start = await getCursor(slug);
  let todo = all.slice(start);
  if (limit) todo = todo.slice(0, limit);
  if (todo.length === 0) {
    console.log(`Nada nuevo (cursor en ${start}/${all.length}).`);
    return;
  }
  console.log(`Importando ${todo.length} (desde ${start})…`);

  const res = await importWhakoomUrls(todo, {
    throttleMs: 600,
    resolveAnilist: false, // mapeo a AniList = enriquecimiento posterior
    onProgress: ({ done }) => {
      if (done % 20 === 0) {
        console.log(`  ${done}/${todo.length}`);
        void setCursor(slug, start + done);
      }
    },
  });
  await setCursor(slug, start + res.processed);

  console.log(
    `${cfg.label}: ${res.imported} importadas, ${res.skipped.length} salteadas.`,
  );
  await logJobRun({
    kind: "whakoom-seed",
    label: cfg.label,
    processed: res.processed,
    imported: res.imported,
    mapped: res.mapped,
    skipped: res.skipped.length,
    summary: groupSkipReasons(res.skipped),
    startedAt,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) || null : null;
  const targets = args.filter((a) => PUBLISHERS[a]);
  const slugs = targets.length ? targets : Object.keys(PUBLISHERS);

  for (const slug of slugs) await seedPublisher(slug, limit, reset);

  await prisma.$disconnect();
}

main();
