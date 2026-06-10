import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { countPendingReports } from "@/lib/reports";
import { SignOut } from "@/components/AuthButtons";
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
  title: "Manga Tracker",
  description: "Seguí tu colección de mangas al estilo Whakoom.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const admin = isAdmin(session?.user?.email);
  const pendingReports = admin ? await countPendingReports().catch(() => 0) : 0;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <nav className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-4">
            <Link href="/" className="font-bold">
              📚 Manga Tracker
            </Link>

            {session && (
              <>
                <Link
                  href="/"
                  className="text-sm text-muted transition hover:text-foreground"
                >
                  Buscar
                </Link>
                <Link
                  href="/collection"
                  className="text-sm text-muted transition hover:text-foreground"
                >
                  Mi colección
                </Link>
                {admin && (
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
                )}
              </>
            )}

            {session?.user && (
              <div className="ml-auto flex items-center gap-3">
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
            )}
          </div>
        </nav>

        {children}
      </body>
    </html>
  );
}
