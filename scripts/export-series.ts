/**
 * Exporta un CSV con todas las series: ID, Nombre, Autor, ¿Tiene sinopsis?
 * Read-only. Escribe series-export.csv en la raíz del repo.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/export-series.ts
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../lib/prisma";

const csvCell = (v: string) =>
  /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

async function main() {
  const works = await prisma.work.findMany({
    select: {
      id: true, title: true, author: true,
      synopsis: true, synopsisEs: true, synopsisEn: true,
    },
    orderBy: { title: "asc" },
  });

  const rows = works.map((w) => {
    const hasSyn = [w.synopsisEs, w.synopsisEn, w.synopsis].some((s) => s && s.trim());
    return [String(w.id), w.title ?? "", w.author ?? "", hasSyn ? "Sí" : "No"]
      .map(csvCell)
      .join(",");
  });

  const csv = ["ID,Nombre,Autor,Tiene sinopsis", ...rows].join("\n");
  writeFileSync("series-export.csv", "﻿" + csv, "utf8"); // BOM para tildes en Excel

  const withSyn = works.filter((w) => [w.synopsisEs, w.synopsisEn, w.synopsis].some((s) => s && s.trim())).length;
  const withAuthor = works.filter((w) => w.author?.trim()).length;
  console.log(`series-export.csv · ${works.length} series · con sinopsis ${withSyn} · con autor ${withAuthor}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
