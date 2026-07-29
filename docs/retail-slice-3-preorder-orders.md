# Retail / Preventas — Slice 3: Reservas (StoreOrder + StoreOrderLine)

Tercera slice del dominio Retail. Permite que un cliente **autenticado** reserve tomos de una campaña de
preventa **abierta**, obtenga una **orden** con sus líneas y precios, y consulte sus órdenes; y que **OWNER/
STAFF** de la tienda vean y cancelen las órdenes de sus campañas. **NO** hay pagos, llegada de mercadería,
retiro, incorporación automática a la colección, notificaciones, WhatsApp, Excel ni matching (slices
posteriores).

## StoreOrder vs Purchase (§4)

Son dominios **distintos** y no se reutiliza uno como el otro:

| | `Purchase` / `PurchaseItem` | `StoreOrder` / `StoreOrderLine` |
|---|---|---|
| Dominio | Historial **personal** que el usuario registra a mano | **Retail**: reserva comercial en una tienda |
| Precio | `Float` (pesos) | **Int centavos** (unidad mínima ARS) |
| Estados | PENDING/SHIPPED/DELAYED/RECEIVED/CANCELLED | **RESERVED | CANCELLED** (esta slice) |
| Dueño del dato | El usuario | La **tienda** (cuelga de `Store`) |

`StoreOrder` **no hereda** estados ni semántica de `Purchase`. En una slice futura, una orden **retirada**
podrá generar `OwnedVolume` y, si se decide explícitamente, un `Purchase` — pero es una decisión posterior,
no un acoplamiento de esta slice.

## Aggregate y fronteras

- **`StoreOrder`** (aggregate root) — reserva de un cliente. Cuelga de **`Store`** (`storeId`, identidad
  durable), **nunca** del perfil comercial. El perfil se consulta solo para habilitación/autorización.
- **`StoreOrderLine`** — un tomo (vía su `PreorderOffer`) con cantidad, **precios y snapshots congelados** al
  reservar. No se re-resuelve del catálogo: la orden muestra sus líneas aunque el catálogo cambie luego.
- **El catálogo no conoce Retail.** Las FKs `StoreOrderLine.volume → Volume` y `→ offer` están **modeladas en
  Prisma** (persistencia, sin drift); las back-relations `Volume.storeOrderLines`, `User.storeOrders`, etc.,
  son metadata del ORM, no dependencias de dominio Catálogo→Retail.

## State machine (§6)

```
RESERVED ──▶ CANCELLED        (CANCELLED es TERMINAL)
```

La orden **nace en RESERVED**. Cancelar es **definitivo** (no se restaura ni se reutiliza). Los estados
operativos (`PENDING_PAYMENT`, `PAID`, `READY_FOR_PICKUP`, `PICKED_UP`) **no existen** todavía: pertenecen a
la slice que implemente la lógica que los produce.

## Una orden por usuario/campaña (§13)

Política **congelada**: `@@unique([campaignId, userId])`. Consecuencia con órdenes canceladas: como la
unicidad es **total** (no parcial), una campaña ya reservada —aunque luego se cancele— **no** se puede volver
a reservar en esta slice. Es una **limitación de MVP deliberada**: "cancelar es definitivo; volver a reservar
tras cancelar queda para una decisión futura". No se usa una unique **parcial** (Prisma no la expresa) para
no introducir drift oculto. Con `userId` NULL (cuenta borrada), Postgres trata los NULL como distintos: no
colisionan órdenes de cuentas eliminadas.

## Idempotencia de confirmación (§14)

Idempotencia **natural** por `@@unique([campaignId, userId])`, sin `reservationKey`:

- doble submit del mismo usuario (doble click / reintento de red / concurrencia) → dentro del lock de la
  campaña, el segundo encuentra la orden **RESERVED** existente y **la devuelve** (misma orden, inmutable);
- una orden **cancelada** no se re-crea → `ORDER_ALREADY_EXISTS`;
- orden + líneas se crean en **una sola transacción** (nested create) → nunca hay órdenes parciales;
- ante carrera perdida, el `@@unique` es el backstop y se traduce a `ORDER_ALREADY_EXISTS`.

## Precios y snapshots (§11/§12)

Al crear la orden se **copian de la oferta**: `unitListPriceCents`, `unitPreorderPriceCents` y los snapshots
(`titleSnapshot`, `volumeNumberSnapshot`, `publisherSnapshot`, `isbnSnapshot`). El servidor calcula
`lineTotalCents = unitPreorderPriceCents × quantity` y `totalCents = Σ líneas`, con **guardas de overflow**
(techo `2.000.000.000` < máx. `int4`). **Nunca** se aceptan precios/total del cliente: un `expectedTotalCents`
opcional solo se **compara** (→ `ORDER_TOTAL_MISMATCH`). Aunque los precios de la oferta estén protegidos
post-publicación (Slice 2), la línea guarda **su propio** snapshot monetario.

## Cantidades (§10) y consolidación (§15)

`quantity ≥ 1`, máximo defensivo **20** por tomo (no es stock ni cupo). Las ofertas repetidas en el request se
**consolidan sumando cantidades** *antes* de validar el máximo. Se rechaza lista vacía (`EMPTY_ORDER`).

## Disponibilidad para reservar (§9)

Se crea orden solo si: comercio **habilitado**, campaña **PUBLISHED**, `isCampaignOpen(campaign, now)` (política
temporal **pura**, `now` inyectado, sin cron), campaña de la tienda de la URL, y **todas** las ofertas
pertenecen a la campaña y están **ACTIVE**. Toda la validación ocurre **dentro** de la transacción que crea la
orden (no se confía en datos validados antes).

## Cancelación (§17) y auditoría (§18)

- **Cliente**: solo su propia orden, solo `RESERVED`, y **mientras la campaña siga abierta**.
- **Tienda (OWNER/STAFF)**: cualquier `RESERVED`, **incluso con el perfil deshabilitado**; el `storeId` se
  **deriva de la orden** (no del slug del cliente).
- Se guarda `cancelledAt`, `cancelledByUserId` y una `cancellationReason` corta opcional. **No** se crea
  `OrderStatusHistory` todavía (MVP); la state machine futura (pago/llegada/retiro) **sí** necesitará auditoría
  completa — se introduce cuando aparezcan esos estados.

## Privacidad (§24)

La UI pública **nunca** expone datos de clientes ni de otras órdenes. El `publicCode` (legible, no enumerable)
**no autoriza**: toda lectura de cliente verifica `order.userId === actor`, y toda lectura de tienda verifica
la **membresía** sobre el `storeId` de la orden. Una tienda no ve órdenes de otra; un cliente no ve las de
otro. Cubierto por tests de aislamiento.

## Matriz de permisos

| Acción | Quién |
|---|---|
| Crear reserva | Cualquier usuario **autenticado** (dueño de su orden) |
| Ver/cancelar orden propia | El **cliente** dueño (`userId === actor`) |
| Ver/cancelar órdenes de la campaña | **OWNER/STAFF** de esa tienda (`requireEnabled:false`) |

## FKs (§25) y snapshot de cliente (§5)

- `StoreOrder.storeId → Store` **Restrict**; `campaignId → PreorderCampaign` **Restrict**.
- `StoreOrder.userId → User` **SetNull** (nullable) — preserva el historial si la cuenta se borra.
- `StoreOrder.cancelledByUserId → User` **SetNull** (auditoría).
- `StoreOrderLine.orderId → StoreOrder` **Cascade**; `offerId → PreorderOffer` **Restrict**;
  `volumeId → Volume` **Restrict**.

Snapshot de cliente = `customerNameSnapshot` + `customerEmailSnapshot` (lo que la tienda necesita para
cumplir). **No** se inventa teléfono/DNI/dirección: no se solicitan aún. Con `SetNull`, el snapshot mínimo
mantiene identificable la orden histórica sin conservar más PII de la necesaria.

## Compatibilidad con Merge

`StoreOrderLine → Volume` **sobrevive** a la absorción de un Work: `absorbWorkInto` re-parenta
`PublisherEdition.workId`; `Volume.id`/`editionId` **no cambian**. La línea sigue apuntando al mismo Volume y
resuelve el Work sobreviviente; además su snapshot conserva el display. Cubierto por test.

## `publicCode` (§5)

`PREFIJO-CUERPO` (ej. `CRU-7K4P2M`). El prefijo se **deriva estable** del slug comercial (no se hardcodea
"Crumb"; relleno neutral `PRV` si el slug no alcanza). El cuerpo: 6 chars de un alfabeto sin ambigüedades
(sin `0/O/1/I/L`), ~1e9 combinaciones → no enumerable. Único por constraint + reintentos de la transacción.

## Concurrencia (§16)

Creación bajo `SELECT … FOR UPDATE` de la campaña → serializa reservas y cierre. Validación **dentro** de la
tx. Cancelación bajo `FOR UPDATE` de la orden. `@@unique` como backstop de unicidad; `P2002` traducido a
códigos de dominio (nunca se expone el mensaje de Prisma).

## Rutas

- Pública (reserva): `/tiendas/[slug]/preventas/[campaignId]` — selector de cantidad + total; exige login para
  confirmar; tras crear redirige a `/mis-compras/preventas/[publicCode]`.
- Cliente: `/mis-compras/preventas` (lista), `/mis-compras/preventas/[publicCode]` (detalle + cancelar).
- Tienda: `/tiendas/[slug]/admin/preventas/[campaignId]/ordenes` (lista),
  `…/ordenes/[orderId]` (detalle + cancelar).

## Qué queda expresamente para próximas slices

Pago, pedido al proveedor, **llegada por línea**, retiro, incorporación automática a la colección
(`OwnedVolume`/`Purchase` opcional), notificaciones, WhatsApp, Excel y matching. Volver a reservar tras
cancelar. `OrderStatusHistory` (auditoría completa) cuando existan los estados operativos.
