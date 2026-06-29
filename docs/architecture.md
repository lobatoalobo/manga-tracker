# Nakama — Technical Architecture

Technical overview of the system (due-diligence style). Covers what it is, how
it's built, the data model, the data pipeline, scalability, technical debt and
risks. Last updated: 2026-06.

> Spanish version: [`arquitectura.md`](arquitectura.md). **Keep both in sync.**

---

## 1. What it is

Nakama is a platform for **manga/comics collectors** (Argentina-first, with
international expansion): browsable catalog, collection tracking by volume and by
edition, shopping list, spending, wishlist, new-volume / reprint alerts, and a
social layer (friends, activity).

The core asset is not the UI but the **owned catalog**: a base of canonical works
with their editions by publisher and language, resolved and deduplicated from
multiple sources, that **does not depend on any external API at runtime**.

---

## 2. Architecture diagram

```
   Ivrea ──────┐   (local truth: AR catalog + dates/upcoming/reprints)
   MangaUpdates┤   (publisher truth: volume counts, licensees, romaji)
   MangaDex ───┤   (aliases/romaji + covers)
   Google Books┤   (discovery: enumerate by publisher)
   Whakoom ────┘   (catalog for the other AR publishers)
   AniList ─────   (batch: legal reader links)
        │
        ▼
 ┌─────────────────────────────────────────┐
 │  RESOLUTION PIPELINE  (ingestion)        │
 │  normalization · match (MD→MU) · dedup/  │
 │  unification · mapping · guards · idempot.│
 └─────────────────────────────────────────┘
        │
        ▼
   Work ─┬─ PublisherEdition (AR/US/ES/JP) ─┬─ Volume
         └─ IvreaRelease (upcoming/reprints)│
        │                                    + covers → Cloudflare R2 (owned)
        ▼
   PostgreSQL (Neon)
        │
        ▼
   Next.js (App Router / RSC)  ← runtime: reads ONLY Postgres + R2
        │
        ▼
   User
```

External sources are queried **only during ingestion** (crawl/cron). The runtime
serves everything from Postgres + our own covers in R2.

---

## 3. Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React Server Components, Server Actions) |
| Language | TypeScript |
| UI | React 19, Tailwind, mobile-first |
| ORM / DB | Prisma 6 + PostgreSQL (Neon serverless) |
| Storage | Cloudflare R2 (owned covers, S3-compatible) |
| Auth | NextAuth v5 — Google OAuth |
| Notifications | Web Push (VAPID) + in-app notifications |
| Scraping | regex server-side parsers (no cheerio) + APIs (MU/MD/Google Books) |
| Observability | Sentry |
| Hosting | Vercel (serverless + Cron Jobs + Edge CDN) |

---

## 4. Architecture principle: local catalog (ETL, not proxy)

**Golden rule:** at *runtime* (when a user browses) the app reads **only Postgres
+ our Blob**. External sources are queried **only in the ingestion jobs**
(crawl/cron), which resolve match/mapping/dedup and **persist the already-resolved
result**. The problem becomes an **ETL**, not a proxy.

Consequences:
- **Resilience**: if an external source goes down or changes, the app keeps
  working. The blast radius stays in the ingestion job.
- **Speed**: browse/search/filters are served locally, no third-party latency.
- **Quality control**: match/dedup bugs are solved once, at ingestion, not on
  every request.

Origin: migration away from AniList (runtime dependency, source of bugs) toward an
owned catalog. See `docs/plan-catalogo-local.md`.

---

## 5. Data model (core)

### Catalog
- **`Work`** — the canonical work. (Data redesign Jun-2026, see
  `docs/analisis-sistema-datos.md`.)
  - **Multi-language titles**: `title` (display, ES>EN>romaji), `originalTitle`
    (romaji), `titleEn`, `titleNative` (Japanese). `normTitle` for search/grouping.
  - **Stable external identity**: `anilistId`, `muId` (MangaUpdates), `mdId`
    (MangaDex uuid) — all `@unique`. **Matching is anchored on external id + author,
    NOT on the title** (which is display-only); resolved once and reused (idempotent).
  - **Per-language synopsis**: `synopsisEs` / `synopsisEn` (+ `synopsisEsAuto` /
    `synopsisEnAuto` = machine-translated). The source's native one wins; the missing
    one is LLM-translated (`lib/translate`: OpenAI/DeepL/Claude). `synopsis` is
    DEPRECATED (transition). UI: ES/EN tabs on the serie page.
  - **`type`** — content type (`MANGA` | `COMIC` | `LIGHT_NOVEL` | `ARTBOOK` |
    `DATABOOK` | `OTHER`, default MANGA). Publishers like Panini/Ovni mix manga and
    Marvel/DC/indie comics; `COMIC` is classified via `lib/contentType` (heuristic
    by title Marvel/DC + Western author, hand-validated) and **hidden from the
    catalog** until GCD is integrated. See `docs/backlog.md`.
  - **`readingLinks`** (Json) — LEGAL reader links (MANGA Plus, VIZ…) curated by
    AniList (`type: STREAMING`), backfilled by batch (no AniList at runtime). The
    serie page shows "Read online" buttons (filtered to ES/EN) + a MangaDex link
    derived from `mdId`.
  - Other: cover (owned R2, **volume 1** anti-spoiler), `author`, `assistants`,
    canonical genres (ES), `rawGenres`, demographic, `curated` (manually edited
    fields no job overwrites), "upcoming" flags.
- **`PublisherEdition`** — one edition per publisher: `publisher`, `title`,
  `slug`, `volumes`, `status`, `url`, `language` (es/en/ja), `country`
  (AR/US/ES/JP…), `synopsis` (in the edition's language), `whakoomId`, `workId`.
  Multiple editions hang off the same Work (Ivrea AR + VIZ US = same work, two
  flags), each with its own volume count/synopsis without clobbering.
- **`Volume`** — an edition's volumes.
- **`IvreaRelease`** — upcoming snapshot: new volume, debut, reprint (with date).
  Sole AR source of dates/upcoming.
- **`Mangaka`** — owned author index.
- **`CrumbMapping`, `EditionExclusion`, `RejectedSource`** — curation and
  idempotency (overrides, exclusions, skip-list of already-discarded duplicates).

### User and collection
- **`User`**, **`Account`**, **`Session`** — auth (NextAuth).
- **`Manga`** — a series the user follows. Local works use a negative pseudo-id
  (`anilistId = -workId`); see §11 (known technical debt).
- **`TrackedEdition`** — the edition collected (`region` AR/INT/JP, totalVolumes,
  reading status).
- **`OwnedVolume`** — volumes owned.

### Purchases, wishlist, social, notifications, ops
- **`Purchase` / `PurchaseItem`** — purchases (bidirectional sync to the
  collection: buying adds, deleting/editing removes/updates).
- **`WishlistItem`** — wishlist.
- **`Friendship`, `Activity`, `ActivityReaction`, `ActivityComment`** — social.
- **`Notification`, `NotificationPref`, `PushSubscription`, `SeriesNotifMute`,
  `IvreaReleaseNotified`** — notifications, per-category prefs, per-series mute,
  alert idempotency.
- **`JobRun`, `AppState`, `RateLimit`, `LoginEvent`, `Report`, `Store`,
  `IndieWork`** — operations, anti-abuse, moderation, stores, indie.

---

## 6. Data sources (each with a single role)

| Source | Role | Access | Notes |
|---|---|---|---|
| **Ivrea Argentina** | **Local truth**: AR catalog + **dates** (upcoming, reprints, debuts) | Scrape (regex) | Sole AR date/calendar source |
| **Whakoom** | **Catalog for the other AR publishers** (Panini/Ovni/Kemuri/Utopía/Larp): titles, authors, volumes, covers | Scrape, runs LOCAL | Cloudflare blocks the datacenter. Gives NO future dates (only Ivrea has them) |
| **MangaUpdates (MU)** | **Publisher truth**: per-format counts, licensees (confirms VIZ), genres, romaji, synopsis | API, no key | NOTE: also indexes Western comics → not usable to classify manga/comic |
| **MangaDex (MD)** | **Aliases** (romaji) + identity (`mdId`) + covers | API, no key | Blocks hotlinking → cover downloaded to R2 |
| **Google Books** | **Discovery**: enumerate by publisher (`inpublisher`) | API key | Multi-query breaks the ~100/query ceiling |
| **AniList** | Legal reader links (`readingLinks`) | API, no key | Batch only (off at runtime); legacy unification key |

Responsibilities are not mixed: each source has a specific role. **Western comics
(DC/Marvel/indie) wait for `comics.org` (GCD)** as a future source.

---

## 7. Resolution engine (the project's moat)

Each ingestion job turns raw multi-source data into clean canonical works. What
gets resolved:

1. **Title normalization** — `normTitle` for grouping/search + `tightTitleKey`
   that distinguishes near-homonyms ("Citrus" vs "Citrus+").
2. **English→series match** — **MangaDex is queried first** to gather all known
   names (including romaji), and that set is fed to **MangaUpdates**, which
   confirms the license and gives the count. Solves that sources index by romaji
   ("My Hero Academia" = "Boku no Hero Academia" = 僕のヒーローアカデミア).
3. **Dedup / unification** — `findOrCreateWork` resolves identity **id-first**:
   `anilistId → muId → mdId → tightTitleKey(title)`, with a final bridge by
   **romaji (`originalTitle`) + author** (unifies the same series across languages
   when neither side has an external id: "Alley" VIZ ↔ "El Callejón" Ivrea). A
   series already present adds another publisher's edition **to the same Work** (no
   duplicate): a work can have AR + US + ES + JP editions under a single entity.
   Identity is anchored on **external id + author**, not the title (display).
   **Anti-over-merge guard** (in enrich): two works sharing an external id are only
   merged if they're the SAME series (same `tightTitleKey` or romaji) — if the
   subtitle differs ("Attack on Titan" vs "…: No Regrets"), the matcher
   mis-assigned the base series' id to a spin-off and they are NOT merged.
   `romajiKey` uses `tightTitleKey` so a series isn't merged with its sequel
   (Citrus vs Citrus+). EN synopsis → `synopsisEn`, ES → `synopsisEs`; the missing
   one is LLM-translated. See `docs/analisis-sistema-datos.md`.
   - **Manga/comic classification** (`Work.type`): Whakoom exposes no category and
     MU/MD index comics, so it's classified heuristically (`lib/contentType`: title
     Marvel/DC/indie + Western author) with **human review**. Enrich **never touches
     `type=COMIC`** (it polluted/merged them). Comics stay hidden from the catalog
     until GCD.
4. **Card→edition mapping** — Ivrea snapshots are mapped by **title** (more
   reliable than the link slug, which is sometimes generic).
5. **Quality guards** — anti-hentai/doujin block (not imported) + publisher
   verification (the source must confirm the target publisher). **Only in the
   Google Books discovery** are non-manga-series titles also filtered out
   (artbooks, novels, guides, box sets) to avoid enumerating noise as fake works.
   *This does NOT delete or block artbooks/box sets from the catalog;* it only
   avoids auto-importing them as series. Tracking them as first-class collectible
   items is a future opportunity via `Work.type`.
6. **Idempotency / new-only** — discovery discards what we already have before
   spending requests; `RejectedSource` avoids re-importing curated-out entries;
   the refresh **rotates** (oldest-first).

Measurable result: the VIZ catalog went from 19 to **262 series with 0
duplicates** and **38 works unified** with their Ivrea editions.

---

## 8. Runtime (what the user sees)

- **App Router + RSC + Server Actions**: server-side render, mutations without a
  manual REST API.
- **Browse**: loads the catalog and filters **client-side in memory** (text +
  tabs + genres + demographic), instant; state synced to the URL.
  - **Current strategy: client-side filtering.** Optimal at the current order of
    magnitude (thousands of works). **Will migrate to server-side search**
    (index + pagination + faceting in Postgres) when the catalog requires it.
    See §10.
- **Unified catalog**: national + international in one list; flags distinguish
  origin (🇦🇷/🇺🇸) and can coexist. `inCatalogWhere()` is the single source of
  visibility: includes `CATALOG_PUBLISHERS` (national) + VIZ, and **excludes
  `type=COMIC`** (comics are in the DB but hidden until GCD).
- **Upcoming / reprints**: new volumes (📅) and reprints (♻️) with dates, in the
  catalog, the detail page and the shopping list. **Only Ivrea** provides a
  calendar (the other publishers have no future-date source).
- **Read online**: buttons to legal readers (`readingLinks`) + MangaDex.
- **Covers**: in **owned storage** (Cloudflare R2), of **volume 1** (anti-spoiler),
  served from our origin. Full independence for images too.

---

## 9. Jobs / Cron (Vercel)

All ingestion runs in the cloud except Whakoom (blocked, runs local). Auth via
`CRON_SECRET` (fail-closed).

- **`/api/cron/ivrea-catalogo`** (daily): crawls the Ivrea catalog
  (volumes/status/cover). Caps over-counting (doesn't count future-dated volumes).
- **`/api/cron/ivrea-proximas`** (daily): refreshes the Ivrea upcoming/reprints
  snapshot, propagates totals to collections, fires the alerts whose date is today.
- **`/api/cron/viz`** (weekly): **discovers** (Google Books) + **refreshes** a
  rotated batch (MU) + **migrates** covers to R2 (batch) + syncs collections + alerts.
- **`/api/cron/mangakas`** (weekly): rebuilds the author index.
- **`refresh-catalog.mjs`** (local task on the user's PC, not a Vercel cron):
  Whakoom (catalog for the other publishers) + enrich + synopsis translation +
  mirror to staging. Whakoom blocks the datacenter, hence local.

---

## 10. Scalability

Growth is accounted for; these are the axes and the plan:

| Axis | Today | Threshold | Plan |
|---|---|---|---|
| **Browse / filters** | Client-side (load + filter in memory) | ~30,000+ works starts to hurt | Migrate to **server-side search**: Postgres index (`pg_trgm`/FTS) + pagination + faceting. The data model already supports it; it's a query-layer change, not a schema change. |
| **Catalog refresh** | Weekly cron **rotated** by `updatedAt` (bounded batch/run) | Grows linearly with the catalog | Already **O(k) incremental per run**, not O(n) total: covers everything over several weeks without exceeding `maxDuration`. At larger scale: higher frequency or sharded parallelism. |
| **Discovery** | Google Books + MU verification, discarding existing | GB quota | Bounded per run; only processes new candidates. |
| **Covers** | Owned R2 + batch migration in the cron | R2 bandwidth | CDN cache (immutable); R2 has no egress fees. At scale, evaluate resize/optimization. |
| **DB** | Neon serverless | — | Branching for staging; read-replicas if needed. |

---

## 11. Known technical debt

- **Negative pseudo-id (`Manga.anilistId = -workId`)** — clever for reusing the
  collection machinery without migrating the schema, but the `Manga`/`anilistId`
  naming no longer reflects reality (it's not AniList). **Known debt**: eventually
  rename to something like `CollectionItem` with a direct FK to `Work`. Not
  urgent; flagged to not forget it.
- **Genres as `String[]` on `Work`** — works for filtering today. For advanced
  filters / statistics / recommendations / faceted search at scale, normalize to
  `Genre` + `WorkGenre` (join). Bounded migration when serious faceting is needed.
- **Covers: transition** — the `/api/cover` proxy (safety net) coexists with owned
  R2 while migration finishes; the proxy can be retired once 100% of covers are in
  R2.

---

## 12. Notifications

- **Grouped anti-spam push**: 1 push per user per run; in-app 1 per item.
- **Per-category prefs** (new volume / reprint / wishlist / social) + **per-series
  mute**.
- **Reprints**: only to users who are **missing** that volume.

---

## 13. Security and operations

- **Auth**: Google OAuth (NextAuth v5), DB-backed sessions.
- **Anti-abuse**: rate limiting (`RateLimit`), URL validation.
- **Observability**: Sentry, `JobRun` (ingestion tracking), `LoginEvent`.
- **Legal**: delete account, privacy, terms.
- **Environments**: production + **staging as a mirror** via Neon branching with
  PII scrub. Hand-written idempotent SQL migrations.

---

## 14. Metrics (snapshot)

> The **visible** catalog is the national publishers **Ivrea + Panini + Ovni +
> Kemuri + Utopía + Larp** (their **manga** only) + VIZ (international). Western
> **comics** (~714 `type=COMIC` works) and the Spanish publishers are in the DB but
> **hidden** until GCD is integrated / their origin is defined.

**Catalog** (snapshot Jun-2026)
- ~1,814 works (`Work`) — **~1,031 visible** · ~714 hidden comics
- ~1,941 editions (`PublisherEdition`) — by language: ES ~1,680, EN ~262
- ~8,280 volumes (`Volume`)
- By publisher: Ovni 629 · Ivrea 594 · Panini 284 · **VIZ 262** · Distrito 83 ·
  Utopía 50 · Kemuri 24 · Larp 14

**Pipeline**
- 6 sources (Ivrea, Whakoom, MU, MangaDex, Google Books, AniList)
- Cron ingestion (Ivrea daily, VIZ/mangakas weekly); Whakoom runs local; requests
  bounded per run

**Quality**
- VIZ: 262 series, **0 duplicates**, 38 unified with Ivrea
- Cross-language dedup + anti-over-merge guard (no collapsing spin-offs/sequels)
- Manga/comic classification hand-validated per publisher (Panini/Utopía/Ovni)

*(Fill in with real performance once measured: search <100ms, initial load <1s,
etc.)*

---

## 15. Risks and mitigations

| Source / area | Risk | Mitigation |
|---|---|---|
| **Whakoom** | Cloudflare blocks the datacenter | Runs **local**; it's the ingestion source for the other AR publishers' catalog, but the **runtime doesn't depend** on it (persisted resolved) |
| **Google Books** | Quota / API changes | Used **for discovery only**, not canonical data (that comes from MU); degradation: the curated seed keeps working |
| **Ivrea** | HTML change breaks the scrape | **Ingestion alerts** (an empty/anomalous parse should alert); `JobRun` records each run; the snapshot is a full replace (no incremental corruption) |
| **MangaUpdates / MangaDex** | API change or rate-limit | Local catalog: an outage doesn't affect runtime, only delays ingestion; throttle + retries |
| **External covers** | Host deletes/changes the image | **Owned storage** (R2): once migrated, it's ours |
| **Browse scale** | Client-side filtering doesn't scale to 100k+ | Migration plan to server-side search (§10) |

---

## 16. Technical differentiators (the pitch)

1. **Owned catalog, no third-party dependency at runtime** (metadata **and**
   covers in owned storage) → resilience and speed.
2. **Multi-source resolution engine** with dedup and **cross-language
   unification**: one work = its AR/US/ES/JP editions under a single entity.
   *This is the moat* — resolving "Boku no Hero Academia = My Hero Academia = 僕の…"
   without generating garbage is what would take a competitor months.
3. **Argentine market data** (Ivrea): dates, upcoming and reprints — info no
   global source has.
4. **Idempotent, self-maintaining pipeline** that **scales** (rotated refresh,
   incremental discovery).
5. **Extensible model**: work → editions → volumes + collection/purchases already
   supports manga and comics, and is the base for other collectibles.

---

## 17. Related documents

- `docs/backlog.md` — prioritized backlog (source of truth for pending work).
- `docs/analisis-sistema-datos.md` — identity/dedup redesign (Jun-2026).
- `docs/auditoria-tomos-ivrea.md` — Ivrea vs Whakoom volume-count audit.
- `docs/plan-catalogo-local.md` — migration to an owned catalog.
- `docs/plan-viz-en.md` — research + international pipeline (VIZ).
- `docs/plan-internacional.md` — JP/EN/ES editions over the same Work.
- `docs/generos-taxonomia.md` — canonical genre taxonomy.
- `docs/frescura-catalogo.md` — catalog refresh strategy.
- `docs/staging-mirror.md` — staging mirror via Neon branching.
- `docs/scripts.md` — ingestion/maintenance commands.
