"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

interface Badges {
  friends: number;
  reports: number;
  stores: number;
  indie: number;
  unread: number;
}

interface NavLink {
  href: string;
  label: string;
  badge?: number;
}

export default function NavBar({
  loggedIn,
  admin,
  userName,
  userImage,
  badges,
  signIn,
  signOut,
}: {
  loggedIn: boolean;
  admin: boolean;
  userName?: string | null;
  userImage?: string | null;
  badges: Badges;
  signIn: ReactNode;
  signOut: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const links: NavLink[] = [
    { href: "/", label: "Buscar" },
    { href: "/tiendas", label: "Tiendas" },
    { href: "/independientes", label: "Indie" },
    ...(loggedIn
      ? [
          { href: "/collection", label: "Mi colección" },
          { href: "/amigos", label: "Amigos", badge: badges.friends },
          { href: "/deseados", label: "Deseados" },
          { href: "/compras", label: "Compras" },
        ]
      : []),
    ...(admin
      ? [
          { href: "/admin/reportes", label: "Reportes", badge: badges.reports },
          { href: "/admin/tiendas", label: "Tiendas admin", badge: badges.stores },
          { href: "/admin/independientes", label: "Indie admin", badge: badges.indie },
        ]
      : []),
  ];

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-5 px-5 py-4">
        <Link href="/" onClick={close} className="shrink-0 font-bold">
          📚 Nakama
        </Link>

        {/* Links — desktop */}
        <div className="hidden items-center gap-5 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
            >
              {l.label}
              {l.badge ? <Badge>{l.badge}</Badge> : null}
            </Link>
          ))}
        </div>

        {/* Cluster derecho */}
        <div className="ml-auto flex items-center gap-3">
          {loggedIn && (
            <Link
              href="/notificaciones"
              onClick={close}
              className="relative text-lg"
              aria-label="Notificaciones"
            >
              🔔
              {badges.unread > 0 && (
                <span className="absolute -right-2 -top-1 rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                  {badges.unread}
                </span>
              )}
            </Link>
          )}

          {loggedIn ? (
            <>
              {userImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userImage}
                  alt={userName ?? ""}
                  className="h-7 w-7 rounded-full"
                />
              )}
              <span className="hidden text-sm text-muted md:inline">{userName}</span>
              <span className="hidden md:block">{signOut}</span>
            </>
          ) : (
            signIn
          )}

          {/* Hamburguesa — solo mobile */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Menú"
            aria-expanded={open}
            className="-mr-1 rounded-lg p-1 text-2xl leading-none text-muted transition hover:text-foreground md:hidden"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Menú desplegable — mobile */}
      {open && (
        <div className="border-t border-border bg-surface px-5 md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={close}
              className="flex items-center gap-2 border-b border-border/50 py-3 text-sm text-muted transition hover:text-foreground"
            >
              {l.label}
              {l.badge ? <Badge>{l.badge}</Badge> : null}
            </Link>
          ))}
          {loggedIn && <div className="py-3">{signOut}</div>}
        </div>
      )}
    </nav>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
      {children}
    </span>
  );
}
