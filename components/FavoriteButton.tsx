"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFavoriteAction } from "@/app/actions";

/** Estrella para marcar/desmarcar la serie preferida (1 por usuario). */
export default function FavoriteButton({
  anilistId,
  isFavorite,
  className,
}: {
  anilistId: number;
  isFavorite: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      await setFavoriteAction(anilistId, !isFavorite);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isFavorite}
      title={isFavorite ? "Quitar de preferida" : "Marcar como preferida"}
      className={
        className ??
        `transition disabled:opacity-50 ${
          isFavorite ? "text-amber-400" : "text-muted hover:text-amber-400"
        }`
      }
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}
