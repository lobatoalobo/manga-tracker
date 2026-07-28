# ADR-010: Proyección de colección automática (Slice 8) — ledger-as-outbox e idempotencia transaccional

- **Estado**: Aceptado — **IMPLEMENTADO** (Slice 8 cerrada; `npm run check` + harness de integración completo verdes, migración aplicada desde cero en efímero/staging; prod = checkpoint de deploy). Ver `docs/retail-slice-8-collection-projection.md`.
- **Fecha**: 2026-07.
- **Relacionado**: docs/retail-slice-7-preparation-pickup.md (evento fuente `PICKED_UP`), arquitectura de dominio de Slice 8 (congelada: `Acquisition` + `OwnershipPosition`), ADR-007 (familias de proyección de Apply, patrón reconcile).
- **Ámbito**: decisiones técnicas para materializar automáticamente en la colección del usuario las unidades retiradas en Retail, respetando **íntegramente** el modelo de dominio congelado, sin modificarlo. Cubre persistencia, entrega durable, idempotencia transaccional, concurrencia, reconstrucción y lectura mínima.

---

## Contexto

El dominio de Slice 8 quedó congelado con dos conceptos:

- **`Acquisition`** — hecho histórico inmutable e idempotente de entrada de unidades.
- **`OwnershipPosition`** — Aggregate Root deliberadamente pequeño de `(userId, volumeId)` que **aplica** adquisiciones de forma consistente e idempotente; `quantity` es fuente de verdad persistida y reconstruible como `Σ Acquisition`.

Garantías del dominio que el diseño técnico no puede violar: Retail commitea primero; Collection consume solo pickups confirmados; la incorporación debe ser **durable, idempotente y reprocesable**; consistencia eventual; Retail y Collection no se importan entre sí. Se resolvió el fork de convivencia con lo legado a favor de la **opción (A)**: Slice 8 escribe **exclusivamente** el modelo nuevo, sin dual-write hacia `OwnedVolume`.

---

## Problema

1. ¿El ledger de `PICKED_UP` puede oficiar de outbox durable, dado que `userId`/`volumeId` no viven en el evento sino que se derivan de `StoreOrderLine`/`StoreOrder`?
2. ¿Cuál es el algoritmo transaccional **real** de idempotencia en PostgreSQL, sabiendo que una violación de unicidad aborta la transacción y no se puede continuar en ella?
3. ¿Qué atributos componen el payload de reconciliación?
4. ¿Cuál es la lectura mínima que valida la slice sin convertirse en una UI de colección completa?

---

## Premisas verificadas en el código real

Condición para usar el ledger como outbox (§1): el hecho publicado debe seguir siendo recuperable y semánticamente inmutable después del pickup. Verificado sobre `prisma/schema.prisma` y `lib/retail/*`:

| Pregunta | Hallazgo | Fuente |
|---|---|---|
| ¿Se puede eliminar una `StoreOrderLine`? | **No en producción.** No hay `delete`/`deleteMany` de líneas/órdenes en código de producción (solo cleanup de tests). Cancelar es soft (`status=CANCELLED`). `order → StoreOrder onDelete: Cascade`, pero la orden no se hard-deletea; órdenes con avisos/pagos son `Restrict`. | schema `StoreOrder`/`StoreOrderLine`; `lib/retail/orders.ts` |
| ¿Puede cambiar su `volumeId`? | **No.** Snapshot congelado al reservar ("no se re-resuelve desde el catálogo"); ningún `update` de producción lo toca. `volume Volume @relation(onDelete: Restrict)` → el `Volume` referido no puede desaparecer. | schema `StoreOrderLine` (l. 895, 925) |
| ¿Puede cambiar de orden (`orderId`)? | **No.** Nunca se actualiza; `@@unique([orderId, offerId])`. | schema `StoreOrderLine` (l. 930) |
| ¿Puede cambiar el dueño de la `StoreOrder`? | **Parcialmente.** No se reasigna a otro usuario (se fija al crear en `createOrder`; el único `storeOrder.update` toca solo cancelación). La **única** mutación posible es `userId → NULL` vía `onDelete: SetNull` al borrar la cuenta. | schema `StoreOrder` (l. 851, 868); `lib/retail/orders.ts:137,211` |
| ¿Qué pasa con los eventos históricos ante borrado/modificación? | **Sobreviven.** Sin hard-delete de orden/línea en producción; `StoreOrderLineEvent` es inmutable, sin edición ni borrado desde UI/servicios; `operationKey` único; `createdAt` fijo. | schema `StoreOrderLineEvent` (l. 940-956) |

**Conclusión de la verificación:** las relaciones necesarias son inmutables y preservadas, con **un único borde**: `StoreOrder.userId` puede pasar a `NULL` tras el borrado de cuenta. Como el proyector derivaba `userId` de esa relación nullable, el hecho publicado **no era completamente autosuficiente**: si la cuenta se elimina entre la confirmación del pickup y su proyección, el evento confirmado perdería al destinatario histórico. Se cierra endureciendo el **hecho fuente** con un snapshot estable del propietario (D1.b) — no requiere tabla outbox nueva ni cambio del modelo de dominio de Collection —, y con terminalidad derivada para el destino ya eliminado (D1.c), consistente con la FK del modelo nuevo (D6).

---

## Decisión

### D1 — Ledger-as-outbox aprobado, con hardening del hecho fuente (sin tabla outbox nueva)

**a.** La fuente de entrega durable son las filas `PICKED_UP` ya committeadas de `StoreOrderLineEvent`: append-only, atómicas con el contador, `operationKey` único, sin edición ni borrado. Es el hecho publicado de Retail. No se agrega segunda tabla outbox (redundante; el ledger ya da durabilidad, orden y unicidad).

**b. Autosuficiencia del hecho — snapshot del propietario.** La verificación halló el único punto donde el hecho no era autosuficiente: `userId` se reconstruía desde `StoreOrder.userId`, nullable (`SetNull` al borrar la cuenta). Corrección **mínima y aditiva en Retail** (no es outbox nueva ni toca el dominio de Collection): el evento `PICKED_UP` conserva un **snapshot estable del propietario al momento del hecho**.

- `StoreOrderLineEvent.ownerUserIdSnapshot` (`String?`), **sin FK** — snapshot puro, siguiendo la convención existente `customerNameSnapshot`/`customerEmailSnapshot` de `StoreOrder` —, poblado al crear el `PICKED_UP` desde `order.userId` de ese instante. Al no tener relación, **no se anula** con el borrado de cuenta.
- El proyector deriva el destinatario de `ownerUserIdSnapshot`, **no** de `order.userId`; `volumeId` sigue viniendo de la línea inmutable. Evento + línea (ambos inmutables) bastan → **hecho autosuficiente**, reprocesable aunque la relación viva de la orden pase a `NULL`.
- Como Slice 7 aún **no está en producción**, no existen `PICKED_UP` previos al snapshot: la columna es universal para todo pickup real (sin backfill ambiguo). Este es también el único cambio de esquema que Slice 8 introduce en Retail; el resto de Retail no se toca.

**c. Destino ya eliminado al proyectar (terminalidad derivada, distinguible).** Con el snapshot, el propietario histórico siempre es reconstruible; lo que puede faltar es la **cuenta destino**, borrada deliberadamente por su política (que además cascadea su colección — D6). No se "omite y ya"; se distingue del hecho perdido/corrupto:

- **Conjunto pendiente del barrido** = `PICKED_UP` con `ownerUserIdSnapshot` presente, **que aún matchea un `User` existente**, y sin `Acquisition` (anti-join contra `Acquisition` **y** contra `User`).
- Un pickup cuyo `User` propietario ya no existe **sale del conjunto pendiente** (terminalidad **derivada**, no un estado que se escribe): no reaparece indefinidamente, no crea `Acquisition` (la FK `Cascade` a `User` exige que exista) ni estado huérfano en Collection. La adquisición **no se persiste** porque la política de eliminación hizo desaparecer el destino a propósito.
- **Distinguible y observable:** "destino deliberadamente abandonado" = `ownerUserIdSnapshot` presente + `User` ausente + sin `Acquisition` (consultable como conjunto de auditoría). "Perdido/corrupto" = `ownerUserIdSnapshot IS NULL` sobre un `PICKED_UP` (inesperado, dado que el snapshot es universal) → señal de alarma, no abandono silencioso.

### D2 — Persistencia: dos estructuras nuevas, ancladas al catálogo `Volume`

- **`Acquisition`** (ledger append-only): `acquisitionKey` (UNIQUE), `userId`, `volumeId` (→ `Volume.id`), `quantity` (>0), `channel` (obligatorio), `occurredAt` (obligatorio), `recordedAt` (opcional, técnico). Índices: `@@unique([acquisitionKey])`, `@@index([userId, volumeId])`.
- **`OwnershipPosition`** (agregado): `userId`, `volumeId`, `quantity` (≥0), `@@unique([userId, volumeId])`. `quantity` = verdad persistida **y** recomputable como `Σ Acquisition` del par.

No reusa `OwnedVolume`/`Purchase`. Modelo paralelo, multi-usuario, sobre el mismo eje de identidad (`Volume`) que Retail. La `OwnedVolume` legada tiene eje incompatible (`TrackedEdition` global, sin `userId`), lo que confirma la no-reutilización.

### D3 — Entrega: proyección idempotente con intento inmediato + barrido durable

Un módulo **proyector** en la capa de orquestación (único que importa Retail y Collection) recorre los `PICKED_UP` no proyectados y, por cada uno: traduce identidad (D5), deriva `userId` (vía `StoreOrder`), `volumeId` (vía `StoreOrderLine`), `quantity` (delta del evento), `channel` = `RETAIL_PICKUP`, `occurredAt` = `event.createdAt`; y aplica la `Acquisition` sobre la `OwnershipPosition` (D4).

- **Intento inmediato (best-effort):** tras commitear la server action de pickup, dispara una proyección en proceso → baja latencia.
- **Barrido durable (respaldo):** cron (Vercel) que reprocesa `PICKED_UP` sin `Acquisition`. Es la garantía real (cumple "no best-effort sin recuperación") y es a la vez el **backfill** de pickups previos a Slice 8.
- **Descubrimiento de lo no proyectado:** anti-join `PICKED_UP LEFT JOIN Acquisition ON acquisitionKey WHERE null`. Un watermark por `event.id` se difiere hasta tener volumen.

Un `PICKED_UP` = un hecho físico = una `Acquisition` (el `operationKey` único de Slice 7 garantiza que un pickup no genera dos filas).

### D4 — Idempotencia transaccional: `INSERT … ON CONFLICT DO NOTHING`, sin trampa de `P2002`

**No** se usa `try/create + catch P2002 + continuar en la misma transacción**: en PostgreSQL una violación de unicidad aborta la transacción (estado `25P02`) y toda sentencia posterior falla. En su lugar, en **una** transacción de Collection:

```
1. cnt = createMany(Acquisition[acq], skipDuplicates:true)   // → INSERT … ON CONFLICT (acquisitionKey) DO NOTHING; NO aborta
2. if cnt == 0:                                                // perdió la carrera de unicidad (o ya estaba)
     existing = findUnique(acquisitionKey)
     if !samePayload(existing, acq): throw ACQUISITION_KEY_CONFLICT
     return NOOP                                               // NO incrementa
3. // cnt == 1: es el creador
   createMany(OwnershipPosition[{userId, volumeId, quantity:0}], skipDuplicates:true)  // asegura fila; ON CONFLICT DO NOTHING
   update OwnershipPosition where (userId,volumeId) { quantity: { increment: acq.quantity } }  // incremento atómico bajo lock de fila
   return APPLIED
```

`createMany({ skipDuplicates: true })` compila a `ON CONFLICT DO NOTHING` y **devuelve el count sin lanzar** — no aborta la transacción. Garantías exigidas:

1. **Solo el creador incrementa** — rama `cnt==1`.
2. **El competidor que pierde no incrementa** — rama `cnt==0` retorna sin escribir la posición.
3. **Tras el conflicto se lee la `Acquisition` existente** — `findUnique(acquisitionKey)`.
4. **Payload igual ⇒ no-op** — `samePayload` verdadero.
5. **Payload distinto ⇒ conflicto visible** — `throw ACQUISITION_KEY_CONFLICT`.
6. **Nunca `Acquisition` sin incremento ni incremento sin `Acquisition`** — ambas escrituras del creador ocurren en la misma transacción (atómicas); si hace rollback, desaparecen las dos y el evento queda no-proyectado para el barrido. El incremento de posición usa `increment` atómico (no read-modify-write) → sin lost updates entre adquisiciones concurrentes de la misma posición.

### D5 — Traducción de identidad → `acquisitionKey`

`acquisitionKey = "retail-pickup:" + operationKey` del evento (el `operationKey` es único e inmutable por pickup físico: individual, o `${batchOperationKey}:pickup:${orderLineId}` en masivo). Relación determinista y estable: mismo evento físico → siempre la misma clave; eventos distintos → claves distintas. Para Collection la clave es **opaca** (no interpreta su estructura); la traducción vive en el proyector.

### D6 — Payload de reconciliación y FKs del modelo nuevo

**Payload (D3 §3):** `samePayload` compara los **cinco** atributos inmutables del hecho: `userId`, `volumeId`, `quantity`, `channel`, `occurredAt` (comparación de instante exacta; determinista desde `event.createdAt`). `recordedAt` **no** participa (dato técnico del procesamiento, no del hecho de dominio).

**FKs:** `OwnershipPosition.userId` y `Acquisition.userId` → `User` con `onDelete: Cascade`. Así el borde `userId=NULL` de Retail queda consistente: al borrar la cuenta, el `SetNull` del lado de Retail (preserva su historial) y el `Cascade` del lado de Collection (elimina su colección) conviven sin huérfanos. `volumeId` → `Volume` con `onDelete: Restrict` (un `Volume` con posesión no se borra).

### D7 — Lectura mínima

Superficie acotada para validar la slice end-to-end, cubierta por tests de integración: (a) posiciones de un usuario; (b) adquisiciones que explican una posición. **No** es una UI de colección completa. La fusión con la experiencia legada (`OwnedVolume`) queda **explícitamente fuera de Slice 8** (slice posterior de read-side/migración).

### D8 — Capas y naming del bounded context

El bounded context se llama **Collection** (lenguaje ubicuo); `OwnershipPosition`/`Acquisition` son sus agregados/entidades, no el nombre del contexto. Existe un archivo legado `lib/collection.ts` (lector de `OwnedVolume`) que colisionaría con un directorio `lib/collection/`. Se preserva el nombre del contexto sin colisión:

- `lib/domain/collection/*` (puro, Prisma-free, `now`/ids inyectados): `applyAcquisition`, invariantes, `samePayload`. El comportamiento vive en el agregado. **Sin colisión** (no existe `lib/domain/collection.ts`) → el lenguaje ubicuo queda intacto en la capa que más importa.
- `lib/collection-context/*` (servicio Prisma, session-free, params explícitos): persistencia, algoritmo D4, traducción de errores, proyector y lecturas. Nombre de carpeta que preserva "Collection" y evita el choque con `lib/collection.ts`. (Se descarta `lib/collection-domain/` porque en este repo `domain` = capa pura sin Prisma, y sería engañoso para una carpeta con servicios Prisma.)
- Proyector: dentro de `lib/collection-context/` (`projection.ts`); único módulo que importa Retail (lee el ledger) + Collection (aplica).
- **Retail: sin cambios de dominio** — ya emite `PICKED_UP`; solo suma la columna snapshot `ownerUserIdSnapshot` (D1.b); no conoce a Collection.

---

## Alternativas descartadas

- **`try create / catch P2002` dentro de la misma tx** — la violación aborta la transacción en PostgreSQL; imposible continuar. Sustituida por `ON CONFLICT DO NOTHING` (D4).
- **Escritura cross-context en la misma tx del pickup** — acopla Retail a Collection y rompe "Retail commitea primero" y el aislamiento de contextos.
- **Tabla outbox dedicada** — el ledger de `PICKED_UP` ya la provee (verificado inmutable); redundante.
- **Trigger de base de datos** — saca lógica de dominio de la capa pura; opaco y difícil de testear.
- **Dual-write / proyección hacia `OwnedVolume`** — eje de identidad incompatible; ensucia el modelo congelado (fork resuelto en opción A).

---

## Riesgos aceptados

- **`occurredAt` = momento de registro del pickup**, no un timestamp físico separado (Slice 7 no lo captura). Es la mejor aproximación disponible y respeta la intención del contrato (momento del pickup físico, no del procesamiento de Collection).
- **Costo del anti-join del barrido a escala** — ahora con doble anti-join (`Acquisition` y `User`); aceptable al volumen actual; watermark diferido.
- **`channel` constante `RETAIL_PICKUP`** — único origen hoy; multi-canal es aditivo (no disruptivo).
- **Autosuficiencia depende de escribir `ownerUserIdSnapshot` al crear el `PICKED_UP`.** Es la condición del hecho autosuficiente; ningún consumidor debe volver a reconstruir el propietario desde `StoreOrder.userId`. Si a futuro otro tipo de evento necesitara el propietario, deberá snapshotearlo análogamente (nota acotada, no aplica hoy).
- **La terminalidad "no aplicable por borrado" es derivada, no materializada.** Se observa por consulta, no por una fila de estado. Si se requiriera trazabilidad explícita/auditada de pickups abandonados por eliminación de cuenta, sería un diagnóstico **aditivo**, no un cambio del modelo de Collection.

---

## Preguntas abiertas (fuera de este ADR)

1. **Read-side unificado / migración de la colección legada** (`OwnedVolume` → modelo nuevo): slice posterior; requiere resolver el puente de ejes de identidad.
2. **Reversa de pickup** (corrección de un retiro mal registrado): hoy fuera de alcance en Retail (Slice 7) y en Collection; lo cubrirá el concepto `Disposal` diferido del roadmap de dominio (aditivo, no disruptivo).
3. **Trigger operativo del barrido** (frecuencia del cron, coexistencia con el intento inmediato): decisión de plan de implementación, no de dominio.
4. **Ubicación de la columna `ownerUserIdSnapshot`** (enmendar la migración gated de Slice 7 —aún no aplicada— vs. migración aditiva propia de Slice 8) y el ajuste puntual del servicio de handoff que crea el `PICKED_UP` para poblarla: detalle del plan de implementación, no del diseño.
