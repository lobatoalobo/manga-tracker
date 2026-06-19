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
   Whakoom ────┘   (ES catalog, optional)
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
        │                                    + covers → Vercel Blob (owned)
        ▼
   PostgreSQL (Neon)
        │
        ▼
   Next.js (App Router / RSC)  ← runtime: reads ONLY Postgres + Blob
        │
        ▼
   User
```

External sources are queried **only during ingestion** (crawl/cron). The runtime
serves everything from Postgres + our own Blob storage.

---

## 3. Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React Server Components, Server Actions) |
| Language | TypeScript |
| UI | React 19, Tailwind, mobile-first |
| ORM / DB | Prisma 6 + PostgreSQL (Neon serverless) |
| Storage | Vercel Blob (owned covers) |
| Auth | NextAuth v5 — Google OAuth |
| Notifications | Web Push (VAPID) + in-app notifications |
| Scraping | cheerio (server-side HTML parser) |
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
- **`Work`** — the canonical work. Fields: title, `originalTitle` (romaji,
  cross-language dedup key), cover (owned Blob URL), author, synopsis, canonical
  genres (ES), demographic, `normTitle`, "upcoming" flags.
- **`PublisherEdition`** — one edition per publisher: `publisher`, `title`,
  `slug`, `volumes`, `status`, `url`, `language` (es/en/ja), `country`
  (AR/US/ES/JP…), `workId`. Multiple editions hang off the same Work (Ivrea AR +
  VIZ US = same work, two flags).
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
| **Ivrea Argentina** | **Local truth**: AR catalog + dates (upcoming, reprints, debuts) | Scrape (cheerio) | Sole AR date source |
| **MangaUpdates (MU)** | **Publisher truth**: per-format counts, licensees (confirms VIZ), genres, romaji, synopsis | API, no key | Per-title authority |
| **MangaDex (MD)** | **Aliases** (romaji) + covers | API, no key | Blocks hotlinking → cover downloaded to Blob |
| **Google Books** | **Discovery**: enumerate by publisher (`inpublisher`) | API key | Multi-query breaks the ~100/query ceiling |
| **Whakoom** | ES catalog (enrichment) | Scrape, runs LOCAL | Cloudflare blocks the datacenter |

Responsibilities are not mixed: each source has a specific role.

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
3. **Dedup / unification** — `findOrCreateWork` deduplicates by
   normTitle/originalTitle/tightTitleKey. A series already present via Ivrea adds
   the VIZ edition **to the same Work** (no duplicate): a work can have AR + US +
   ES + JP editions under a single entity, with their flags.
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
  origin (🇦🇷/🇺🇸) and can coexist.
- **Upcoming / reprints**: new volumes (📅) and reprints (♻️) with dates, in the
  catalog, the detail page and the shopping list.
- **Covers**: in **owned storage** (Vercel Blob), served from our origin. Full
  independence for images too.

---

## 9. Jobs / Cron (Vercel)

All ingestion runs in the cloud except Whakoom (blocked, runs local). Auth via
`CRON_SECRET` (fail-closed).

- **`/api/cron/ivrea-proximas`** (daily): refreshes the Ivrea snapshot, propagates
  totals to collections, fires the alerts whose date is today.
- **`/api/cron/viz`** (weekly): **discovers** (Google Books) + **refreshes** a
  rotated batch (MU) + **migrates** covers to Blob (batch) + syncs collections +
  alerts.
- **`/api/cron/mangakas`** (weekly): rebuilds the author index.

---

## 10. Scalability

Growth is accounted for; these are the axes and the plan:

| Axis | Today | Threshold | Plan |
|---|---|---|---|
| **Browse / filters** | Client-side (load + filter in memory) | ~30,000+ works starts to hurt | Migrate to **server-side search**: Postgres index (`pg_trgm`/FTS) + pagination + faceting. The data model already supports it; it's a query-layer change, not a schema change. |
| **Catalog refresh** | Weekly cron **rotated** by `updatedAt` (bounded batch/run) | Grows linearly with the catalog | Already **O(k) incremental per run**, not O(n) total: covers everything over several weeks without exceeding `maxDuration`. At larger scale: higher frequency or sharded parallelism. |
| **Discovery** | Google Books + MU verification, discarding existing | GB quota | Bounded per run; only processes new candidates. |
| **Covers** | Owned Blob + batch migration in the cron | Blob bandwidth | CDN cache (immutable); at scale, evaluate resize/optimization. |
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
  Blob while migration finishes; the proxy can be retired once 100% of covers are
  in Blob.

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

> Full catalog in the database (includes publishers still hidden in the MVP). The
> **visible** MVP catalog is Ivrea + VIZ; the rest (Panini/Ovni/Spanish) is
> ingested but not listed yet.

**Catalog**
- ~1,840 works (`Work`)
- ~1,940 editions (`PublisherEdition`) — by language: ES ~1,680, EN ~262
- ~8,370 volumes (`Volume`)
- By publisher: Ovni 628 · Ivrea 595 · Panini 286 · **VIZ 262** · Distrito 83 ·
  Utopía 50 · Kemuri 24 · Larp 14

**Pipeline**
- 5 sources (Ivrea, MU, MangaDex, Google Books, Whakoom)
- Cron ingestion (Ivrea daily, VIZ/mangakas weekly); requests bounded per run

**Quality**
- VIZ: 262 series, **0 duplicates**, 38 unified with Ivrea
- Discovery with MU verification: ~58% of new candidates confirmed and imported

*(Fill in with real performance once measured: search <100ms, initial load <1s,
etc.)*

---

## 15. Risks and mitigations

| Source / area | Risk | Mitigation |
|---|---|---|
| **Whakoom** | Cloudflare blocks the datacenter | **Optional** source (ES enrichment); runs local; the catalog doesn't depend on it |
| **Google Books** | Quota / API changes | Used **for discovery only**, not canonical data (that comes from MU); degradation: the curated seed keeps working |
| **Ivrea** | HTML change breaks the scrape | **Ingestion alerts** (an empty/anomalous parse should alert); `JobRun` records each run; the snapshot is a full replace (no incremental corruption) |
| **MangaUpdates / MangaDex** | API change or rate-limit | Local catalog: an outage doesn't affect runtime, only delays ingestion; throttle + retries |
| **External covers** | Host deletes/changes the image | **Owned storage** (Blob): once migrated, it's ours |
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

- `docs/plan-catalogo-local.md` — migration to an owned catalog.
- `docs/plan-viz-en.md` — research + international pipeline (VIZ).
- `docs/plan-internacional.md` — JP/EN/ES editions over the same Work.
- `docs/generos-taxonomia.md` — canonical genre taxonomy.
- `docs/frescura-catalogo.md` — catalog refresh strategy.
- `docs/staging-mirror.md` — staging mirror via Neon branching.
- `docs/scripts.md` — ingestion/maintenance commands.
