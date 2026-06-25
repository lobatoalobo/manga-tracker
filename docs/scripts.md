# Scripts — Nakama

Referencia de todos los comandos. **Convención de entorno:**
- Sin prefijo → corren contra **`DATABASE_URL` de `.env` (= producción)**.
- Contra **staging**: `node scripts/with-staging.mjs npx tsx scripts/<x>.ts …`
- Casi todos los `.ts` se corren con `npx tsx scripts/<x>.ts`.
- 🟥 = legacy/AniList o de desarrollo (revisar si sigue sirviendo con catálogo local + solo-Ivrea).

---

## npm scripts (`package.json`)

| Comando | Qué hace |
|---|---|
| `npm run dev` | Server de desarrollo (Next). |
| `npm run build` | Build de producción. |
| `npm run start` | Sirve el build. |
| `npm run lint` | ESLint. |
| `npm test` | Tests unitarios (vitest, una corrida). |
| `npm run test:watch` | Tests en watch. |
| `npm run migrate:staging` | `prisma migrate deploy` contra **staging**. |
| `npm run studio:staging` | Prisma Studio contra staging. |
| `npm run crawl …` | Atajo de `tsx scripts/crawl.ts` (ver abajo). |
| `npm run import:whakoom …` | Atajo de `scripts/import-whakoom.ts`. |
| `npm run seed:whakoom …` | Atajo de `scripts/seed-whakoom.ts`. |
| `npm run depurate` / `consolidate-dups` / `enrich-covers` / `split-homonyms` / `fix-ivrea-urls` / `auto-map` / `test-preventa` / `reset-preventa` / `push-test` | Atajos de los scripts homónimos. |

Migraciones: crear el SQL a mano en `prisma/migrations/<ts>_<nombre>/migration.sql`, luego `npm run migrate:staging` (staging) y `npx prisma migrate deploy` (prod) + `npx prisma generate`.

---

## Catálogo / crawl

| Comando | Qué hace |
|---|---|
| `npm run crawl ivrea` | Crawlea el catálogo de Ivrea (títulos → fichas → tomos + Work). Notifica tomos nuevos. |
| `npm run crawl whakoom-all` | Importa TODAS las editoriales de Whakoom (Panini/Ovni/Kemuri/Utopía/Larp/Distrito). Corre LOCAL (Whakoom bloquea runners). |
| `npm run crawl whakoom-pub "<url /all>" [reset] [baseline] [new]` | Importa una editorial completa de Whakoom. `new` = solo ediciones nuevas (incremental, no re-abre las que ya tenés). |
| `npm run crawl whakoom <archivo.txt>` | Importa ediciones de Whakoom desde una lista de URLs. |
| `npm run crawl resolve [reset] [publisher]` | 🟥 Resuelve el `anilistId` de cada edición (verificado por autor). |
| `npm run crawl mangakas` | 🟥 Reconstruye el índice de mangakas (escanea AniList). |
| `npx tsx scripts/seed-whakoom.ts [ivrea\|panini\|ovni] [--reset] [--limit N]` | Seed bulk del catálogo desde Whakoom (resumable, cursor en AppState). |
| `npx tsx scripts/import-whakoom.ts <url> [url2 …]` | Importa ediciones puntuales de Whakoom (local). |

---

## Refresh programado (frescura del catálogo)

| Comando | Qué hace |
|---|---|
| `node scripts/refresh-catalog.mjs` | Orquesta el refresh completo (contra prod): whakoom-all → enrich-works → traducir sinopsis (completa ES↔EN) → mirror a staging. Ivrea va por su cron de Vercel. Ver [frescura-catalogo.md](frescura-catalogo.md). |
| `powershell -File scripts/refresh-catalog.ps1` | Wrapper para el Task Scheduler (loguea en `logs/`). |
| `powershell -File scripts/install-refresh-task.ps1 [-At HH:mm]` | Registra la tarea programada diaria de Windows. |
| `node scripts/with-staging.mjs <cmd…>` | Corre cualquier comando con `DATABASE_URL` apuntando a staging. |
| `npm run sync:staging` / `… --yes` | Clona PROD → staging (Neon branching) + migraciones + scrub de PII. Sin `--yes` = dry. Ver [staging-mirror.md](staging-mirror.md). |

---

## Enriquecimiento (identidad / nombres / géneros / sinopsis)

Rediseño de datos jun-2026 (ver `docs/analisis-sistema-datos.md`): el enrich
persiste **identidad externa** (mdId/muId) + **nombres multi-idioma** + autor
confiable, además de géneros/sinopsis. Match por romaji + prefijo "Romaji: ES".

| Comando | Qué hace |
|---|---|
| `npx tsx scripts/enrich-works.ts [--limit N] [--dry] [--force]` | Géneros + nombres (EN/JA/romaji) + identidad (mdId/muId) + autor (MU) + respaldo de portada/sinopsis-EN. Resumable. |
| `… enrich-works.ts --missing-genres` | Solo obras sin géneros (re-match). |
| `… enrich-works.ts --missing-identity` | Solo obras sin mdId/muId (backfill de identidad + nombres). |
| `… enrich-works.ts --missing-cover` | Solo obras sin portada (recovery MU/MD). |
| `npx tsx scripts/audit-data.ts` | **Auditoría** (read-only): cobertura de campos, identidad, matchabilidad, focos de problema (autores/sinopsis faltantes, ediciones multi-idioma). |
| `npx tsx scripts/whakoom-ivrea-diff.ts [--refresh]` | **Diff read-only** Ivrea Whakoom vs nuestra base: qué ediciones lista Whakoom que nos faltan (match por tokens + colapsado sin puntuación). Cachea la enumeración en `scripts/.whakoom-ivrea-urls.json` (`--refresh` re-enumera). Correr **local** (Whakoom bloquea datacenter). |
| `npx tsx scripts/backfill-synopsis-lang.ts [--dry]` | Separa la `synopsis` existente a `synopsisEs`/`synopsisEn` por idioma detectado (sin traducir). |
| `npx tsx scripts/translate-synopses.ts [--limit N] [--dry]` | Completa la versión de sinopsis faltante traduciendo la otra con LLM (marcada auto). Requiere `OPENAI_API_KEY` (o DEEPL/ANTHROPIC). |
| `npx tsx scripts/curate-genres.ts [--dry]` | Géneros curados a mano para obras que no matchean en MU/MD. |

---

## Curación / limpieza del catálogo

| Comando | Qué hace |
|---|---|
| `npx tsx scripts/fix-volume-overcounts.ts [--apply]` | Capa el **sobre-conteo** de tomos: si una edición tiene un tomo NUEVO con fecha futura (en `IvreaRelease`), los publicados son `N-1`. **No re-fetchea Ivrea** (usa el snapshot) → seguro local. Misma lógica que corre el cron de /proximas/ (`capOvercountedIvreaEditions`). |
| `npx tsx scripts/recrawl-ivrea.ts --contradictions [--dry]` | Re-crawlea fichas de Ivrea con conteo contradictorio (próximo tomo #N con ≥N tomos) y trae el conteo AR real. **Correr solo con Ivrea arriba** (a veces banea la IP local). |
| `npx tsx scripts/fix-ivrea-urls.ts [--limit N] [--apply]` | Arregla links de Ivrea que quedaron a Whakoom + sincroniza tomos. |
| `npx tsx scripts/fix-whakoom-counts.ts [--dry]` | Corrige conteo de tomos publicados de imports de Whakoom (excluye upcoming). |
| `npx tsx scripts/auto-map.ts [--limit N] [--apply]` | 🟥 Auto-mapea a AniList ediciones sin mapear (por título original + autor). |
| `npx tsx scripts/fix-broken-maps.ts [--apply]` | 🟥 Detecta/arregla ediciones mapeadas a un anilistId inválido (404). |
| `npx tsx scripts/verify-author-maps.ts [--apply]` | 🟥 Verifica mapeos a AniList contra el autor; desmapea homónimos. |

---

## Próximas / preventa

| Comando | Qué hace |
|---|---|
| `npx tsx scripts/ivrea-proximas.ts [--dry]` | Reconcilia el chip "🔜 Próximo a salir" desde /proximas/ de Ivrea (igual que el cron diario). |

---

## Portadas (Cloudflare R2)

Las portadas se hostean en R2 (propias, persistentes; ver memoria covers-r2).
Todas usan `dbRetry` + `storeCover` (sube a R2). **OJO Ivrea**: no abusar desde la
IP local (baneo).

| Comando | Qué hace |
|---|---|
| `npx tsx scripts/migrate-covers-r2.ts [--dry]` | Migra portadas existentes (hotlink/proxy/blob) a R2. |
| `npx tsx scripts/ivrea-covers.ts [--limit N] [--force] [--dry]` | (Re)genera portadas de obras con edición Ivrea desde la ficha (nacional). `--force` respeta lo curado a mano. |
| `npx tsx scripts/whakoom-covers.ts [--limit N] [--dry]` | Recupera portadas de obras sin portada con edición de Whakoom (corre **local**). |
| `npx tsx scripts/refresh-ivrea-empty.ts [--dry]` | Refresca ediciones Ivrea con 0 tomos ("EN CATÁLOGO" sin tomo). **Ivrea arriba.** |

---

## Notificaciones / push

| Comando | Qué hace |
|---|---|
| `npx tsx scripts/push-test.ts [email]` | Manda un push de prueba a las suscripciones de un usuario. |
| `npx tsx scripts/test-notifications.ts <email>` | Prueba "tomo nuevo (agrupado)" + "salió en Argentina" contra tu cuenta. |
| `npx tsx scripts/reset-notifications.ts <email>` | Revierte lo de `test-notifications` (re-baseliza, limpia notis de prueba). |

---

## Tests de flujo (end-to-end de features, en staging)

| Comando | Qué hace |
|---|---|
| `npx tsx scripts/test-preventa.ts [anilistId]` | Flow preventa → lanzamiento (idempotente). |
| `npx tsx scripts/reset-preventa.ts [anilistId]` | Restaura una serie a estado de preventa. |
| `… scripts/test-new-volumes.ts <email>` | Simula tomos nuevos de tu colección → "te faltan" + alerta. |
| `… scripts/test-debut-launch.ts <email> <substr>` | Simula que sale un debut que tenés en deseados. |
| `… scripts/test-ivrea-notify.ts` | Test e2e de `notifyIvreaReleases` (próximo tomo + reediciones). |

---

## Base de datos / seed

| Comando | Qué hace |
|---|---|
| `node scripts/with-staging.mjs npx tsx scripts/wipe-db.ts --yes` | ⚠️ Wipe TOTAL de la base (reset). Sin `--yes` solo reporta. Imprime el host para confirmar que NO es prod. |
| `npx tsx scripts/backfill-works.ts` | Backfill de identidad `Work` para ediciones existentes (idempotente). |
| `npx tsx scripts/seedStores.ts` | Base inicial de comiquerías. |
| `npx tsx scripts/seed.ts` | 🟥 Seed inicial de mangas (AniList ids) en la 1ª cuenta. |

---

## Desarrollo / debug (no tocan datos de prod)

| Comando | Qué hace |
|---|---|
| `npx tsx scripts/testAnilist.ts` | 🟥 Prueba `searchManga` de AniList. |
| `npx tsx scripts/testDetails.ts` | 🟥 Prueba `getMangaDetails` (AniList). |
| `npx tsx scripts/testIvreaProvider.ts` | Prueba el parser del catálogo de Ivrea. |
| `npx tsx scripts/compareSources.ts` | 🟥 Compara conteos entre AniList / Ivrea / Panini / MangaUpdates. |
