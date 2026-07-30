# Retail Slice P0 — Checkout conversacional (CheckoutMode)

> Estado: EN IMPLEMENTACIÓN. Este doc acompaña la implementación y se actualiza con cada tarea (T1–T8).
> Execution Plan congelado aprobado; ver el hilo de decisiones de producto.

## Objetivo
Retail Pilot completamente funcional en **experiencia conversacional**: la tienda configura sus datos de
contacto/pago; el comprador ve —siempre dentro de Nakama— total, estado del pedido y estado del pago, más las
instrucciones para pagar y un botón de contacto por WhatsApp cuando corresponda; la tienda confirma el pago con
el **flujo manual existente** (`registerPayment`). Nakama es la fuente de verdad del pedido.

## Decisiones arquitectónicas (vinculantes)
1. **No `paymentMode`** (mezclaba canal + método + confirmación).
2. **Comunicación ≠ dominio de pago.** WhatsApp/email son metadata de contacto; el comprador permanece en Nakama.
3. **Eje que ramifica la UX = `CheckoutMode`**, proyección MVP de un futuro conjunto `PaymentOption = método ×
   estrategia de confirmación`. **En P0 el único valor es `CONVERSATIONAL`**; la columna se introduce
   forward-ready para que P1 agregue `SELF_SERVICE` de forma aditiva. P0 NO introduce código/UI/validación de
   estados futuros.
4. **Método de pago = eje independiente** (`PAYMENT_METHOD` de registro se conserva; no se suman métodos).
5. **`StorePayment` = único ledger.** Toda confirmación termina en `registerPayment`. `projection`/`pickup`/
   `collection` permanecen desacoplados (solo se acoplan a `PICKED_UP`, no al pago).

## Alcance
`checkoutMode` por tienda (columna, default `CONVERSATIONAL`, no editable en P0); configuración de datos de
contacto/pago (reusa `whatsapp`/`paymentAlias`/`paymentInstructions`/`pickupInstructions`/`publicDescription`);
UI de edición (hoy read-only); visualización al comprador (total/estado pedido/estado pago/instrucciones/alias/
datos de transferencia/botón WhatsApp); integración con el pago manual existente.

## Fuera de alcance (P1)
`SELF_SERVICE`; comprobantes; subida/revisión/aprobación/rechazo; Mercado Pago; Stripe; múltiples métodos;
notificaciones push del pago; campos bancarios estructurados adicionales.

## Dominio
- `lib/domain/retail/checkout.ts`: `CHECKOUT_MODE = { CONVERSATIONAL }` + `DEFAULT_CHECKOUT_MODE`. Puro, sin
  validación de estados futuros.

## Despliegue (runbook migrate-first)
La migración de `checkoutMode` es **aditiva/expand-only** (columna con default). **Aplicar la migración a
producción ANTES de desplegar el código** que la lee (evita la clase de incidente "código adelantado al
esquema" → `P2022`). Rollback: código = revert/promote; datos = ninguno; esquema = la columna puede permanecer.

## Estado por tarea
- **T1 — Dominio + doc inicial:** hecho.
- **T2 — Esquema + migración aditiva:** hecho. `StoreCommerceProfile.checkoutMode TEXT NOT NULL DEFAULT 'CONVERSATIONAL'` (migración `20260802000000_retail_checkout_mode`, expand-only). Valida desde cero en el harness. NO aplicada a staging/prod (deploy-time, migrate-first).
- **T3 — Servicio de configuración:** hecho. `lib/storeCommerce.ts::updateCommerceData` ya cubría los campos de contacto/pago de P0 (whatsapp/paymentAlias/paymentInstructions/pickupInstructions/publicDescription) → sin cambios en el servicio. `checkoutMode` NO es editable en P0 (valor único). La **autorización OWNER** vive en la server action (T6), según la convención existente (el servicio asume caller ya autorizado). Cobertura: test de round-trip + default de checkoutMode agregado a `tests/store-commerce.integration.test.ts`.
- **T4 — Reader del comprador:** hecho. `lib/retail/orders.ts::getCustomerOrder` expone `store.commerceProfile.{checkoutMode, whatsapp, paymentAlias, paymentInstructions}` (solo campos públicos; no filtra notas internas del pago). Test agregado en `tests/retail-orders.integration.test.ts` (+ fix de cleanup: borrar `StorePayment` antes que la orden). 263 IT verdes.
- **T5 — Helper de contacto WhatsApp:** hecho. `lib/retail/contact.ts::whatsappOrderLink(profile, order)` (puro): `https://wa.me/<phone dígitos>?text=<publicCode + total>`; null si no hay teléfono válido (botón oculto); teléfono siempre el de la tienda. Unit `tests/retail-contact.test.ts` (789 unit verdes).
- **T6 — UI de configuración de tienda + server action:** hecho. `app/tiendas/[slug]/admin/configActions.ts` (`updateCommerceDataAction`, autoriza **OWNER** dentro de la action, `revalidatePath`) + `CommerceConfigForm.tsx` (client, `useTransition`, sin selector de checkoutMode) + `page.tsx` (OWNER edita, STAFF read-only). tsc limpio.
- **T7 — UI de detalle del comprador (bloque "Cómo pagar"):** hecho. `app/mis-compras/preventas/[publicCode]/page.tsx`: bloque server-rendered con total + alias + instrucciones + botón WhatsApp (`whatsappOrderLink`), visible en RESERVED no pagada con datos o teléfono. Total/estado pedido/estado pago siguen siempre visibles. Sin ramificación por modo (P0 = conversacional). tsc limpio.
- **T8 — Regresión + cierre de doc:** hecho. `npm run check` (tsc + 789 unit) y `node scripts/identity-it.mjs` (263 IT, 22 files) verdes sobre el estado final. Sin suites de integración nuevas → sin cambios en el runner.

## Cierre del slice
Implementación de P0 completa en la rama `feat/retail-p0-conversational-checkout` (desde `origin/main` = `e8d9a79`). Commits pequeños por tarea (T1–T8). `projection`/`pickup`/`collection` sin tocar (suites verdes = desacople). **Pendiente (deploy-time, requiere autorización):** aplicar la migración `20260802000000_retail_checkout_mode` a producción **ANTES** de desplegar el código (migrate-first), QA en staging (conversacional), PR/merge. NO empujado / sin PR / sin deploy.
