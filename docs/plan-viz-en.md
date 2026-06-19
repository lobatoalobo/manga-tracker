# Research: catálogo VIZ (inglés) — verificado, implementable

Objetivo: catálogo navegable de manga en inglés de VIZ como **obras propias**
(decisión 2026-06-19), en una sección **Internacional** aparte del nacional.
Research con probes reales (no teoría) para no repetir el problema de AniList.

## Fuentes — qué probé y qué dio (2026-06-19)

| Fuente | Probe | Resultado | Veredicto |
|---|---|---|---|
| **viz.com** | GET robots.txt + home | home 200, pero **`robots.txt: Disallow: /manga/`** (su catálogo) + `/products` + crawl-delay 2 | ❌ **NO scrapear** (lo prohíbe). Descartado como crawl. |
| **MangaUpdates** (ya integrado, sin key, no bloquea Vercel) | search "Chainsaw Man" → detail | `publishers: [VIZ Media (English), Shueisha (Original), MANGA Plus (English)]` + `status: "24 Volumes (Complete)"` + géneros/año/título original | ✅ **Autoridad por-título**: confirma que VIZ licencia + conteo + romaji + géneros. **PERO no tiene endpoint para listar las series de una editorial** (probé `pubname` → 0; el detail de publisher no trae la lista). |
| **MangaDex** (ya integrado) | (usado en enrich) | portadas + altTitles + tags | ✅ portadas. |
| **Wikidata** (SPARQL, gratis) | P31=manga series ∧ P123=VIZ (Q660288) | **0 resultados** (no modela a VIZ como editorial en las series) | ❌ no sirve para enumerar. |
| **Google Books API** | `inpublisher:"Viz Media"` | **429 sin API key** (cuota anónima compartida) | ⚠️ necesita **API key gratis**; con key da catálogo por-tomo + ISBN + portada. Calidad sin verificar (no tengo key). |

**Conclusión dura:** NO existe una API libre que devuelva el catálogo COMPLETO de
VIZ de una. viz.com (la fuente natural) está vedado por robots. Así que el diseño
separa **resolución por-serie** (sólida, verificada) de **enumeración** (la parte
sin fuente perfecta), con opciones.

## Arquitectura (2 capas)

### Capa 1 — Resolución por serie (VERIFICADA, sin deps nuevas)
Dado un título, **MangaUpdates** confirma VIZ (publishers[English] = "VIZ Media") +
da conteo (`status`) + géneros + año + **título original (romaji)**; **MangaDex** da
portada. Corre en Vercel (no bloquean). Reusa el pipeline de `enrichWorks`.

### Capa 2 — Enumeración (la lista de series VIZ). 3 opciones implementables:
- **E1 — Seed curado (RECOMENDADO para arrancar, cero dependencias):** lista de
  series VIZ (JSON en repo o tabla editable por admin), cada una procesada por la
  Capa 1. Bulletproof, controlado, sin key, sin bloqueo. Patrón "lista de URLs de
  Whakoom" aplicado a VIZ. Arrancar con las grandes (línea Shonen Jump, etc.) y
  crecer. 100% hoy.
- **E2 — Google Books `inpublisher:"Viz Media"` (más completo, +1 dep):** con API
  key gratis, enumera los libros de VIZ con **ISBN + portada + fecha por tomo**.
  Requiere: key + agrupar tomos→serie ("Title, Vol. N") + filtrar no-manga (light
  novels/artbooks). Es lo más cercano al catálogo real de VIZ accesible por API.
  Verificar calidad cuando exista la key.
- **E3 — Alta por admin/comunidad:** form/import puntual (modelo Whakoom-URL).

## Modelo de datos (encaja, cambios chicos — del plan internacional)
```prisma
// PublisherEdition += 
language String  @default("es") // "es" | "en" | "ja"
country  String?                // "US" | "AR" | "JP" | ...
```
- VIZ serie = `Work` + `PublisherEdition(publisher="VIZ Media", language="en", country="US", volumes=N)`. ISBN/portada por tomo en `Volume`.
- **Dedup al Work existente por `originalTitle` (romaji):** si la serie VIZ ya existe (p. ej. también la publica Ivrea), la edición VIZ se cuelga del MISMO Work → "Chainsaw Man" queda 1 obra con edición Ivrea + VIZ. `findOrCreateWork` (por originalTitle/título) **ya hace esto**. VIZ crea Works nuevos solo para lo que no tenemos.
- Backfill: ediciones actuales → `language="es"`, `country="AR"` (Ivrea) etc.

## Catálogo / UI
- Sección **Internacional** aparte: el browse nacional sigue Ivrea-only; las obras
  con edición `en`/VIZ aparecen en su propia vista/tab (o un filtro de Origen:
  🇦🇷 nacional / 🇺🇸 inglés). `inCatalogWhere` se amplía para incluir VIZ en esa vista.
- "Nacional" = `country=AR` (chip 🇦🇷). VIZ lleva 🇺🇸. (Reusa el patrón de chips por edición del plan.)
- Géneros/demografía ya andan por-Work (las obras VIZ los traen de MU).

## Pipeline / mantenimiento
- Job `crawl viz` (como ivrea/whakoom): procesa el seed (E1) o Google Books (E2)
  vía MU/MD, periódico, resumable, con el **guard anti-hentai** (genres MU).
- **Ventaja clave:** MU/MD/Google Books **NO bloquean datacenter** → este pipeline
  puede correr en **Vercel cron** (a diferencia de Whakoom, que es local).

## Riesgos / honestidad
- **Sin enumeración perfecta libre:** E1 (seed) es bulletproof pero crece a mano;
  E2 (Google Books) es más completo pero +key +limpieza y sin verificar aún.
- **Conteo VIZ ≠ conteo MU:** MU da el conteo ORIGINAL (japonés); la edición VIZ a
  veces difiere (omnibus/3-en-1). MU = aproximado; Google Books por-tomo = exacto.
  Para MVP, MU alcanza; marcarlo.
- **Universo crece:** las series solo-VIZ pasan a ser Works nuevos (lo elegido). La
  sección Internacional las mantiene separadas de lo nacional.

## Plan de implementación (fases, 100% factible)
1. **Schema**: `language`/`country` en PublisherEdition + migración + backfill AR→(es/AR). (chico, seguro)
2. **Capa 1**: función `resolveVizSeries(title)` con MU (verifica VIZ + count + romaji + géneros) + MD (portada) → `findOrCreateWork` + `PublisherEdition(VIZ, en, US)`. Reusa enrich.
3. **Enumeración E1**: seed list (JSON/tabla) + `crawl viz` que la procesa. (MVP)
4. **UI**: sección/filtro Internacional + chip 🇺🇸 por edición.
5. **(Opcional E2)**: integrar Google Books con key para enumeración completa + ISBN por tomo.

**Decisión pendiente:** arrancar con **E1 (seed curado, sin deps)** o montar **E2
(Google Books, key)** para enumeración completa. Recomiendo E1 para el MVP "1
extranjera sin fallas" y sumar E2 como mejora.
