"use client";

import { useTransition } from "react";
import {
  respondFriendRequestAction,
  removeFriendAction,
} from "@/app/actions";

export function RequestActions({ friendshipId }: { friendshipId: number }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex shrink-0 gap-2">
      <button
        onClick={() =>
          startTransition(() => respondFriendRequestAction(friendshipId, true))
        }
        disabled={isPending}
        className="rounded-lg border border-accent px-3 py-1.5 text-sm text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
      >
        Aceptar
      </button>
      <button
        onClick={() =>
          startTransition(() => respondFriendRequestAction(friendshipId, false))
        }
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:text-foreground disabled:opacity-50"
      >
        Rechazar
      </button>
    </div>
  );
}

export function RemoveFriendButton({ otherId }: { otherId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => removeFriendAction(otherId))}
      disabled={isPending}
      className="text-xs text-muted transition hover:text-red-400 disabled:opacity-50"
    >
      Quitar
    </button>
  );
}
