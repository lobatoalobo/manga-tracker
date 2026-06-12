"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

interface Badges {
  friends: number;
  reports: number;
  stores: number;
  indie: number;
  unread: number;
}

interface MenuLink {
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
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const primary: MenuLink[] = [
    { href: "/", label: "Búsqueda" },
    { href: "/tiendas", label: "Tiendas" },
    { href: "/independientes", label: "Indie" },
  ];

  const profile: MenuLink[] = [
    { href: "/collection", label: "Mi colección" },
    { href: "/amigos", label: "Amigos", badge: badges.friends },
    { href: "/deseados", label: "Deseados" },
    { href: "/compras", label: "Compras" },
  ];

  const adminLinks: MenuLink[] = [
    { href: "/admin/mapeos", label: "Mapeos editoriales" },
    { href: "/admin/reportes", label: "Reportes", badge: badges.reports },
    { href: "/admin/tiendas", label: "Tiendas", badge: badges.stores },
    { href: "/admin/independientes", label: "Indie", badge: badges.indie },
    { href: "/admin/logins", label: "Logins" },
  ];

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5">
        <Link href="/" onClick={close} className="shrink-0 font-bold">
          📚 <span className="hidden sm:inline">Nakama</span>
        </Link>

        {primary.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-sm text-muted transition hover:text-foreground"
          >
            {l.label}
          </Link>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {loggedIn ? (
            <>
              <Link
                href="/notificaciones"
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

              <div className="relative" ref={ref}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  aria-expanded={open}
                  className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm transition hover:bg-surface-2"
                >
                  {userImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userImage}
                      alt={userName ?? ""}
                      className="h-7 w-7 rounded-full"
                    />
                  )}
                  <span className="hidden text-muted sm:inline">{userName}</span>
                  <span className="text-xs text-muted">▾</span>
                </button>

                {open && (
                  <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
                    {profile.map((l) => (
                      <MenuItem
                        key={l.href}
                        href={l.href}
                        badge={l.badge}
                        onClick={close}
                      >
                        {l.label}
                      </MenuItem>
                    ))}

                    {admin && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">
                          Admin
                        </p>
                        {adminLinks.map((l) => (
                          <MenuItem
                            key={l.href}
                            href={l.href}
                            badge={l.badge}
                            onClick={close}
                          >
                            {l.label}
                          </MenuItem>
                        ))}
                      </>
                    )}

                    <div className="my-1 border-t border-border" />
                    <div className="px-2 py-1">{signOut}</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            signIn
          )}
        </div>
      </div>
    </nav>
  );
}

function MenuItem({
  href,
  badge,
  onClick,
  children,
}: {
  href: string;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-foreground"
    >
      {children}
      {badge ? <Dot>{badge}</Dot> : null}
    </Link>
  );
}

function Dot({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
      {children}
    </span>
  );
}
