"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Rutas que "viven" dentro de Perfil (para resaltar esa pestaña).
const PROFILE_ROUTES = [
  "/perfil",
  "/compras",
  "/amigos",
  "/ajustes",
  "/tiendas",
  "/independientes",
  "/notificaciones",
  "/admin",
];

interface Tab {
  href: string;
  label: string;
  icon: string;
  active: (p: string) => boolean;
  badge?: number;
}

export default function BottomNav({
  faltantes = 0,
  perfil = 0,
}: {
  faltantes?: number;
  perfil?: number;
}) {
  const path = usePathname();

  const tabs: Tab[] = [
    { href: "/", label: "Inicio", icon: "🏠", active: (p) => p === "/" },
    {
      href: "/collection",
      label: "Colección",
      icon: "📚",
      active: (p) => p.startsWith("/collection"),
    },
    {
      href: "/faltantes",
      label: "Comprar",
      icon: "🛒",
      active: (p) => p.startsWith("/faltantes"),
      badge: faltantes,
    },
    {
      href: "/deseados",
      label: "Deseados",
      icon: "❤️",
      active: (p) => p.startsWith("/deseados"),
    },
    {
      href: "/perfil",
      label: "Perfil",
      icon: "👤",
      active: (p) => PROFILE_ROUTES.some((r) => p.startsWith(r)),
      badge: perfil,
    },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md">
        {tabs.map((t) => {
          const on = t.active(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${
                on ? "text-accent" : "text-muted"
              }`}
            >
              <span className="text-lg leading-none">{t.icon}</span>
              <span>{t.label}</span>
              {t.badge ? (
                <span className="absolute right-1/2 top-1 translate-x-3 rounded-full bg-accent px-1 text-[9px] font-semibold leading-tight text-white">
                  {t.badge > 99 ? "99+" : t.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
