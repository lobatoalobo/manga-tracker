import Link from "next/link";

export const metadata = { title: "Política de privacidad · Nakama" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const UPDATED = "18 de junio de 2026";

export default function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="text-2xl font-bold">Política de privacidad</h1>
      <p className="mt-1 text-xs text-muted">Última actualización: {UPDATED}</p>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-muted">
        <p>
          Nakama es una aplicación para seguir y organizar tu colección de
          manga. Esta política explica qué datos personales tratamos, con qué
          fin y qué derechos tenés. Cumplimos con la Ley 25.326 de Protección de
          los Datos Personales de la República Argentina.
        </p>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Qué datos recopilamos
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">Cuenta:</strong> cuando entrás
              con Google, recibimos tu nombre, correo electrónico y foto de
              perfil.
            </li>
            <li>
              <strong className="text-foreground">Tu colección:</strong> las
              series y ediciones que seguís, tomos que tenés, progreso de
              lectura, deseados, notas y puntajes.
            </li>
            <li>
              <strong className="text-foreground">Compras:</strong> el historial
              de compras que cargues (tienda, fecha, precio, estado).
            </li>
            <li>
              <strong className="text-foreground">Social:</strong> amistades,
              actividad, reacciones y comentarios dentro de la app.
            </li>
            <li>
              <strong className="text-foreground">Notificaciones:</strong> si las
              activás, guardamos la suscripción de tu navegador para enviarte
              avisos push.
            </li>
            <li>
              <strong className="text-foreground">Registros técnicos:</strong>
              {" "}fecha de inicio de sesión, para seguridad y operación.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Para qué los usamos
          </h2>
          <p className="mt-2">
            Únicamente para que la app funcione: autenticarte, mostrar y
            sincronizar tu colección, enviarte las notificaciones que pediste y,
            si elegís compartir tu colección, mostrarla públicamente en tu enlace
            personal. No vendemos tus datos ni los usamos para publicidad.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Con quién los compartimos
          </h2>
          <p className="mt-2">
            Solo con los proveedores que hacen funcionar el servicio:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">Google</strong> — inicio de
              sesión.
            </li>
            <li>
              <strong className="text-foreground">Vercel</strong> — hosting de la
              aplicación.
            </li>
            <li>
              <strong className="text-foreground">Neon</strong> — base de datos.
            </li>
          </ul>
          <p className="mt-2">
            Los datos del catálogo (títulos, portadas, tomos, géneros) provienen
            de las editoriales, MangaUpdates y MangaDex, y son información pública
            de las obras, no datos personales tuyos.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            Cuánto tiempo los guardamos
          </h2>
          <p className="mt-2">
            Mientras tengas la cuenta activa. Si borrás tu cuenta, eliminamos tus
            datos personales de forma permanente (ver más abajo).
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Tus derechos</h2>
          <p className="mt-2">
            Podés acceder, rectificar y suprimir tus datos en cualquier momento:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">Acceso / portabilidad:</strong>
              {" "}exportá tu colección a CSV desde Mi colección → Exportar CSV.
            </li>
            <li>
              <strong className="text-foreground">Supresión:</strong> borrá tu
              cuenta y todos tus datos desde{" "}
              <Link href="/ajustes" className="text-accent hover:underline">
                Ajustes → Borrar cuenta
              </Link>
              . Es inmediato e irreversible.
            </li>
          </ul>
          <p className="mt-2">
            La Agencia de Acceso a la Información Pública, Órgano de Control de la
            Ley 25.326, atiende las denuncias y reclamos por incumplimiento de
            las normas sobre protección de datos personales.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Contacto</h2>
          <p className="mt-2">
            Por cualquier consulta sobre tus datos,{" "}
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
