# F2 Completion Report — Backfill de colección legada → Collection

**Fecha:** 2026-07-29 · **Estado:** Completada · **Documento de cierre de fase (no ADR, no runbook)**

## Objetivos originales de F2
Migrar la colección legada (`OwnedVolume`) al nuevo modelo Collection (`OwnershipPosition` + `Acquisition`), estableciendo presencia **solo donde el destino es determinístico** (bucket RESOLVABLE), **sin alterar catálogo ni legado**, de forma **idempotente, resumible y solo-avance**, bajo una política explícita y auditada.

## Componentes implementados
- **Dry-run de backfilleabilidad** (read-only): `lib/collection-read/backfill-scan.ts` (5 buckets mutuamente excluyentes/exhaustivos), adapter `catalog-universe`, `scripts/backfill-collection-dryrun.ts` (guard de destino).
- **Política F2** — `docs/adr/012-collection-backfill-policy.md`: migración automática **solo RESOLVABLE**; los otros 4 buckets requieren tratamiento explícito (justificación por semántica/invariantes/seguridad, no por porcentajes).
- **Executor F2.2** — `lib/collection-context/backfill.ts` (`establishLegacyPresence` atómico vía unique `OwnershipPosition`), `scripts/backfill-collection-run.ts` (reutiliza `scanUser` + `resolveCorrespondence`), canal aditivo `ACQUISITION_CHANNEL.LEGACY_BACKFILL`, tests unit + integración.
- **Runbook operativo** — `docs/runbooks/collection-backfill-f2.md` (12 secciones: supuestos → evidencia).

## PRs
- **#176** — F2.2 executor + ADR-012 → `staging` (merge `d628f0f`).
- **#177** — runbook operativo → `staging` (merge `82da081`).

## Commits principales
- `728b123` dry-run · `30dbd4a` ADR-012 · `bb3e855` executor F2.2 · `3969d97` runbook · merges `d628f0f`, `82da081`.

## Validaciones realizadas
- `npm run check` 804 ✓; lint limpio; `test:identity-it` 291 ✓ (24 archivos).
- Dry-run read-only contra staging **y** producción (idénticos: pre-launch).
- Preflight de migraciones (staging up to date, 69 migraciones, 0 pendientes/0 fallidas).
- Checks de Vercel en verde en #176 y #177.
- Preflight operativo del runbook (Git/entorno/base/deployment) ejecutado como operador.

## Ejecución real
Una **única** corrida controlada contra **staging**, desde worktree temporal detached en `82da081` (ex `origin/staging`).
Inicio `2026-07-29T18:25:36Z` → fin `2026-07-29T18:25:42Z`; executor 4781 ms; **exit code 0**.

## Resultado final
- 58 `OwnedVolume`; 2 usuarios (ambos con ≥1 no-resoluble).
- Buckets: RESOLVABLE **0**, AMBIGUOUS 0, ORPHAN_NO_EDITION **53**, EDITION_KEY_MISMATCH **5**, ORPHAN_NO_VOLUME 0. **Σ = 58 == total ✅**.
- Escrituras: todas 0. **Σ resultados = 0 == RESOLVABLE ✅**.
- Sin CONFLICT/TERMINAL/RETRYABLE, sin error desconocido, sin escritura fuera de RESOLVABLE.
- Cero escrituras es el **resultado esperado** (base pre-launch, 0% RESOLVABLE); la corrida **valida el procedimiento end-to-end**.

## Estado de staging
`82da081` READY; schema up to date; Collection sin cambios por el backfill (0 escrituras); legado intacto.

## Estado de producción
**Intacta** — último deploy `1445a6b` (main), READY. F2.2 **no** desplegado a prod; ejecución en prod **no autorizada y no realizada**.

## Riesgos abiertos (F3)
- Las 58 posesiones legadas siguen servidas por el **backstop legado** (ADR-011).
- 53 ORPHAN_NO_EDITION + 5 EDITION_KEY_MISMATCH **no son migrables hoy**: requieren tratamiento de catálogo (materializar/mapear ediciones) antes de poder resolverse.
- La muestra staging == prod es **pre-launch, no representativa**: con usuarios reales aparecerán casos RESOLVABLE.
- El **retiro del legado (F3)** / cutover sigue pendiente de diseño.

## Trabajo futuro (fuera del alcance de F2)
Los siguientes ítems se documentan únicamente para preservar la continuidad del proyecto y **no forman parte de F2**. No iniciar sin pedido explícito.

1. Tratamiento de catálogo para ORPHAN_NO_EDITION / EDITION_KEY_MISMATCH.
2. Reejecución del backfill cuando exista RESOLVABLE > 0 (idempotente por diseño).
3. Diseño de F3 (retiro del legado / cutover).
4. Promoción de F2.2 a producción, bajo autorización + runbook de prod dedicado.
