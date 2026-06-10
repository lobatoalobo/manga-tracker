"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeWishAction } from "@/app/actions";

export default function RemoveWishButton({ anilistId }: { anilistId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await removeWishAction(anilistId);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={isPending}
      className="absolute right-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 text-xs text-muted opacity-0 backdrop-blur transition hover:text-red-400 group-hover:opacity-100"
    >
      Quitar
    </button>
  );
}
