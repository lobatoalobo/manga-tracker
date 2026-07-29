# Retail / Preventas — Slice 7: Preparación y retiro

Séptima slice del dominio Retail. Permite que OWNER/STAFF **preparen** (aparten/embolsen) las unidades
llegadas de una orden y **registren el retiro** cuando el cliente se las lleva, con parciales y múltiples
veces. El cliente ve, de solo lectura, cuánto está preparado, listo para retirar y retirado. **NO** hay
gate de pago, allocation, reversa, comprobante de entrega, ni escritura en la colección del usuario.

## Continuación outbound del ciclo físico (principio central)

Preparación y retiro son la **continuación** del mismo ciclo físico por LÍNEA que abrió la Slice 4
(`reserved → ordered → arrived`). La unidad sigue: `arrived → prepared → picked_up`. **No** es un eje
ortogonal nuevo (eso es el pago, Slice 6). Se reutiliza toda la máquina de Slice 4: contadores por línea como
fuente de verdad, ledger inmutable `StoreOrderLineEvent`, idempotencia por `operationKey`, locks `FOR UPDATE`
y traducción de `P2002`.

## Modelo

- **`StoreOrderLine`** suma dos contadores: `preparedQuantity`, `pickedUpQuantity` (default 0). Son la verdad;
  los estados se **derivan** al leer y **no se persisten**. **No** se agregan `preparedAt`/`pickedUpAt` (el
  ledger ya tiene los timestamps; un campo único sería ambiguo con parciales).
- **`StoreOrderLineEvent`** suma dos tipos: `PREPARED`, `PICKED_UP` (columna `type` es TEXT sin CHECK → sin
  cambio de tipo SQL). Los eventos `PICKED_UP` **no** pueblan `note`.
- **`StoreOrder`**: sin cambios (ningún estado ni fecha de retiro). El estado de retiro se deriva.

## Invariantes

```
0 ≤ pickedUpQuantity ≤ preparedQuantity ≤ arrivedQuantity ≤ quantity − cancelledQuantity
lineComplete ⇔ (arrivedQuantity + cancelledQuantity == quantity) ∧ (pickedUpQuantity == arrivedQuantity)
```

Preservados por **todas** las transiciones, incluidas las de Slice 4: `arrived` solo crece y nunca decrece;
la cancelación actúa solo sobre el *pending* (no llegado) → nunca se solapa con `prepared`/`pickedUp`. Por eso
las operaciones `ordered/arrived/cancelled` de Slice 4 **no requieren cambios**.

## Cantidades y estados derivados (no persistidos)

```
preparableQuantity     = arrivedQuantity − preparedQuantity     (llegado sin preparar)
pickupableQuantity     = preparedQuantity − pickedUpQuantity     (preparado sin retirar)
pendingArrivalQuantity = quantity − arrivedQuantity − cancelledQuantity
```

**Línea** (`deriveHandoffLine`): expone cantidades + flags (`hasUnprepared`, `hasReadyToPickup`, `hasPickedUp`,
`lineComplete`). **No hay enum único de línea** — induciría textos engañosos con parciales.

**Orden** (`getOrderHandoffSummary` → `ORDER_HANDOFF`), separado del resumen inbound de fulfillment:
```
1. A==0 ∧ P==0 ∧ U==0            → NOT_STARTED
2. Q>0 ∧ A+C==Q ∧ U==A           → COMPLETED
3. (P − U) > 0                   → READY_FOR_PICKUP
4. otro                          → IN_PROGRESS
```
`COMPLETED` es el ÚNICO que se muestra como "Pedido entregado". **Nunca** se muestra "entregado" por haber
retirado solo todo lo llegado hasta ese momento si aún quedan unidades por llegar (queda `IN_PROGRESS`).

- "No queda nada listo para retirar ahora" = `(P − U) == 0` (transitorio) ≠ "la orden terminó" = `COMPLETED`.

## Operaciones

**Individuales** (lock de la línea):
```
prepareOrderLine(lineId, quantity, actorUserId, operationKey)
pickupOrderLine (lineId, quantity, actorUserId, operationKey)
```
Autorizan OWNER/STAFF (`storeId` derivado de la orden, `requireEnabled:false`); guard `ORDER_CANCELLED`;
reconcile de `operationKey` antes de aplicar; validación contra contadores frescos; update del contador +
creación del evento en la **misma transacción**; `P2002` traducido.

**Masivas** (payload explícito inmutable; lock orden → todas las líneas asc; una transacción):
```
prepareOrderLines(orderId, items:{orderLineId, quantity}[], actorUserId, batchOperationKey)
pickupOrderLines (orderId, items:{orderLineId, quantity}[], actorUserId, batchOperationKey)
```
`item.quantity` es un **delta** del intento (unidades a preparar/retirar ahora), **no** un total acumulado.
El servidor **nunca** recalcula el alcance ni agrega líneas ausentes; procesa exactamente `items`. Validaciones:
vacío → `EMPTY_HANDOFF_BATCH`; duplicados → `DUPLICATE_HANDOFF_ITEM`; línea ajena → `ORDER_LINE_NOT_FOUND`;
cantidades enteras ≥ 1; cada delta válido contra los contadores actuales.

## Idempotencia

- **Individual:** misma `operationKey` + mismo `{línea, tipo, cantidad}` → idempotente; distinta cantidad →
  `OPERATION_KEY_CONFLICT`. `P2002` sobre `operationKey` → reconcilia o conflicto (sin exponer Prisma).
- **Masiva:** clave determinística por item `${batchOperationKey}:${prepare|pickup}:${orderLineId}`; reconcile
  por item contra la cantidad **inmutable** del payload. Un retry con payload idéntico es no-op idempotente
  (aunque hayan llegado o se hayan preparado unidades nuevas en el medio). Reusar la clave con una cantidad
  distinta → `OPERATION_KEY_CONFLICT`.
- **UI:** clave estable por intento en un `ref`; se conserva mientras el resultado sea incierto y se rota tras
  un resultado definitivo. Las masivas construyen `items` UNA vez desde el snapshot visible.

## Concurrencia y orden de locks

- Individuales: lock **solo de la línea** (`FOR UPDATE`).
- Masivas: lock de la **orden primero**, luego **todas las líneas** de la orden en orden ascendente de id.
- Sin deadlocks nuevos: las individuales nunca piden el lock de orden; dos masivas serializan en la fila de
  orden; masiva vs individual serializan en la línea. Dos operaciones concurrentes legítimas (claves distintas)
  producen una proyección correcta; una masiva con snapshot viejo falla con `EXCEEDS`/`CONFLICT` (retriable),
  sin corromper.

## Ledger

`StoreOrderLineEvent` es el único source of truth histórico. **Nunca** hay contador incrementado sin evento ni
evento sin contador incrementado: ambas escrituras ocurren en la misma transacción. El camino idempotente
saltea ambas. Sin edición ni borrado.

## Permisos y privacidad

OWNER/STAFF: preparar, retirar (individual y masivo), ver el tablero de campaña. Cliente: solo lectura de
preparado/retirado/listo y del estado de retiro de **sus** órdenes; **nunca** `actorUserId`, eventos internos,
`operationKey` ni notas internas. Aislamiento entre tiendas. El cliente no auto-registra retiro.

## Seam futuro de pago (no implementado)

En la rama `PICKUP` de `runHandoffOp` queda marcado el punto único donde iría un gate de pago
(`assertPickupAllowed(order.paymentStatus, policy)`). La Slice 7 **no lo cablea**: el retiro no depende del
pago. La UI muestra `paymentStatus`/saldo de forma **informativa** reutilizando la lectura de Slice 6. El
predicado (orden completa vs allocation por unidades entregadas) se decidirá con evidencia del piloto.

## Seam de colección (Slice 8, IMPLEMENTADO)

El evento `PICKED_UP` es el disparador de la colección automática: lleva `orderLineId` (⇒ `volumeId` vía línea),
`quantity`, `createdAt`, `operationKey` único y —agregado por Slice 8— `ownerUserIdSnapshot` (snapshot estable
del dueño, que hace al hecho autosuficiente). Slice 8 lo proyecta idempotentemente a un modelo de posesión
**propio** (`Acquisition` + `OwnershipPosition`), con retiros parciales y múltiples, intento inmediato + barrido
durable. **No** usa `OwnedVolume`/`Purchase` (eje de identidad incompatible). Retail sigue sin escribir la
colección: la orquestación vive en la server action. Ver `docs/retail-slice-8-collection-projection.md` y ADR-010.

## Alcance excluido

Allocation de pagos, gate de pago, `pickupPaymentPolicy`, `StorePickup`, `recipientNote`, reversa de
preparación/retiro, colección automática, escritura en `OwnedVolume`/`Purchase`, estados de handoff
persistidos, `preparedAt`/`pickedUpAt`, refactors de Slice 4, extracción de un núcleo transaccional compartido
entre fulfillment y handoff.

## Limitaciones conocidas

- Un retiro/preparación mal registrado **no** se corrige in-app en esta slice (la reversa se difiere, como el
  `VOID` de pagos). El contador está modelado para permitir la reversa aditivamente en el futuro.
- Carrera preexistente de `cancelWholeOrder` (lee líneas sin `FOR UPDATE`): es de Slice 4, **fuera de alcance**,
  no introducida ni empeorada por esta slice (prepare/pickup exigen `arrived>0` y `cancelWholeOrder` exige
  `arrived==0`, estados mutuamente excluyentes).
