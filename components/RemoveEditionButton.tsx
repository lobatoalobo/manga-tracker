"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeEditionAction } from "@/app/actions";

export default function RemoveEditionButton({
  anilistId,
  editionKey,
  label = "Dejar de trackear",
  className,
}: {
  anilistId: number;
  editionKey: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function remove(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await removeEditionAction(anilistId, editionKey);
      router.refresh();
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
      {isPending ? "Quitando…" : label}
    </button>
  );
}
