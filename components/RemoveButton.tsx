"use client";

import { useTransition } from "react";
import { removeMangaAction } from "@/app/actions";

export default function RemoveButton({
  id,
  className,
}: {
  id: number;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();

  function remove(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();

    startTransition(async () => {
      await removeMangaAction(id);
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={isPending}
      className={
        className ??
        "rounded-lg border border-border px-4 py-2 text-sm text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
      }
    >
      {isPending ? "Quitando…" : "Quitar"}
    </button>
  );
}
