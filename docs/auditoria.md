# Auditoría integral — Nakama

Fecha: 2026-06-18. Alcance: Dev, QA, seguridad, diseño/accesibilidad, SEO/marketing,
performance. Metodología: lectura de código + cross-check manual de cada hallazgo
crítico (varios reportes automáticos tenían falsos positivos, ver nota al pie).

Severidad: 🔴 Crítico · 🟠 Alto · 🟡 Medio · 🔵 Bajo. Estado: ✅ corregido hoy · ⬜ pendiente.

---

## 1. Seguridad

| # | Sev | Estado | Hallazgo | Ubicación |
|---|-----|--------|----------|-----------|
| S1 | 🔴 | ✅ | `resolveReportAction` mutaba `Report.status` **sin `assertAdmin`**: cualquiera (incluso anónimo, invocando la server action) podía marcar reportes resueltos. | `app/actions.ts` resolveReportAction |
| S2 | 🟠 | ✅ | **IDOR** en `updatePurchase`: el update de ítems usaba `where:{ id }` sin acotar a `purchaseId`, permitiendo sobrescribir ítems de compras de **otros usuarios**. Corregido con `updateMany({ where:{ id, purchaseId } })`. | `lib/purchases.ts` |
| S3 | 🟡 | ✅ | `deleteSubscription` borraba push por `endpoint` sin `userId` → se podía desuscribir el dispositivo de otro. Ahora acotado a `userId`. | `lib/push.ts`, `unsubscribePushAction` |
| S4 | 🟡 | ✅ | Crons `if (secret && …)` quedaban **abiertos si faltaba `CRON_SECRET`**. Ahora **fail-closed** (401 sin secreto). | `app/api/cron/{ivrea-proximas,mangakas}/route.ts` |
| S5 | 🔵 | ⬜ | `searchPurchaseSeriesAction` sin `requireUserId` (solo lectura de catálogo; sin datos privados). Agregar guard por consistencia/abuso. | `app/actions.ts` |
| S6 | 🔵 | ⬜ | `ADMIN_EMAIL` con fallback hardcodeado en el código. Setear la env en prod y, si el repo se hace público, sacar el literal. | `lib/admin.ts` |

**Verificado OK (sin acción):** las 9 páginas `/admin/**` gatean con `isAdmin`; colección pública solo con opt-in (`shareSlug`), sin exponer email; `/api/export` exige sesión; raw SQL parametrizado; **cero** `dangerouslySetInnerHTML`; validación de URLs de comunidad (`safeHttpUrl`); ownership correcto en notes/notifications/social/wishlist/collection.

---

## 2. Manejo de errores y resiliencia (QA/Dev)

| # | Sev | Estado | Hallazgo | Nota |
|---|-----|--------|----------|------|
| E1 | 🟠 | ⬜ | **No hay `error.tsx` en ninguna ruta** (solo `app/global-error.tsx`). Si una page server falla (DB caída, timeout), el usuario ve el error boundary global (pantalla completa) en vez de un error contenido en el layout, con la nav. | Agregar `app/error.tsx` (y por sección crítica). |
| E2 | 🟡 | ⬜ | **No hay `not-found.tsx`** → 404 genérico de Next, sin la nav ni CTA. Hay muchos `notFound()` (fichas, autores). | Agregar `app/not-found.tsx` con CTA a /catalogo. |
| E3 | 🔵 | ⬜ | **No hay `loading.tsx`** → sin skeletons; en conexiones lentas la navegación parece colgada. | Opcional; agregar en /catalogo y /collection. |
| E4 | 🟡 | ⬜ | Degradación silenciosa: en la home, si la búsqueda/fetch falla, el `.catch(()=>[])` muestra "sin resultados" en vez de "error temporal, reintentá". | Distinguir vacío real de error. `app/(browse)/page.tsx` |

---

## 3. Diseño / accesibilidad

| # | Sev | Estado | Hallazgo | Ubicación |
|---|-----|--------|----------|-----------|
| A1 | 🟠 | ⬜ | Portadas que son **contenido** con `alt=""` (lector de pantalla no identifica la serie). | `components/CollectionGrid.tsx` (vista lista), `components/Dashboard.tsx`, avatar en `app/amigos/page.tsx` |
| A2 | 🟡 | ⬜ | **Inputs sin `<label>`** asociado (solo placeholder): formularios de compra, import CSV, buscadores y selects de colección/tiendas. | `components/PurchaseForm.tsx`, `ImportExport.tsx`, `CollectionGrid.tsx`, `StoreList.tsx` |
| A3 | 🟡 | ⬜ | Botones de solo-ícono o de acción sin `aria-label`. | `RemoveWishButton.tsx`, `FriendActions.tsx`, `SeriesNotifManager.tsx` |
| A4 | 🔵 | ⬜ | Estado comunicado solo por color en algunos badges (al-día/incompleta) — sumar texto/ícono. | `MangaCard.tsx`, `CollectionGrid.tsx` |

**Verificado OK:** estados vacíos bien resueltos en /deseados, /faltantes, /compras, /amigos, /notificaciones, /tiendas, /independientes, /collection (doble: vacío vs filtro sin resultados). Feedback de formularios (loading + error) correcto en ReportButton, ProposeStore, PublishIndieWork, PurchaseForm, AddFriend, NoteEditor, ImportExport.

---

## 4. SEO / marketing

| # | Sev | Estado | Hallazgo | Nota |
|---|-----|--------|----------|------|
| M1 | 🟠 | ✅ | **Open Graph + Twitter card** agregados: `/serie/[id]` y `/u/[slug]` (+ `/u/[slug]/[id]`) exponen og/twitter con la **portada real** como imagen → preview al compartir en WhatsApp/Twitter. (Imagen *compuesta* con ImageResponse queda como polish futuro; se evitó por riesgo de fuentes.) | `app/(browse)/serie/[id]`, `app/u/[slug]` |
| M2 | 🟠 | ✅ | `/serie/[id]` ahora usa `generateMetadata` dinámica (título de la obra + descripción desde sinopsis + og:image). | idem |
| M3 | 🟡 | ✅ | `metadataBase` + título/descripción por defecto en el layout (la home hereda un title propio y bueno). | `app/layout.tsx` |
| M4 | 🟡 | ⬜ | Logged-out cae directo al catálogo, **sin landing/hero** con propuesta de valor + CTA de login. | Hero en home pública. |
| M5 | 🔵 | ✅ | Agregados `app/robots.ts` (bloquea privado/admin/api) y `app/sitemap.ts` (rutas públicas + todas las series). | — |

**Verificado OK:** PWA instalable; **íconos PWA existen** (`app/icons/192|512/route.ts` — el reporte automático que decía que faltaban era **incorrecto**); `app/manifest.ts` completo; Sentry integrado.

---

## 5. Performance / escala

| # | Sev | Estado | Hallazgo | Ubicación |
|---|-----|--------|----------|-----------|
| P1 | 🟠 | ⬜ | `/catalogo` manda **hasta 10.000 works** al cliente (`take: 10000`) y filtra/pagina client-side. Payload grande; crece con el catálogo. | `app/(browse)/catalogo/page.tsx`. Paginar server-side o bajar el `take` + carga incremental. |
| P2 | 🟠 | ⬜ | **N+1** en "deseados para comprar": un `findFirst` por cada deseado. | `lib/shopping.ts` getWishlistToBuy → batch con `findMany`+OR. |
| P3 | 🟡 | ⬜ | **N+1** en `syncTrackedTotals` (update por edición trackeada) y en `detectAndNotifyNewVolumes` (varias queries por edición cambiada). Es cron, no hot-path, pero escala mal. | `lib/syncTracked.ts`, `lib/catalogNotify.ts` |
| P4 | 🔵 | ⬜ | 22 usos de `<img>` (no `next/image`): sin lazy-load/AVIF/srcset. | Migrar a `<Image>` (configurar `images` en next.config). |
| P5 | 🔵 | ⬜ | Riesgo histórico: AniList en runtime con rate-limit. Ya **mitigado** en el path local (ver [pre-launch]); queda admin/batch. | — |

---

## 6. Cobertura de tests (Dev)

- Solo 3 tests unitarios de matching (`tests/author-match`, `matching`, `whakoom-parser`). **Cero tests de server actions, autorización, o flujos.** Riesgo de regresión alto en cada cambio.
- No hay E2E. Los planes de [smoke](smoke-tests.md) y [regresión](regression-tests.md) son manuales por ahora; a futuro, automatizar el smoke con Playwright.

---

## Resumen de prioridades pendientes (post-fixes de hoy)

1. ✅ ~~Marketing viral: Open Graph en /serie y /u~~ — HECHO (M1–M3, M5).
2. 🟠 **Resiliencia**: `app/error.tsx` + `not-found.tsx` (E1, E2).
3. 🟠 **Escala**: paginar /catalogo (P1) + batch N+1 de deseados (P2).
4. 🟡 **Accesibilidad**: alt de portadas + labels de inputs (A1, A2).
5. 🟡 **UX**: landing/hero para logged-out (M4).

> Nota de método: los hallazgos S1–S4, P1 y los íconos PWA se verificaron leyendo el
> código directamente. Un reporte automático afirmó que faltaban los íconos PWA y que
> había más actions sin guard: **falsos**. Siempre cross-checkear antes de actuar.
