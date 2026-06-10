import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getApprovedStores, getPendingStores } from "@/lib/stores";
import { createStoreAdminAction } from "@/app/actions";
import StoreFields from "@/components/StoreFields";
import StoreAdminActions from "@/components/StoreAdminActions";
import { externalHref } from "@/lib/url";

export const metadata = { title: "Tiendas (admin) · Nakama" };

export default async function AdminTiendasPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [pending, approved] = await Promise.all([
    getPendingStores(),
    getApprovedStores(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Tiendas (admin)</h1>

      <form
        action={createStoreAdminAction}
        className="mb-8 rounded-xl border border-border bg-surface p-4"
      >
        <h2 className="mb-3 text-sm font-semibold">Agregar tienda</h2>
        <StoreFields />
        <button className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90">
          Agregar
        </button>
      </form>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Propuestas pendientes ({pending.length})
      </h2>
      {pending.length === 0 ? (
        <p className="mb-8 text-sm text-muted">No hay propuestas pendientes.</p>
      ) : (
        <ul className="mb-8 space-y-3">
          {pending.map((s) => (
            <StoreRow key={s.id} store={s} pending />
          ))}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Publicadas ({approved.length})
      </h2>
      <ul className="space-y-3">
        {approved.map((s) => (
          <StoreRow key={s.id} store={s} pending={false} />
        ))}
      </ul>
    </main>
  );
}

function StoreRow({
  store,
  pending,
}: {
  store: {
    id: number;
    name: string;
    address: string | null;
    city: string | null;
    province: string | null;
    phone: string | null;
    hours: string | null;
    website: string | null;
    social: string | null;
  };
  pending: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="min-w-0">
        <p className="font-medium">{store.name}</p>
        <p className="mt-0.5 text-sm text-muted">
          {[store.address, store.city, store.province]
            .filter(Boolean)
            .join(", ") || "Sin dirección"}
        </p>
        {(store.phone || store.hours) && (
          <p className="mt-0.5 text-xs text-muted">
            {[store.phone, store.hours].filter(Boolean).join(" · ")}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {store.website && (
            <a
              href={externalHref(store.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent break-all hover:underline"
            >
              🌐 {store.website}
            </a>
          )}
          {store.social && (
            <a
              href={externalHref(store.social)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent break-all hover:underline"
            >
              📱 {store.social}
            </a>
          )}
        </div>
      </div>
      <StoreAdminActions id={store.id} pending={pending} />
    </li>
  );
}
