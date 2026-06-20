import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { FEATURE_FLAGS, getFlags, type FlagKey } from "@/lib/featureFlags";
import FlagToggle from "@/components/FlagToggle";

export const metadata = { title: "Feature flags · Admin" };

export default async function FlagsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const flags = await getFlags();
  const entries = Object.entries(FEATURE_FLAGS) as [
    FlagKey,
    (typeof FEATURE_FLAGS)[FlagKey],
  ][];

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Feature flags</h1>
      <p className="mb-6 text-sm text-muted">
        Prendé o apagá funcionalidades en vivo, sin redeploy.
      </p>
      <ul className="space-y-2">
        {entries.map(([key, meta]) => (
          <li
            key={key}
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4"
          >
            <div className="min-w-0">
              <p className="font-medium">{meta.label}</p>
              {meta.description && (
                <p className="text-sm text-muted">{meta.description}</p>
              )}
              <p className="mt-0.5 font-mono text-xs text-muted">{key}</p>
            </div>
            <FlagToggle flagKey={key} enabled={flags[key]} />
          </li>
        ))}
      </ul>
    </main>
  );
}
