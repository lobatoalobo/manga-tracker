import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getLoginEvents } from "@/lib/loginLog";
import Pager from "@/components/Pager";

export const metadata = { title: "Logins (admin) · Nakama" };

export default async function AdminLoginsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { events, total, lastPage } = await getLoginEvents(page);

  const fmt = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Inicios de sesión</h1>
      <p className="mb-5 text-sm text-muted">{total} logins registrados.</p>

      {events.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay logins registrados.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
            >
              {e.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.image}
                  alt={e.name ?? ""}
                  className="h-8 w-8 shrink-0 rounded-full"
                />
              ) : (
                <div className="h-8 w-8 shrink-0 rounded-full bg-surface-2" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {e.name ?? "—"}
                </p>
                <p className="truncate text-xs text-muted">{e.email ?? "—"}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">
                {fmt.format(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <Pager basePath="/admin/logins?" page={page} lastPage={lastPage} />
      )}
    </main>
  );
}
