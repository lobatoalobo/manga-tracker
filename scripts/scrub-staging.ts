/**
 * Anonimiza datos personales en STAGING tras clonar prod (ver sync-staging.mjs).
 * SOLO corre si DATABASE_URL apunta a la branch de staging (no a prod).
 *   node scripts/with-staging.mjs npx tsx scripts/scrub-staging.ts
 */
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";

function envVal(key: string): string | null {
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const i = line.indexOf("=");
      if (i === -1 || line.trim().startsWith("#")) continue;
      if (line.slice(0, i).trim() === key)
        return line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return null;
}

async function main() {
  const staging = envVal("STAGING_DATABASE_URL");
  const prod = envVal("DATABASE_URL");
  const current = process.env.DATABASE_URL;
  // Guard: solo staging. Nunca prod.
  if (!staging || current !== staging || current === prod) {
    console.error(
      "✗ ABORT: scrub solo corre contra STAGING. Usá: node scripts/with-staging.mjs npx tsx scripts/scrub-staging.ts",
    );
    process.exit(1);
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  let i = 0;
  for (const u of users) {
    i++;
    await prisma.user.update({
      where: { id: u.id },
      data: {
        email: `user${i}@staging.local`,
        name: `Usuario ${i}`,
        image: null,
      },
    });
  }
  // Borrar lo sensible/operacional (no se necesita en staging).
  const [sess, push, logins] = await Promise.all([
    prisma.session.deleteMany({}),
    prisma.pushSubscription.deleteMany({}),
    prisma.loginEvent.deleteMany({}),
  ]);

  console.log(
    `Scrub OK · usuarios anonimizados: ${users.length} · sesiones ${sess.count} · push ${push.count} · logins ${logins.count} borrados`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
