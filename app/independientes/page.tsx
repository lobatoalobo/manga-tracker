import { auth } from "@/auth";
import { getApprovedIndieWorks } from "@/lib/indie";
import PublishIndieWork from "@/components/PublishIndieWork";
import { externalHref } from "@/lib/url";

export const metadata = { title: "Autores independientes · Nakama" };

export default async function IndependientesPage() {
  const session = await auth();
  const works = await getApprovedIndieWorks();

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Autores independientes</h1>
      <p className="mb-6 text-sm text-muted">
        Manga y cómic de autores locales e independientes. ¿Sos autor/a? Publicá
        tu obra y, una vez aprobada, aparece acá.
      </p>

      {works.length === 0 ? (
        <p className="text-sm text-muted">
          Todavía no hay obras publicadas.{" "}
          {session ? "¡Subí la tuya!" : "Iniciá sesión para subir la tuya."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {works.map((w) => (
            <IndieCard key={w.id} work={w} />
          ))}
        </div>
      )}

      {session && <PublishIndieWork />}
    </main>
  );
}

function IndieCard({
  work,
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
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-border bg-surface p-4">
      {work.coverUrl && (
        <div className="aspect-2/3 h-32 shrink-0 overflow-hidden rounded-lg bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={work.coverUrl}
            alt={work.title}
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <div className="min-w-0">
        <p className="font-medium">{work.title}</p>
        <p className="text-sm text-accent">{work.author}</p>
        {work.synopsis && (
          <p className="mt-1 line-clamp-3 text-xs text-muted">{work.synopsis}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {work.buyUrl && (
            <a
              href={externalHref(work.buyUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              🛒 Comprar / leer
            </a>
          )}
          {work.social && (
            <a
              href={externalHref(work.social)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              📱 Redes
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
