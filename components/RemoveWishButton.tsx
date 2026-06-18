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
      aria-label="Quitar de deseados"
      className="absolute right-2 top-2 z-10 rounded-full bg-rose-500 px-1.5 py-0.5 text-sm leading-none text-white shadow transition hover:bg-rose-600 disabled:opacity-50"
    >
      ❤
    </button>
  );
}
