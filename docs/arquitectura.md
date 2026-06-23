# Nakama — Arquitectura técnica

Documento de overview técnico del sistema (estilo due-diligence). Describe qué
es, cómo está construido, el modelo de datos, el pipeline de datos, escalabilidad,
deuda técnica y riesgos. Última actualización: 2026-06.

> Versión en inglés: [`architecture.md`](architecture.md). **Mantener ambos en sync.**

---

## 1. Qué es

Nakama es una plataforma para **coleccionistas de manga/cómics** (foco Argentina,
con expansión internacional): catálogo navegable, seguimiento de colección por
tomo y por edición, lista de compras, gasto, deseados, avisos de tomos nuevos /
reediciones, y capa social (amigos, actividad).

El activo central no es la UI sino el **catálogo propio**: una base de obras
canónicas con sus ediciones por editorial e idioma, resuelta y deduplicada a
partir de múltiples fuentes, que **no depende de ninguna API externa en runtime**.

---

## 2. Diagrama de arquitectura

```
   Ivrea ──────┐   (verdad local: catálogo AR + fechas/próximos/reediciones)
   MangaUpdates┤   (verdad editorial: conteo de tomos, licenciatarios, romaji)
   MangaDex ───┤   (aliases/romaji + portadas)
   Google Books┤   (discovery: enumera por editorial)
   Whakoom ────┘   (catálogo ES, opcional)
        │
        ▼
 ┌─────────────────────────────────────────┐
 │  PIPELINE DE RESOLUCIÓN  (ingesta)       │
 │  normalización · match (MD→MU) · dedup/  │
 │  unificación · mapeo · guards · idempot. │
 └─────────────────────────────────────────┘
        │
        ▼
   Work ─┬─ PublisherEdition (AR/US/ES/JP) ─┬─ Volume
         └─ IvreaRelease (próximos/reedic.) │
        │                                    + portadas → Vercel Blob (propio)
        ▼
   PostgreSQL (Neon)
        │
        ▼
   Next.js (App Router / RSC)  ← runtime: SOLO lee Postgres + Blob
        │
        ▼
   Usuario
```

Las fuentes externas se consultan **únicamente en la ingesta** (crawl/cron). El
runtime sirve todo desde Postgres + Blob propio.

---

## 3. Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, React Server Components, Server Actions) |
| Lenguaje | TypeScript |
| UI | React 19, Tailwind, mobile-first |
| ORM / DB | Prisma 6 + PostgreSQL (Neon serverless) |
| Storage | Vercel Blob (portadas propias) |
| Auth | NextAuth v5 — Google OAuth |
| Notificaciones | Web Push (VAPID) + notificaciones in-app |
| Scraping | cheerio (parser HTML server-side) |
| Observabilidad | Sentry |
| Hosting | Vercel (serverless + Cron Jobs + Edge CDN) |

---

## 4. Principio de arquitectura: catálogo local (ETL, no proxy)

**Regla de oro:** en *runtime* (cuando un usuario navega) la app lee **solo
Postgres + nuestro Blob**. Las fuentes externas se consultan **únicamente en los
jobs de ingesta** (crawl/cron), que resuelven match/mapeo/dedup y **persisten el
resultado ya resuelto**. El problema se convierte en un **ETL**, no en un proxy.

Consecuencias:
- **Resiliencia**: si una fuente externa se cae o cambia, la app sigue
  funcionando. El blast radius queda en el job de ingesta.
- **Velocidad**: browse/búsqueda/filtros se sirven local, sin latencia de terceros.
- **Control de calidad**: los bugs de match/dedup se resuelven una vez, en la
  ingesta, no en cada request.

Origen: migración desde AniList (dependencia en runtime, fuente de bugs) hacia
catálogo propio. Ver `docs/plan-catalogo-local.md`.

---

## 5. Modelo de datos (núcleo)

### Catálogo
- **`Work`** — la obra canónica. (Rediseño de datos jun-2026, ver
  `docs/analisis-sistema-datos.md`.)
  - **Nombres multi-idioma**: `title` (display, ES>EN>romaji), `originalTitle`
    (romaji), `titleEn` (inglés), `titleNative` (japonés nativo). `normTitle` para
    búsqueda/agrupado.
  - **Identidad externa estable**: `anilistId`, `muId` (MangaUpdates), `mdId`
    (MangaDex, uuid) — todos `@unique`. **El matcheo se ancla acá + autor, NO en el
    título** (que es solo display). Se resuelven una vez y se reusan (idempotente).
  - **Sinopsis por idioma**: `synopsisEs` / `synopsisEn` (+ flags `synopsisEsAuto`/
    `synopsisEnAuto` = traducción automática). La nativa de la fuente manda; la que
    falta se traduce con LLM (OpenAI/DeepL/Claude, ver `lib/translate`). El campo
    `synopsis` quedó DEPRECADO (transición). Display: tabs ES/EN en la ficha.
  - Otros: portada (R2 propio), `author`, `assistants`, géneros canónicos (ES),
    `rawGenres`, demografía, `curated` (campos editados a mano que ningún job pisa),
    flags de "próximo a salir".
- **`PublisherEdition`** — una edición por editorial: `publisher`, `title`,
  `slug`, `volumes`, `status`, `url`, `language` (es/en/ja), `country`
  (AR/US/ES/JP…), `synopsis` (en el idioma de la edición), `whakoomId` (llave
  fuerte), `workId`. Varias ediciones cuelgan del mismo Work (Ivrea AR + VIZ US =
  misma obra, dos banderas), cada una con su conteo/sinopsis sin pisarse.
- **`Volume`** — tomos de una edición.
- **`IvreaRelease`** — snapshot de próximos: tomo nuevo, debut, reedición (con
  fecha). Única fuente AR de fechas/próximos.
- **`Mangaka`** — índice propio de autores.
- **`CrumbMapping`, `EditionExclusion`, `RejectedSource`** — curación e
  idempotencia (overrides, exclusiones, skip-list de duplicados ya descartados).

### Usuario y colección
- **`User`**, **`Account`**, **`Session`** — auth (NextAuth).
- **`Manga`** — una serie que el usuario sigue. Obras locales usan un pseudo-id
  negativo (`anilistId = -workId`); ver §11 (deuda técnica conocida).
- **`TrackedEdition`** — la edición que colecciona (`region` AR/INT/JP,
  totalVolumes, estado de lectura).
- **`OwnedVolume`** — tomos que tiene.

### Compras, deseos, social, notis, ops
- **`Purchase` / `PurchaseItem`** — compras (sincronización bidireccional a la
  colección: comprar suma, borrar/editar quita/actualiza).
- **`WishlistItem`** — deseados.
- **`Friendship`, `Activity`, `ActivityReaction`, `ActivityComment`** — social.
- **`Notification`, `NotificationPref`, `PushSubscription`, `SeriesNotifMute`,
  `IvreaReleaseNotified`** — notificaciones, prefs por categoría, mute por serie,
  idempotencia de avisos.
- **`JobRun`, `AppState`, `RateLimit`, `LoginEvent`, `Report`, `Store`,
  `IndieWork`** — operación, anti-abuso, moderación, tiendas, indie.

---

## 6. Fuentes de datos (cada una con un rol único)

| Fuente | Rol | Acceso | Notas |
|---|---|---|---|
| **Ivrea Argentina** | **Verdad local**: catálogo AR + fechas (próximos, reediciones, debuts) | Scrape (cheerio) | Única fuente AR de fechas |
| **MangaUpdates (MU)** | **Verdad editorial**: conteo por formato, licenciatarios (confirma VIZ), géneros, romaji, sinopsis | API, sin key | Autoridad por título |
| **MangaDex (MD)** | **Aliases** (romaji) + portadas | API, sin key | Bloquea hotlinking → portada se baja a Blob |
| **Google Books** | **Discovery**: enumera por editorial (`inpublisher`) | API key | Multi-query rompe el techo de 100/query |
| **Whakoom** | Catálogo ES (enriquecimiento) | Scrape, corre LOCAL | Cloudflare bloquea el datacenter |

No se mezclan responsabilidades: cada fuente cumple un rol específico.

---

## 7. Motor de resolución (el moat del proyecto)

Cada job de ingesta convierte datos crudos de varias fuentes en obras canónicas
limpias. Lo que se resuelve:

1. **Normalización de títulos** — `normTitle` para agrupar/buscar + `tightTitleKey`
   que distingue homónimos cercanos ("Citrus" vs "Citrus+").
2. **Match inglés→serie** — se consulta **MangaDex primero** para juntar todos los
   nombres (incluido el romaji) y con ese set se le pega a **MangaUpdates**, que
   confirma la licencia y da el conteo. Resuelve que las fuentes indexan en romaji
   ("My Hero Academia" = "Boku no Hero Academia" = 僕のヒーローアカデミア).
3. **Dedup / unificación** — `findOrCreateWork` agrupa por `anilistId` (o, sin él,
   por `tightTitleKey`). Una serie que ya existe por Ivrea suma la edición VIZ **al
   mismo Work** (no duplica): una obra puede tener ediciones AR + US + ES + JP bajo
   una sola entidad, con sus banderas. **Dirección del rediseño (jun-2026):** la
   identidad se ancla en **id externo (anilistId/muId/mdId) + autor**, no en el
   título (que es display); el enrich persiste esos ids para re-match idempotente
   y trae los nombres multi-idioma. Ver `docs/analisis-sistema-datos.md`. La
   sinopsis EN va a `synopsisEn` y la ES a `synopsisEs` (no se pisan); lo que falte
   se traduce con LLM.
4. **Mapeo tarjeta→edición** — los snapshots de Ivrea se mapean por **título**
   (más confiable que el slug del link, que a veces es genérico).
5. **Guards de calidad** — bloqueo anti-hentai/doujin (no se importan) +
   verificación de editorial (que la fuente confirme la editorial buscada).
   **Solo en el discovery por Google Books** se filtran además títulos que no son
   una serie de manga (artbooks, novelas, guías, box sets) para no enumerar ruido
   como obras falsas. *Esto NO borra ni bloquea artbooks/box sets del catálogo;*
   solo evita auto-importarlos como series. Trackearlos como ítems coleccionables
   propios es una oportunidad futura vía `Work.type`.
6. **Idempotencia / solo-nuevo** — el discovery descarta lo existente antes de
   gastar requests; `RejectedSource` evita re-importar lo curado-afuera; el
   refresh **rota** (procesa los menos recientes primero).

Resultado medible: el catálogo VIZ pasó de 19 a **262 series con 0 duplicados** y
**38 obras unificadas** con sus ediciones de Ivrea.

---

## 8. Runtime (lo que ve el usuario)

- **App Router + RSC + Server Actions**: render server-side, mutaciones sin API
  REST manual.
- **Browse**: carga el catálogo y filtra **en memoria del cliente** (texto + tabs
  + géneros + demografía), instantáneo; estado sincronizado a la URL.
  - **Estrategia actual: client-side filtering.** Óptimo en el orden actual de
    magnitud (miles de obras). **Migrará a búsqueda server-side** (índice +
    paginación + faceting en Postgres) cuando el catálogo lo requiera. Ver §10.
- **Catálogo unificado**: nacional + internacional en una lista; banderas
  distinguen origen (🇦🇷/🇺🇸) y pueden coexistir.
- **Próximos / reediciones**: tomos nuevos (📅) y reediciones (♻️) con fecha, en
  catálogo, ficha y lista de compras.
- **Portadas**: en **storage propio** (Vercel Blob), servidas desde nuestro
  origen. Independencia total también en imágenes.

---

## 9. Jobs / Cron (Vercel)

Toda la ingesta corre en cloud salvo Whakoom (bloqueado, corre local). Auth por
`CRON_SECRET` (fail-closed).

- **`/api/cron/ivrea-proximas`** (diario): refresca el snapshot de Ivrea, propaga
  totales a colecciones, dispara las notis cuya fecha es hoy.
- **`/api/cron/viz`** (semanal): **descubre** (Google Books) + **refresca** un
  lote rotado (MU) + **migra** portadas a Blob (lote) + sincroniza colecciones +
  notis.
- **`/api/cron/mangakas`** (semanal): reconstruye el índice de autores.

---

## 10. Escalabilidad

El crecimiento está contemplado; estos son los ejes y su plan:

| Eje | Hoy | Umbral | Plan |
|---|---|---|---|
| **Browse / filtros** | Client-side (carga + filtra en memoria) | ~30.000+ obras empieza a doler | Migrar a **server-side search**: índice en Postgres (`pg_trgm`/FTS) + paginación + faceting. El modelo de datos ya lo soporta; es un cambio de capa de consulta, no de esquema. |
| **Refresh del catálogo** | Cron semanal **rotado** por `updatedAt` (lote acotado/corrida) | Crece linealmente con el catálogo | Ya es **O(k) incremental por corrida**, no O(n) total: cubre todo en varias semanas sin pasarse del `maxDuration`. A más escala: más frecuencia o paralelización por shards. |
| **Discovery** | Google Books + verificación MU, descartando lo existente | Quota GB | Acotado por corrida; solo procesa candidatos nuevos. |
| **Portadas** | Blob propio + migración por lote en el cron | Bandwidth de Blob | Cache de CDN (immutable); a escala, evaluar resize/optimización. |
| **DB** | Neon serverless | — | Branching para staging; read-replicas si hiciera falta. |

---

## 11. Deuda técnica conocida

- **Pseudo-id negativo (`Manga.anilistId = -workId`)** — ingenioso para reusar la
  maquinaria de colección sin migrar el esquema, pero el nombre `Manga`/`anilistId`
  ya no refleja la realidad (no es AniList). **Deuda conocida**: a futuro,
  renombrar a algo tipo `CollectionItem` con FK directa a `Work`. No urge; se
  marca para no olvidarlo.
- **Géneros como `String[]` en `Work`** — funciona para filtrar hoy. Para filtros
  avanzados / estadísticas / recomendaciones / búsqueda facetada a escala,
  conviene normalizar a `Genre` + `WorkGenre` (join). Migración acotada cuando se
  necesite faceting serio.
- **Portadas: transición** — coexiste el proxy `/api/cover` (red de seguridad) con
  el Blob propio mientras termina la migración; el proxy se puede retirar cuando
  el 100% de las portadas estén en Blob.

---

## 12. Notificaciones

- **Push agrupado anti-spam**: 1 push por usuario por corrida; in-app 1 por ítem.
- **Prefs por categoría** (tomo nuevo / reedición / deseado / social) + **mute por
  serie**.
- **Reediciones**: solo a quien le **falta** ese tomo.

---

## 13. Seguridad y operación

- **Auth**: Google OAuth (NextAuth v5), sesiones en DB.
- **Anti-abuso**: rate limiting (`RateLimit`), validación de URLs.
- **Observabilidad**: Sentry, `JobRun` (tracking de ingestas), `LoginEvent`.
- **Legal**: borrar cuenta, privacidad, términos.
- **Entornos**: producción + **staging como mirror** vía Neon branching con scrub
  de PII. Migraciones SQL idempotentes escritas a mano.

---

## 14. Métricas (snapshot)

> Catálogo completo en base (incluye editoriales aún ocultas en el MVP). El
> catálogo **visible** en el MVP es Ivrea + VIZ; el resto (Panini/Ovni/españolas)
> está ingerido pero no listado todavía.

**Catálogo**
- ~1.840 obras (`Work`)
- ~1.940 ediciones (`PublisherEdition`) — por idioma: ES ~1.680, EN ~262
- ~8.370 tomos (`Volume`)
- Por editorial: Ovni 628 · Ivrea 595 · Panini 286 · **VIZ 262** · Distrito 83 ·
  Utopía 50 · Kemuri 24 · Larp 14

**Pipeline**
- 5 fuentes (Ivrea, MU, MangaDex, Google Books, Whakoom)
- Ingesta por cron (diaria Ivrea, semanal VIZ/mangakas); requests acotados por corrida

**Calidad**
- VIZ: 262 series, **0 duplicados**, 38 unificadas con Ivrea
- Discovery con verificación MU: ~58% de candidatos nuevos confirmados e importados

*(Completar con performance real cuando se midan: búsqueda <100ms, carga inicial
<1s, etc.)*

---

## 15. Riesgos y mitigaciones

| Fuente / área | Riesgo | Mitigación |
|---|---|---|
| **Whakoom** | Cloudflare bloquea el datacenter | Fuente **opcional** (enriquecimiento ES); corre local; el catálogo no depende de ella |
| **Google Books** | Cambios de quota / API | Se usa **solo para discovery**, no para datos canónicos (esos vienen de MU); degradación: el seed curado sigue funcionando |
| **Ivrea** | Cambio de HTML rompe el scrape | **Alertas de ingesta** (un parse vacío/anómalo debería alertar); `JobRun` registra cada corrida; snapshot es reemplazo total (no corrompe incrementalmente) |
| **MangaUpdates / MangaDex** | Cambios de API o rate-limit | Catálogo local: una caída no afecta runtime, solo difiere la ingesta; throttle + reintentos |
| **Portadas externas** | Host borra/cambia la imagen | **Storage propio** (Blob): una vez migrada, es nuestra |
| **Escala de browse** | Client-side filtering no escala a 100k+ | Plan de migración a server-side search (§10) |

---

## 16. Diferenciales técnicos (el pitch)

1. **Catálogo propio, no dependiente de terceros en runtime** (metadata **y**
   portadas en storage propio) → resiliencia y velocidad.
2. **Motor de resolución multi-fuente** con dedup y **unificación cross-idioma**:
   una obra = sus ediciones AR/US/ES/JP bajo una entidad. *Acá está el moat* —
   resolver "Boku no Hero Academia = My Hero Academia = 僕の…" sin generar basura
   es lo que a un competidor le toma meses.
3. **Datos de mercado argentino** (Ivrea): fechas, próximos y reediciones — info
   que ninguna fuente global tiene.
4. **Pipeline idempotente y auto-mantenido** que **escala** (refresh rotado,
   discovery incremental).
5. **Modelo extensible**: obra → ediciones → tomos + colección/compras ya soporta
   manga y cómics, y es base para otros coleccionables.

---

## 17. Documentos relacionados

- `docs/plan-catalogo-local.md` — migración a catálogo propio.
- `docs/plan-viz-en.md` — research + pipeline internacional (VIZ).
- `docs/plan-internacional.md` — ediciones JP/EN/ES sobre el mismo Work.
- `docs/generos-taxonomia.md` — taxonomía de géneros canónicos.
- `docs/frescura-catalogo.md` — estrategia de actualización del catálogo.
- `docs/staging-mirror.md` — mirror de staging vía Neon branching.
- `docs/scripts.md` — comandos de ingesta/mantenimiento.
