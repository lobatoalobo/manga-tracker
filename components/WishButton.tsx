"use client";

import { useState, useTransition } from "react";
import { toggleWishAction } from "@/app/actions";

export default function WishButton({
  anilistId,
  title,
  coverImage,
  initialWished,
}: {
  anilistId: number;
  title: string;
  coverImage: string;
  initialWished: boolean;
}) {
  const [wished, setWished] = useState(initialWished);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const prev = wished;
    setWished(!prev);
    startTransition(() =>
      toggleWishAction({ anilistId, title, coverImage, wished: prev }),
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
        wished
          ? "bg-accent text-white"
          : "border border-border text-muted hover:border-accent hover:text-foreground"
      }`}
    >
      {wished ? "★ En deseados" : "☆ Agregar a deseados"}
    </button>
  );
}
