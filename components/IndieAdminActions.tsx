"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveIndieWorkAction,
  deleteIndieWorkAction,
} from "@/app/actions";

export default function IndieAdminActions({
  id,
  pending,
}: {
  id: number;
  pending: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (action: () => Promise<void>) =>
    startTransition(async () => {
      await action();
      router.refresh(); // garantiza que la lista se actualice
    });

  return (
    <div className="flex shrink-0 gap-2">
      {pending && (
        <button
          onClick={() => run(() => approveIndieWorkAction(id))}
          disabled={isPending}
          className="rounded-lg border border-accent px-3 py-1.5 text-sm text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
        >
          Aprobar
        </button>
      )}
      <button
        onClick={() => run(() => deleteIndieWorkAction(id))}
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
      >
        Borrar
      </button>
    </div>
  );
}
