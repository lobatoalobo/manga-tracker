# Retail / Preventas — Slice 4: Operación de proveedor y llegada por línea (cumplimiento)

Cuarta slice del dominio Retail. Permite que OWNER/STAFF gestionen el **cumplimiento físico** de cada línea
reservada: pedido al proveedor → llegada a la tienda → (cancelación de pendientes), **por cantidades
parciales**. **NO** hay pagos, comprobantes, retiro, colección automática, notificaciones, WhatsApp,
importación de Excel ni matching (slices posteriores).

## Estado único vs cantidades parciales (§7 — decisión)

Se eligió **Estrategia B (cantidades parciales)**: una tienda real recibe mercadería en tandas. Una línea con
`quantity > 1` puede pedirse/llegar de a partes. Se modela con **tres contadores acumulativos** —
`orderedQuantity`, `arrivedQuantity`, `cancelledQuantity`— como **única fuente de verdad**, y un
`fulfillmentStatus` **derivado** de ellos (persistido solo como índice/display). `pendingQuantity = quantity −
arrived − cancelled` es derivado, no se persiste. `quantity` (dato comercial de Slice 3) es **inmutable**.

## Modelo final

`StoreOrderLine` gana: `fulfillmentStatus`, `orderedQuantity`, `arrivedQuantity`, `cancelledQuantity`,
`orderedAt?`, `arrivedAt?`, `cancelledAt?`, `cancelledByUserId?`, `cancellationReason?`, `updatedAt`. Las
fechas se fijan en la **primera** transición real y no se sobrescriben (`now` inyectado). `cancelledByUserId`
usa **SetNull**.

`StoreOrderLineEvent` (historial inmutable): `id`, `orderLineId`, `type`, `quantity`, `actorUserId?`,
`operationKey` (único), `note?`, `createdAt`. No copia snapshots comerciales (ya viven en la línea). No se
edita ni borra desde la UI.

**Append-only (invariante).** `StoreOrderLineEvent` es estrictamente append-only: ningún flujo hace `UPDATE`
ni `DELETE` de un evento existente (ni por Prisma ni por SQL crudo) — sobre la tabla sólo hay `create` +
lecturas. La historia operativa es **inmutable**; **toda corrección se representa agregando un nuevo evento**
explícito y auditado (p. ej. un `CANCELLED`), nunca editando ni borrando los previos. Los slices posteriores
que reutilizan el ledger (avisos, pagos, preparación/retiro) quedan sujetos a **esta misma regla**.

## State machine y derivación (§4/§8)

Estados de línea: `RESERVED | ORDERED | ARRIVED | CANCELLED`. Se **derivan** de los contadores:

```
CANCELLED   si cancelled == quantity
ARRIVED     si arrived > 0 y arrived + cancelled == quantity
ORDERED     si ordered > 0 o arrived > 0
RESERVED    en otro caso
```

Invariantes: `0 ≤ arrived ≤ ordered ≤ quantity`, `0 ≤ cancelled ≤ quantity`, `arrived + cancelled ≤
quantity`. Transiciones representadas por las operaciones: `applyOrdered` (sube ordered), `applyArrived`
(sube arrived; **llegada directa** permitida ⇒ auto-sube ordered), `applyCancelled` (sube cancelled sobre
unidades **pendientes**; baja ordered en tránsito con clamp). `ARRIVED` y `CANCELLED` son terminales (no hay
reversión: si hace falta corregir, será una operación explícita y auditada de una slice futura).

## Eventos e idempotencia (§9/§22)

Cada operación registra un evento inmutable (`MARKED_ORDERED | MARKED_ARRIVED | CANCELLED`) con la cantidad y
el actor.

### Qué representa `operationKey`

Es el identificador de **un intento lógico** de operación administrativa (una pulsación de "Registrar
llegada", etc.). No es un dato libre confiable: el servidor **siempre** valida actor, tienda derivada de la
línea, tipo, cantidad, estado de línea/orden/campaña — la key solo decide si un reintento es el **mismo**
intento o uno nuevo.

### Ciclo de vida de la clave en la UI

`LineFulfillmentControls` guarda una clave **viva por operación** en un `ref`:
- se genera al primer clic si no hay clave viva para esa operación;
- se **reutiliza** en todo reintento (doble clic, reenvío, respuesta perdida) → mismo intento lógico;
- se **conserva** mientras el resultado sea **incierto** (throw de red/desconocido: el handler la mantiene);
- se **rota** solo tras un resultado **definitivo** (éxito o error de dominio).

`useTransition` evita el doble submit **visual**, pero NO es la garantía de idempotencia: la integridad la dan
la clave estable + el servidor. Un doble clic reutiliza la misma clave de forma síncrona (antes de que
`pending` cambie), así que aun sin el `disabled` no se duplica.

### Retry con respuesta perdida

Si el Server Action responde pero la respuesta se pierde, el reintento reusa la clave: el servidor encuentra el
evento ya escrito y devuelve el estado **idempotente** (misma línea + tipo + cantidad), sin segundo evento ni
segunda aplicación.

### Conflicto de payload (idempotencia ≠ dos operaciones distintas)

`reconcileOperationKey` (dominio, puro) compara el evento existente con la operación pedida:
- **misma** línea + tipo + cantidad → idempotente (devuelve el estado actual);
- **cualquier** discrepancia → `OPERATION_KEY_CONFLICT`.

Así, una clave reutilizada con otra cantidad u otro tipo (por accidente o abuso) **falla**, no devuelve éxito
silencioso. Dos operaciones administrativas intencionalmente distintas (p. ej. "llegaron 2" y luego "llegaron
3 más") usan **claves distintas** y son dos eventos legítimos.

### Concurrencia y P2002

La lectura del evento y la aplicación ocurren **en la misma transacción**, tras bloquear la línea con `SELECT
… FOR UPDATE` (los reintentos con la misma key se serializan). Una carrera que igual inserte dos veces la
misma key produce `P2002`, que se traduce con la **misma** semántica: idempotente si coincide el payload,
`OPERATION_KEY_CONFLICT` si no. Nunca se depende del mensaje de Prisma como contrato.

### Alcance de unicidad — decisión

`operationKey` se mantiene **globalmente única** (`@@unique([operationKey])`). Las claves son UUID de alta
entropía generados por intento, así que una compuesta `(orderLineId, operationKey)` no aporta (la colisión
entre líneas es imposible en la práctica) y la global simplifica el retry. Reusar una clave en otra línea se
detecta como conflicto (la línea del evento no coincide). No se cambia sin necesidad.

## Cancelación de línea vs orden vs campaña (§5/§12/§18)

- **Línea**: `cancelOrderLineQuantity` cancela solo unidades **pendientes** (nunca las ya llegadas). Permitida
  aun con campaña `CANCELLED` (para resolver actividad).
- **Orden** (`cancelStoreOrder`/`cancelCustomerOrder`): MVP **seguro** → solo si la orden está `RESERVED` y
  **ninguna** línea tiene operación física iniciada (`ORDER_FULFILLMENT_STARTED` si empezó). Cancelar la orden
  cancela por completo sus líneas (evento por línea). El cliente además exige campaña abierta (Slice 3). No se
  cancela automáticamente lo ya pedido: la tienda debe cancelar esas unidades por línea primero.
- **Campaña** (`cancelPreorderCampaign`): se **rechaza** si hay órdenes activas (`CAMPAIGN_HAS_ACTIVE_ORDERS`);
  sin órdenes activas, cancela normalmente. No hay cancelación masiva automática.

## Permisos (§11)

OWNER y STAFF: marcar pedido, registrar llegada, cancelar unidades/líneas, consultar historial y la vista
agregada. Autorización por `storeId` **derivado** de la orden/campaña (nunca del slug/ids del cliente),
`requireEnabled:false` → la operación física continúa aunque el comercio esté deshabilitado. El **cliente**
ve el estado operativo de sus propias líneas pero **no lo modifica**. Una tienda no opera líneas de otra.

## Resumen derivado de orden (§13)

`getOrderFulfillmentSummary(lines)` (puro, no se persiste): `NOT_STARTED | IN_PROGRESS | FULLY_ARRIVED |
PARTIALLY_CANCELLED | FULLY_CANCELLED`. Se usa como badge en la UI de cliente y tienda.

## Campaña cerrada vs cancelada (§17/§19)

```
campaña CLOSED    = venta cerrada (no acepta nuevas reservas) → el cumplimiento CONTINÚA.
campaña CANCELLED = no se permiten pedido/llegada; solo cancelaciones para resolver actividad.
```

Cerrar una campaña con órdenes activas sigue permitido y no toca las líneas ni las reservas.

## Estado visible al cliente (§14)

En el detalle de su orden se muestra por línea: reservado, pedido, **parcialmente recibido** (`Recibido X de
N`), **llegó a la tienda**, cancelado; y el resumen de la orden. Deliberadamente **no** dice "listo para
retirar" cuando llega: el retiro/pago son slices futuras. Texto: **"Llegó a la tienda"**.

## UI administrativa (§15/§16)

- Detalle de orden (`…/ordenes/[orderId]`): por línea, contadores (reservado/pedido/llegó/cancelado/pendiente),
  estado, fechas, historial e **acciones con cantidad explícita** (Marcar pedido / Registrar llegada / Cancelar
  pendiente). Cada acción opera **una** línea (sin submit ambiguo).
- Vista agregada por oferta (`…/[campaignId]/cumplimiento`): demanda de la campaña agrupada por `offerId`
  (reservado/pedido/llegado/cancelado/pendiente + nº de órdenes). Suma solo órdenes **no canceladas**.

## Servicios (§10)

`markOrderLineOrdered`, `markOrderLineArrived`, `cancelOrderLineQuantity`, `getOrderLineHistory`,
`getCampaignFulfillment` (infra `lib/retail/fulfillment.ts`). Dominio puro en `lib/domain/retail/fulfillment.ts`
(contadores, derivación, resumen). Toda operación: resuelve la línea → deriva `storeId` → autoriza → lock
`FOR UPDATE` → valida dentro de la tx → actualiza contadores + estado + fechas → crea evento.

## Migración y backfill (§24)

Aditiva y gated (`20260728000000_preorder_fulfillment`). Columnas nuevas con defaults seguros para líneas
existentes: `fulfillmentStatus='RESERVED'`, contadores `0`. `updatedAt` se agrega con `DEFAULT
CURRENT_TIMESTAMP` (backfill) y luego se le hace `DROP DEFAULT` para coincidir con `@updatedAt` (sin drift).
Tabla `StoreOrderLineEvent` con `operationKey` único, índices `(orderLineId, createdAt)` y `actorUserId`, FKs
Line→Event **Cascade** y Actor→User **SetNull**. Sin churn ajeno.

## Compatibilidad con Merge

`StoreOrderLine`/eventos **sobreviven** a la absorción de un Work (re-parenta `PublisherEdition.workId`;
`Volume.id` no cambia). Cubierto por test.

## Qué queda expresamente para slices futuras

Aviso de llegada, pago, comprobantes, preparación, retiro, colección automática (`OwnedVolume`/`Purchase`),
Excel y matching. Reversión auditada de transiciones terminales. Estados de pago/retiro en `StoreOrder`.
