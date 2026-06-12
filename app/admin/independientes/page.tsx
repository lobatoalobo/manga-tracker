import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import {
  getApprovedIndieWorks,
  getPendingIndieWorks,
} from "@/lib/indie";
import IndieAdminActions from "@/components/IndieAdminActions";
import { externalHref } from "@/lib/url";

export const metadata = { title: "Autores independientes (admin) · Nakama" };

export default async function AdminIndependientesPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [pending, approved] = await Promise.all([
    getPendingIndieWorks(),
    getApprovedIndieWorks(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Autores independientes (admin)</h1>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Pendientes ({pending.length})
      </h2>
      {pending.length === 0 ? (
        <p className="mb-8 text-sm text-muted">No hay obras pendientes.</p>
      ) : (
        <ul className="mb-8 space-y-3">
          {pending.map((w) => (
            <IndieRow key={w.id} work={w} pending />
          ))}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Publicadas ({approved.length})
      </h2>
      <ul className="space-y-3">
        {approved.map((w) => (
          <IndieRow key={w.id} work={w} pending={false} />
        ))}
      </ul>
    </main>
  );
}

function IndieRow({
  work,
  pending,
}: {
  work: {
    id: number;
    title: string;
    author: string;
    synopsis: string | null;
    coverUrl: string | null;
    buyUrl: string | null;
    social: string | null;
  };
  pending: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="min-w-0">
        <p className="font-medium">
          {work.title}{" "}
          <span className="text-sm font-normal text-accent">· {work.author}</span>
        </p>
        {work.synopsis && (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted">
            {work.synopsis}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {work.coverUrl && (
            <a
              href={externalHref(work.coverUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent hover:underline"
            >
              🖼 Portada
            </a>
          )}
          {work.buyUrl && (
            <a
              href={externalHref(work.buyUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent hover:underline"
            >
              🛒 {work.buyUrl}
            </a>
          )}
          {work.social && (
            <a
              href={externalHref(work.social)}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent hover:underline"
            >
              📱 {work.social}
            </a>
          )}
        </div>
      </div>
      <IndieAdminActions id={work.id} pending={pending} />
    </li>
  );
}
