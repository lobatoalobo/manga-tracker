"use client";

import { useState, useTransition } from "react";
import { toggleReactionAction, addCommentAction } from "@/app/actions";

const EMOJIS = ["👍", "❤️", "🔥", "😮"];

export function ReactionBar({
  activityId,
  reactions,
  myReaction,
}: {
  activityId: number;
  reactions: Record<string, number>;
  myReaction: string | null;
}) {
  const [, startTransition] = useTransition();

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {EMOJIS.map((e) => {
        const count = reactions[e] ?? 0;
        const mine = myReaction === e;
        return (
          <button
            key={e}
            onClick={() =>
              startTransition(() => toggleReactionAction(activityId, e))
            }
            className={`rounded-full border px-2.5 py-1 text-sm transition ${
              mine
                ? "border-accent bg-accent/15 text-accent"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {e}
            {count > 0 && <span className="ml-1 text-xs">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function CommentForm({ activityId }: { activityId: number }) {
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text;
    setText("");
    startTransition(() => addCommentAction(activityId, t));
  }

  return (
    <form onSubmit={submit} className="mt-3 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Comentar…"
        className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent"
      />
      <button
        disabled={isPending || !text.trim()}
        className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
      >
        Enviar
      </button>
    </form>
  );
}
