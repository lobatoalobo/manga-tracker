# Retail UI Kit (`components/retail/ui`)

Los 11 componentes del PDD (ver [`docs/pdd/componentes.md`](../../../docs/pdd/componentes.md)) viven acá. Se implementan de a poco (Fase 0). Presentes hoy: **`Button`** (C-01), **`Money`** (C-02), **`Cover`** (C-03) y **`Pill`** (C-04).

> Nombres de props (desviaciones deliberadas vs la ficha):
> - `Money` recibe **`cents`** (garantía de unidad, siempre vía `formatArsCents`) y **`variant`** (`inline` | `total`), no `amount`/`size`.
> - `Button` y `Pill` reciben **`children`** (no `label`), para admitir ícono + contenido. `Button` suma `type` (`button` | `submit`), `loading` (`aria-busy`, sin spinner) y `ariaLabel` (solo-ícono). No renderiza como link ni orquesta async.
> - `Pill` sin `onClick` → `<span>` display-only; con `onClick` → `<button>` nativo. El mapeo *estado → tono/etiqueta* es dominio, no del `Pill`.

## Convenciones

- **Color y tipografía** vienen de las CSS-vars del **tema retail acotado** (`--paper`, `--ink`, `--mark`, `--serif`, `--sans`, `--mono`, …), definido en [`app/(retail-preview)/retail-theme.css`](../../../app/%28retail-preview%29/retail-theme.css) y aplicado **solo bajo `[data-retail]`**. Ningún componente hardcodea hex ni fuentes.
- **Layout y utilidades** → Tailwind v4 (el idioma del repo). El tema retail **no** reemplaza a Tailwind: lo complementa aportando la paleta editorial y las fuentes de sistema dentro de su scope.
- **Alcance del tema:** todo se pinta bajo un contenedor con `data-retail` (y, opcionalmente, `data-theme="light" | "dark"` para forzar el modo). Fuera de ese scope, la app usa su tema global (dark) intacto.
- **Sin dependencias de servidor:** los componentes son presentacionales. No importan Prisma. Reciben datos ya resueltos (view-models de `lib/domain/retail`) y **emiten intención** (callbacks); no mutan estado.
- **Dinero** → se formatea con `formatArsCents` de `lib/retail/format.ts` (precios en **centavos**). No se reimplementa el formateo.

## Preview

La galería de estados/variantes se sirve en `/kit`, **gateada** por `RETAIL_PREVIEW_ENABLED=true` (ver [`app/(retail-preview)/gate.ts`](../../../app/%28retail-preview%29/gate.ts)). La preview valida **composición visual**; el comportamiento se cubre con tests (desde C2).

**Regla de la galería:** cada componente se muestra **aislado, con fixtures propias** — la galería **nunca reconstruye una pantalla** (P-01…P-08). El andamio reutilizable es `Section` (en `app/(retail-preview)/kit/_gallery/`), donde se enchufa cada entrada. Los tests de componentes viven en `tests/ui/**/*.test.tsx` (entorno **jsdom**, proyecto `ui` de Vitest); la suite de dominio/servicios sigue en `tests/*.test.ts` (**node**).
