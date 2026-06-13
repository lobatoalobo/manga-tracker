import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getNotifPrefs } from "@/lib/notificationPrefs";
import NotifPrefsToggles from "@/components/NotifPrefsToggles";
import PushToggle from "@/components/PushToggle";

export const metadata = { title: "Ajustes · Nakama" };

export default async function AjustesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const prefs = await getNotifPrefs(session.user.id);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Ajustes</h1>
      <p className="mb-6 text-sm text-muted">
        Elegí qué notificaciones querés recibir.
      </p>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Notificaciones
      </h2>
      <NotifPrefsToggles initial={prefs} />

      <div className="mt-4">
        <PushToggle />
      </div>
    </main>
  );
}
