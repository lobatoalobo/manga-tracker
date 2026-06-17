import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getNotifications, markAllRead } from "@/lib/notifications";
import { seriesHref } from "@/lib/url";
import RefreshOnMount from "@/components/RefreshOnMount";
import { DeleteNotifButton, ClearAllNotifsButton } from "@/components/NotifActions";

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
    case "REISSUE":
      return `♻️ Reedición de ${n.actorName}`;
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
      {/* Refresca el layout para limpiar la campanita tras markAllRead. */}
      <RefreshOnMount />
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Notificaciones</h1>
        <div className="flex items-center gap-4">
          {items.length > 0 && <ClearAllNotifsButton />}
          <Link
            href="/ajustes"
            className="text-sm text-muted hover:text-foreground"
          >
            ⚙️ Preferencias
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">No tenés notificaciones.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const href =
              (n.type === "NEW_VOLUME" || n.type === "REISSUE") && n.anilistId
                ? seriesHref(n.anilistId)
                : "/amigos";
            return (
              <li
                key={n.id}
                className={`flex items-start gap-2 rounded-xl border p-4 ${
                  n.read ? "border-border bg-surface" : "border-accent bg-surface"
                }`}
              >
                <Link href={href} className="block min-w-0 flex-1">
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
                <DeleteNotifButton id={n.id} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
