# Mutation Framework — Especificación técnica

> Estado: **diseño aprobado, sin implementar** (Fase 0 de la auditoría técnica).
> Decisión congelada en [`adr/002-mutation-framework.md`](adr/002-mutation-framework.md).
> Bitácora de la auditoría: [`auditoria-arquitectura.md`](auditoria-arquitectura.md).

## Problema que resuelve

Hoy las mutaciones de datos de riesgo (merge/split/clasificación/borrado de
catálogo) se ejecutan con scripts descartables **directo contra producción**, sin
dry-run obligatorio, sin diff, sin auditoría y sin límites. Ya produjo corrupción
(over-merge de spin-offs ×3). El runtime no es el mayor riesgo del proyecto; **esto
lo es**.

## Idea central

> **Una mutación es un objeto de primer nivel del dominio técnico**: tiene
> identidad, validación, política, trazabilidad, versionado y contrato. No es un
> "script". Da igual desde dónde se ejecute (script, cron, Server Action o una
> futura UI de admin): **todas pasan por el mismo contrato**.

## Principios (innegociables)

1. **No es un ORM.** Gobierna mutaciones; nunca compite con Prisma. Prohibido
   `m.findMany/aggregate/groupBy/...`. En `execute` se usa **Prisma normal**.
2. **No es un motor de reglas de negocio.** El framework solo *invoca* un
   validador; no sabe qué validan. Las reglas viven en la operación / el dominio.
3. **Todo desacoplado por interfaz** (preview, audit, confirmación): el framework
   depende de contratos, no de implementaciones.
4. **Dry-run por default.** Aplicar requiere intención explícita.

## El pipeline

```
runMutation(definition, input)
   │
   ├─ 1. VALIDATE     definition.validate(input)         ← reglas de DOMINIO
   │                  (independientes del conteo; "¿misma serie?" → rechaza aunque sea 1 fila)
   ├─ 2. PREVIEW?     definition.preview?(input)          ← OPCIONAL → MutationPreview (diff + métricas)
   │                  si no hay preview, la policy usa metadata que provee la operación
   ├─ 3. POLICY       límites por operación + circuit-breaker sobre las métricas
   ├─ 4. CONFIRM      estrategia por actor (script: prompt / action: flag / cron: none)
   ├─ 5. EXECUTE      definition.execute(tx, input) — Prisma normal, en transacción
   │                  RE-VALIDATE dentro de la tx antes de escribir (R1, ver abajo)
   └─ 6. AUDIT        AuditSink.record(...) — el intento Y el resultado
```

**Validation primero y separada de Policy:** "estas dos series son distintas" no es
cuestión de *cuántas* filas — es un **invariante de negocio**. Que viva acá es lo
que frena el over-merge *aunque toque 1 fila*. Es el puente a la Fase 2 (modelo de
dominio): el framework no cambia cuando el validador se mude de
`catalog/mutations/mergeWork.ts` a `domain/work/mergeValidator.ts`.

**Preview opcional:** regenerar caché, recalcular un contador o reindexar no
necesitan diff. Forzar preview generaría previews vacíos. Si hay preview → hay
diff + métricas + circuit-breaker; si no → la policy trabaja sobre la metadata que
la propia operación declara (ej. `{ estimatedAffected }`).

## `MutationDefinition` (tipada, versionada, por operación)

```ts
const mergeWork = defineMutation<{ sourceId: number; targetId: number }>({
  name: "mergeWork",
  definitionVersion: 1,                         // versionada (ver Auditoría)
  kind: "MERGE",
  validate: async ({ sourceId, targetId }) => { /* misma serie? si no → throw ValidationError */ },
  preview:  async (input) => { /* → MutationPreview */ },   // opcional
  execute:  async (tx, input) => { /* Prisma normal */ },
  policy:   { maxAffected: 60, maxDeletes: 1, requiresConfirmation: "prod", requiresReview: true },
  idempotency: (i) => ({ key: `merge-${i.sourceId}-${i.targetId}` }),   // permanente por default
});

await runMutation(mergeWork, { sourceId: 211, targetId: 154 });   // dry por default
```

- **Límite por operación, no por categoría:** `mergeWork` mueve decenas de
  ediciones y está bien; `mergePublisher` afecta cientos; `mergeAuthor` otra cosa.
  Default sensato por operación, override por llamada.
- **Tipado estricto:** `runMutation(def, input)` infiere `input`. Cero `any`.

## Interfaces desacopladas

- **`PreviewProvider`** → produce `MutationPreview { diff, metrics:{creates,updates,deletes} }`.
  Lo aporta la operación; el framework no sabe construirlo.
- **`AuditSink`** → `record(entry)`. v1 trae `ConsoleAuditSink`; el `PrismaAuditSink`
  (tabla `MutationLog`) llega en el **paso 4**, después de usar el framework y saber
  qué campos hacen falta de verdad.
- **`ConfirmationStrategy`** → por actor:

| Actor | Confirmación | dry-run default |
|---|---|---|
| Script | prompt interactivo (escribir `PROD`) en prod | sí, `--execute` para aplicar |
| Server Action | flag `confirmed:true` recolectado por la UI | la UI decide |
| Cron | ninguna | aplica directo (pero límites + audit siguen) |

## Idempotencia

`idempotency: (input) => ({ key, scope?, expiresAt? })`.
- **Permanente por default** (un MERGE no debe re-correr nunca).
- Cada operación decide otra cosa: `syncGoogleBooks` → 24h, `bulkImport` → 7d.
- Antes de ejecutar: si hay un run exitoso, no-dry, mismo `key` (no expirado) →
  `Already executed. Skipping.`

## R1 — Re-validar dentro de la transacción (parte del contrato, no optimización)

`preview` lee en T0; el operador confirma; `execute` corre en T1 (2 s, 10 min, o
—con colas a futuro— mañana). `execute` **re-corre `validate()` dentro de la tx**
antes de escribir: un preview viejo no puede aplicar un cambio ahora inválido.

## Entorno: explícito, no inferido

`APP_ENV` / `VERCEL_ENV` — **nunca** parsear `DATABASE_URL` (el día que cambie Neon,
se rompe la detección). La política sube en `production`.

## Trazabilidad

`correlationId` + `requestId`, tomados del **trace de Sentry** cuando existe → un
error en Sentry linkea a su entrada de auditoría. Un solo hilo: Sentry → Server
Action → mutación → cron.

## Modelo de auditoría (campos previstos — la tabla se diseña en el paso 4)

`schemaVersion`, `frameworkVersion`, **`definitionVersion`**, `name`/`kind`,
`actorType`/`actor`/`source`, `env`, `correlationId`/`requestId`, `entity`/
`entityId?`, `affected{creates,updates,deletes}`, `dryRun`, `summary` (primeros N
cambios, inline), `diffHash`, `reason`, `metadata`, `mutationKey?`/`scope?`/
`expiresAt?`, `durationMs`, `success`, `error`.

- **Tabla chica**: `summary` + `diffHash` inline. El diff completo a **R2 está
  DIFERIDO** — primero medimos cuánto pesa un diff promedio; no se construye infra
  para un problema que todavía no existe.

## Estructura de archivos

```
lib/mutations/
  run.ts        → runMutation(definition, input)  (orquesta el pipeline)
  define.ts     → defineMutation<Input>()  (tipado)
  policy.ts     → límites + circuit-breaker
  confirm.ts    → ConfirmationStrategy (por actor)
  audit.ts      → AuditSink (interfaz) + ConsoleAuditSink
  preview.ts    → PreviewProvider (interfaz) + helpers de diff
  context.ts    → actor/source/env explícito + correlationId (Sentry)
  errors.ts     → ValidationError, PolicyError, ...
  types.ts
```

Las **operaciones** viven fuera del framework (`lib/catalog/mutations/*` hoy;
`lib/domain/*` cuando exista la capa de dominio).

## Orden de implementación (pasos chicos, sin big-bang)

1. **Docs + ADR** (este documento). ✔ en curso.
2. **Framework** con tests, **sin tocar prod, sin migración**. Audit = `ConsoleAuditSink`.
3. **Migrar UNA mutación real** (`mergeWork`) y usarla de verdad → ahí salen las
   APIs feas, los datos que faltan, las validaciones repetidas. **Todavía sin tabla.**
4. **Recién ahí** diseñar la migración definitiva de `MutationLog` (con lo aprendido:
   `operationName`, `definitionVersion`, `previewDuration`, `validationDuration`…).
5. v1.5: integración Server Actions (admin críticas).

## Fuera de alcance (anti gold-plating)

Recorder (mini-ORM — si alguna vez hace falta) · artifact de diff a R2 (cuando los
diffs crezcan) · dashboards sobre `MutationLog` · event-sourcing/CQRS · reversibilidad
universal (el "undo" real es el restore PITR de Neon, ver runbook).
