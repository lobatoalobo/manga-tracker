# Handoff — arco cross-type + fixes /autores (jul 2026)

> **Registro de cierre** del arco cross-type + fixes `/autores`, **MERGEADO a
> producción** vía PR #139. La app es **Nakama** (tracker de manga/cómics AR:
> Next.js 16 App Router/RSC, React 19 + Tailwind, Prisma 6 + Neon Postgres,
> Cloudflare R2, Auth.js v5, Vercel). Ramas: `main`=prod, `staging`=trabajo.

## TL;DR — qué quedó en producción
**PR #139** (`release/pre-identity` → `main`) promovió ~196 commits pre-identidad a
prod. Durante su QA aparecieron **dos blockers**, resueltos en código + datos:

1. **BLOCKER cross-type** (manga se fusionaba con cómic en el dedup) → **guard +
   scan + split de Reborn**, aplicado en prod y staging.
2. **BLOCKER funcional `/autores`** (autores de cómic daban 404 / no salían en el
   listado) → **fix detalle + fix listado**.

**#139 MERGEADO** (merge commit `e4a60bc` en `main`) y **deployado a prod**
(`mangas-nakamas.vercel.app`). Spot-check en prod PASÓ (ver "Verificación en prod").
**Sin aplicar migraciones**; `mutation_log` sigue gated. **Identidad NO incluida.**

## Commits del arco (en `release/pre-identity`, ya en `main`)
`191a866..ca86e46`:
- `e8feb00` `fix(catalog)`: **guard cross-type** en `findOrCreateWork`.
- `9cdcc92` `chore(catalog)`: **scan** read-only `scripts/scan-crosstype.ts`.
- `01155a3` `chore(catalog)`: **split** `scripts/split-work-1716.ts`.
- `d110d2f` `chore`: gitignore de `scripts/.backup-*.json`.
- `5ca4234` `fix(autores)`: **detalle** `/autores/[name]` usa `content:"all"`.
- `ca86e46` `fix(autores)`: **listado** `getLocalAuthors()` usa `inCatalogWhere("all")`.

Merge a `main`: `e4a60bc` (merge commit, preserva historia del lote).

---

## 1. Guard cross-type (el BLOCKER de fondo)
**Problema:** `findOrCreateWork` (`lib/catalog.ts`) dedupeaba por título /
`tightTitleKey` / puente romaji **sin mirar `Work.type`** → un cómic (Panini/
Ovni/Utopía) podía fusionarse con un manga homónimo o del mismo romaji. El puente
romaji (nuevo en #139) + los crons Ivrea/VIZ lo dispararían **en automático**.

**Fix (`e8feb00`):**
- `findOrCreateWork` acepta `incomingType?: "MANGA" | "COMIC" | null`.
- Callers cableados: Ivrea catálogo/próximas = `MANGA`, VIZ = `MANGA`, Whakoom =
  `looksLikeComic(title, author)` (de `lib/contentType`, author-aware).
- Los matches **débiles** (título/`tightTitleKey`/romaji) rechazan cross-type vía
  `sameContentClass(incoming, existing.type)` = `(existing==="COMIC")===(incoming==="COMIC")`.
- Los **ids fuertes** (anilistId/muId/mdId, provider-scoped a manga) **no** se
  guardan (los cómics no los tienen).
- El create setea `type` cuando `incomingType` está definido. `Work.type` nunca es
  null (`@default("MANGA")`); incoming null = no-cómic.
- Tests: `sameContentClass` en `tests/logic.test.ts`.

**Nota:** hay una duplicación PRE-EXISTENTE de `looksLikeComic`: `lib/comicTerms.ts`
(viejo, title-only, lo usa `catalog.ts`) vs `lib/contentType.ts` (nuevo, author-aware,
lo usa el guard en `whakoomImport`). No se dedupeó (fuera de alcance).

## 2. Scan cross-type (guardrail permanente)
`scripts/scan-crosstype.ts` (READ-ONLY, `dbRetry`). Buckets:
- **MERGE** = ≥2 ediciones con señal manga+cómic → candidato a split.
- **RECLASIF** = 1 edición con señal contradictoria → NO es merge (cómic mal
  tipeado o falso positivo del clasificador).
- `--dump id,id` para inspección puntual.
- Correr tras cada import: `node scripts/with-prod.mjs npx tsx scripts/scan-crosstype.ts`.

**Resultado sobre prod:** el ÚNICO merge real era **#1716 "Reborn"**. Los otros 8
hits son RECLASIF single-edition (4 cómics occidentales mal tipeados MANGA con id
manga espurio: #838 Cyber Force, #791 300, #1040 The Darkness, #1062 Witchblade; y
4 falsos positivos que son manga correcto: #2455 Black Cat, #2418 Dogs, #338 Star
Wars Lost Stars, #1560 Blossoming Blade). **Los 8 RECLASIF quedaron SIN tocar** (no
son merges; limpieza diferida).

## 3. Split de #1716 Reborn (APLICADO en prod y staging)
`scripts/split-work-1716.ts` (dry-run default, `--apply` transaccional + backup
JSON, `--rollback <file>`). Separó:
- **#1716** quedó = **manga** Katekyo Hitman Reborn! (conserva anilistId=30047,
  muId, mdId + metadata manga; se corrigieron title→"Katekyo Hitman Reborn!",
  author→"Akira Amano", type→MANGA; 2 ediciones VIZ).
- **Work nuevo = cómic** "Reborn" de Mark Millar (edición Utopía #3452, sin ids
  manga, sin metadata manga heredada). Portada quedó null → correr `whakoom-covers`.
- **newWorkId: prod = 2688, staging = 2687** (staging fue re-sincronizado desde
  prod después, así que HOY ambas DBs muestran #2688 = Reborn cómic).
- **0 user-data afectada** (no había filas para -1716/30047).
- Post-split `scan-crosstype` = **0 MERGE** en ambos.
- Backups locales gitignored (`scripts/.backup-split-1716-*.json`).

## 4. Fix `/autores` detalle (`5ca4234`)
**Problema:** `/autores/[name]` usaba el default `content:"manga"` (filtra
`type != COMIC`) → un autor solo-cómic (ej. **Tom Taylor**, 12 obras COMIC) daba 0
resultados → `notFound()` → **404**.
**Fix:** `inCatalogWhere` acepta `content:"all"` (sin filtro type); la página de
detalle lo usa. `browseWorks({author})` ya busca en **`Work.author` Y `Work.credits`**
(JSONB `@>`), así que autores en credits también resuelven.
**Verificado (DB prod):** `browseWorks({content:"all",author:"Tom Taylor"})` = **12**;
autor manga (Urasawa) 7=7 sin cambios.

## 5. Fix `/autores` listado (`ca86e46`)
**Problema (separado):** `getLocalAuthors()` usaba `inCatalogWhere()` default manga
→ el índice/listado `/autores` excluía autores solo-cómic.
**Fix:** `getLocalAuthors()` → `inCatalogWhere("all")`. Índice **~719 → 955**;
Tom Taylor (12) y Mark Millar (18) ahora aparecen; autores manga intactos. Sigue
leyendo solo `Work.author` (no credits — fuera de alcance).

---

## Verificación en producción (post-merge, PASÓ)
Spot-check en `mangas-nakamas.vercel.app`:
- `/autores/Tom Taylor` → **12 obras**, sin 404.
- `/autores` → Tom Taylor / Mark Millar aparecen en el índice; autores manga intactos.
- `/serie/1716` → manga "Katekyo Hitman Reborn!", Akira Amano, VIZ, sinopsis Tsuna/Vongola.
- `/serie/2688` → cómic "Reborn", Mark Millar, Utopía, sin metadata manga.
- `/catalogo` → carga, default manga; `?content=comic` → sección cómics.
- `/admin/identidad` → 404 (identidad no incluida en este lote).

Merge sin migraciones: solo `mutation_log` queda **pending/gated** (verificado que
ningún runtime de `app/` consulta `MutationLog` — `PrismaAuditSink` es script-only).

## ⚠️ Lección permanente: qué deploy corre qué código (gotcha)
Un mismo repo tiene **3 deploys en Vercel, cada uno con OTRA rama**:
- **prod** (`mangas-nakamas.vercel.app`) = rama `main`.
- **`nakama-staging.vercel.app`** = rama `staging` (¡incluye identidad!).
- **preview** (`manga-tracker-git-<rama>-…vercel.app`) = esa rama; protegido por SSO
  (WebFetch/Claude no pasa; el dueño logueado sí).

Al probar un fix que vive en una rama, **hay que smokear el deploy de ESA rama**. En
este arco el smoke falló 2 veces por probar `nakama-staging`/prod (sin los commits).
Tip de diagnóstico: un dato compartido entre DBs (ej. `/serie/2688`) NO discrimina el
deploy; el discriminante es la página que cambia el fix (`/autores/Tom Taylor`).

---

## Follow-ups abiertos (no urgentes, ninguno bloquea)
- Portada del cómic #2688 quedó null → `whakoom-covers`.
- Los **8 RECLASIF** (cómics mal tipeados MANGA + falsos positivos) → limpieza aparte.
- Las **2 ediciones VIZ duplicadas** de #1716 (9969 "Reborn!" + 16880 "Kateikyoushi
  Hitman Reborn!") → edition-dup para `/admin/duplicados`, no cross-type.
- Dedup de `looksLikeComic` (comicTerms vs contentType).
- `getLocalAuthors` no indexa autores que estén SOLO en `Work.credits` (decisión
  explícita de no ampliar ahora).

## Guardrails permanentes de este repo (recordatorio)
- **Ivrea**: SOLO desde el cron de Vercel (la IP local está baneada por over-fetch).
- **Whakoom**: SOLO local (Cloudflare bloquea datacenters/Vercel).
- **MU** throttle 300ms.
- `npm run check` (tsc + tests) antes de cada commit.
- Migraciones a mano + `migrate:staging` / `prisma migrate deploy` (migración ANTES
  que código). Prod ya tiene 12 migraciones pre-identidad; #139 no necesita ninguna.
- Trabajo/deploy en `staging`; PRs a `main` en lotes.
- Commits terminan con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Archivos y comandos clave
- Guard/dedup: `lib/catalog.ts` (`findOrCreateWork`, `sameContentClass`,
  `inCatalogWhere`, `browseWorks`, `getLocalAuthors`).
- Página autor: `app/(browse)/autores/[name]/page.tsx`, listado `app/(browse)/autores/page.tsx`.
- Ficha/créditos: `app/(browse)/serie/[id]/page.tsx` (link autor línea ~189; fallback
  a `Work.author` cuando `credits=[]`, líneas ~309-322).
- Scripts: `scripts/scan-crosstype.ts`, `scripts/split-work-1716.ts`.
- Correr contra prod/staging: `node scripts/with-prod.mjs npx tsx scripts/<x>.ts`
  / `node scripts/with-staging.mjs ...`.
- Memoria relacionada (auto-memory de Claude): `crosstype-guard-arc`, `session-handoff`,
  `identity-moderation-arc`, `dev-workflow`, `ivrea-ip-ban`, `whakoom-blocked-vercel`.
