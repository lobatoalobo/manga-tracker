# Retail Pilot — QA Plan end-to-end (staging)

> **Alcance:** validar en **staging** el flujo comercial completo *preventa → pago → pickup → colección visible* antes del onboarding real de la tienda piloto. **Alcance del piloto = "colección visible"** (el read-side de colección cableado, Fase 1). Este plan es de QA; su ejecución es una fase posterior.

## Convenciones
- **Entorno:** staging (Neon branch `staging`, host `ep-winter-smoke…`), con las 69 migraciones aplicadas.
- **Tienda piloto de prueba:** "Espacio Crumb" (slug `crumb`), sembrada con `node scripts/with-staging.mjs npx tsx scripts/seed-crumb-commerce.ts --owner <email> --slug crumb --enable`.
- **Verificación de Collection (backend):** `Acquisition`/`OwnershipPosition` vía consulta read-only y `scripts/audit-ownership.ts` (`detectOwnershipDrift`).
- **Verificación de Collection (UI):** `/collection` del usuario, ya cableado al read-side unificado (Fase 1) en staging.
- **Sweep:** `curl` autenticado a `GET /api/cron/collection-projection` (`Authorization: Bearer <CRON_SECRET>`).
- **Clave de adquisición esperada:** `retail-pickup:<operationKey>`, `channel=RETAIL_PICKUP`, `occurredAt = createdAt del evento PICKED_UP`.
- **Criterio transversal:** ningún 500 no controlado; los errores esperados deben ser el `RETAIL_ERROR`/`STORE_AUTH_ERROR` correcto.

## Datos de prueba
- Tienda: `crumb`. Usuarios: `owner@qa.dev` (OWNER), `staff@qa.dev` (STAFF), `cliente1/2/3@qa.dev` (clientes), `extrano@qa.dev` (no miembro). ≥6 `Volume` reales para ofertar.

---

## Fase 0 — Preparación
- **TC-0.1 · Paridad de esquema:** `prisma migrate status` en staging → up to date (69). Tablas retail/collection presentes.
- **TC-0.2 · Estado inicial de Collection:** conteo base de `Acquisition`/`OwnershipPosition` de los usuarios QA = 0.
- **TC-0.3 · Fase 1 desplegada en staging:** `/collection` lee el read-side unificado (verificable por equivalencia, TC-13.x).

## Fase 1 — Tienda y habilitación
- **TC-1.1 · Seed de Crumb:** correr `seed-crumb-commerce --owner owner@qa.dev --slug crumb --enable` → `Store "Espacio Crumb"`, `StoreCommerceProfile{slug:crumb, enabled:true}`, `StoreMember{OWNER}`. Idempotente (re-correr no duplica).
- **TC-1.2 · STAFF:** agregar `staff@qa.dev` como STAFF.
- **TC-1.3 · Negativo no-miembro:** `extrano@qa.dev` en `/tiendas/crumb/admin/preventas` → `NOT_A_MEMBER`.

## Fase 2 — Campañas y ofertas (máquina de estados)
- **TC-2.1** Crear campaña DRAFT. · **TC-2.2** Fechas incoherentes → `INVALID_DATES`. · **TC-2.3** Título vacío → `INVALID_TITLE`.
- **TC-2.4** Agregar 3 ofertas ACTIVE (precio preorder ≤ list). · **TC-2.5** Oferta duplicada (mismo Volume) → `OFFER_ALREADY_EXISTS`. · **TC-2.6** Precio inválido → `INVALID_PRICE`.
- **TC-2.7** Ocultar/mostrar/cancelar oferta (ACTIVE↔HIDDEN→CANCELLED; CANCELLED terminal; idempotente).
- **TC-2.8** Publicar sin ofertas activas → `CAMPAIGN_HAS_NO_OFFERS`.
- **TC-2.9** Publicar como OWNER → PUBLISHED, `publishedAt`; re-publicar idempotente.
- **TC-2.10** Publicar como STAFF → `FORBIDDEN_ROLE`.
- **TC-2.11** Editar campos comerciales tras publicar → `CAMPAIGN_NOT_EDITABLE` (solo `description`).
- **TC-2.12** Transición inválida (CLOSED→PUBLISHED / CANCELLED→*) → `INVALID_CAMPAIGN_TRANSITION`.

## Fase 3 — Reservas y multi-usuario
- **TC-3.1** Reserva de cliente → `RESERVED`, `publicCode` único, `totalCents` de servidor, líneas con snapshots.
- **TC-3.2** Total manipulado → `ORDER_TOTAL_MISMATCH`. · **TC-3.3** Segunda reserva mismo usuario/campaña → misma orden (idempotencia).
- **TC-3.4** Multi-usuario: `cliente2`/`cliente3` reservan → 3 órdenes independientes.
- **TC-3.5** Oferta inactiva/de otra campaña → `OFFER_NOT_AVAILABLE`/`OFFER_CAMPAIGN_MISMATCH`.
- **TC-3.6** Tienda deshabilitada al reservar → `STORE_COMMERCE_DISABLED` (re-habilitar después).
- **TC-3.7** Cantidad fuera de rango (>20) → `INVALID_QUANTITY`/`TOO_MANY_ITEMS`.
- **TC-3.8** Cancelación de cliente (campaña abierta, sin pagos/fulfillment) → `CANCELLED`; no re-reservable.

## Fase 4 — Fulfillment (parciales)
- **TC-4.1** Ordered parcial. · **TC-4.2** Arrived (+ llegada directa). · **TC-4.3** Exceso → `INVALID_FULFILLMENT_QUANTITY`. · **TC-4.4** Nada pendiente → `NOTHING_PENDING`. · **TC-4.5** Cancelar unidades pendientes (nunca llegadas). · **TC-4.6** Idempotencia de evento (mismo `operationKey`; distinto payload → `OPERATION_KEY_CONFLICT`).

## Fase 5 — Avisos de llegada
- **TC-5.1** Crear aviso DRAFT. · **TC-5.2** Enviar (SENT terminal; reenvío → `NOTIFICATION_ALREADY_SENT`). · **TC-5.3** Duplicado → `ARRIVAL_ALREADY_NOTIFIED`/`ARRIVAL_NOTIFICATION_EXCEEDS_PENDING`. · **TC-5.4** Idempotencia de envío (`sendOperationKey`).

## Fase 6 — Pagos manuales
- **TC-6.1** Parcial → `PARTIALLY_PAID`. · **TC-6.2** Total → `PAID`. · **TC-6.3** Sobrepago → `OVERPAID`. · **TC-6.4** Monto/método inválidos → `INVALID_PAYMENT_AMOUNT`/`INVALID_PAYMENT_METHOD`. · **TC-6.5** Idempotencia (`recordOperationKey`; divergencia → `PAYMENT_OPERATION_KEY_CONFLICT`). · **TC-6.6** Pago sobre orden cancelada → `ORDER_CANCELLED`.

## Fase 7 — Preparación
- **TC-7.1** Preparar parcial (`prepared ≤ arrived`). · **TC-7.2** De más → `PREPARATION_EXCEEDS_ARRIVED`. · **TC-7.3** Nada para preparar → `NOTHING_TO_PREPARE`.

## Fase 8 — Pickup + proyección inmediata a Collection
- **TC-8.1 · Pickup dispara Collection:** `pickupLineAction` (retiro por `staff`) → evento `PICKED_UP` con `ownerUserIdSnapshot = cliente1`; `Acquisition{retail-pickup:<opKey>, userId:cliente1, RETAIL_PICKUP}`; `OwnershipPosition{cliente1, volumeId}` incrementada. Colección aterriza en **cliente1**, NO en el staff.
- **TC-8.2 · Snapshot = dueño, no actor:** verificar `ownerUserIdSnapshot`/`Acquisition.userId` = cliente1; `actorUserId` = staff.
- **TC-8.3** Pickup excede preparado → `PICKUP_EXCEEDS_PREPARED` (sin escritura en Collection). · **TC-8.4** Nada para retirar → `NOTHING_TO_PICKUP`.
- **TC-8.5 · Idempotencia (pickup doble):** mismo `operationKey` → evento idempotente; proyección → `ALREADY_APPLIED` (posición no cambia).
- **TC-8.6 · Falla aislada de Collection no rompe el pickup:** `projectPickupImmediate` "nunca lanza"; el evento queda pendiente para el sweep.

## Fase 9 — Colección VISIBLE (validación de la Fase 1)
- **TC-9.1 · El comprador ve el tomo:** tras TC-8.1, abrir `/collection` de `cliente1` → el tomo retirado **aparece** en la grilla.
- **TC-9.2 · Sin duplicados:** si `cliente1` ya poseía ese tomo por el modelo legado, aparece **una sola vez** (deduplicación legado↔`OwnershipPosition`).
- **TC-9.3 · Stats coherentes:** los contadores de `/collection` (owned/total, leído) reflejan el ítem nuevo sin romper el cálculo.
- **TC-9.4 · Share:** la vista pública compartida refleja la posesión de forma consistente con `/collection`.

## Fase 10 — Sweep durable + idempotencia
- **TC-10.1** Sweep recupera pendientes (de TC-8.6) → `applied≥1`; `findPendingPickups`=0 después.
- **TC-10.2** Sweep idempotente (2ª corrida) → `applied=0`, sin cambios.
- **TC-10.3** Sweep sin auth → 401. · **TC-10.4** Dos sweeps concurrentes → uno `lockAcquired:true`, otro `false` (sin doble proyección).
- **TC-10.5** Auditoría de drift → 0 MISSING/MISMATCH/ORPHAN_NONZERO.

## Fase 11 — Volumen: multi-campaña, batch, quantity>1
- **TC-11.1** quantity>1 end-to-end (parciales) → `OwnershipPosition.quantity` acumulada; sin drift.
- **TC-11.2** Pickup en batch (`handoffBatchItemKey`) → una `Acquisition` por línea; alcance exacto.
- **TC-11.3** Batch con ítem duplicado/vacío → `DUPLICATE_HANDOFF_ITEM`/`EMPTY_HANDOFF_BATCH`.
- **TC-11.4** Múltiples campañas y pickups → colecciones correctas por usuario; sin cross-contamination.
- **TC-11.5** Mismo Volume por dos usuarios → dos `OwnershipPosition` separadas.

## Fase 12 — Cancelaciones, casos borde y autorización
- **TC-12.1** Cancelar campaña con órdenes activas → `CAMPAIGN_HAS_ACTIVE_ORDERS`.
- **TC-12.2** Cancelar orden con fulfillment iniciado → `ORDER_FULFILLMENT_STARTED`. · **TC-12.3** Con pagos → `ORDER_HAS_PAYMENTS`.
- **TC-12.4** Cancelación de cliente con campaña cerrada → `ORDER_NOT_CANCELLABLE`.
- **TC-12.5** Snapshot corrupto (`ownerUserIdSnapshot=null`, nivel DB controlado) → `CORRUPT_SOURCE` (excluido del anti-join; auditable) *(opcional; cubierto por IT)*.
- **TC-12.6** Cuenta borrada tras pickup → `TERMINALLY_NOT_APPLICABLE`.
- **TC-12.7** Último OWNER → `LAST_OWNER`.
- **TC-12.8** `requireEnabled=true` con tienda deshabilitada → `STORE_COMMERCE_DISABLED`; wind-down (CLOSE/CANCEL/operar órdenes) permitido.
- **TC-12.9** STAFF intenta PUBLISH/CANCEL/DELETE_DRAFT → `FORBIDDEN_ROLE`.
- **TC-12.10** Acceso a orden de otra tienda → denegado (aislamiento por `storeId` derivado).

## Fase 13 — Equivalencia y regresión (read-side)
- **TC-13.1 · Equivalencia:** para un usuario **sin** pickups, `/collection` con el read-side unificado == la vista legada actual (misma serie/edición/orden/conteos). Respaldado por `tests/collection-read-equivalence.integration.test.ts`.
- **TC-13.2 · Suite verde:** `npm run check` + `node scripts/identity-it.mjs` (incluye retail + collection + equivalence) → todo verde.

---

## Salida del QA
- **Aprobación global:** todas las fases con criterio cumplido; **0 drift** (TC-10.5); suite verde (TC-13.2); evidencia de que *cada pickup aterriza en la colección del dueño correcto* (TC-8.1/8.2) **y es visible sin duplicar** (Fase 9); *sweep idempotente* (TC-10.2); *equivalencia legada preservada* (TC-13.1).
- **Registro:** por cada TC, ✅/⚠️/❌ + evidencia (emails QA, sin PII de usuarios reales).
