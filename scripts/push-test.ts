/**
 * Manda un push de PRUEBA a las suscripciones de un usuario, para verificar que
 * la entrega web-push funciona con la app/navegador cerrado.
 *
 *   npx tsx scripts/push-test.ts [email]   # default lobatox4@gmail.com
 *
 * Si te llega con el navegador cerrado → el push anda y solo te falta suscribir
 * el dispositivo donde lo querés (en iOS, instalar la PWA primero).
 */
import { prisma } from "../lib/prisma";
import { sendPushToUser } from "../lib/push";

const email = process.argv[2] || "lobatox4@gmail.com";

async function main() {
  const u = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true },
  });
  if (!u) {
    console.log(`No encontré usuario ${email}.`);
    await prisma.$disconnect();
    return;
  }
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: u.id },
    select: { endpoint: true },
  });
  console.log(`${u.email}: ${subs.length} suscripción(es):`);
  for (const s of subs) console.log(`  - ${new URL(s.endpoint).host}`);

  await sendPushToUser(u.id, {
    title: "🔔 Prueba Nakama",
    body: "Si ves esto con la app cerrada, el push funciona.",
    url: "/",
  });
  console.log(
    "\nPush enviado. Revisá tus dispositivos (con el navegador/app CERRADO).",
  );
  await prisma.$disconnect();
}

main();
