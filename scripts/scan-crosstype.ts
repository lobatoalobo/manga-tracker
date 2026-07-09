/**
 * Diagnóstico (READ-ONLY) de Works que fusionaron un MANGA con un CÓMIC (la
 * corrupción que el guard de `findOrCreateWork` -> `sameContentClass` ahora evita
 * para nuevos imports). Estos ya quedaron mezclados ANTES del guard y hay que
 * partirlos a mano (B.2). Este script NO escribe nada: sólo reporta candidatos
 * con su evidencia y una confianza, para revisar caso por caso.
 *
 * Señales (una fila es candidata si dispara R1, R2 o R3):
 *   - R1 (ALTA): id manga (muId/mdId — el enrich NUNCA enriquece cómics) + señal
 *     cómic (type=COMIC, o una edición cuyo título `looksLikeComic`).
 *   - R2 (ALTA): edición de VIZ Media (manga puro) + señal cómic.
 *   - R3 (MEDIA): las ediciones del Work no coinciden en "comic-ness" (una parece
 *     cómic y otra no) — el clasificador es conservador, así que puede haber falsos
 *     positivos: revisar.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/scan-crosstype.ts
 *   # inspeccionar works puntuales (validación), aunque no disparen señal:
 *   node scripts/with-prod.mjs npx tsx scripts/scan-crosstype.ts --dump 1716,1719,743
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { looksLikeComic } from "../lib/contentType";

const short = (p: string) => p.replace(" Argentina", "");

type Row = {
  id: number;
  title: string;
  author: string | null;
  type: string;
  muId: string | null;
  mdId: string | null;
  anilistId: number | null;
  credits: unknown;
  editions: { publisher: string; title: string; language: string }[];
};

// `kind`:
//   MERGE     = corrupción real: ≥2 ediciones + señal manga y señal cómic a la vez
//               → hay que PARTIR el Work (B.2).
//   RECLASIF  = 1 sola edición pero con señal contradictoria (cómic occidental
//               tipeado MANGA con id manga espurio, o similar): NO se parte (no hay
//               dos series), se reclasifica/limpia el id. Fuera del alcance del split.
type Kind = "MERGE" | "RECLASIF" | null;

function analyze(w: Row) {
  const eds = w.editions.map((e) => ({ ...e, comic: looksLikeComic(e.title, w.author) }));
  const anyEdComic = eds.some((e) => e.comic);
  const hasMangaId = !!w.muId || !!w.mdId;
  const hasViz = w.editions.some((e) => e.publisher === "VIZ Media");
  const typeComic = w.type === "COMIC";
  const titleComic = looksLikeComic(w.title, w.author);
  const comicSignal = typeComic || anyEdComic || titleComic;
  const mangaSignal = hasMangaId || hasViz;

  const reasons: string[] = [];
  if (hasMangaId && comicSignal) reasons.push(`id-manga(${w.muId ? "mu" : ""}${w.mdId ? "md" : ""})+cómic`);
  if (hasViz && comicSignal) reasons.push("edición-VIZ(manga)+cómic");

  let kind: Kind = null;
  if (mangaSignal && comicSignal) kind = w.editions.length >= 2 ? "MERGE" : "RECLASIF";
  return { eds, reasons, kind };
}

function printWork(w: Row, a: ReturnType<typeof analyze>) {
  const nCredits = Array.isArray(w.credits) ? w.credits.length : 0;
  console.log(
    `\n#${w.id} "${w.title}" type=${w.type} autor=${w.author ?? "—"} ` +
      `mu=${w.muId ?? "—"} md=${w.mdId ? "y" : "—"} AL=${w.anilistId ?? "—"} créditos=${nCredits}`,
  );
  if (a.kind) console.log(`   ▸ ${a.kind}: ${a.reasons.join(" | ")}`);
  for (const e of a.eds)
    console.log(`   · [${short(e.publisher)}] ${e.comic ? "CÓMIC" : "manga"} · "${e.title}" (${e.language})`);
}

async function main() {
  const dumpArg = process.argv.includes("--dump")
    ? process.argv[process.argv.indexOf("--dump") + 1]
    : null;
  const dumpIds = new Set(
    (dumpArg ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
  );

  const works = (await dbRetry(() =>
    prisma.work.findMany({
      select: {
        id: true, title: true, author: true, type: true,
        muId: true, mdId: true, anilistId: true, credits: true,
        editions: { select: { publisher: true, title: true, language: true } },
      },
    }),
  )) as Row[];

  if (dumpIds.size) {
    console.log(`=== DUMP de works ${[...dumpIds].join(",")} (validación, sin filtrar) ===`);
    for (const w of works.filter((x) => dumpIds.has(x.id))) printWork(w, analyze(w));
    console.log();
  }

  const analyzed = works.map((w) => ({ w, a: analyze(w) }));
  const merges = analyzed.filter((c) => c.a.kind === "MERGE");
  const reclasif = analyzed.filter((c) => c.a.kind === "RECLASIF");

  console.log(`\n########## MERGE — a PARTIR (B.2): ${merges.length} ##########`);
  for (const c of merges) printWork(c.w, c.a);

  console.log(`\n########## RECLASIF — 1 edición, NO se parte (limpieza aparte): ${reclasif.length} ##########`);
  for (const c of reclasif) printWork(c.w, c.a);

  console.log(
    `\n=== ${merges.length} MERGE (split) · ${reclasif.length} RECLASIF (id/tipo) sobre ${works.length} works ===`,
  );
  console.log("READ-ONLY: nada modificado. Sólo los MERGE son candidatos a split (B.2).");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
