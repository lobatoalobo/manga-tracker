import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { countPendingReports } from "@/lib/reports";
import { countPendingStores } from "@/lib/stores";
import { countPendingIndieWorks } from "@/lib/indie";
import { countPendingRequests } from "@/lib/social";
import { countUnread } from "@/lib/notifications";
import { SignIn, SignOut } from "@/components/AuthButtons";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nakama",
  description: "Seguí y organizá tu colección de manga.",
  applicationName: "Nakama",
  appleWebApp: { capable: true, title: "Nakama", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0d0d12",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const admin = isAdmin(session?.user?.email);
  const [pendingReports, pendingStores, pendingIndie] = admin
    ? await Promise.all([
        countPendingReports().catch(() => 0),
        countPendingStores().catch(() => 0),
        countPendingIndieWorks().catch(() => 0),
      ])
    : [0, 0, 0];
  const [pendingFriends, unreadNotifs] = session?.user?.id
    ? await Promise.all([
        countPendingRequests(session.user.id).catch(() => 0),
        countUnread(session.user.id).catch(() => 0),
      ])
    : [0, 0];

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <nav className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-4">
            <Link href="/" className="font-bold">
              📚 Nakama
            </Link>

            <Link
              href="/"
              className="text-sm text-muted transition hover:text-foreground"
            >
              Buscar
            </Link>
            <Link
              href="/tiendas"
              className="text-sm text-muted transition hover:text-foreground"
            >
              Tiendas
            </Link>
            <Link
              href="/independientes"
              className="text-sm text-muted transition hover:text-foreground"
            >
              Indie
            </Link>

            {session && (
              <>
                <Link
                  href="/collection"
                  className="text-sm text-muted transition hover:text-foreground"
                >
                  Mi colección
                </Link>
                <Link
                  href="/amigos"
                  className="flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
                >
                  Amigos
                  {pendingFriends > 0 && (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
                      {pendingFriends}
                    </span>
                  )}
                </Link>
                <Link
                  href="/deseados"
                  className="text-sm text-muted transition hover:text-foreground"
                >
                  Deseados
                </Link>
                <Link
                  href="/compras"
                  className="text-sm text-muted transition hover:text-foreground"
                >
                  Compras
                </Link>
                {admin && (
                  <>
                    <Link
                      href="/admin/reportes"
                      className="flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
                    >
                      Reportes
                      {pendingReports > 0 && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
                          {pendingReports}
                        </span>
                      )}
                    </Link>
                    <Link
                      href="/admin/tiendas"
                      className="flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
                    >
                      Tiendas admin
                      {pendingStores > 0 && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
                          {pendingStores}
                        </span>
                      )}
                    </Link>
                    <Link
                      href="/admin/independientes"
                      className="flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
                    >
                      Indie admin
                      {pendingIndie > 0 && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
                          {pendingIndie}
                        </span>
                      )}
                    </Link>
                  </>
                )}
              </>
            )}

            {session?.user ? (
              <div className="ml-auto flex items-center gap-3">
                <Link
                  href="/notificaciones"
                  className="relative text-lg"
                  title="Notificaciones"
                >
                  🔔
                  {unreadNotifs > 0 && (
                    <span className="absolute -right-2 -top-1 rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                      {unreadNotifs}
                    </span>
                  )}
                </Link>
                {session.user.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.image}
                    alt={session.user.name ?? ""}
                    className="h-7 w-7 rounded-full"
                  />
                )}
                <span className="hidden text-sm text-muted sm:inline">
                  {session.user.name}
                </span>
                <SignOut />
              </div>
            ) : (
              <div className="ml-auto">
                <SignIn className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90" />
              </div>
            )}
          </div>
        </nav>

        {children}

        <footer className="mt-12 border-t border-border py-8 text-center text-sm text-muted">
          <p>Nakama · datos de AniList, MangaUpdates y editoriales locales.</p>
          {process.env.NEXT_PUBLIC_DONATE_URL && (
            <a
              href={process.env.NEXT_PUBLIC_DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-lg border border-border px-4 py-2 transition hover:border-accent hover:text-foreground"
            >
              ☕ Invitame un cafecito
            </a>
          )}
        </footer>
      </body>
    </html>
  );
}
