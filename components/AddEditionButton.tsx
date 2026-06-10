"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { addMangaAction } from "@/app/actions";
import type { Edition } from "@/lib/editions";

export default function AddEditionButton({
  manga,
  edition,
  muVolumes,
  japanVolumes,
}: {
  manga: any;
  edition: Edition;
  muVolumes?: number | null;
  japanVolumes?: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      await addMangaAction({
        id: manga.id,
        title: manga.title,
        coverImage: manga.coverImage,
        volumes: manga.volumes ?? null,
        muVolumes: muVolumes ?? null,
        japanVolumes: japanVolumes ?? null,
        edition: {
          // Para formatos japoneses (sin editorial) usamos el nombre como etiqueta.
          publisher: edition.publisher ?? edition.source,
          slug: edition.slug,
          status: edition.status,
          volumes: edition.volumes,
          nextVolume: edition.nextVolume,
        },
      });

      router.push("/collection");
    });
  }

  return (
    <button
      onClick={add}
      disabled={isPending}
      className="mt-3 w-full rounded-lg border border-accent/60 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
    >
      {isPending ? "Agregando…" : "+ Trackear esta edición"}
    </button>
  );
}
