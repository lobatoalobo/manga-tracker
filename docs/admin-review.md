# Revisión de herramientas de Admin (2026-06-18)

Contexto: prod con `ANILIST_OFF=1`, catálogo local, MVP **solo Ivrea**
(`CATALOG_PUBLISHERS`). Objetivo: marcar qué herramientas de admin siguen
sirviendo y cuáles quedaron obsoletas con AniList apagado / editoriales ocultas.

Leyenda: ✅ MANTENER · 🟡 REVISAR · 🟥 DEPRECAR.

## Páginas (`app/admin/**`)
| Página | Estado | Nota |
|---|---|---|
| `/admin` (home) | ✅ | Dashboard de pendientes/conteos. Degradar la métrica "Mapeadas" (AniList) a informativa. |
| `/admin/reportes` | ✅ | Moderación. Local. |
| `/admin/tiendas` | ✅ | Directorio. Local. |
| `/admin/independientes` | ✅ | Moderación indie. Local. |
| `/admin/logins` | ✅ | Log de logins. Local. |
| `/admin/herramientas` | 🟡 | Ver tabla de abajo (mixto). |
| `/admin/mapeos` | 🟡 | Conservar editar/borrar/portada/datos locales; **sacar** el flujo "mapear a AniList", `national-only` y la auditoría de conteos vs AniList (`getMangaVolumes`). |
| `/admin/inspeccionar` | 🟡 | Útil para debug, pero pivota sobre `anilistId`. No pega a AniList (lee DB). Reorientar a workId a futuro. |
| `/admin/scripts` | 🟡 | Cheat-sheet: depurar (sacar mapeo AniList y editoriales ocultas). |

## Crons (`app/api/cron/**`)
| Cron | Estado | Nota |
|---|---|---|
| `ivrea-proximas` (diario) | ✅ | Núcleo: próximos/fechas + notis. Ivrea no bloquea datacenter. |
| `mangakas` (semanal) | 🟥 | Escanea **AniList** (`lib/mangakas.ts`). El tab Mangaka (AniList) no se muestra con ANILIST_OFF; el índice local es `/autores`. Pausar. |

## Jobs de GitHub Actions (`lib/github.ts` `CRAWL_JOBS`)
| Job | Estado | Nota |
|---|---|---|
| `ivrea` | ✅ | Sitio de Ivrea. |
| `mangakas` | 🟥 | AniList. |
| `resolve` | 🟥 | Re-mapea por autor contra **AniList**. |
| (Whakoom) | — | No se dispara por GH (bloquea runners); corre local. |

## Tareas de mantenimiento (`lib/adminTasks.ts`, runner en /admin/herramientas)
| id | Estado | Nota |
|---|---|---|
| `consolidate-dups` | ✅ | Junta duplicados crawl+Whakoom. |
| `depurate-catalog` | ✅ | 1 edición por (obra, editorial). |
| `split-homonyms` | ✅ | Separa homónimos. |
| `fix-volumes-out-of-range` | ✅ | Corrige total < tomos poseídos. |
| `notify-new-volumes` | ✅ | Detecta/notifica tomos nuevos. |
| `clear-stale-cache` | ✅ | Limpia EditionsCache viejo. |
| `flag-comics` | 🟥 ELIMINADO | **Borraba** cómics occidentales por heurística. Los cómics ahora son parte de la oferta (y a futuro Funkos/etc.) → una herramienta que borra contenido por título es peligrosa. Removida (task + script + npm + filtro "Sospecha cómic"). El detector `looksLikeComic` queda solo como clasificador neutral. |
| `backfill-ovni-urls` | 🟥 | Ovni está oculto en el MVP. |
| `resolve-unmapped` | 🟥 | Mapea a **AniList** por autor. |

## Acciones admin (`app/actions.ts`)
- ✅ Locales (mantener): `updateWork`, `setWorkUpcoming`, `addSeriesEdition`, `updateSeriesEdition`, `deleteSeriesEdition`, `setEditionUrl`, `setCrumbQuery`, `unlink/relinkEdition`, moderación (reportes/tiendas/indie), `flushEditionsCache`, `runAdminTask`, `importWhakoomUrl`, `runCrawl` (solo job ivrea).
- 🟥 AniList: `resolveEditionMappingAction` (único que pega a AniList en vivo). `setEditionMapping`/`setEditionNationalOnly`/`bulkEdition`(national) manipulan el concepto de mapeo AniList → degradar con `/admin/mapeos`.

---

## Plan de limpieza (ordenado por riesgo)

**Fase 1 — apagar lo muerto (seguro, sin impacto en usuarios):** ✅ HECHO (2026-06-18)
1. ✅ Cron `mangakas` sacado del schedule (vercel.json).
2. ✅ `mangakas` y `resolve` removidos de `CRAWL_JOBS` (`lib/github.ts`) y del `RunJobsPanel` (queda solo Ivrea).
3. ✅ Tareas `resolve-unmapped` y `backfill-ovni-urls` removidas del runner (`lib/adminTasks.ts`).
4. ✅ Página `/admin/scripts` (cheat-sheet de comandos) **eliminada** — los comandos viven solo en docs/scripts.md (decisión del usuario: en la app, solo herramientas ejecutables). Links actualizados (NavBar, CatalogRefreshBanner → Herramientas).
5. ✅ `flag-comics` ELIMINADO (borraba cómics; ahora son parte de la oferta).

**Criterio a futuro (importante):** el catálogo crece a multi-tipo (manga + cómics + Funkos por waves) y multi-editorial (Panini/Ovni y luego españolas/foráneas). Por eso: NUNCA herramientas que **borren por heurística** (como flag-comics); preferir clasificar/taguear. `depurate-catalog` ("1 edición por obra+editorial") usar **con cuidado** con tipos nuevos (waves de Funko = muchas "ediciones" legítimas). Ovni/Panini y las españolas volverán al browse → su mantenimiento (ej. backfill de URLs) se re-habilita cuando se muestren. AniList puede volver como **enriquecimiento** (géneros/score) sobre el catálogo local; por eso `lib/anilist.ts` se conserva.

**Fase 2 — limpiar /admin/mapeos y /admin/scripts:**
5. /admin/mapeos: sacar "mapear a AniList", `national-only` y la auditoría de conteos vs AniList; conservar editar/borrar/portada/filtros locales.
6. /admin/scripts: sacar de la lista los comandos AniList (`auto-map`, `fix-broken-maps`, `verify-author-maps`, `enrich-covers`, `resolve`) y los de editoriales ocultas.
7. /admin home: degradar "Mapeadas" a métrica informativa (no foco).

**Fase 3 — opcional, mayor toque:**
8. /admin/inspeccionar: reorientar de `anilistId` a `workId`.

**Nota importante:** NO se puede borrar el campo `Work.anilistId` / `PublisherEdition.anilistId` — sigue siendo la **llave** de muchas joins (cron Ivrea vía `nextIvreaRelease(anilistId)`, exclusiones, caché, colección con `-workId`). Esto es solo limpieza de UI/jobs, no de esquema. Los scripts/`lib/anilist.ts` se conservan para cuando se retome AniList como enriquecimiento (géneros/score) sobre el catálogo local.
