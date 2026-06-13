import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getNotifications, markAllRead } from "@/lib/notifications";
import { seriesHref } from "@/lib/url";

export const metadata = { title: "Notificaciones · Nakama" };

function text(n: { type: string; actorName: string; text: string | null }) {
  switch (n.type) {
    case "REACTION":
      return `${n.actorName} reaccionó en tu actividad`;
    case "COMMENT":
      return `${n.actorName} comentó tu actividad`;
    case "FRIEND_REQUEST":
      return `${n.actorName} te envió una solicitud de amistad`;
    case "FRIEND_ACCEPTED":
      return `${n.actorName} aceptó tu solicitud de amistad`;
    case "NEW_VOLUME":
      return `📖 Tomo nuevo de ${n.actorName}`;
    default:
      return n.actorName;
  }
}

export default async function NotificacionesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const items = await getNotifications(session.user.id);
  await markAllRead(session.user.id);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Notificaciones</h1>

      {items.length === 0 ? (
        <p className="text-sm text-muted">No tenés notificaciones.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const href =
              n.type === "NEW_VOLUME" && n.anilistId
                ? seriesHref(n.anilistId)
                : "/amigos";
            return (
              <li
                key={n.id}
                className={`rounded-xl border p-4 ${
                  n.read ? "border-border bg-surface" : "border-accent bg-surface"
                }`}
              >
                <Link href={href} className="block">
                  <p className="text-sm">{text(n)}</p>
                  {n.text && (
                    <p className="mt-1 truncate text-sm text-muted">{n.text}</p>
                  )}
                  <p className="mt-1 text-xs text-muted">
                    {n.createdAt.toLocaleString("es-AR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
