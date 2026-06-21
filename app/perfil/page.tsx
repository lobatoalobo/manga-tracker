import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { countPendingRequests } from "@/lib/social";
import { countUnread } from "@/lib/notifications";
import { SignOut } from "@/components/AuthButtons";

export const metadata = { title: "Perfil · Nakama" };

interface Row {
  href: string;
  label: string;
  badge?: number;
}

export default async function PerfilPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const admin = isAdmin(session.user.email);

  const [friends, unread] = await Promise.all([
    countPendingRequests(session.user.id).catch(() => 0),
    countUnread(session.user.id).catch(() => 0),
  ]);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Mi colección",
      rows: [
        { href: "/collection", label: "Mi colección" },
        { href: "/faltantes", label: "Para comprar" },
        { href: "/deseados", label: "Deseados" },
        { href: "/compras", label: "Compras" },
      ],
    },
    {
      title: "Social",
      rows: [
        { href: "/amigos", label: "Amigos", badge: friends },
        { href: "/notificaciones", label: "Notificaciones", badge: unread },
      ],
    },
    {
      title: "Explorar",
      rows: [
        { href: "/catalogo", label: "Buscar" },
        { href: "/tiendas", label: "Tiendas" },
        { href: "/independientes", label: "Autores independientes" },
      ],
    },
    { title: "Cuenta", rows: [{ href: "/ajustes", label: "Ajustes" }] },
  ];

  if (admin)
    groups.push({
      title: "Admin",
      rows: [
        { href: "/admin/duplicados", label: "Series duplicadas" },
        { href: "/admin/reportes", label: "Reportes" },
        { href: "/admin/tiendas", label: "Tiendas" },
        { href: "/admin/independientes", label: "Indie" },
        { href: "/admin/logins", label: "Logins" },
        { href: "/admin/herramientas", label: "Herramientas" },
      ],
    });

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center gap-3">
        {session.user.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt=""
            className="h-12 w-12 rounded-full"
          />
        )}
        <div>
          <p className="font-semibold">{session.user.name}</p>
          <p className="text-xs text-muted">{session.user.email}</p>
        </div>
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {g.title}
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {g.rows.map((r) => (
                <li key={r.href}>
                  <Link
                    href={r.href}
                    className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-surface-2"
                  >
                    <span>{r.label}</span>
                    <span className="flex items-center gap-2">
                      {r.badge ? (
                        <span className="rounded-full bg-accent px-2 text-xs font-semibold text-white">
                          {r.badge}
                        </span>
                      ) : null}
                      <span className="text-muted">›</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-6">
        <SignOut />
      </div>
    </main>
  );
}
