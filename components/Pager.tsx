import Link from "next/link";

/**
 * Paginador con números: « Anterior · 1 2 3 … · Siguiente ». Muestra una
 * ventana de hasta `windowSize` páginas centrada en la actual, para saltar
 * rápido sin ir de a una.
 *
 * `basePath` debe traer ya los query params existentes (tab, etc.); se le
 * agrega `&page=N`.
 */
export default function Pager({
  basePath,
  page,
  lastPage,
  windowSize = 10,
}: {
  basePath: string;
  page: number;
  lastPage: number;
  windowSize?: number;
}) {
  if (lastPage <= 1) return null;

  const start = Math.max(
    1,
    Math.min(page - Math.floor(windowSize / 2), lastPage - windowSize + 1),
  );
  const end = Math.min(start + windowSize - 1, lastPage);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const href = (n: number) => `${basePath}&page=${n}`;

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-1.5 text-sm">
      <Step href={href(page - 1)} disabled={page <= 1}>
        ‹ Anterior
      </Step>

      {pages.map((n) => (
        <Number key={n} href={href(n)} n={n} active={n === page} />
      ))}

      <Step href={href(page + 1)} disabled={page >= lastPage}>
        Siguiente ›
      </Step>
    </nav>
  );
}

function Step({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="cursor-default px-3 py-1.5 text-muted opacity-40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-muted transition hover:text-foreground"
    >
      {children}
    </Link>
  );
}

function Number({
  href,
  n,
  active,
}: {
  href: string;
  n: number;
  active: boolean;
}) {
  if (active) {
    return (
      <span
        aria-current="page"
        className="min-w-9 rounded-lg border border-accent px-3 py-1.5 text-center font-medium text-accent"
      >
        {n}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="min-w-9 rounded-lg px-3 py-1.5 text-center text-muted transition hover:bg-surface-2 hover:text-foreground"
    >
      {n}
    </Link>
  );
}
