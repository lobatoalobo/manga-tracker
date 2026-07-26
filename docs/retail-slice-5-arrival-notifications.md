# Retail / Preventas — Slice 5: Avisos de llegada al cliente

Quinta slice del dominio Retail. Permite que OWNER/STAFF identifiquen qué clientes deben ser informados
cuando llegan unidades de sus preventas, generen un mensaje sugerido, lo copien, marquen el aviso como
enviado **manualmente** y conserven historial. El cliente ve en Nakama qué líneas llegaron y los avisos ya
enviados. **NO** hay envío externo automático (WhatsApp/email/SMS/push), pagos, comprobantes, preparación,
retiro, colección automática, Excel ni matching.

## Llegada ≠ comunicación (principio central)

`StoreOrderLine.arrivedQuantity` es **operación física** (Slice 4). El aviso es **comunicación** y tiene su
propio estado e historial. Que una línea esté ARRIVED **no** implica que el cliente fue informado. Los avisos
**no** modifican los contadores de fulfillment ni el estado comercial de `StoreOrder`.

## Unidad de notificación (§4 — decisión)

El aviso se registra a **nivel de ORDEN** (`StoreOrderNotification`) pero contiene **ítems concretos**
(`StoreOrderNotificationItem`: línea + cantidad informada). Así una tienda puede agrupar varias líneas
llegadas en distintos momentos en un solo mensaje, sin perder trazabilidad de qué se informó por línea.

## Modelo

- **`StoreOrderNotification`** (aggregate): `orderId`, `type` (ARRIVAL), `status` (DRAFT|SENT|CANCELLED),
  `channel` (MANUAL), `recipientSnapshot?`, `messageSnapshot` (texto plano confirmado), `createdByUserId?`,
  `sentByUserId?`, `sendOperationKey?` (único), fechas. Cuelga de `StoreOrder` (**Restrict**).
- **`StoreOrderNotificationItem`**: `notificationId`, `orderLineId`, `quantity`. No copia precios. FK
  Item→Notification **Cascade**, Item→Line **Restrict**. `@@unique([notificationId, orderLineId])`.

Canales/tipos futuros (WHATSAPP/EMAIL/SMS/PUSH) quedan **documentados pero no usados**: esta slice persiste
solo `ARRIVAL` / `MANUAL`.

## State machine (§9)

```
DRAFT → SENT
DRAFT → CANCELLED     (SENT y CANCELLED son terminales)
```

No se edita tras `SENT`; no se reenvía ni reabre. Una segunda comunicación legítima = una **notificación
nueva**. Solo un `DRAFT` es editable/cancelable.

## Cantidades informadas / pendientes (§7)

No hay contador en la línea: se **deriva** de los ítems de avisos **SENT**:

```
notifiedArrivalQuantity(line)    = Σ NotificationItem.quantity de avisos ARRIVAL SENT de esa línea
unnotifiedArrivalQuantity(line)  = max(0, arrivedQuantity − notified)
```

Los `DRAFT` y `CANCELLED` **no** consumen unidades. Invariante `0 ≤ notified ≤ arrived`.

## Mensaje sugerido y snapshots (§10/§11)

`buildArrivalMessage` arma el texto desde nombre del cliente, tienda, líneas+cantidades (título/volumen de
snapshots) y `publicCode`. **Solo** confirma que la mercadería llegó a la tienda: no menciona monto, alias,
pago, "listo para retirar", horarios, dirección ni vencimientos. OWNER/STAFF pueden editar el texto (máx.
2000, **sin HTML**: se neutralizan `<`/`>`). `messageSnapshot` guarda el texto exacto confirmado.
`recipientSnapshot` = `customerNameSnapshot` (o el email histórico si es lo único). **No se inventa
teléfono**: la futura integración con WhatsApp necesitará un número explícito y consentimiento.

## Envío manual e idempotencia (§13)

"Copiar mensaje" es **solo UI** (no registra envío; la UI lo aclara). "Marcar como enviado" es una acción
explícita con `sendOperationKey` **estable por intento** (patrón de Slice 4): se reutiliza en reintentos y se
rota tras un resultado definitivo. Semántica: misma clave + misma notificación → idempotente; clave de otra
notificación → `NOTIFICATION_OPERATION_KEY_CONFLICT`; una notificación ya `SENT` con otra clave →
`NOTIFICATION_ALREADY_SENT`. El `P2002` sobre `sendOperationKey` se traduce con la misma semántica (sin
exponer Prisma).

## Concurrencia (§14)

Crear un borrador **no** bloquea unidades (validación soft). La validación **definitiva** ocurre al ENVIAR,
dentro de la transacción: se bloquea la orden (`FOR UPDATE`) y sus líneas, se recalcula lo ya informado por
otros avisos SENT y se verifica disponibilidad. Si otro aviso consumió las unidades primero →
`ARRIVAL_NOTIFICATION_EXCEEDS_PENDING` / `ARRIVAL_ALREADY_NOTIFIED`. El doble submit de "marcar enviado" es
idempotente por la clave + el estado + el lock.

## Cancelación de orden y borradores (§15)

Los avisos `SENT` conservan su historial (no se borran ni cancelan). La cancelación completa de orden sigue
gobernada por fulfillment (solo si no comenzó). **Decisión MVP:** si existiera un `DRAFT`, la cancelación de
orden lo **cancela automáticamente** en la misma transacción. En la práctica, un `DRAFT` implica
`arrivedQuantity > 0`, y una orden con fulfillment iniciado **no** puede cancelarse (`ORDER_FULFILLMENT_STARTED`);
por eso el auto-cancelado es defensivo (borde). Las notificaciones no modifican contadores de fulfillment.

## Campaña cerrada / cancelada (§17)

```
campaña CLOSED    = venta cerrada → se pueden crear y enviar avisos de órdenes existentes.
campaña CANCELLED = no acepta nuevas llegadas, PERO se puede informar unidades ya llegadas de órdenes activas
                    (la comunicación resuelve una obligación previa).
```

## Permisos y privacidad (§18/§24)

OWNER/STAFF (por `storeId` derivado de la notificación/orden, `requireEnabled:false`): ver pendientes, crear/
editar/cancelar borradores, marcar enviados, ver historial. **Cliente**: solo ve avisos `SENT` de sus propias
órdenes (nunca borradores, actor interno, claves ni notas); no modifica nada. Una tienda no accede a avisos de
otra. El `messageSnapshot` puede contener nombre/email; no se incluye dirección, DNI, teléfono ni alias de
pago. **Retención:** al borrarse una cuenta, `createdByUserId`/`sentByUserId` pasan a NULL (SetNull) pero el
aviso y su `messageSnapshot` se **preservan** como historial comercial de la tienda.

## Vista agregada (§22)

En cumplimiento por campaña se agregan por oferta **Informado** (Σ ítems SENT) y **Llegó sin informar**
(`arrived − informado`). No se mezcla "informado" con "retirado" ni se agregan métricas de pago.

## Servicios

`getOrderArrivalNotificationPreview`, `createArrivalNotificationDraft`, `updateArrivalNotificationDraft`,
`markArrivalNotificationSent`, `cancelArrivalNotification`, `listOrderNotifications`, `getOrderNotification`,
`listPendingArrivalNotifications` (`lib/retail/notifications.ts`); dominio puro en
`lib/domain/retail/notification.ts`.

## Rutas

- Admin: sección "Avisos al cliente" en `…/ordenes/[orderId]`; lista de pendientes en
  `…/[campaignId]/avisos`; columnas Informado/Sin informar en `…/[campaignId]/cumplimiento`.
- Cliente: sección "Avisos de la tienda" (SENT) en `/mis-compras/preventas/[publicCode]`.

## Qué queda expresamente fuera

API de WhatsApp, email automático, SMS, push, pagos, comprobantes, preparación, retiro, colección automática
(`OwnedVolume`/`Purchase`), Excel y matching. Edición de la selección de un borrador (se cancela y se crea uno
nuevo). Reenvío de un aviso SENT.
