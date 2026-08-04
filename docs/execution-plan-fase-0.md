# Execution Plan · Fase 0 (Fundaciones)

Plan de ejecución de las fundaciones compartidas para implementar las ocho pantallas del PDD **sin duplicar dominio, estilos ni componentes**. No incluye código. Parte del **estado real del repo**, no de una hoja en blanco.

> **Hallazgo que gobierna todo el plan:** el dominio de Retail **ya existe y está en producción** (slices 1–8). El PDD es el **rediseño visual + la evolución a self-service (checkout P1)** de una feature funcionando, **no** una app nueva. Fase 0 = un **UI Kit** + un **tema retail acotado** + una **capa pura de vista/etiquetas** sobre el dominio existente. **No se reconstruye el dominio ni se crea una app paralela.**

---

## 1 · Estado actual del repositorio

### Stack real
- **Next 16.2.7** (App Router), **React 19**, **TypeScript 5** (`strict`, alias `@/*` → raíz).
- **Tailwind v4** (`@import "tailwindcss"` + `@theme inline` en [app/globals.css](../app/globals.css)); tokens por CSS-vars. **Hoy es dark-only** (`--background:#0d0d12`, `--accent:#7c5cff`, fuentes Geist).
- **Prisma 6** (Postgres; `embedded-postgres` para tests/local), **next-auth v5**, **Sentry**, **@vercel/blob**, **web-push**.
- **Vitest** (`npm run check` = `tsc --noEmit && vitest run`). **No hay** Storybook, ni `@testing-library/react`, ni jsdom.

### Estructura relevante (lo que ya existe)
| Capa | Ubicación | Qué hay |
|---|---|---|
| **Dominio puro (Prisma-free)** | [lib/domain/retail/](../lib/domain/retail/) | `fulfillment.ts` (máquina por contadores RESERVED→ORDERED→ARRIVED→CANCELLED + PREPARED/PICKED_UP; idempotencia `reconcileOperationKey`), `payment.ts`, `order.ts`, `campaign.ts`, `handoff.ts`, `notification.ts`, `offer.ts`, `errors.ts` (`RetailError`). |
| **Servicios (Prisma)** | [lib/retail/](../lib/retail/) | `campaigns · offers · orders · fulfillment · handoff · notifications · payments · public · auth · contact · volumeSearch · publicCode · format`. `format.ts` ya tiene **`formatArsCents`**. `contact.ts` arma el **deep-link de WhatsApp** de la tienda. |
| **Schema** | [prisma/schema.prisma](../prisma/schema.prisma) L705–1071 | `Store · StoreCommerceProfile(slug, whatsapp, paymentAlias, pickupInstructions, checkoutMode) · StoreMember(OWNER/STAFF) · PreorderCampaign(DRAFT/PUBLISHED/CLOSED/CANCELLED, opensAt/closesAt) · PreorderOffer(volumeId opcional, snapshots, precios en centavos, sortOrder) · StoreOrder(publicCode, userId, status, totalCents, paidCents, paymentStatus) · StoreOrderLine(quantity + contadores ordered/arrived/cancelled/prepared/pickedUp) · StoreOrderLineEvent · StoreOrderNotification(+Item, envío MANUAL) · StorePayment(ledger, method TRANSFER/CASH/…)`. |
| **UI de retail (ya funcionando)** | [app/tiendas/[slug]/](../app/tiendas/) | **Admin:** `admin/page · admin/CommerceConfigForm · admin/preventas/{nueva,page,[campaignId]/{page,ordenes,cumplimiento,preparacion,pagos,avisos}}` + controles (`HandoffControls · LineFulfillmentControls · Payments · ArrivalNotifications · StoreCancelButton`). **Cliente:** `[slug]/preventas/[campaignId]/{page, ReserveForm}`. |
| **Estilo** | [app/globals.css](../app/globals.css) | Tailwind v4, tokens dark-only, Geist. |

### Componentes/servicios reutilizables (NO duplicar)
- **Formato de dinero** → `lib/retail/format.ts::formatArsCents`. El componente `Money` lo **envuelve**; precios en **centavos** (Int), no pesos.
- **Máquina de estados** → `lib/domain/retail/fulfillment.ts` + `payment.ts` **son** la máquina. El "Bloqueante 3" del PDD es en el código una **capa de vista/etiquetas** sobre estos estados derivados, no una máquina nueva.
- **Idempotencia / errores** → `reconcileOperationKey`, `RetailError`. Reusar el patrón; no inventar otro.
- **Contacto / WhatsApp** → `lib/retail/contact.ts` (deep-link de la tienda). El modelo de contacto vive en los snapshots de `StoreOrder`.
- **Rutas y servicios de admin/cliente** → ya existen; el rediseño **restila y reestructura** estas pantallas, no crea rutas paralelas.

### Incompatibilidades PDD ↔ código (las que importan)
| # | PDD dice | Código hace | Impacto |
|---|---|---|---|
| **X-1 · Acceso** | Enlace-capacidad **sin cuenta** (DT-01) | `StoreOrder.userId` **autenticado**; `@@unique([campaignId, userId])`; `publicCode` **no autoriza** (lee por userId/membresía) | **RESUELTO — dirección A** (pedidos anónimos por capability token; reservar sin cuenta es parte del flujo aprobado P-05/P-06). Fase 0 sigue **schema-free**. Un **slice dedicado, previo a P-05/P-06**, adapta el modelo (userId **opcional**, pedido autenticado **o** anónimo, consulta anónima por token, **se conserva** el flujo autenticado) con su **propio Execution Plan** (schema/compat/authz/migración/rollout/tests). **No se diseña dentro de Fase 0.** |
| **X-2 · Contacto** | Nombre + **WhatsApp** (sin email) | `customerNameSnapshot` + `customerEmailSnapshot` (sin whatsapp del cliente) | **Dirección de producto: nombre + WhatsApp** como contacto principal de Retail. Cambio de schema en el slice previo a P-05/P-06 (o uno separado si el análisis técnico lo aconseja). **Fase 0 solo define tipos/view-models, sin asumir que las columnas existen.** |
| **X-3 · Comprobante** | Cliente **adjunta comprobante** → tienda valida (DT-04) | Ledger `StorePayment`: la tienda **registra un pago que ya verificó** (sin adjunto, sin estado "por validar") | Nuevo flujo + schema. Fuera de Fase 0. El dominio-vista puede modelar el estado; persistencia después. |
| **X-4 · Portada** | Principal + secundarias (D-006/007/008) | `PreorderOffer.sortOrder` existe; **no** hay flag principal/portada | Schema (flag). El componente `Portada` se construye contra props ahora; persistencia después. |
| **X-5 · modoPago** | 3 modos configurables por preventa/tomo (DT-02) | No existe; `checkoutMode` es otro eje (CONVERSATIONAL→SELF_SERVICE) | Schema (config). Dominio-vista puro ahora; persistencia + `pilot.modoPago` después. |
| **X-6 · Avisos** | "Nakama avisa por WhatsApp" (SYS-03) | Avisos **MANUALES** (la tienda copia el texto; Nakama no manda comms externas) | **Refina** DT-01: el link viaja **dentro del mensaje manual** que manda la tienda. No es bloqueante; corrige el supuesto. |
| **X-7 · Granularidad** | Faltante por línea completa (borde qty>1 diferido) | Contadores **por cantidad** (parcial ya resuelto) | El backend es **más capaz** que el PDD. La UI presenta línea-completa sobre un dominio que soporta parciales. Reconciliación, no conflicto. |
| **X-8 · Estética** | "Editorial preciso" papel+tinta, serif, **light/dark** | Tailwind **dark-only**, tech, Geist | Requiere **tema retail acotado** (no reskin global). Decisión de arquitectura. |

---

## 2 · Decisiones arquitectónicas necesarias

- **Ubicación del dominio.** Extender [lib/domain/retail/](../lib/domain/retail/) (puro, `now` inyectado). Fase 0 agrega **módulos puros nuevos** ahí: `labels.ts` (mapeos estado→etiqueta dominio↔cliente↔tienda), `promise-view.ts` (view-model que combina cumplimiento+pago+aviso en las etiquetas del PDD), `payment-mode.ts` (derivación de los 3 modos → puntos de cargo; valor del piloto **sin fijar**). **Sin schema.**
- **Separación server/client.** El dominio es puro → server y client lo importan sin costo. Los **servicios** (`lib/retail`) y las **mutaciones** siguen siendo **server-only** (Server Actions / route handlers existentes). El UI Kit es **presentacional** (client components donde haga falta interactividad; server components para render estático). Ningún componente del Kit importa Prisma.
- **Cómo se exponen estados y transiciones.** Los estados se **derivan** (ya lo hacen: `deriveFulfillmentStatus`, `paymentStatus` proyectado del ledger). El Kit **nunca** recibe "el estado crudo"; recibe el **view-model** de `promise-view.ts` (etiqueta + tono + acciones permitidas). Las **transiciones** solo ocurren en los servicios server-side, detrás de `operationKey` idempotente.
- **Cómo se evita que la UI mutte estados inválidos.** (a) El Kit **no muta**: emite intención (callbacks/acciones), no cambia estado. (b) Las transiciones válidas las decide el **dominio puro** (guardas + `RetailError`), no la UI. (c) La UI **deshabilita** lo no permitido leyendo `acciones permitidas` del view-model, pero la **verdad** la impone el server. Doble puerta: UI orienta, dominio valida.
- **Dónde viven los mapeos de copy.** En el **dominio** (`lib/domain/retail/labels.ts`), no en los componentes (ver [componentes.md](pdd/componentes.md) → "Movido al dominio"). `Pill`, `HeroEstado` (composición) y las tarjetas los **renderizan**; no los deciden. Un solo lugar para "estado → texto de cliente / de tienda".

---

## 3 · Fases y commits

Entregables chicos, en orden de dependencia. Cada commit deja `npm run check` verde y **no cambia nada visible** de la app existente (el Kit vive en `components/retail/ui/` + una ruta de preview gateada). Convención de tests: **dominio → vitest unit**; **componentes → smoke render + fixtures visuales**.

> **Estado real (progreso).** **Fase 0 COMPLETA y verde** (rama `feat/retail-redesign-foundations`): tema (C1), harness jsdom + galería (C2), los 11 componentes del Kit, y la **capa de dominio-vista implementada** — `labels.ts` (`8c263a6`), `promise-view.ts` (`80a2ae6`) y `payment-mode.ts` (`96d4bf8`). Tests: **82 de componente (jsdom / ui)** + **871 de dominio (node)** = **953 passed**. `pilot.modoPago` sigue **deliberadamente sin fijar** (lo inyecta el llamador; pendiente de confirmar con Agustín).
>
> **Nota de numeración.** Este plan enumera los commits **C1–C12** (con la capa de dominio en C10–C12). Durante la implementación se usó una numeración **C1–C11** que agrupó distinto los componentes de estructura (el `WorkspaceShell + ActionBar` quedó como C8+C9 y el `BottomSheet + Search` como C10+C11), agrupando la capa de dominio como tres commits atómicos propios. **La diferencia entre la numeración original del plan y la usada durante la implementación no representa un cambio de alcance sino únicamente una diferencia de organización de los commits** — el trabajo es el mismo. Mapa: plan C3=Cover+Money, C4=Button+Pill, C5=TomoLine, C6=Portada, C7=Comprobante, C8=WorkspaceShell+ActionBar, C9=BottomSheet+Search, **C10–C12=capa de dominio (implementada: `labels.ts` · `promise-view.ts` · `payment-mode.ts`)**.

### 0.A · Scaffolding y tema (sin tocar la app actual) — ✅ HECHO
- **C1 · Tema retail acotado.** Tokens papel+tinta (light/dark) como capa CSS **scopeada** a un segmento retail (p. ej. `data-retail` en el layout del segmento), sin alterar `globals.css` global. Fuentes **de sistema** (Iowan/Palatino, Optima, ui-monospace — sin webfonts, CSP-safe). *Aceptación:* una página de preview muestra la paleta en light/dark; el resto de la app queda idéntica. *Tests:* visual (preview).
- **C2 · Infra de preview + tests de componentes.** Expandir la preview a galería de componentes/estados. Sumar `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` + env vitest (jsdom) para tests de **comportamiento**. **División aprobada:** la **preview valida composición visual**; los **tests cubren comportamiento, estados, callbacks, teclado, foco y a11y básica**. *Aceptación:* `npm run test` verde; galería renderiza. *Tests:* smoke del harness (render + un aserto de rol/aria) que prueba que jsdom+testing-library funcionan.

### 0.B · Primitivos — ✅ HECHO
- **C3 · Cover + Money.** `Cover` (greybox tipográfico por paleta; prop `imagen` futura; tamaños xs–xl; estado visual). `Money` **envuelve `formatArsCents`** (recibe **centavos**). *Aceptación:* fixtures de tamaños/estados; Money formatea es-AR desde centavos. *Tests:* unit de Money; smoke de Cover.
- **C4 · Button + Pill.** `Button` (primary/ghost/warn, disabled). `Pill` (tono neutral/mark/warn/go, dot?, prefijo?, onClick?) — unifica status/chip/pay/tag. *Aceptación:* fixtures de variantes; foco visible (a11y). *Tests:* smoke + a11y (rol/aria).

### 0.C · Compuestos de contenido — ✅ HECHO
- **C5 · TomoLine.** Cover + identidad + cantidad + precio + **acción por slot**. Fixtures de variantes (lectura, precio editable, "A pedir", stepper, "no llegó", se-lleva/debe). Props tipados desde snapshots de oferta/línea existentes. *Tests:* smoke por variante.
- **C6 · Portada.** principal + secundarias (D-006/007/008) con acciones de editor **por slot**; consume props (persistencia del flag = futura). *Tests:* smoke vacía/con-principal.
- **C7 · Comprobante.** Modos adjuntar/enviar (cliente) y ver/confirmar (tienda) — **UI only**, sin persistencia (X-3). *Tests:* smoke por modo.

### 0.D · Estructura — ✅ HECHO
- **C8 · WorkspaceShell + ActionBar.** `WorkspaceShell` (identidad de edición + fase + navegación; **absorbe Masthead**, usa `Pill`). `ActionBar` (barra fija: status/bloqueo + CTA). *Aceptación:* shell con las 5 fases; ActionBar bloqueada con motivo. *Tests:* smoke.
- **C9 · BottomSheet + Search.** `BottomSheet` (capa sobre la página; `prefers-reduced-motion`). `Search` (filtro por nombre, client). *Tests:* smoke + a11y (foco/escape del sheet).

### 0.E · Capa de dominio-vista (pura, sin schema) — ✅ HECHO
- **C10 · `labels.ts`.** ✅ Lookup puro estado→etiqueta (dominio→cliente→tienda); 8 `EstadoPromesa` con copy neutro + tono. El cliente nunca ve *apartado/faltante*. *Tests:* 18 unit (una por fila del mapeo). Commit `8c263a6`.
- **C11 · `promise-view.ts`.** ✅ View-model puro con **proyección por actor** (cliente/tienda pueden diferir alrededor del aviso), faceta de pago por promesa (`EstadoPagoPromesaVista`, desacoplada del `PaymentStatus` agregado), acciones **separadas por actor** y `cancelar` según cancelabilidad real. *Tests:* 21 unit por combinación de estados. Commit `80a2ae6`.
- **C12 · `payment-mode.ts`.** ✅ Derivación de los 3 modos (`sin_pago_previo`/`sena`/`total`) → puntos de cobro CP1/CP2; seña fija/porcentual con clamp y redondeo absorbido por el saldo; **`pilot.modoPago` deliberadamente sin fijar** (config inyectada, no constante). *Tests:* 29 unit de la tabla modo × punto de cobro. Commit `96d4bf8`.

> **No incluido en la secuencia (gated por decisión):** helper puro de capability-token (X-1). No se implementa hasta resolver el modelo de acceso.

---

## 4 · Migraciones de datos

**Fase 0 no lleva migraciones** (por restricción y por diseño: Kit + tema + dominio-vista son schema-free). No se toca `schema.prisma`.

Para trazabilidad, lo que **fases futuras** necesitarán (fuera de acá): `PreorderOffer.featured/principal` (X-4), `StoreOrder.customerWhatsappSnapshot` (X-2), artefacto de comprobante + estado "por validar" (X-3), `PreorderCampaign.modoPago` (X-5), y el **token de acceso** + `userId` **opcional** + relajar `@@unique([campaignId, userId])` (X-1). Cada una será aditiva, con la misma estrategia segura del repo (`migrate:staging` antes que prod). Ninguna se diseña ahora.

> **Slice dedicado previo a P-05/P-06 (acceso anónimo por capability token).** Aprobada la dirección A. Antes de rediseñar P-05/P-06 se ejecuta un slice que hace `userId` **opcional**, permite el pedido **anónimo** consultado por **token-capacidad**, **conserva** el flujo autenticado, y (mismo slice o uno separado según el análisis técnico) suma el contacto **WhatsApp** (X-2). Tendrá su **propio Execution Plan** con schema, compatibilidad, autorización, migración, rollout y tests. **No se diseña dentro de Fase 0.**

---

## 5 · Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| **R-1** | El tema papel+tinta se filtra al resto de la app (dark) o viceversa. | Scopear por `data-retail`/capa CSS al segmento retail; regresión visual sobre 2–3 pantallas existentes. |
| **R-2** | Dos estéticas conviviendo (app half-rediseñada) durante la migración. | Adopción del Kit **por pantalla**, detrás de las rutas existentes; feature-flag (`retail-manual-offers` ya existe como patrón) si hace falta. |
| **R-3** | Dinero en centavos vs pesos (los mocks usaban pesos). | `Money` recibe **centavos** y usa `formatArsCents`; test unitario. |
| **R-4** | Componentes construidos contra props que luego necesitan schema (portada, comprobante). | Tipar props desde el **dominio existente** donde ya existe; para lo no-modelado (X-3/X-4) props mínimas y marcadas *provisional*. |
| **R-5** | La divergencia de acceso (X-1) frena P-05/P-06 rediseñados. | No bloquea Fase 0 (kit/tema/labels). Se resuelve **antes de Fase 2**; ver decisiones. |
| **R-6** | Sumar jsdom/testing-library afecta `npm run check`/CI. | devDeps aditivas, env vitest scopeado; verificar verde antes de mergear C2. |
| **R-7** | Rework si el rediseño reemplaza patrones que la operación real ya usa. | Restilar **in-place** las rutas existentes; no crear árbol paralelo; validar con la operación de Crumb. |

**Decisiones del PDD que aún dependen de validación real:** `pilot.modoPago` (Agustín) · el modelo de acceso (X-1) · el flujo de comprobante (X-3) · si el piloto usa checkout SELF_SERVICE o sigue CONVERSATIONAL.

---

## 6 · Definition of Done de Fase 0

> **Estado: 6/6 cumplidos · Fase 0 CERRADA.** El UI Kit está completo (11/11) y la capa de dominio-vista está implementada y verde. Quedan habilitados P-03/P-01/P-02.

Para habilitar la implementación (rediseño) de **P-03 / P-01 / P-02**:
1. ✅ **11 componentes** del Kit implementados en `components/retail/ui/`, tematizados **light/dark**, responsive, con **a11y base** (foco visible, roles/aria, `prefers-reduced-motion`), y **fixtures** que muestran cada estado/variante.
2. ✅ **Tema retail acotado** aplicado sin alterar la estética global de la app.
3. ✅ **Capa de dominio-vista** (`labels.ts`, `promise-view.ts`, `payment-mode.ts`) con **tests unitarios** (18+21+29 = 68); `pilot.modoPago` **sigue sin fijar** (config inyectada, no constante).
4. ✅ **`Money` reusa `formatArsCents`**; ningún cálculo de dinero duplicado.
5. ✅ `npm run check` **verde** (**953 passed**: 871 node + 82 ui); la app existente **visualmente intacta**; el Kit no importa Prisma.
6. ✅ **Mapa PDD ↔ schema** documentado (esta tabla de incompatibilidades, mantenida).

P-03/P-01/P-02 son alcanzables schema-free porque mapean a `PreorderCampaign`/`PreorderOffer`/`StoreOrder` **que ya existen** (la única pieza que P-03 pediría a futuro es el flag de portada X-4, no bloqueante del rediseño base).

---

## 7 · Restricciones (honradas)
Sin código · sin schema ni migraciones · sin reabrir decisiones de producto · sin implementar las 8 pantallas · sin fijar `pilot.modoPago` · sin promover composiciones a componentes sin evidencia · **prioridad: reutilizar la arquitectura actual** (dominio, servicios, rutas, `formatArsCents`, patrón de idempotencia/errores).

---

## 8 · Decisiones aprobadas

1. **Modelo de acceso (X-1) → dirección A · pedidos sin cuenta por capability token.** No se reutiliza el login obligatorio como solución del piloto (reservar sin cuenta es parte del flujo aprobado P-05/P-06). Fase 0 **schema-free**; un **slice dedicado previo a P-05/P-06** adapta el modelo (userId opcional, anónimo por token, conserva el flujo autenticado) con **Execution Plan propio** (no se diseña ahora).
2. **Rediseño in-place** de `app/tiendas/[slug]/…` adoptando el Kit. **Sin árbol paralelo de rutas.**
3. **Tema retail acotado por `data-retail`.** No se modifica el tema global de Nakama.
4. **Contacto → nombre + WhatsApp** como contacto principal de Retail. Schema en el slice previo a P-05/P-06 (o separado). **Fase 0 solo define tipos/view-models**, sin asumir columnas.
5. **Tests:** sumar `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` + ruta de preview gateada. Preview = composición visual; tests = comportamiento, estados, callbacks, teclado, foco y a11y básica.

**Invariantes mantenidos:** cero migraciones · cero cambios visibles en las rutas actuales · `pilot.modoPago` sin fijar · componentes compatibles con la arquitectura existente · cada commit con `npm run check` + sus tests verdes.

---

## 9 · Detalle del primer commit — 0.A / C1 · Tema retail acotado

**Objetivo:** dejar disponible el tema papel+tinta (light/dark) **scopeado a `[data-retail]`**, verificable en aislamiento, **sin tocar el tema global ni ninguna ruta existente**. Sin componentes todavía (llegan desde C3).

**Archivos (todos NUEVOS; ninguno modifica `app/globals.css`, `app/tiendas/**` ni el schema):**

| Archivo | Tipo | Contenido |
|---|---|---|
| `app/(retail-preview)/retail-theme.css` | NEW | Tokens **scopeados** bajo `[data-retail]`: `--paper/-2/--card · --ink/-2/-3 · --hair/-2 · --mark/-2/-soft · --warn/-soft · --go/-soft` + `--serif/--sans/--mono` (fuentes de sistema, sin webfonts). Light por defecto; `@media (prefers-color-scheme:dark)`; overrides `[data-retail][data-theme="dark"]` / `[data-theme="light"]` en ambas direcciones. **Todos los selectores bajo `[data-retail]` → inertes fuera del segmento.** |
| `app/(retail-preview)/layout.tsx` | NEW | Layout del route-group aislado `(retail-preview)`: importa `retail-theme.css`, envuelve en `<div data-retail>`, marca `robots noindex` y **gatea por flag explícito** (`notFound()` salvo que `RETAIL_PREVIEW_ENABLED==="true"`; oculto por defecto en todos los entornos). No altera el nesting de rutas existentes. |
| `app/(retail-preview)/kit/page.tsx` | NEW | Preview mínima verificable: **swatches** de cada token de color, **muestras tipográficas** (serif/sans/mono) y un **toggle light/dark** que estampa `data-theme` en el wrapper. Sin componentes del Kit todavía. |
| `components/retail/ui/README.md` | NEW | Documenta la convención: el Kit vive acá; los colores/tipografía se consumen de las CSS-vars del tema `[data-retail]`; Tailwind se usa para layout/utilidades. |

**Fuera de C1 (llega después):** `@testing-library/*` + `jsdom` + galería de componentes (C2); cualquier componente del Kit (C3+); `components/retail/ui/theme.ts` (referencia tipada de tokens) se agrega cuando el primer componente lo necesite (C3), no antes.

**Criterio de aceptación de C1:**
- `npm run check` verde (los `.tsx` tipan; sin lógica nueva).
- En dev, `/kit` bajo `data-retail` muestra la paleta en **light**; el toggle la pasa a **dark**; **ninguna ruta existente cambia** de aspecto (route-group aislado, `globals.css` intacto).
- Sin migraciones, sin schema, sin tocar `app/tiendas/**`.

**Tests de C1:** no agrega tests de comportamiento (es CSS + render estático; su verificación es visual por la preview, según la división aprobada). La red de seguridad es `npm run check` verde y la app existente intacta. El harness de tests de comportamiento entra en C2; los primeros tests de componente, en C3.
