import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStoreMember } from "@/lib/storeAuth";
import { listMembers } from "@/lib/storeCommerce";
import { STORE_AUTH_ERROR, StoreAuthError, STORE_ROLE } from "@/lib/domain/store/authorize";

export const metadata = { title: "Admin de tienda · Nakama" };

/**
 * Pantalla MÍNIMA de administración comercial de una tienda (Slice 1): verifica perfil comercial, datos
 * básicos y miembros. Solo miembros (OWNER/STAFF) acceden — vía `requireStoreMember` (NO `isAdmin`).
 * `requireEnabled: false`: un OWNER puede entrar aunque la tienda esté deshabilitada (para reactivarla).
 * Sin formularios todavía: los servicios de edición existen (lib/storeCommerce) pero su UI es Slice futura.
 */
export default async function StoreAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let ctx;
  try {
    ctx = await requireStoreMember(slug, {
      allowedRoles: [STORE_ROLE.OWNER, STORE_ROLE.STAFF],
      requireEnabled: false,
    });
  } catch (err) {
    if (err instanceof StoreAuthError) {
      // No filtrar existencia a extraños: perfil inexistente o no-miembro → 404.
      if (err.code === STORE_AUTH_ERROR.PROFILE_NOT_FOUND || err.code === STORE_AUTH_ERROR.NOT_A_MEMBER)
        notFound();
      if (err.code === STORE_AUTH_ERROR.UNAUTHENTICATED)
        return <Shell><p className="text-sm text-muted">Iniciá sesión para administrar esta tienda.</p></Shell>;
      notFound(); // FORBIDDEN_ROLE / STORE_DISABLED (no debería ocurrir con requireEnabled:false)
    }
    throw err;
  }

  const { profileRow: profile, role } = ctx;
  const members = await listMembers(profile.id);

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{profile.store.name}</h1>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
          tu rol: {role}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Administración comercial · <code>/{slug}</code> ·{" "}
        {profile.enabled ? (
          <span className="text-green-600">habilitada</span>
        ) : (
          <span className="text-amber-600">deshabilitada</span>
        )}
      </p>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">Datos comerciales</h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Field label="WhatsApp" value={profile.whatsapp} />
          <Field label="Alias de pago" value={profile.paymentAlias} />
          <Field label="Instrucciones de pago" value={profile.paymentInstructions} />
          <Field label="Instrucciones de retiro" value={profile.pickupInstructions} />
          <Field label="Descripción pública" value={profile.publicDescription} />
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold">Miembros ({members.length})</h2>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{m.user.name ?? m.user.email ?? m.userId}</span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{m.role}</span>
            </li>
          ))}
          {members.length === 0 && <li className="px-4 py-2.5 text-sm text-muted">Sin miembros.</li>}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/tiendas" className="text-sm text-accent hover:underline">
        ← Tiendas
      </Link>
      <div className="mt-4">{children}</div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{value ?? <span className="text-muted">—</span>}</dd>
    </div>
  );
}
