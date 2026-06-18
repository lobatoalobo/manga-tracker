import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Link from "next/link";
import { getNotifPrefs } from "@/lib/notificationPrefs";
import NotifPrefsToggles from "@/components/NotifPrefsToggles";
import PushToggle from "@/components/PushToggle";
import DeleteAccount from "@/components/DeleteAccount";

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

      <Link
        href="/ajustes/series"
        className="mt-3 flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm transition hover:border-accent"
      >
        <span>
          <span className="font-medium">🔔 Notificaciones por serie</span>
          <span className="mt-0.5 block text-xs text-muted">
            Silenciá series puntuales de tu colección, todo en un lugar.
          </span>
        </span>
        <span className="shrink-0 text-accent">→</span>
      </Link>

      <div className="mt-4">
        <PushToggle />
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Cuenta
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        <li>
          <Link
            href="/privacidad"
            className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-surface-2"
          >
            <span>Política de privacidad</span>
            <span className="text-muted">›</span>
          </Link>
        </li>
        <li>
          <Link
            href="/terminos"
            className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-surface-2"
          >
            <span>Términos y condiciones</span>
            <span className="text-muted">›</span>
          </Link>
        </li>
      </ul>

      <DeleteAccount />
    </main>
  );
}
