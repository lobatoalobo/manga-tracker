# Nakama — Arquitectura técnica

Documento de overview técnico del sistema (estilo due-diligence). Describe qué
es, cómo está construido, el modelo de datos, el pipeline de datos y los puntos
técnicos diferenciales. Última actualización: 2026-06.

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

## 2. Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, React Server Components, Server Actions) |
| Lenguaje | TypeScript |
| UI | React 19, Tailwind, mobile-first |
| ORM / DB | Prisma 6 + PostgreSQL (Neon serverless) |
| Auth | NextAuth v5 — Google OAuth |
| Notificaciones | Web Push (VAPID) + notificaciones in-app |
| Scraping | cheerio (parser HTML server-side) |
| Observabilidad | Sentry |
| Hosting | Vercel (serverless + Cron Jobs + Edge CDN) |

---

## 3. Principio de arquitectura: catálogo local

**Regla de oro:** en *runtime* (cuando un usuario navega) la app lee **solo
nuestra Postgres**. Las fuentes externas (Ivrea, Whakoom, MangaUpdates, MangaDex,
Google Books) se consultan **únicamente en los jobs de ingesta** (crawl/cron),
que resuelven match/mapeo/dedup y **persisten el resultado ya resuelto**.

Consecuencias:
- **Resiliencia**: si una fuente externa se cae o cambia, la app sigue
  funcionando (lee local). El blast radius queda en el job de ingesta.
- **Velocidad**: browse/búsqueda/filtros se sirven desde Postgres (y se filtran
  en memoria del cliente), sin latencia de terceros.
- **Control de calidad**: los bugs de match/dedup se resuelven una vez, en la
  ingesta, no en cada request.

Origen del diseño: migración desde AniList (dependencia en runtime, fuente de
bugs) hacia catálogo propio. Ver `docs/plan-catalogo-local.md`.

---

## 4. Modelo de datos (núcleo)

### Catálogo
- **`Work`** — la obra canónica (lo que se muestra y agrupa). Campos: título,
  `originalTitle` (romaji, llave de dedup cross-idioma), portada, autor,
  sinopsis, géneros canónicos (ES), demografía, `normTitle` (normalizado para
  búsqueda/agrupación), flags de "próximo a salir".
- **`PublisherEdition`** — una edición de la obra por editorial: `publisher`,
  `title`, `slug`, `volumes`, `status`, `url`, `language` (es/en/ja),
  `country` (AR/US/ES/JP…), `workId`. Varias ediciones cuelgan del mismo Work
  (ej. Ivrea AR + VIZ US = misma obra, dos banderas).
- **`Volume`** — tomos de una edición.
- **`IvreaRelease`** — snapshot de próximos lanzamientos: tomo nuevo, debut,
  reedición (con fecha). Única fuente de fechas/próximos.
- **`Mangaka`** — índice propio de autores (la API de fuentes no permite listar
  autores; lo reconstruye un cron).
- **`CrumbMapping`, `EditionExclusion`, `RejectedSource`** — curación e
  idempotencia (overrides de búsqueda, exclusiones, skip-list de duplicados ya
  descartados para no re-importarlos).

### Usuario y colección
- **`User`**, **`Account`**, **`Session`** — auth (NextAuth).
- **`Manga`** — una serie que el usuario sigue. Para obras locales usa un
  pseudo-id negativo (`anilistId = -workId`), reutilizando la maquinaria de
  colección sin tocar el esquema.
- **`TrackedEdition`** — la edición concreta que el usuario colecciona
  (`region` AR/INT/JP, totalVolumes, estado de lectura).
- **`OwnedVolume`** — tomos que tiene (por edición).

### Compras, deseos, social, notis, ops
- **`Purchase` / `PurchaseItem`** — compras (con sincronización bidireccional a
  la colección: comprar suma a colección, borrar/editar la quita/actualiza).
- **`WishlistItem`** — deseados.
- **`Friendship`, `Activity`, `ActivityReaction`, `ActivityComment`** — social.
- **`Notification`, `NotificationPref`, `PushSubscription`, `SeriesNotifMute`,
  `IvreaReleaseNotified`** — notificaciones (in-app + push), prefs por categoría,
  mute por serie, idempotencia de avisos.
- **`JobRun`, `AppState`, `RateLimit`, `LoginEvent`, `Report`, `Store`,
  `IndieWork`** — operación, anti-abuso, moderación, tiendas, indie.

---

## 5. Fuentes de datos

| Fuente | Aporta | Acceso | Notas |
|---|---|---|---|
| **Ivrea Argentina** | Catálogo nacional + fechas (próximos tomos, reediciones, debuts) | Scrape (cheerio) | Única fuente AR de fechas/próximos |
| **MangaUpdates (MU)** | Conteo de tomos por formato, licenciatarios (confirma VIZ), géneros, romaji, sinopsis | API, sin key | Autoridad por título; no bloquea datacenter |
| **MangaDex (MD)** | Portadas + alias (romaji) + géneros | API, sin key | Bloquea hotlinking de portadas → se sirven por proxy |
| **Google Books** | Enumeración por editorial (`inpublisher`) para descubrir series | API key | Rompe el techo de 100/query con multi-query |
| **Whakoom** | Catálogo en español (enriquecimiento) | Scrape, corre LOCAL | Cloudflare bloquea el datacenter |
| **VIZ (inglés)** | Catálogo internacional | Resuelto vía MU+MD+GB | viz.com no es crawleable (robots) |

---

## 6. Motor de resolución (el corazón del sistema)

Cada job de ingesta convierte datos crudos de varias fuentes en obras canónicas
limpias. Lo que se resuelve:

1. **Normalización de títulos** — `normTitle` para agrupar/buscar + `tightTitleKey`
   que distingue homónimos cercanos (ej. "Citrus" vs "Citrus+").
2. **Match inglés→serie** — se consulta **MangaDex primero** para juntar todos los
   nombres (incluido el romaji), y con ese set se le pega a **MangaUpdates**, que
   confirma la licencia (¿es VIZ?) y da el conteo. Esto resuelve el problema de
   que las fuentes indexan en romaji (ej. "My Hero Academia" → "Boku no Hero
   Academia").
3. **Dedup / unificación** — `findOrCreateWork` deduplica por
   normTitle/originalTitle/tightTitleKey. Una serie que ya existe por Ivrea suma
   la edición VIZ **al mismo Work** (no duplica): así una obra puede tener
   ediciones AR + US + ES + JP bajo una sola entidad, con sus banderas.
4. **Mapeo tarjeta→edición** — los snapshots de Ivrea se mapean a la edición por
   **título** (más confiable que el slug del link, que a veces es genérico).
5. **Guards de calidad** — bloqueo anti-hentai/doujin, filtro de ruido
   (artbooks, novelas, guías, box sets), verificación de editorial.
6. **Idempotencia / solo-nuevo** — el descubrimiento descarta lo que ya tenemos
   antes de gastar requests; `RejectedSource` evita re-importar lo curado-afuera;
   el refresh **rota** (procesa los menos recientes primero) para escalar.

Resultado medible: el catálogo VIZ pasó de 19 a 262 series con **0 duplicados**
y 38 obras correctamente unificadas con sus ediciones de Ivrea.

---

## 7. Runtime (lo que ve el usuario)

- **App Router + RSC + Server Actions**: render server-side, mutaciones sin API
  REST manual.
- **Browse**: carga el catálogo y filtra **en memoria del cliente** (texto +
  tabs + géneros + demografía), instantáneo; estado sincronizado a la URL
  (deep-links, back/forward).
- **Catálogo unificado**: nacional + internacional en una sola lista; las
  **banderas** distinguen el origen (🇦🇷 / 🇺🇸) y pueden coexistir en una obra.
- **Próximos / reediciones**: tomos nuevos (📅) y reediciones (♻️) con fecha, en
  el catálogo, la ficha y la lista de compras.
- **Portadas**: MU directo; MD vía proxy propio `/api/cover` (cache inmutable),
  por el bloqueo de hotlinking de MangaDex.

---

## 8. Jobs / Cron (Vercel)

Toda la ingesta corre en cloud salvo Whakoom (bloqueado, corre local). Auth de
crons por `CRON_SECRET` (fail-closed).

- **`/api/cron/ivrea-proximas`** (diario): refresca el snapshot de Ivrea
  (próximos/reediciones/debuts), propaga totales a colecciones y dispara las
  notis cuya fecha es hoy.
- **`/api/cron/viz`** (semanal): **descubre** series nuevas (Google Books) +
  **refresca** un lote rotado contra MU (conteos/tomos nuevos) + sincroniza
  colecciones + notis. Auto-mantenido y escalable.
- **`/api/cron/mangakas`** (semanal): reconstruye el índice de autores.

---

## 9. Notificaciones

- **Push agrupado anti-spam**: 1 push por usuario por corrida (una colección
  grande no recibe decenas de avisos); in-app queda 1 por ítem.
- **Prefs por categoría** (tomo nuevo / reedición / deseado / social) + **mute
  por serie**.
- **Reediciones**: solo a quien le **falta** ese tomo (no a quien ya lo tiene).

---

## 10. Seguridad y operación

- **Auth**: Google OAuth (NextAuth v5), sesiones en DB.
- **Anti-abuso**: rate limiting (modelo `RateLimit`), validación de URLs.
- **Observabilidad**: Sentry (errores), `JobRun` (tracking de ingestas),
  `LoginEvent`.
- **Legal**: borrar cuenta, política de privacidad, términos.
- **Entornos**: producción + **staging como mirror** vía Neon branching con
  scrub de PII; los crawls corren contra producción. Migraciones SQL
  idempotentes escritas a mano.

---

## 11. Diferenciales técnicos (el "pitch")

1. **Catálogo propio, no dependiente de terceros en runtime** → resiliencia y
   velocidad; nadie nos puede romper el producto cambiando su API.
2. **Motor de resolución multi-fuente** con dedup y **unificación cross-idioma**:
   una obra = sus ediciones AR/US/ES/JP bajo una entidad, con banderas.
3. **Datos de mercado argentino** (Ivrea): fechas, próximos tomos y reediciones
   — información que ninguna fuente global tiene.
4. **Pipeline idempotente y auto-mantenido**: los crons descubren, refrescan y
   limpian solos, y **escalan** (refresh rotado) aunque el catálogo crezca.
5. **Modelo extensible**: la misma estructura (obra → ediciones → tomos +
   colección/compras) ya soporta manga y cómics, y es la base para otros
   coleccionables (ej. Funko Pops como waves→ediciones).

---

## 12. Documentos relacionados

- `docs/plan-catalogo-local.md` — migración a catálogo propio.
- `docs/plan-viz-en.md` — research + pipeline internacional (VIZ).
- `docs/plan-internacional.md` — ediciones JP/EN/ES sobre el mismo Work.
- `docs/generos-taxonomia.md` — taxonomía de géneros canónicos.
- `docs/frescura-catalogo.md` — estrategia de actualización del catálogo.
- `docs/staging-mirror.md` — mirror de staging vía Neon branching.
- `docs/scripts.md` — comandos de ingesta/mantenimiento.
