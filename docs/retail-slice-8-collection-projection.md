# Retail → Collection / Slice 8: Colección automática

Octava slice del arco. Las unidades **retiradas** en Retail (evento `PICKED_UP` de Slice 7) se materializan
automáticamente en la colección del usuario, con retiros parciales y múltiples, idempotencia y recuperación
durable. Es el **bounded context Collection** (nuevo), no una extensión de Retail. Decisiones congeladas en
**ADR-010** (`docs/adr/010-slice8-collection-projection.md`).

## Principio central: ledger-as-outbox + consistencia eventual

Retail **commitea primero**; Collection consume sólo pickups confirmados. El hecho publicado durable es la fila
`PICKED_UP` del ledger inmutable `StoreOrderLineEvent` (Slice 7): append-only, atómica con el contador,
`operationKey` único. **No se agrega una segunda tabla outbox**: el ledger ya da durabilidad, orden y unicidad.
La incorporación a Collection es **durable, idempotente y reprocesable**; nunca best-effort sin recuperación.

Verificado en el código real que el hecho es **autosuficiente** (ADR-010 §Premisas): línea/orden no se
hard-deletean en prod, `volumeId`/`orderId` inmutables, `Volume` es `Restrict`. El único borde —`StoreOrder.userId`
pasa a `NULL` por `SetNull` al borrar la cuenta— se cierra con un **snapshot estable del dueño**.

## Modelo de dominio (mínimo, congelado)

- **`Acquisition`** — hecho histórico **inmutable e idempotente** de entrada de unidades. `acquisitionKey`
  (único, opaca), `userId`, `volumeId` (catálogo `Volume.id`), `quantity` (>0, CHECK), `channel`
  (`RETAIL_PICKUP`), `occurredAt` (momento físico del pickup = `event.createdAt`), `recordedAt` (técnico, fuera
  del contrato de dominio). FKs: `User` `Cascade`, `Volume` `Restrict`.
- **`OwnershipPosition`** — Aggregate Root pequeño de `(userId, volumeId)`. `quantity` = fuente de verdad
  persistida **y** reconstruible como `Σ Acquisition` (>= 0, CHECK). Hoy append-only (sólo crece).
- **`StoreOrderLineEvent.ownerUserIdSnapshot`** (TEXT, nullable, **sin FK**) — snapshot puro del dueño al crear
  un `PICKED_UP` (convención `customerNameSnapshot`). No se anula con el `SetNull` → hace el hecho autosuficiente.

**No reusa `OwnedVolume`/`Purchase`** (eje de identidad legado incompatible: `TrackedEdition` global, sin
`userId`). Modelo paralelo; la fusión con la colección legada es una slice posterior (diferida).

## Idempotencia transaccional (sin la trampa de `P2002`)

En PostgreSQL una violación de unicidad **aborta** la transacción, así que **no** se usa `try create / catch
P2002`. `Acquisition.createMany({ skipDuplicates: true })` = `INSERT … ON CONFLICT DO NOTHING`, devuelve el
count sin abortar (`lib/collection-context/apply.ts`):

```
applyAcquisitionTx(tx, fact):
  count = createMany(Acquisition[fact], skipDuplicates)      # ON CONFLICT DO NOTHING
  if count == 0:                                             # perdió la carrera / ya estaba
     existing = findUnique(acquisitionKey)
     reconcileAcquisition(existing, fact)                    # igual → ALREADY_APPLIED; distinto → CONFLICT (aborta)
     return ALREADY_APPLIED
  createMany(OwnershipPosition[{userId,volumeId,0}], skipDuplicates)   # siembra la fila (evita race del upsert)
  update OwnershipPosition { quantity: { increment: fact.quantity } }  # incremento atómico bajo lock de fila
  return APPLIED
```

`applyAcquisition` (capa exterior) corre esto en **una** `$transaction` y traduce **fuera** de ella:
`CONFLICT` (payload distinto), `P2003` → `TERMINALLY_NOT_APPLICABLE` (el destino se borró en carrera — el único
FK alcanzable es el del usuario; el volumen siempre existe), resto → `RETRYABLE_FAILURE`. Insert + incremento son
atómicos (rollback total si algo falla).

## Traducción de identidad

`acquisitionKeyFor(operationKey) = "retail-pickup:" + operationKey` — helper **único y determinista**
(`lib/collection-context/projection.ts`). El prefijo se comparte con el SQL de los queries. Un `PICKED_UP` = un
hecho físico = una `Acquisition`. Opaca para Collection.

## Proyección: intento inmediato + barrido durable

- **Inmediato (best-effort, post-commit):** la server action de pickup, **después** de que Retail retornó,
  llama `projectPickupImmediate(keys)` (`handoffActions.ts`): individual por la `operationKey` exacta; batch
  reconstruyendo las claves exactas con `handoffBatchItemKey`. **Nunca lanza** → un fallo de Collection no afecta
  la respuesta del pickup. Clasifica en un tally (anomalías `CORRUPT`/`CONFLICT`, `retryable`, `terminal`).
- **Barrido durable (cron):** `app/api/cron/collection-projection/route.ts` (GET, `CRON_SECRET` fail-closed,
  `maxDuration=60`) → `sweepPickupProjections` (`lib/collection-context/sweep.ts`). Recupera lo que el inmediato
  no proyectó; es también el **backfill**. `vercel.json`: horario (`0 * * * *`).

**Query de pendientes** (`findPendingPickups`): doble anti-join contra `Acquisition` (aún sin aplicar) y `User`
(destino existente), snapshot presente, orden por `event.id`, cursor keyset en memoria (`e.id > cursor`, **no**
watermark persistido). CORRUPT (snapshot nulo), terminales (destino ausente) y CONFLICT (clave ya existente)
**no entran** al set pendiente → no generan loop; se auditan aparte (`findCorruptPickups`/`findTerminalPickups`).
`RETRYABLE` queda para la próxima corrida.

## Advisory lock por sesión — afinidad de conexión (crítico)

Los advisory locks de PostgreSQL son **por sesión**. Con el pool normal de Prisma, `pg_try_advisory_lock` y
`pg_advisory_unlock` podrían salir por conexiones distintas → el unlock no libera lo tomado. No sirve
`pg_advisory_xact_lock` porque cada evento va en **su propia** transacción (el lock debe sobrevivir a todas). El
barrido usa un **`PrismaClient` DEDICADO con `connection_limit=1`**: una sola conexión física para el lock, las
lecturas, cada apply y el unlock. Unlock en `finally` + `$disconnect` (defensa). Si no obtiene el lock → salida
limpia `lockAcquired: false` (no es error). Presupuesto de tiempo (`50s`) < `maxDuration`.

`SweepSummary`: `applied, alreadyApplied, terminallyNotApplicable, corruptSource, conflict, retryableFailure,
processed, durationMs, stoppedByTimeBudget, lockAcquired`.

## Lecturas mínimas (`lib/collection-context/read.ts`)

- `getUserPositions(client, userId)` — aislado por usuario, orden por `volumeId`, cantidad persistida + datos
  mínimos de `Volume`.
- `getPositionAcquisitions(client, userId, volumeId)` — alcance por ambos ids; orden `occurredAt` asc + desempate
  estable por `id`; expone los cinco atributos + `acquisitionKey` + `recordedAt`.

No hay UI nueva (diferida). Sin dependencia a `OwnedVolume`.

## Auditoría y reparación (`lib/collection-context/audit.ts`, `scripts/audit-ownership.ts`)

`detectOwnershipDrift` compara `Σ Acquisition` (fuente de verdad) vs `OwnershipPosition.quantity`:
`MISSING` (hay adquisiciones, no hay posición), `MISMATCH` (distinto), `ORPHAN_NONZERO` (posición sin
adquisiciones, cantidad ≠ 0). Read-only por defecto; repara sólo con `--repair`. Idempotente. **Nunca borra ni
inventa adquisiciones.** Política **ORPHAN_NONZERO: se lleva a 0, la fila NO se borra**.

**Reparación segura ante concurrencia — el orden `lock → sum → update` es parte de la corrección:** por cada par,
dentro de **una** transacción: (1) `createMany` siembra la fila idempotentemente; (2) `SELECT … FOR UPDATE` de la
`OwnershipPosition`; (3) recomputa `Σ Acquisition` **dentro** de la tx, **después** del lock; (4) `update
quantity = Σ`. Como `apply` inserta la `Acquisition` e incrementa la posición en **una sola** tx, la reparación ve
**ambos o ninguno** → si el apply ya committeó, su hecho está en Σ; si está en vuelo, Σ no lo ve y su incremento
queda bloqueado tras el lock, y al continuar suma su delta sobre el valor reparado. No se pierde ninguna
adquisición ni hay doble conteo.

## Bounded contexts y acoplamiento

- **Retail no importa Collection** (verificado: `lib/retail/*` sin imports de `collection`).
- **Collection no reusa `OwnedVolume`** (verificado) ni importa el dominio de Retail; **lee** el hecho publicado
  (tablas `StoreOrderLineEvent`/`StoreOrderLine`) vía SQL — el contrato ledger-as-outbox, acoplamiento de datos.
- **El único acoplamiento de módulos entre contextos vive en la capa de orquestación (app):** la server action
  `handoffActions.ts` (importa el proyector de Collection + `handoffBatchItemKey` de Retail) y la ruta cron.
- 3 capas: `lib/domain/collection/*` (puro) → `lib/collection-context/*` (Prisma) → app (server action + cron).

## Alcance excluido / diferido (backlog)

UI completa de colección; **read-side unificado y migración desde `OwnedVolume`/`Purchase`**; reversa de pickup
(`Disposal`); ejemplares individualizados / pool fungible; multi-canal; watermark persistido; tabla de jobs;
promoción de la migración a producción (checkpoint de deploy). Ver `docs/backlog.md`.

## Riesgos operativos

- **`PrismaClient` dedicado (`connection_limit=1`) del barrido:** conecta/desconecta por corrida; correcto para
  un cron. Si el barrido crashea sin liberar, `$disconnect`/cierre de sesión libera el advisory lock; una corrida
  atascada podría retener el lock hasta que su sesión muera (el timeout del runtime la corta). Aceptado.
- `occurredAt` = momento de **registro** del pickup (Slice 7 no captura un timestamp físico separado); mejor
  aproximación disponible.
- Snapshot corrupto (`ownerUserIdSnapshot` nulo en un `PICKED_UP`) no debería ocurrir (los dos productores lo
  pueblan); si aparece, es alarma vía `findCorruptPickups`, no se aplica.
- Migración `20260801000000_slice8_collection` **gated**, aplicada en efímero/staging; **prod = checkpoint de
  deploy**.

## Estado

Implementado y verde: `npm run check` (tsc + 703 unit) y el harness de integración completo (17 suites, 220
tests, migración aplicada desde cero sobre Postgres efímero). Sin dual-write a `OwnedVolume`.
