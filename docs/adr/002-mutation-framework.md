# ADR-002: Mutation Framework

- **Estado**: Aceptado · **Implementado** (Fase 0, v1)
- **Fecha**: 2026-06-29 · **Actualizado**: 2026-06-28 (as-built tras stress test)
- **Spec**: [`../mutation-framework.md`](../mutation-framework.md)
- **Código**: `lib/mutations/` (core, Prisma-free en todo el árbol) · `lib/infra/`
  (adapters Prisma: `mutations.ts` transversal + `work/merge.ts`) · `lib/domain/work/`
  (reglas puras) · `lib/catalog/mutations/mergeWork.ts` (orquestación)

## Contexto

Las mutaciones de datos de riesgo (merge/split/clasificación/borrado de catálogo)
se ejecutan con scripts descartables **directo contra producción**: sin dry-run
obligatorio, sin diff, sin auditoría, sin límites. Esto ya produjo **corrupción de
datos** (over-merge de spin-offs colapsados ×3 durante una sola sesión de trabajo).
El mayor riesgo del proyecto hoy **no es la arquitectura del runtime; es esto.**

`scripts/with-prod.mjs` no pide confirmación; de 52 scripts, ~29 mutan sin gate de
dry-run, con convención mezclada (`--apply`/`--dry`/`--yes`); no hay tabla de
auditoría; el restore PITR de Neon nunca se ensayó.

## Decisión

Construir un **Mutation Framework** transversal: una mutación es un **objeto de
primer nivel** (identidad, validación, política, trazabilidad, versionado,
contrato), no un script. Toda escritura de riesgo —de script, cron o Server
Action— pasa por el mismo contrato.

Decisiones de diseño (las "esquinas" que se discutieron):

1. **`{ validate, preview?, execute }` con PLAN, NO un *recorder*.** Un recorder
   (`m.update/delete/create` que calcula el `after`) tendría que conocer la
   semántica de Prisma (updateMany, upsert, nested writes, increment, JSON…) y
   terminaría siendo un mini-ORM. En su lugar: `preview()` lee, arma el diff y
   produce un **`MutationPlan` (P)**; `execute(ctx, input, plan)` **consume** ese
   plan (no re-deriva) usando **Prisma normal** vía `ctx.write`. El framework
   **gobierna**, no reemplaza. El core no importa Prisma: el acceso entra por
   `ctx.read`/`ctx.write` opacos + `TransactionRunner` inyectado por el adapter.
2. **`preview` es OPCIONAL.** No toda mutación necesita diff (regenerar caché,
   recalcular contador). Sin preview, la policy trabaja sobre metadata que provee
   la operación.
3. **El framework no conoce reglas de negocio.** Solo invoca `definition.validate`.
   Hoy el validador vive en `lib/catalog/mutations/`; cuando exista la capa de
   dominio (Fase 2) se mudará a `lib/domain/` **sin tocar el framework**.
4. **Validación ANTES y SEPARADA de la policy.** "Las series son distintas" es un
   invariante de dominio, no una cuestión de conteo: rechaza aunque afecte 1 fila.
5. **Re-validar dentro de la transacción** antes de escribir (cierra la ventana
   entre preview y execute; es parte del contrato, no una optimización).
6. **Límites por OPERACIÓN concreta**, no por categoría: `mergeWork` mueve decenas
   de ediciones y está bien; `mergePublisher`/`mergeAuthor` son distintos.
7. **Entorno explícito** (`APP_ENV`/`VERCEL_ENV`), nunca inferido de `DATABASE_URL`.
8. **Auditoría por interfaz** (`AuditSink`). El core default es `ConsoleAuditSink`
   (Prisma-free); los callers inyectan `PrismaAuditSink`. La tabla `MutationLog` se
   diseñó **después** de usar el framework (con el `AuditEntry` ya congelado v1), y
   persiste el shape 1:1, aplanado y consultable.
9. **Versionado**: `frameworkVersion` **y** `definitionVersion` (saber con qué
   versión de la operación se ejecutó un log viejo).
10. **Idempotencia** `key` + `scope` + `expiresAt`: permanente por default, cada
    operación decide (sync 24h, bulk import 7d).
11. **R2 para el diff completo: DIFERIDO.** Medir el peso real antes de optimizar.
    No se construye infra para problemas que todavía no existen.

## Resultado del stress test (`mergeWork`)

Migrar la operación más peligrosa (borra un Work + re-clava data de usuario) validó
el diseño y lo endureció. Decisiones que salieron de usarlo de verdad (detalle en el
spec, "Decisiones registradas"):

- **Pragmatic mode + warnings** (no strict): `preview` es best-effort; `execute` es la
  verdad; el mismatch se audita, no aborta.
- **Plan-consume** confirmado: `buildMergePlan` (puro) + `applyMergeInTx` → una lógica,
  cero drift; lo comparten el `mergeWorks()` viejo y la mutación.
- **Bug encontrado y corregido**: el gate de confirmación corría antes del early-return
  de dry-run (un preview no confirma). El control-flow ya importa críticamente.
- **`ctx.read as PrismaClient`**: era un leak (🔴); **resuelto en Fase 2** con
  `MutationContext<R,W>` genérico + puertos de dominio (sin cast). Capas
  domain/infra/orquestación separadas.
- **`AuditEntry` congelado v1**; `MutationLog` lo persiste 1:1.

## Work lifecycle invariants (emergió al migrar `deleteWork`)

Migrar `deleteWork` (2ª critical-path mutation) confirmó la hipótesis: **comparte un
invariante con `mergeWork`** — la *clave de dominio* (`anilistId ?? -id`) bajo la que
viven colección/deseados/notas. Estaba duplicada en `mergeWorks`/`deleteWork`; se
extrajo a `lib/domain/work/identity.ts` (`workDomainKey`), reusada por ambos. NO se
construyó un "sistema de invariantes": hoy hay UNO compartido; el módulo crece
orgánicamente si aparecen más (anti gold-plating). Los invariantes son **explícitos**
(funciones puras en `lib/domain/work/*`), no dispersos en queries.

Decisión de policy del delete: `requiresConfirmation: "always"` (no solo prod — no
hay undo salvo PITR) y `maxDeletes: 1` gobierna el borrado del **Work primario**; las
dependencias (ediciones, colección…) son cascade y se exponen en el `preview`
(magnitud + warnings), no se cuentan como deletes del circuit-breaker.

## Estado de implementación

- ✔ Core (`types/define/run/policy/context/errors/audit`), Prisma-free (fitness-test
  lo enforce), 100+ tests de contrato.
- ✔ Adapters Prisma transversales (`PrismaAuditSink` + `PrismaIdempotencyStore`) en
  `lib/infra/`; IO por operación junto al dominio (`lib/infra/work/*`, `lock` por
  `FOR UPDATE`).
- ✔ `mergeWork` + `deleteWork` reales (dominio puro + puertos + orquestación sin
  Prisma), con scripts `merge-work`/`delete-work`. Invariantes testeados.
- ✔ `MutationLog`: schema + migración **como archivo**.
- ⏳ **Pendiente**: aplicar la migración y un re-run en vivo (dry-run) con logs reales.
  Bloqueado a propósito: staging comparte DB con prod (memoria `test-environment`);
  se hará cuando haya DB de staging separada o con aprobación explícita.
- ⏳ v1.5: integración con Server Actions (admin críticas).

## Consecuencias

**Buenas:**
- Un dry-run + diff habría cacheado los over-merges *antes* de escribir.
- Mismo contrato para script/cron/Server Action → no se duplica disciplina.
- Mutaciones testeables (validate/preview sin DB).
- La Fase 2 (dominio) no requiere tocar infraestructura: solo mover validadores.

**Malas / costos:**
- Las operaciones de catálogo se migran de `prisma.x` directo a definiciones
  (ergonomía distinta, trabajo inicial).
- Disciplina nueva: las mutaciones dejan de ser scripts ad-hoc y pasan a estar
  commiteadas y versionadas.

## Alternativas consideradas

- **Recorder completo (plan→diff→apply automático)** — descartado en v1: se vuelve
  un mini-ORM. Reconsiderable si aparece necesidad real.
- **Wrapper simple (`runMutation(fn)`) con Prisma directo** — descartado: sin diff
  ni límites *antes* de escribir, no previene el bug.
- **Solo disciplina (convención de `--dry`/`--apply` por script)** — descartado: es
  lo que hay hoy y falló; depende de que cada dev se acuerde.
