import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { countPendingReports } from "@/lib/reports";
import { countPendingStores } from "@/lib/stores";
import { countPendingIndieWorks } from "@/lib/indie";
import { countPendingRequests } from "@/lib/social";
import { countUnread } from "@/lib/notifications";
import { SignIn, SignOut } from "@/components/AuthButtons";
import NavBar from "@/components/NavBar";
import InstallPWA from "@/components/InstallPWA";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
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
        <NavBar
          loggedIn={!!session?.user}
          admin={admin}
          userName={session?.user?.name}
          userImage={session?.user?.image}
          badges={{
            friends: pendingFriends,
            reports: pendingReports,
            stores: pendingStores,
            indie: pendingIndie,
            unread: unreadNotifs,
          }}
          signIn={
            <SignIn className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90" />
          }
          signOut={<SignOut />}
        />

        <InstallPWA />

        {children}

        <ServiceWorkerRegister />

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
