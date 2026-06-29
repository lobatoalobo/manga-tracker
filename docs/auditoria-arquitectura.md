# Auditoría de arquitectura — bitácora viva

Registro de hallazgos y decisiones de la auditoría técnica del proyecto. Las
decisiones individuales y su *por qué* se congelan en [`adr/`](adr/); este doc es
el índice vivo (estado, severidades, links).

> Severidades: 🔴 crítica · 🟠 importante · 🟢 opcional.
> Última actualización: 2026-06-29.

## Plan de fases (orden acordado)

| Fase | Tema | Estado |
|---|---|---|
| **0** | **Seguridad operativa** (scripts/mutaciones/backups/rollback) | 🟡 diseño aprobado |
| 1 | Arquitectura / capas / dominios | pendiente |
| 2 | Modelo de dominio (entidades, invariantes) | pendiente |
| 3 | Data layer (Prisma / Postgres / Neon) | pendiente |
| 4 | Ingesta (regex / providers / APIs / pipeline) | pendiente |
| 5 | Runtime Next (RSC / Server Actions / caché / streaming) | pendiente |
| 6 | UI / UX / design system | pendiente |
| 7 | DX / Performance / Costos | pendiente |

**Principio de trabajo:** responder las preguntas de arquitectura *antes* de mover
archivos (cuáles son los bounded contexts, qué es dominio/infra/transporte/
presentación, qué invariantes tiene el negocio, qué dependencias invertir). Refactors
en pasos chicos, independientes, que no rompen el proyecto.

---

## Hallazgos preliminares (a profundizar por fase)

| # | Hallazgo | Sev | Fase |
|---|---|---|---|
| A1 | **Mutaciones a prod sin red de seguridad** (scripts descartables, sin dry-run obligatorio, sin auditoría, sin límites) → ya causó corrupción ×3 | 🔴 | 0 |
| A2 | **No hay capa de dominio**: `services/`/`types/` tienen 1 archivo c/u; la lógica vive en `actions.ts` (1437 líneas) y `catalog.ts` (1111) | 🔴 | 1 |
| A3 | **El dominio depende de Prisma** (funciones toman/devuelven `Prisma.Work`, queries inline) → la DB dicta el modelo de negocio | 🔴 | 1/2 |
| A4 | `catalog.ts` viola SRP (constantes + normalización + queries + presentación juntas) | 🟠 | 1 |
| A5 | Catálogo entero al cliente + filtrado en memoria (`browseWorks take:10000` + `CatalogBrowser` 879 líneas) — techo de escala | 🟠 | 5 |
| A6 | Pseudo-id negativo `Manga.anilistId = -workId` (el modelo de colección miente sobre su clave) | 🟠 | 2/3 |
| A7 | `genres String[]` (sin facetado), Json sin tipar en boundary (`readingLinks`), falta `noUncheckedIndexedAccess` | 🟢 | 3/7 |

**Invariantes del negocio que el modelo NO enforcea hoy** (se rompieron a mano; son
el cimiento de la Fase 2): ≤1 edición por (editorial, identidad) por Work · solo
fusionar Works de la **misma serie** · `published ≤ primer_tomo_futuro − 1` ·
`type=COMIC` ⇒ fuera del catálogo visible.

**Bounded contexts** (lectura inicial, a validar en Fase 1): Catalog (core) ·
Ingestion · Collection · Identity · Notifications · Media.

---

## Fase 0 — Seguridad operativa

**Decisión:** construir un **Mutation Framework** transversal en vez de parchar
scripts. Una mutación = objeto de primer nivel (validación / política / trazabilidad
/ versionado / contrato), igual desde script, cron o Server Action.

- Spec técnica: [`mutation-framework.md`](mutation-framework.md).
- Decisión + alternativas: [`adr/002-mutation-framework.md`](adr/002-mutation-framework.md).
- Runbook de restore de Neon (ensayar el PITR): _pendiente_ → `runbook-restore.md`.

**Orden de implementación:** docs (✔) → framework + tests (sin prod, sin migración)
→ migrar `mergeWork` real → diseñar la tabla `MutationLog` con lo aprendido → v1.5
Server Actions.

---

## Índice de ADRs

Ver [`adr/README.md`](adr/README.md). Aceptados: **002** (Mutation Framework).
