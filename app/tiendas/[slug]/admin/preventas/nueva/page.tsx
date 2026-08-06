import { redirect } from "next/navigation";

/**
 * Ruta antigua (warm-dark) de alta de preventa: REDIRIGE a la nueva pantalla SaaS, preservando el slug. Se
 * conserva temporalmente para no romper enlaces existentes; el formulario/servicios antiguos siguen sin borrar.
 */
export default async function NewPreorderRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/tiendas/${slug}/preventas/nueva`);
}
