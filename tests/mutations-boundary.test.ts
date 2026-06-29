import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Fitness-function de arquitectura: el core del Mutation Framework
 * (`lib/mutations/`) NO debe conocer Prisma. La infra (PrismaAuditSink, puertos,
 * etc.) vive en `lib/infra/`. Si alguien mete un import de Prisma en el core, este
 * test lo frena — el boundary deja de depender de la disciplina.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("boundary: lib/mutations es Prisma-free", () => {
  it("ningún archivo del core importa Prisma", () => {
    const root = join(process.cwd(), "lib", "mutations");
    const offenders = walk(root)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /@prisma\/client|@\/lib\/prisma/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), "").replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });
});
