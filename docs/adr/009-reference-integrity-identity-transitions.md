# ADR-009: Integridad de referencias externas frente a transiciones de Identity

- **Estado**: Aceptado (bloqueante para implementar Fusionar — resuelve T2 del Design Spec).
- **Fecha**: 2026-07.
- **Relacionado**: ADR-008 (coordinación identidad–contenido), Design Spec de Fusionar, slices Conferir y Asociar.
- **Ámbito**: garantizar, bajo concurrencia real, el invariante normativo *"una referencia externa nunca debe quedar asociada directamente a una Identity no terminal (no ACTIVE)"*, frente a las transiciones de estado que introduce Fusionar.

---

## Contexto

La regla normativa: una referencia `(provider, externalId)` solo debe resolver hacia una Identity
`ACTIVE`. Asociar (slice cerrada) verifica el estado del destino en el camino amable pero **no bloquea
la Identity durante toda la operación**. Carrera real (**T2** del Design Spec):

```
Tx A (Asociar): lee Identity X = ACTIVE
Tx B (Fusionar): lockea X, mueve refs, cambia X → REDIRECTED, commitea
Tx A: inserta la referencia sobre X ya REDIRECTED  → viola el invariante
```

Ambas operaciones son correctas aisladas; la violación emerge de la carrera. Se necesita una **garantía
autoritativa** que la impida.

---

## Problema

1. ¿Qué mecanismo impide *físicamente* referencias sobre identidades no-ACTIVE bajo concurrencia?
2. ¿Alcanza con locks, hace falta un trigger, o existe una solución **declarativa**?
3. ¿Qué cambia en la slice Asociar ya cerrada?

---

## Decisión

### D1 — Garantía autoritativa: **FK compuesta declarativa** (Alternativa E)

Se **refuta** la hipótesis inicial (lock pesimista en Asociar + trigger) a favor de una solución
**declarativa** que se demuestra existe:

- En `CatalogIdentity`: `UNIQUE (id, state)` (trivial: `id` ya es PK).
- En `IdentityExternalReference`: una columna denormalizada `identityState` con **DEFAULT `'ACTIVE'`** y
  **CHECK `identityState = 'ACTIVE'`**, y la FK reemplazada por una **compuesta**:
  `(identityId, identityState) → CatalogIdentity(id, state)` con `ON UPDATE RESTRICT ON DELETE CASCADE`.

Efecto (dos garantías, sin trigger, sin lógica procedural):
- **Insert sobre no-ACTIVE es imposible:** una referencia lleva `identityState='ACTIVE'` (CHECK). La FK
  exige que exista `CatalogIdentity(id=identityId, state='ACTIVE')`. Si la Identity es `REDIRECTED`, no
  hay fila `(id,'ACTIVE')` → la FK **rechaza** el insert (violación de FK). Resuelve T2 de raíz.
- **Orden de mutación forzado en Fusionar:** flipear una Identity a `REDIRECTED` cambia su clave
  referenciada `(id,'ACTIVE') → (id,'REDIRECTED')`. Con `ON UPDATE RESTRICT`, ese cambio **falla** si
  todavía hay referencias apuntándola → obliga a **mover las referencias antes** de cambiar el estado.
  Es una red de seguridad declarativa de la regla de orden de ADR-008/Design Spec.

Por qué declarativo > trigger: es el mismo mecanismo que cualquier FK (fácil de razonar y testear), sin
código procedural per-row que Prisma no gestiona, y **además** enforcea el orden de mutación. La
denormalización de `identityState` (siempre `'ACTIVE'`) es el costo, pequeño y acotado.

### D2 — Locks: **solo en Fusionar** (para su coordinación multi-identidad), **no** en Asociar

Fusionar mantiene `SELECT … FOR UPDATE` sobre **ambas** identidades **ordenadas por `id`** (anti-deadlock)
+ revalidación bajo lock — pero eso es por su coordinación de **grafo** (carreras 1–4/9–10 del §), **no**
por el invariante de referencias, que ya lo garantiza la FK compuesta (D1). **Asociar NO necesita lock**:
la FK compuesta re-evalúa el estado comprometido al momento del insert; si la Identity fue redirigida, el
insert falla con violación de FK, que Asociar traduce a `INVALID_IDENTITY_STATE`.

### D3 — Traducción de error en Asociar

La violación de la FK compuesta se materializa como `PrismaClientKnownRequestError` con `code` de FK
(`P2003`) o, según la forma, un error de constraint. Asociar la **traduce** a
`INVALID_IDENTITY_STATE` (destino no ACTIVE). Encapsulado y testeado, análogo a la traducción de P2002 ya
existente. La friendly-path (pre-check de estado) se conserva como camino amable; la FK es la guardia
autoritativa bajo carrera.

---

## Protocolo de locks (Fusionar)

- **Filas bloqueadas:** las dos `CatalogIdentity` (sobreviviente y absorbida).
- **Orden global de adquisición:** por `id` técnico ascendente (estable, evita A→B/B→A deadlock).
- **Por id, no por handle** (el handle *es* el `id`).
- **Cuándo:** al comenzar la ejecución, tras la lectura de idempotencia; antes de validar estados.
- **Relectura:** el estado de ambas se **relee bajo lock** (patrón R1) antes de mutar.
- **Interacción con Asociar:** Asociar no toma `FOR UPDATE`; su insert toma `FOR KEY SHARE` sobre la fila
  padre (FK), que **espera** al `FOR UPDATE` de Fusionar y, al desbloquearse, la FK re-evalúa el estado
  comprometido → si cambió a `REDIRECTED`, el insert falla (→ `INVALID_IDENTITY_STATE`).
- **Múltiples referencias:** el movimiento es un solo `UPDATE … WHERE identityId = absorbida`; atómico.
- **Estado cambiado tras esperar:** la operación que, tras el lock/espera, encuentra el estado cambiado,
  devuelve el resultado semántico correspondiente (`INVALID_*_STATE` / `STALE_DECISION` / `ALREADY_MERGED`).

---

## Guardia de base (la FK compuesta) — orden en Fusionar

SQL ilustrativo (no es la migración):
```sql
-- CatalogIdentity: UNIQUE (id, state)
-- IdentityExternalReference:
--   identityState text NOT NULL DEFAULT 'ACTIVE' CHECK (identityState = 'ACTIVE')
--   FOREIGN KEY (identityId, identityState) REFERENCES CatalogIdentity(id, state)
--     ON UPDATE RESTRICT ON DELETE CASCADE

-- Fusionar (bajo lock, en la tx), ORDEN OBLIGATORIO:
UPDATE "IdentityExternalReference" SET "identityId" = :survivor WHERE "identityId" = :absorbed; -- 1) mover
UPDATE "CatalogIdentity" SET "state"='REDIRECTED', "redirectsToId"=:survivor
  WHERE id=:absorbed AND state='ACTIVE';                                                        -- 2) flipear
```
Si se invirtiera el orden (flipear antes de mover), el paso 2 fallaría por `ON UPDATE RESTRICT` (hay
referencias sobre `(absorbed,'ACTIVE')`). La base impide el orden ilegal.

---

## Impacto sobre la slice Asociar (cerrada)

Cambios necesarios (habilitados porque Fusionar reveló una violación concurrente real del invariante —
misma excepción que el fix de Conferir):
- **Infra:** traducir la violación de la FK compuesta (P2003) a `INVALID_IDENTITY_STATE`. **No** se agrega
  lock (la FK basta). Orden de lecturas sin cambios (friendly-path se conserva).
- **Transacción:** sin cambios estructurales (sigue una fila, un insert).
- **Tests unitarios:** agregar traducción de P2003 (con doble) → `INVALID_IDENTITY_STATE`.
- **Tests de integración:** insert sobre Identity `REDIRECTED` (materializada) → `INVALID_IDENTITY_STATE`.
- **Tests de concurrencia:** Asociar vs Fusionar sobre la absorbida (carrera 1 de la matriz) con Postgres real.
- **Documentación:** nota en `docs/identity-associate-slice.md` sobre la FK compuesta y la traducción.
- **Schema/migración:** la columna `identityState` + CHECK + FK compuesta + `UNIQUE(id,state)` (una
  migración nueva, gated). `identityState` con DEFAULT `'ACTIVE'` → Conferir/Asociar no cambian su
  `create` (heredan el default).

---

## Matriz de carreras

| # | Carrera | Locks | Espera | Resultado final | Resultado semántico | Guardia de base | Test real |
|---|---|---|---|---|---|---|---|
| 1 | Asociar vs Fusionar sobre la absorbida | Fusionar FOR UPDATE; Asociar FK KEY SHARE | Asociar espera al commit de Fusionar | ref NO se inserta sobre no-ACTIVE | `INVALID_IDENTITY_STATE` | FK compuesta rechaza | sí |
| 2 | Asociar vs Retirar (futuro) | (Retirar aún no existe) | — | análogo a 1 (Retirar → no-ACTIVE) | `INVALID_IDENTITY_STATE` | FK compuesta | diferido |
| 3 | dos Asociar, misma Identity, refs distintas | ninguno | — | ambas EXECUTED | EXECUTED×2 | `(provider,externalId)` único | sí |
| 4 | dos Fusionar con una misma Identity | FOR UPDATE ordenado por id | la 2ª espera | una EXECUTED, otra `INVALID_*_STATE` | según rol | lock + relectura | sí |
| 5 | Fusionar moviendo refs mientras otra intenta Asociar | FOR UPDATE (mueve) | Asociar espera | insert falla tras redirección | `INVALID_IDENTITY_STATE` | FK compuesta | sí |
| 6 | UPDATE directo accidental de una ref hacia REDIRECTED | — | — | **imposible** | (error de FK) | FK compuesta | sí |
| 7 | replay de Asociar esperando un lock | KEY SHARE espera | sí | idempotente si la ref/decisión ya existe | `ALREADY_SATISFIED` / `ALREADY_ASSOCIATED` | únicos + FK | sí |
| 8 | deadlock por orden inconsistente | FOR UPDATE **ordenado por id** | — | sin deadlock | — | orden global de locks | sí |

---

## Consecuencias

**Buenas:**
- Garantía **física y declarativa** del invariante (no depende de que cada operación se acuerde de lockear).
- Enforcea además el **orden de mutación** de Fusionar (mover refs antes de flipear estado).
- Cambio **mínimo** a Asociar: solo traducción de error, sin lock, sin reestructurar la transacción.
- Sin triggers procedurales que mantener fuera de Prisma.

**Malas / costos:**
- Columna denormalizada `identityState` (constante `'ACTIVE'`) + FK compuesta + `UNIQUE(id,state)`.
- La FK RESTRICT obliga a un orden estricto en Fusionar (bueno para correctitud, pero es una restricción a
  respetar en el diseño de la transición).
- Un `UPDATE` de estado que olvide mover refs falla ruidosamente (deseable, pero hay que traducirlo bien).

## Riesgos

- Si una versión futura de Prisma/PG cambia la forma de reportar la violación de FK compuesta, la
  traducción a `INVALID_IDENTITY_STATE` es el único punto de ajuste (encapsulado, testeado).
- La denormalización exige que **ninguna** vía escriba `identityState` distinto de `'ACTIVE'`; el CHECK lo
  garantiza.

## Alternativas consideradas (y por qué se descartaron)

- **A — Lock pesimista en Asociar (FOR UPDATE + revalidar):** funciona para la carrera, pero (i) no da
  garantía *física* contra un UPDATE directo accidental (carrera 6); (ii) obliga a más cambios en la slice
  cerrada; (iii) deja el invariante dependiente de que toda operación futura recuerde lockear. Subsumida
  por E (que además fuerza el orden). Se conserva el lock **solo en Fusionar** por su coordinación de grafo.
- **B — Trigger de PostgreSQL (rechaza INSERT/UPDATE si identityId no es ACTIVE):** viable pero **inferior**:
  procedural, per-row, fuera de la gestión de Prisma, no enforcea el orden de mutación, y más difícil de
  razonar/testear que una FK. Rechazada a favor de E.
- **C — Lock + trigger (ambas):** innecesaria dado E. La FK compuesta ya es la guardia física; agregar
  trigger es redundante.
- **D — Nivel de aislamiento SERIALIZABLE:** rechazada. Costo global y reintentos para localizar un
  invariante puntual; no da garantía declarativa contra UPDATE directo; peor testabilidad.
- **E — FK compuesta declarativa:** **elegida** (D1). Se demostró que **existe** una solución declarativa
  sin trigger, contra la suposición inicial de que haría falta uno.

## Plan de validación con PostgreSQL real

Con el harness efímero existente (`npm run test:identity-it`, `--no-file-parallelism`): (i) insert sobre
Identity `REDIRECTED` → rechazo traducido; (ii) intento de flipear a `REDIRECTED` con refs sin mover →
falla (orden forzado); (iii) carrera Asociar-vs-Fusionar (matriz #1/#5) con `Promise.all`; (iv) ausencia
de deadlock con locks ordenados (matriz #8); (v) idempotencia de Asociar esperando lock (#7).

## Evidencia observada (PostgreSQL 18.4 efímero) — validación de la fortificación de Asociar

La migración `20260722020000` aplica limpiamente (la FK COMPUESTA referencia la CONSTRAINT
`UNIQUE(id, state)` — por eso se usa `ADD CONSTRAINT ... UNIQUE`, no un índice suelto). Metadata real:
- **FK compuesta** violada por un `create` de Prisma: `code='P2003'`,
  `meta={ modelName, constraint: 'IdentityExternalReference_identity_active_fkey' }` → el clasificador
  matchea por `meta.constraint`. Confirmado.
- **CHECK** (`identityState != 'ACTIVE'` por write directo/raw) → rechazado. Confirmado.
- **ON UPDATE RESTRICT** (flip de estado con referencias presentes) → `"Key (id, state)=(…, ACTIVE) is
  referenced from IdentityExternalReference"`. Confirmado.

Resultados: `npm run test:identity-it` → **29 passed** (Conferir 11 + Asociar 9 + integridad 9).

**Confirmación de las afirmaciones de este ADR (todas sostenidas en Postgres real):**
- La FK compuesta garantiza el invariante **sin trigger** — CONFIRMADO (rechaza incluso writes directos).
- Asociar **no necesita `FOR UPDATE`** — CONFIRMADO (la carrera preserva el invariante vía FK; Asociar
  siempre devuelve un resultado semántico, no lanza).
- `ON UPDATE RESTRICT` **fuerza mover las referencias antes de redirigir** — CONFIRMADO (el flip con
  referencia presente falla; mover-luego-flipear funciona).
- **`READ COMMITTED` es suficiente** para esta interacción — CONFIRMADO (isolation default; la carrera
  no produce anomalía).
- El resultado concurrente **siempre preserva la validez del namespace** — CONFIRMADO (nunca referencia
  + Identity REDIRECTED).
- **Compatible con el UPDATE masivo futuro de Fusionar** — CONFIRMADO (el patrón mover-refs (`UPDATE …
  WHERE identityId=src`) → flipear-estado se ejecuta sin violar constraints intermedios).

Ninguna afirmación fue refutada. No se requirió trigger ni lock en Asociar.
