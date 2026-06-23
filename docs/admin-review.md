# Herramientas de Admin — estado actual (2026-06-23)

Inventario de las herramientas de admin. La limpieza de la era-AniList (plan de
2026-06-18) ya se ejecutó: se removieron `/admin/mapeos`, `/admin/inspeccionar`,
`/admin/scripts`, el `RunJobsPanel`, `lib/github.ts` y los flujos de mapeo a
AniList. AniList sigue apagado en runtime (`ANILIST_OFF`); el matcheo se ancla
ahora en identidad externa (anilistId/muId/mdId) + autor, ver
`docs/analisis-sistema-datos.md`.

## Panel (`/admin`)
Dashboard con conteos accionables (cada uno linkea a su tool):
- **Pendientes**: Reportes · Tiendas · Indie (moderación).
- **Catálogo**: Ediciones · Obras · Preventas · **🔀 Series duplicadas**
  (`/admin/duplicados`) · **🖼 Sin portada** (`/admin/herramientas#sin-portada`) ·
  **✍️ Autores a unificar** (`/admin/autores`) · **✍️ Series sin autor**
  (`/admin/autores?tab=sin-autor`) · **📝 Sinopsis incompletas** (`/admin/sinopsis`).
- **Integridad**: ediciones con 0 tomos / duplicadas (link a Herramientas).

## Páginas (`app/admin/**`)
| Página | Qué hace |
|---|---|
| `/admin` | Panel/dashboard (arriba). |
| `/admin/reportes` · `/admin/tiendas` · `/admin/independientes` | Moderación (reportes, directorio de tiendas, obras indie). |
| `/admin/logins` | Log de logins. |
| `/admin/flags` | Feature flags (on/off sin redeploy). |
| `/admin/herramientas` | Import de Whakoom + tareas de mantenimiento (TaskRunner) + Limpieza del catálogo (0 tomos / duplicadas, con link a ficha + borrar/marcar próxima) + **Series sin portada** (`#sin-portada`: subir archivo a R2 o pegar URL). |
| `/admin/duplicados` | **Fusión manual** (pegás 2 ids/URL y unificás) + cola automática (works que comparten anilistId): fusionar o separar. |
| `/admin/autores` | 2 tabs: **A unificar** (grafías del mismo mangaka, tolera orden/mayúsculas/vocal larga del romaji; chips clickeables → ver sus series) y **Sin autor** (cargar el autor faltante). |
| `/admin/sinopsis` | **Sinopsis incompletas** (falta ES o EN): por serie, los 2 campos; "Traducir →" completa el faltante con LLM (guarda solo, marcado auto); carga manual guarda onBlur. |

## Editor de la ficha (`AdminWorkEdit`, en `/serie/[id]`)
Editar campos de display del Work (título, autor, sinopsis ES, portada con upload
a R2, géneros, próximo+fecha, búsqueda Crumb) — **manda solo los campos que
cambian** (no wipea el resto) y los bloquea en `curated`. Botón **Borrar entrada**
(elimina el Work + ediciones + data de usuario; para duplicados que la cola
automática no agarra).

## Crons (`app/api/cron/**`)
| Cron | Nota |
|---|---|
| `ivrea-proximas` | Próximos/fechas + notis (única fuente AR de fechas). |
| `ivrea-catalogo` | Catálogo de Ivrea (conteos/portadas). Ivrea no bloquea datacenter → corre en Vercel. **OJO**: no tocar Ivrea desde scripts locales (baneo de IP por over-fetching). |
| `viz` | Refresh del catálogo VIZ (vía MU/MD). |
| `mangakas` | Índice de mangakas (AniList). Pausado/legacy con ANILIST_OFF. |

## Tareas de mantenimiento (`lib/adminTasks.ts`, runner en `/admin/herramientas`)
`fix-volumes-out-of-range` (total < poseídos) · `normalize-genres` (re-mapea
crudos → canónicos sin re-enriquecer) · `notify-new-volumes` (detecta/notifica
tomos nuevos). Con **Simular** (dry) / **Aplicar**.

## Frescura del catálogo
El refresh local (`scripts/refresh-catalog.mjs`, tarea programada en la PC del
usuario) corre **Whakoom** (bloquea datacenter → debe ser local) + **enrich** +
**mirror prod→staging**. Ivrea va por su cron de Vercel. Ver `docs/scripts.md` y
`docs/frescura-catalogo.md`.

> Criterio: NUNCA herramientas que **borren por heurística** (el viejo
> `flag-comics` se eliminó). El catálogo crece a multi-tipo (manga/cómics/Funkos)
> y multi-editorial; preferir clasificar/taguear. `Work.anilistId` no se puede
> borrar (llave de joins: cron Ivrea, exclusiones, colección por `-workId`).
