/**
 * Diff (READ-ONLY) entre las ediciones de Ivrea en Whakoom y las nuestras, para
 * ver qué series tiene Whakoom que NOS FALTAN (sin importar nada). Whakoom bloquea
 * datacenter → correr LOCAL, throttleado (no abusar, ver memoria ivrea-ip-ban).
 * Match por SUBCONJUNTO de tokens: el slug de Whakoom es "romaji_es" combinado;
 * si los tokens de alguno de NUESTROS títulos ⊆ el slug, ya la tenemos.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/whakoom-ivrea-diff.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { enumeratePublisherEditions } from "../lib/whakoomImport";
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { normalizeTitle } from "../lib/catalog";

const ALL_URL = "https://www.whakoom.com/publisher/27123/ivrea_argentina/all";
// Cache de la enumeración (URLs de Whakoom) para no re-pegarle a Whakoom al
// iterar el matching. Borrar el archivo (o pasar --refresh) para re-enumerar.
const CACHE = join(process.cwd(), "scripts", ".whakoom-ivrea-urls.json");

const tok = (s: string) =>
  normalizeTitle(s)
    .split(" ")
    .filter((w) => w.length >= 2);

function slugTokens(url: string): Set<string> {
  const m = url.match(/\/ediciones\/\d+\/([^/?]+)/);
  return new Set(m ? tok(m[1].replace(/_/g, " ")) : []);
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  let urls: string[];
  if (!refresh && existsSync(CACHE)) {
    urls = JSON.parse(readFileSync(CACHE, "utf8"));
    console.log(`Usando cache (${urls.length} URLs). --refresh para re-enumerar.\n`);
  } else {
    console.log("Enumerando Ivrea en Whakoom (throttleado)…");
    urls = await enumeratePublisherEditions(ALL_URL, {
      throttleMs: 700,
      onPage: (p, t) => console.log(`  página ${p}: ${t} ediciones`),
    });
    writeFileSync(CACHE, JSON.stringify(urls, null, 0));
    console.log(`\nWhakoom Ivrea: ${urls.length} ediciones listadas.\n`);
  }

  // Nuestros títulos Ivrea (normTitle + romaji) como sets de tokens.
  const eds = await dbRetry(() =>
    prisma.publisherEdition.findMany({
      where: { publisher: "Ivrea Argentina" },
      select: { normTitle: true, work: { select: { originalTitle: true } } },
    }),
  );
  const ourSets: Set<string>[] = [];
  for (const e of eds) {
    const a = new Set(tok(e.normTitle));
    if (a.size) ourSets.push(a);
    if (e.work?.originalTitle) {
      const b = new Set(tok(e.work.originalTitle));
      if (b.size) ourSets.push(b);
    }
  }

  // "La tenemos" si los tokens de algún título nuestro están TODOS en el slug de
  // Whakoom (que trae "romaji_es_formato"). Incluye títulos de 1 token (Another,
  // Bleach, Citrus…). Whakoom le agrega el formato (-rustica, -grapa, etc.) que
  // son tokens EXTRA → no afectan el subset.
  const haveSets = ourSets;
  const have = (slug: Set<string>) =>
    haveSets.some((ts) => [...ts].every((x) => slug.has(x)));

  const missing: string[] = [];
  for (const u of urls) {
    const slug = slugTokens(u);
    if (slug.size === 0) continue;
    if (!have(slug)) missing.push(u);
  }

  console.log(`Nuestras ediciones Ivrea: ${eds.length}`);
  console.log(`FALTAN (en Whakoom, no en nuestra base, aprox): ${missing.length}\n`);
  console.log("Muestra de las que faltarían:");
  for (const u of missing.slice(0, 40)) {
    const m = u.match(/\/ediciones\/\d+\/([^/?]+)/);
    console.log(`  - ${m ? m[1].replace(/_/g, " ") : u}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
