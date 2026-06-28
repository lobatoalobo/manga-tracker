export type ReadingLink = { url: string; site: string; language: string | null };

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

const LANG_SHORT: Record<string, string> = {
  Spanish: "ES",
  English: "EN",
  Japanese: "JA",
};

/**
 * Botones "Leer online": lectores LEGALES curados por AniList (MANGA Plus, VIZ…)
 * guardados en `Work.readingLinks`, + un botón a MangaDex derivado del `mdId`
 * (scanlation/gris, por eso va al final y etiquetado). Solo se muestra si hay
 * alguno. No hosteamos nada: son links externos.
 */
export default function ReadingLinks({
  links,
  mdId,
}: {
  links: ReadingLink[] | null | undefined;
  mdId: string | null;
}) {
  // Solo lectores útiles para AR: español/inglés (los JA/KO —Naver, KakaoPage,
  // Piccoma, Pixiv…— no sirven). Un botón por sitio (la data viene ordenada
  // ES > EN, así que el primero es el mejor idioma). Tope 6.
  const seen = new Set<string>();
  const all: ReadingLink[] = [];
  for (const l of links ?? []) {
    if (l.language && l.language !== "Spanish" && l.language !== "English") continue;
    if (seen.has(l.site)) continue;
    seen.add(l.site);
    all.push(l);
    if (all.length >= 6) break;
  }
  if (mdId)
    all.push({ url: `https://mangadex.org/title/${mdId}`, site: "MangaDex", language: null });
  if (all.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Leer online
      </h2>
      <div className="flex flex-wrap gap-2">
        {all.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition hover:border-accent hover:text-accent"
          >
            <BookIcon />
            {l.site}
            {l.language && LANG_SHORT[l.language] ? (
              <span className="text-xs text-muted">{LANG_SHORT[l.language]}</span>
            ) : null}
          </a>
        ))}
      </div>
    </section>
  );
}
