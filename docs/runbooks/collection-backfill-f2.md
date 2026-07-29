# Runbook Operativo — Backfill de colección legada → Collection (F2.2)

> **Versión de referencia:** F2.2 = commit `bb3e855` (integrado en `staging` vía merge `d628f0f`). Política: **ADR-012**.
> Este documento describe **únicamente la ejecución operativa** del backfill sobre una base **ya preparada** (migraciones aplicadas). No cubre merge, preparación de producción, ni F3.

## 0. Supuestos

Este runbook parte de las siguientes precondiciones. Si alguna no se cumple, **no corre**:

- La base destino ya tiene **todas las migraciones aplicadas** (schema up to date); este documento no prepara ni migra bases.
- Existe **autorización explícita** para ejecutar el backfill contra la base real elegida.
- **ADR-012 está aprobado** y es la política vigente; el executor no la reinterpreta.
- El código de F2.2 (commit `bb3e855`) está presente en el working tree que se va a ejecutar.
- El **dry-run** ya fue validado previamente en el mismo entorno.
- La selección de entorno destino se hace **siempre mediante wrapper** (`with-staging.mjs` / `with-prod.mjs`); nunca por edición manual de variables.
- Este runbook cubre **una sola corrida controlada por vez**; no contempla ejecuciones concurrentes.

## 1. Objetivo

**Qué hace F2.2:** recorre todas las colecciones legadas (`OwnedVolume`), las clasifica con la correspondencia autoritativa de F1 (misma que el dry-run) y **migra a Collection únicamente los casos `RESOLVABLE`** (destino determinístico único), creando `OwnershipPosition(quantity=1)` + una `Acquisition` de procedencia `LEGACY_BACKFILL`.

**Propósito operativo:** **establecer presencia donde el destino es determinístico, sin alterar datos ya presentes.**

**Qué NO hace:**
- No incrementa posiciones existentes: si ya hay `OwnershipPosition` para `(userId, volumeId)` — de cualquier fuente, **incluida `quantity = 0`** — la respeta y no la toca.
- No escribe para `AMBIGUOUS`, `ORPHAN_NO_EDITION`, `ORPHAN_NO_VOLUME`, `EDITION_KEY_MISMATCH`.
- No crea ni modifica catálogo (`PublisherEdition`/`Volume`). No borra ni modifica el legado (`OwnedVolume`/`TrackedEdition`/`Manga`).
- No hace dual-write. No cambia F1 ni la semántica de Slice 8.

**Fuera de alcance (explícito):** materialización de `Volume` faltantes, reconciliación de ambigüedades/mismatch, retiro del legado (F3), y cualquier corrida que no sea sobre una base con migraciones ya aplicadas.

## 2. Prerrequisitos

- **Selección de entorno por wrapper:** la corrida usa SIEMPRE un wrapper (`with-staging.mjs` / `with-prod.mjs`). **Nunca ejecutar el executor sin wrapper. El wrapper es la única fuente autorizada para seleccionar el entorno destino.**
- **Host correcto (branch Neon):** staging = `ep-winter-smoke-appx6wwe…neon.tech` (branch `staging`); producción = `ep-divine-term-aphcaaxj…neon.tech` (branch `production`, default). Base `neondb`, schema `public`.
- **Commit/versión del código:** el working tree local debe contener F2.2 — `git rev-parse HEAD` y confirmar que **contiene `bb3e855`** (o `staging` en `d628f0f`); `scripts/backfill-collection-run.ts` presente.
- **Estado de migraciones:** `prisma migrate status` contra el destino debe decir **"Database schema is up to date!"** (0 pendientes, 0 fallidas). Si hay pendientes → **no correr** (base no preparada).
- **ADR-012 aprobado** (`docs/adr/012-collection-backfill-policy.md`).
- **Executor presente y validado**; **dry-run validado** en el mismo entorno; **Preview READY** del deploy correspondiente.

## 3. Checklist previo (tick del operador)

```
□ git rev-parse HEAD  → contiene bb3e855 (F2.2)
□ scripts/backfill-collection-run.ts existe
□ Wrapper elegido (with-staging.mjs | with-prod.mjs) según el destino previsto
□ prisma migrate status → "Database schema is up to date!"
□ Host destino esperado confirmado (ep-winter-smoke… staging | ep-divine-term… prod)
□ Base = neondb, schema = public
□ El executor SIEMPRE se corre vía wrapper (nunca directo)
□ Confirmar que no existe otra ejecución simultánea del mismo runbook
□ ADR-012 aprobado
□ Dry-run previamente validado en este entorno
□ Ventana de PITR de Neon vigente (~6 h) conocida antes de escribir
□ Autorización explícita para correr contra base real
□ Archivo de evidencia preparado (destino de la salida, sin credenciales)
```

## 4. Comando exacto

Staging:
```
node scripts/with-staging.mjs npx tsx scripts/backfill-collection-run.ts --confirm-target
```
Producción (solo con autorización expresa):
```
node scripts/with-prod.mjs npx tsx scripts/backfill-collection-run.ts --confirm-target
```
- **Wrapper:** fija `DATABASE_URL` al destino (staging o prod) y anuncia `→ Ejecutando contra STAGING|PROD`.
- **Executor:** `scripts/backfill-collection-run.ts` vía `npx tsx`.
- **Flag:** `--confirm-target` (**obligatorio** contra cualquier base no efímera; sin él el guard aborta con exit 2).
- **Variables:** ninguna adicional; el wrapper carga la configuración del entorno. No hay otros flags ni parámetros.
- **Captura de evidencia** (redirección, preserva exit code):
  `… scripts/backfill-collection-run.ts --confirm-target > <ruta-evidencia>.log 2>&1`

## 5. Observabilidad durante la corrida

Primera línea a verificar **antes** de que procese: `Destino → host=<host> base=neondb`. **Debe coincidir con el entorno previsto.**

**Registrar siempre:** **hora de inicio**, **hora de finalización** y **duración** (la línea `Duración: <ms> ms` del resumen).

Resumen final esperado:
- `OwnedVolume observados: <total>`
- `Usuarios afectados: <n> (con ≥1 no-resoluble: <m>)`
- Bloque **Buckets** (5 líneas) + `Σ … (== total: true)`.
- Bloque **Resultado de escritura (sobre RESOLVABLE)** + `Σ resultados … (== RESOLVABLE: true)`.
- `Duración: <ms> ms`.

Significado de cada resultado (contadores sobre los casos RESOLVABLE):

| Resultado | Significado | ¿Esperado? |
|---|---|---|
| **APPLIED** | Se creó la posición (ausente) + `Acquisition` de backfill. | Sí, en primera corrida. |
| **ALREADY_APPLIED** | Ya existía nuestra `Acquisition` de backfill (mismo payload): no-op idempotente. | Sí, en reejecuciones. |
| **ALREADY_PRESENT** | Existe `OwnershipPosition` (incl. `quantity 0`) **sin** nuestra `Acquisition`: posesión de otra fuente; se respeta. | Sí (esperable si Collection ya tenía datos). |
| **CONFLICT** | Inconsistencia explícita (payload incompatible reusando la clave, o `Acquisition` de backfill sin su posición). Aborta ese fact; nada persiste. | **No** — anomalía; investigar. |
| **TERMINAL** | Una referencia requerida (`User`/`Volume`) desapareció durante la corrida (FK). | Raro; no reintentable. |
| **RETRYABLE** | Fallo transitorio de infraestructura (lista blanca). Lo recupera un re-run. | Raro; reejecutable. |

Comportamiento esperado en una base sana: `Σ buckets == total: true`, `Σ resultados == RESOLVABLE: true`, `CONFLICT = 0`, `TERMINAL = 0`, `RETRYABLE = 0`.

## 6. Criterios de aborto

**Detener inmediatamente (Ctrl-C) si:**
- La línea `Destino →` muestra un **host o base distintos** del entorno previsto.
- Se advierte que se corrió **sin wrapper** o contra el entorno equivocado.

Detener la corrida **no requiere rollback manual**: cada fact es **atómico** (una interrupción no deja estado parcial por fact) y el proceso es **idempotente** (volver a correr retoma sin duplicar).

**Tratar la corrida como fallida / no reejecutar a ciegas y escalar si:**
- **Exit code ≠ 0** (ver §7). En particular exit `1` por **mismatch de cardinalidad** (`Σ buckets ≠ total`) o **incoherencia** (`Σ resultados ≠ RESOLVABLE`).
- Aparece **cualquier `CONFLICT > 0`** (adquisición inconsistente / payload incompatible): indica una anomalía de datos que no debería ocurrir.
- Cualquier señal de **escritura fuera de RESOLVABLE** (no debería ser posible; el executor solo procesa `matched`).
- **Error desconocido**: el executor lo **relanza y aborta** (no lo disimula como transitorio) → exit 1.

En todos estos casos: **no reejecutar** hasta diagnosticar; conservar la evidencia.

## 7. Validación posterior

Al terminar, verificar:
- **Exit code = 0** (0 = OK; 2 = guard abortó por falta de `--confirm-target`; 1 = abortó por error/invariante).
- **Duración** registrada.
- **Resumen final** completo presente.
- **`Σ buckets == total: true`**.
- **`Σ resultados == RESOLVABLE: true`**.
- Contadores: **APPLIED**, **ALREADY_APPLIED**, **ALREADY_PRESENT**, **CONFLICT (=0 esperado)**, **TERMINAL (=0 esperado)**, **RETRYABLE (=0 esperado)**.
- **Evidencia de que solo RESOLVABLE escribió:** los cuatro buckets no resolubles no producen contadores de escritura; `Σ resultados == RESOLVABLE` confirma que el número de escrituras intentadas iguala exactamente los casos RESOLVABLE (nunca los otros buckets).
- **Confirmar que la evidencia quedó archivada** (salida completa) **junto con el commit ejecutado** (`git rev-parse HEAD`).

## 8. Reejecución

- **Cuándo es seguro:** siempre. El executor es **idempotente, resumible, reejecutable y solo-avance**.
- **Qué debería cambiar entre corridas:** los que fueron `APPLIED` pasan a **`ALREADY_APPLIED`** en la siguiente corrida; los `RETRYABLE` (si hubo) deberían resolverse a `APPLIED`/`ALREADY_APPLIED`.
- **Qué debe permanecer igual:** conteo de `OwnershipPosition` y `Acquisition`; las `quantity`; los buckets; `ALREADY_PRESENT` (posiciones de otras fuentes intactas).
- **Por qué es idempotente:** clave estable `legacy-backfill:{userId}:{volumeId}` (`ON CONFLICT DO NOTHING`) + **skip-if-position-exists** atómico vía el unique `OwnershipPosition(userId, volumeId)`. Una interrupción a mitad de camino se retoma sin duplicar.

## 9. Rollback

- **El backfill NO tiene rollback automático.** Una posesión ya migrada (posición + `Acquisition`) permanece.
- **El rollback no forma parte del executor**: solo puede realizarse mediante **restauración de la base** (point-in-time de Neon) o una **futura migración compensatoria**. No existe tooling de rollback/compensación de F2.2.
- **Ante `CONFLICT`:** cada fact conflictivo **ya abortó su propia transacción** (no dejó estado parcial). No hay que revertir nada de ese fact; hay que **investigar la inconsistencia** antes de reejecutar.
- **Ante `TERMINAL`:** el fact no se aplicó (referencia desaparecida); no hay estado que revertir. Reejecutar no lo recupera (es terminal por diseño).
- **Si la corrida se interrumpe:** no queda estado parcial por fact (cada fact es atómico); es seguro **volver a correr** (retoma por idempotencia).
- **Recurso a nivel base (no es tooling de F2.2):** Neon ofrece restauración point-in-time con ventana **~6 h**; es la única forma de deshacer escrituras ya confirmadas, y es una operación de DBA fuera de este runbook.

## 10. Riesgos conocidos (buckets deliberadamente no migrados — ADR-012)

- **`AMBIGUOUS`:** hay ≥2 destinos candidatos → migrar elegiría uno posiblemente incorrecto. Se preserva la ambigüedad; requiere resolución explícita.
- **`ORPHAN_NO_EDITION`:** no existe `PublisherEdition` para el ancla → no hay destino; incorporarlo es tarea de catálogo.
- **`ORPHAN_NO_VOLUME`:** existe la edición pero falta la fila `Volume` → materializar el `Volume` es una decisión de catálogo, no de este backfill.
- **`EDITION_KEY_MISMATCH`:** el ancla existe bajo otra `editionKey` → mapear arriesga la edición equivocada.

Todos permanecen servidos por el **backstop legado** (ADR-011) hasta que reciban tratamiento explícito. Su presencia en el resumen es **esperada y correcta**, no un error.

## 11. Evidencia a conservar

Por cada corrida, archivar:
- **Operador** que ejecutó la corrida.
- **Commit** ejecutado (`git rev-parse HEAD`; confirmar que contiene `bb3e855`).
- **PR** de integración de F2.2 (#176).
- **Entorno** destino (staging | prod) y **host** confirmado.
- **Timestamp** (hora de inicio y de finalización).
- **Salida completa** de la corrida (archivo `.log`), **sin credenciales ni connection string** (la línea `Destino →` muestra host/base, no credenciales).
- **Duración** y **resumen final** (buckets + resultados + ambas invariantes).

Guardar en una ubicación auditable (no en el repo salvo decisión explícita); nombrar con entorno + timestamp.
