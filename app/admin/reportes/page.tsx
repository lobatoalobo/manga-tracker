import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getReports } from "@/lib/reports";
import ReportActions from "@/components/ReportActions";

export const metadata = {
  title: "Reportes · Manga Tracker",
};

export default async function ReportesPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const reports = await getReports();
  const pending = reports.filter((r) => r.status === "PENDING");
  const resolved = reports.filter((r) => r.status === "RESOLVED");

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Reportes</h1>
      <p className="mb-6 text-sm text-muted">
        Correcciones enviadas por usuarios. Revisalas y actualizá los datos.
      </p>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Pendientes ({pending.length})
      </h2>
      {pending.length === 0 ? (
        <p className="mb-8 text-sm text-muted">No hay reportes pendientes. 🎉</p>
      ) : (
        <ul className="mb-8 space-y-3">
          {pending.map((r) => (
            <ReportItem key={r.id} report={r} />
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Resueltos ({resolved.length})
          </h2>
          <ul className="space-y-3 opacity-60">
            {resolved.map((r) => (
              <ReportItem key={r.id} report={r} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function ReportItem({
  report,
}: {
  report: {
    id: number;
    mangaId: number | null;
    mangaTitle: string;
    message: string;
    status: string;
    createdAt: Date;
  };
}) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{report.mangaTitle}</p>
          <p className="mt-1 text-sm text-muted">{report.message}</p>
          <p className="mt-2 text-xs text-muted">
            {report.createdAt.toLocaleString("es-AR")}
          </p>
        </div>
        <ReportActions
          id={report.id}
          mangaId={report.mangaId}
          status={report.status}
        />
      </div>
    </li>
  );
}
