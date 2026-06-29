# ADR-002: Mutation Framework

- **Estado**: Aceptado
- **Fecha**: 2026-06-29
- **Spec**: [`../mutation-framework.md`](../mutation-framework.md)

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

1. **`{ validate, preview?, execute }`, NO un *recorder*.** Un recorder
   (`m.update/delete/create` que calcula el `after`) tendría que conocer la
   semántica de Prisma (updateMany, upsert, nested writes, increment, JSON…) y
   terminaría siendo un mini-ORM. En su lugar: `preview()` lee y arma el diff;
   `execute(tx)` usa **Prisma normal**. El framework **gobierna**, no reemplaza.
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
8. **Auditoría por interfaz** (`AuditSink`). v1 usa `ConsoleAuditSink`; la tabla
   `MutationLog` se diseña **después** de usar el framework (paso 4), para no
   congelar un esquema antes de saber qué campos hacen falta.
9. **Versionado**: `frameworkVersion` **y** `definitionVersion` (saber con qué
   versión de la operación se ejecutó un log viejo).
10. **Idempotencia** `key` + `scope` + `expiresAt`: permanente por default, cada
    operación decide (sync 24h, bulk import 7d).
11. **R2 para el diff completo: DIFERIDO.** Medir el peso real antes de optimizar.
    No se construye infra para problemas que todavía no existen.

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
