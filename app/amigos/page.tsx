import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getFriends, getPendingRequests, getFriendsFeed } from "@/lib/social";
import { seriesHref } from "@/lib/url";
import AddFriend from "@/components/AddFriend";
import { RequestActions, RemoveFriendButton } from "@/components/FriendActions";
import { ReactionBar, CommentForm } from "@/components/ActivitySocial";

export const metadata = { title: "Amigos · Nakama" };

const ACTION_TEXT: Record<string, string> = {
  ADDED_EDITION: "agregó a su colección",
  MARKED_READ: "marcó como leído",
  COMPLETED: "completó",
};

export default async function AmigosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const me = session.user.id;
  const tab = (await searchParams).tab === "amigos" ? "amigos" : "actividad";

  // Para los badges de los tabs traemos amigos+solicitudes siempre; el feed solo
  // en su tab (puede ser grande).
  const [friends, requests] = await Promise.all([
    getFriends(me),
    getPendingRequests(me),
  ]);
  const feed = tab === "actividad" ? await getFriendsFeed(me) : [];

  const tabs = [
    { t: "actividad", label: "Actividad" },
    { t: "amigos", label: `Amigos${friends.length ? ` (${friends.length})` : ""}`, badge: requests.length },
  ];

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-4 text-2xl font-bold">Amigos</h1>

      <div className="mb-6 flex gap-2 text-sm">
        {tabs.map(({ t, label, badge }) => (
          <Link
            key={t}
            href={`/amigos?tab=${t}`}
            className={`relative rounded-full px-3 py-1 transition ${
              tab === t ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            {label}
            {badge ? (
              <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {badge}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {tab === "amigos" ? (
        <>
          <AddFriend />

          {requests.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Solicitudes ({requests.length})
              </h2>
              <ul className="space-y-2">
                {requests.map((r) => (
                  <li
                    key={r.friendshipId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
                  >
                    <Friend user={r.user} />
                    <RequestActions friendshipId={r.friendshipId} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Mis amigos ({friends.length})
            </h2>
            {friends.length === 0 ? (
              <p className="text-sm text-muted">Todavía no tenés amigos agregados.</p>
            ) : (
              <ul className="space-y-2">
                {friends.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2"
                  >
                    <Friend user={f} />
                    <RemoveFriendButton otherId={f.id} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : feed.length === 0 ? (
        <p className="text-sm text-muted">
          {friends.length === 0
            ? "Agregá amigos (pestaña Amigos) para ver su actividad acá."
            : "Cuando tus amigos agreguen o lean mangas, lo vas a ver acá."}
        </p>
      ) : (
        <ul className="space-y-4">
          {feed.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex gap-3">
                {a.coverImage && (
                  <Link href={a.anilistId ? seriesHref(a.anilistId) : "#"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.coverImage}
                      alt={a.title ?? ""}
                      className="h-20 w-14 shrink-0 rounded-md object-cover"
                    />
                  </Link>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{a.user.name}</span>{" "}
                    {ACTION_TEXT[a.type] ?? "actualizó"}{" "}
                    {a.anilistId ? (
                      <Link
                        href={seriesHref(a.anilistId)}
                        className="font-medium text-accent hover:underline"
                      >
                        {a.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{a.title}</span>
                    )}
                    {a.detail ? <span className="text-muted"> · {a.detail}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {a.createdAt.toLocaleString("es-AR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>

                  <ReactionBar
                    activityId={a.id}
                    reactions={a.reactions}
                    myReaction={a.myReaction}
                  />

                  {a.comments.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                      {a.comments.map((c) => (
                        <li key={c.id} className="text-sm">
                          <span className="font-medium">{c.user.name}:</span>{" "}
                          <span className="text-muted">{c.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <CommentForm activityId={a.id} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Friend({
  user,
}: {
  user: { id: string; name: string | null; image: string | null };
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {user.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt="" className="h-7 w-7 rounded-full" />
      )}
      <span className="truncate text-sm font-medium">{user.name}</span>
    </div>
  );
}
