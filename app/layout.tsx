import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { countPendingReports } from "@/lib/reports";
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
  const pendingReports = await countPendingReports().catch(() => 0);

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
            <Link href="/" className="text-sm text-muted transition hover:text-foreground">
              Buscar
            </Link>
            <Link
              href="/collection"
              className="text-sm text-muted transition hover:text-foreground"
            >
              Mi colección
            </Link>
            <Link
              href="/admin/reportes"
              className="ml-auto flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
            >
              Reportes
              {pendingReports > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
                  {pendingReports}
                </span>
              )}
            </Link>
          </div>
        </nav>

        {children}
      </body>
    </html>
  );
}
