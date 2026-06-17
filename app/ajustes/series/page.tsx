import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getSeriesNotifList } from "@/lib/collection";
import SeriesNotifManager from "@/components/SeriesNotifManager";

export const metadata = { title: "Notificaciones por serie · Nakama" };

export default async function SeriesNotifPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const series = await getSeriesNotifList(session.user.id);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/ajustes" className="text-sm text-muted hover:text-foreground">
        ← Ajustes
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">🔔 Notificaciones por serie</h1>
      <p className="mb-5 text-sm text-muted">
        Por default avisamos de tomos nuevos de todas las series que coleccionás.
        Acá silenciás (🔕) o reactivás (🔔) las que quieras, sin entrar a cada una.
      </p>
      {series.length === 0 ? (
        <p className="text-sm text-muted">
          No tenés series (mapeadas) en tu colección todavía.
        </p>
      ) : (
        <SeriesNotifManager series={series} />
      )}
    </main>
  );
}
