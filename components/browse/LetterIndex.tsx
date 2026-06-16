import Link from "next/link";

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

/** Índice alfabético para el modo Nacional A-Z (+ "All" para buscar global). */
export default function LetterIndex({ active }: { active: string }) {
  const cls = (on: boolean) =>
    `flex h-7 items-center justify-center rounded-md text-xs font-medium transition ${
      on ? "bg-accent text-white" : "border border-border text-muted hover:text-foreground"
    }`;
  return (
    <div className="flex flex-wrap gap-1">
      <Link href="/?tab=nacional&letra=all" className={`${cls(active === "all")} px-2.5`}>
        All
      </Link>
      {LETTERS.map((l) => (
        <Link
          key={l}
          href={`/?tab=nacional&letra=${l === "#" ? "%23" : l.toLowerCase()}`}
          className={`${cls(l.toLowerCase() === active.toLowerCase())} w-7`}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
