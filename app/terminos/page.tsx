import Link from "next/link";

export const metadata = { title: "Términos y condiciones · Nakama" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const UPDATED = "18 de junio de 2026";

export default function TerminosPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="text-2xl font-bold">Términos y condiciones</h1>
      <p className="mt-1 text-xs text-muted">Última actualización: {UPDATED}</p>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-muted">
        <p>
          Al usar Nakama aceptás estos términos. Nakama es un servicio gratuito
          para seguir y organizar tu colección de manga.
        </p>

        <section>
          <h2 className="text-base font-semibold text-foreground">Tu cuenta</h2>
          <p className="mt-2">
            Necesitás iniciar sesión con una cuenta de Google. Sos responsable de
            la actividad de tu cuenta y del contenido que cargues. Podés borrar tu
            cuenta cuando quieras desde{" "}
            <Link href="/ajustes" className="text-accent hover:underline">
              Ajustes
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Contenido de la comunidad
          </h2>
          <p className="mt-2">
            Si proponés tiendas, autores independientes, reportes, reseñas o
            notas, te comprometés a que el contenido sea veraz, propio o con
            permiso, y que no infrinja derechos de terceros ni sea ofensivo,
            ilegal o spam. Podemos revisar, editar o eliminar contenido y
            suspender cuentas que incumplan estas reglas.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Propiedad intelectual
          </h2>
          <p className="mt-2">
            Los títulos, portadas y datos de las obras pertenecen a sus
            respectivos autores y editoriales. Nakama los muestra con fines
            informativos y de catálogo. Los enlaces de compra te llevan a tiendas
            externas; no vendemos productos ni intermediamos en esas compras.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Sin garantías
          </h2>
          <p className="mt-2">
            El servicio se ofrece &quot;tal cual&quot;. Hacemos lo posible por
            mantener los datos del catálogo y las fechas de salida al día, pero
            pueden contener errores o estar desactualizados. No nos hacemos
            responsables por decisiones de compra basadas en esta información.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Cambios</h2>
          <p className="mt-2">
            Podemos actualizar estos términos. Si hay cambios importantes, lo
            indicaremos en la app. El uso continuado implica la aceptación de los
            términos vigentes.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Contacto</h2>
          <p className="mt-2">
            Ante cualquier duda,{" "}
            {CONTACT ? (
              <>
                escribinos a{" "}
                <a
                  href={`mailto:${CONTACT}`}
                  className="text-accent hover:underline"
                >
                  {CONTACT}
                </a>
                .
              </>
            ) : (
              "podés contactarnos a través del sitio."
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
