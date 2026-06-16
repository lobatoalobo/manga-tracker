import Link from "next/link";

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

/** Índice alfabético para el modo Nacional A-Z. */
export default function LetterIndex({ active }: { active: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {LETTERS.map((l) => {
        const on = l.toLowerCase() === active.toLowerCase();
        return (
          <Link
            key={l}
            href={`/?tab=nacional&letra=${l === "#" ? "%23" : l.toLowerCase()}`}
            className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium transition ${
              on
                ? "bg-accent text-white"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            {l}
          </Link>
        );
      })}
    </div>
  );
}
