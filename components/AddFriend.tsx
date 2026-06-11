"use client";

import { useActionState } from "react";
import { sendFriendRequestAction } from "@/app/actions";

export default function AddFriend() {
  const [state, action, pending] = useActionState(sendFriendRequestAction, null);

  return (
    <form action={action} className="rounded-xl border border-border bg-surface p-4">
      <label className="text-sm font-medium">Agregar amigo</label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="email de tu amigo (Google)"
          className="min-w-56 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Enviar solicitud"}
        </button>
      </div>
      {state && !state.ok && (
        <p className="mt-2 text-sm text-red-400">{state.error}</p>
      )}
      {state?.ok && (
        <p className="mt-2 text-sm text-emerald-400">Solicitud enviada.</p>
      )}
    </form>
  );
}
