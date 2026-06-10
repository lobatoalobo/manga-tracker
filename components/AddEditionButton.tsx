"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { addEditionAction, removeEditionAction } from "@/app/actions";
import type { Edition } from "@/lib/editions";

export default function AddEditionButton({
  anilist,
  edition,
  muVolumes,
  isTracked,
}: {
  anilist: any;
  edition: Edition;
  muVolumes?: number | null;
  isTracked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function track() {
    startTransition(async () => {
      await addEditionAction({
        anilistId: anilist.id,
        title: anilist.title,
        coverImage: anilist.coverImage,
        volumes: anilist.volumes ?? null,
        muVolumes: muVolumes ?? null,
        edition: {
          key: edition.id,
          label: edition.source,
          publisher: edition.publisher,
          slug: edition.slug,
          region: edition.region,
          totalVolumes: edition.volumes,
        },
      });
      router.refresh();
    });
  }

  function untrack() {
    startTransition(async () => {
      await removeEditionAction(anilist.id, edition.id);
      router.refresh();
    });
  }

  if (isTracked) {
    return (
      <button
        onClick={untrack}
        disabled={isPending}
        className="mt-3 w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "…" : "✓ Trackeando · quitar"}
      </button>
    );
  }

  return (
    <button
      onClick={track}
      disabled={isPending || edition.volumes <= 0}
      className="mt-3 w-full rounded-lg border border-accent/60 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
    >
      {isPending ? "Agregando…" : "+ Trackear esta edición"}
    </button>
  );
}
