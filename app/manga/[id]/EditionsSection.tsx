import { resolveEditions, titlesOf } from "@/lib/getMangaDetails";
import AddEditionButton from "@/components/AddEditionButton";

export default async function EditionsSection({
  anilist,
  knownSlug,
  trackedKeys,
}: {
  anilist: any;
  knownSlug?: string | null;
  trackedKeys: string[];
}) {
  const { editions, muVolumes } = await resolveEditions(
    anilist,
    titlesOf(anilist),
    knownSlug,
  );

  if (editions.length === 0) {
    return (
      <p className="text-sm text-muted">
        No encontramos ediciones para esta serie.
      </p>
    );
  }

  const tracked = new Set(trackedKeys);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {editions.map((ed) => {
        const isTracked = tracked.has(ed.id);
        return (
          <div
            key={ed.id}
            className={`flex flex-col rounded-xl border bg-surface p-4 ${
              isTracked ? "border-accent" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{ed.source}</span>
              <RegionBadge region={ed.region} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <Field label="Tomos" value={ed.volumes || "—"} />
              <Field label="Estado" value={ed.status} />
              {ed.nextVolume ? (
                <Field label="Próximo tomo" value={`#${ed.nextVolume}`} />
              ) : null}
            </dl>
            {ed.note && <p className="mt-2 text-xs text-muted">{ed.note}</p>}
            {ed.url && (
              <a
                href={ed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs text-accent hover:underline"
              >
                Ver en {ed.publisher ?? ed.source} ↗
              </a>
            )}
            <div className="mt-auto">
              <AddEditionButton
                anilist={anilist}
                edition={ed}
                muVolumes={muVolumes}
                isTracked={isTracked}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium">{value ?? "—"}</dd>
    </div>
  );
}

function RegionBadge({ region }: { region: string }) {
  const map: Record<string, { label: string; className: string }> = {
    AR: { label: "🇦🇷 Argentina", className: "bg-sky-500/15 text-sky-300" },
    JP: { label: "🇯🇵 Japón", className: "bg-rose-500/15 text-rose-300" },
    INT: {
      label: "🌎 Internacional",
      className: "bg-emerald-500/15 text-emerald-300",
    },
  };
  const { label, className } = map[region] ?? map.INT;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
