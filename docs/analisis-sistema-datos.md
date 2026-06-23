# Análisis del sistema de datos, matcheo y mapping

> Objetivo: entender qué tenemos, qué necesitamos, por qué fallamos seguido, y
> rediseñar estructura + lógica para que los datos tengan sentido y escalen a más
> editoriales (con estructuras peores). No parchar el problema del momento.

## 1. Qué tenemos — fuentes y qué da cada una

| Fuente | Cómo | Qué aporta | Idioma | Llave |
|---|---|---|---|---|
| **Ivrea** (scrape ficha) | `getIvreaDataBySlug` | title ES, **romaji** (originalTitle), author (a veces), synopsis ES, **tomos AR**, tomos JP, status, próximo tomo | ES | slug |
| **Ivrea /proximas/** | `refreshIvreaProximas` | lanzamiento/debut/oneshot/**reedición** + fecha | ES | slug |
| **Whakoom** (scrape, **local-only**) | `getWhakoomEdition` | title `"Romaji: ES"`, author, publisher, tomos, cover, synopsis ES, releaseDate, **whakoomId**, ids por tomo | ES | whakoomId |
| **VIZ** (vía MU/MD) | `importVizSeries` | title EN, romaji (mu.title), author, synopsis EN, tomos estándar | EN | (resuelto por MU) |
| **MangaUpdates** | `getMangaUpdatesEnrich` / `getMuLicensed` | **géneros**, author, description EN, aliases, standardVolumes, englishPublishers (detecta VIZ) | EN | muId (no persistido) |
| **MangaDex** | `getMangaDex` | **géneros**, **aliases (todos los idiomas: native/romaji/en)**, cover, description EN | multi | mdId (no persistido) |
| **AniList** | `lib/anilist` | géneros, personajes, relaciones; **era la llave canónica** | en/romaji/native | anilistId (apagado en runtime) |

## 2. Cómo se relaciona hoy (modelo)

```
Work (1 obra)  ──<  PublisherEdition[] (N ediciones, 1 por editorial)
                         └──< Volume[] (tomos)
```

- **Work**: `title` (display), `originalTitle` (romaji), `author` (texto libre), `anilistId?`, `genres[]`, `rawGenres[]`, `demographic`, `synopsis` (UNA sola), `coverImage`, `curated[]` (campos editados a mano), `enrichedAt`, `upcoming`, `releaseLabel`.
- **PublisherEdition**: `publisher`, `slug`, `title`, `normTitle`, `anilistId?`, `volumes`, `language` (es/en/ja), `country`, `whakoomId? @unique`, `workId?`.
- **Dedup / identidad del Work**: `findOrCreateWork` agrupa por `anilistId` (si hay) o, si no, por **`tightTitleKey(title)`** (título normalizado conservando `+` y números).

## 3. Modos de falla (causas raíz, con evidencia)

### A. La identidad del Work es el TÍTULO (frágil)
`findOrCreateWork` agrupa por `tightTitleKey(title)` cuando no hay anilistId. El título es **inestable**: idioma (ES vs EN vs romaji), subtítulos (`"Romaji: Traducción"`), entidades HTML (`I&quot;s`), mayúsculas, decoraciones de editorial. Consecuencias:
- **Mezcla de ediciones** (serie/1614 Rai Rai Rai): la obra existe en Ivrea (1 tomo) y VIZ (5 tomos). Ambas comparten `tightTitleKey("Rai Rai Rai")` → **mismo Work** (correcto), pero la edición VIZ escribió `volumes=5` y la sinopsis EN, y la edición Ivrea quedó con conteo 5 (de VIZ) y sin su tomo real (1). Las señales por-edición se pisaron y la edición VIZ ni siquiera quedó como fila separada.
- **Homónimos**: mismo título, distinto autor → se fusionan. Mitigado con `authorMatches` SOLO en el path de AniList (`resolveByTitleAuthor`), no en `findOrCreateWork`.
- **Sin matchear** lo que tiene el título "raro": el 50% sin géneros era mayormente Panini/Ovni con `"Romaji: ES"` que no probábamos cortar por `:`.

### B. Sin identidad externa estable persistida
No guardamos `muId` ni `mdId`. Cada `enrichWorks` **re-busca por título** contra MU/MD → no idempotente, frágil, y se vuelve a romper si cambia el título. `anilistId` era la llave canónica pero está apagado en runtime. `whakoomId` existe **por edición** pero no se usa como identidad del Work.

### C. Datos que deberían ser por-idioma/por-edición viven en el Work
`synopsis`, `coverImage`, `genres`, `author`, `originalTitle` viven en **el Work** (uno solo). Cuando una obra tiene edición Ivrea (ES) **y** VIZ (EN):
- La sinopsis es **una sola** → queda en inglés (lo que el usuario vio: "Source: VIZ Media"), aunque debería preferirse la ES de Ivrea.
- No hay lugar para "título ES" vs "título EN" vs "título JP" vs "romaji" como campos distintos: solo `title` + `originalTitle`.

### D. Sobrescritura sin provenance (datos que se pierden)
Ningún campo registra **qué fuente lo puso**. Dos efectos:
- **`updateWorkAction` manda TODOS los campos** desde `AdminWorkEdit`. Un edit puntual (p. ej. arreglar la portada) reescribe `author` con lo que haya en el form. Evidencia: **serie/791 "300"** tiene `curated=["title","synopsis","coverImage","genres"]` pero `author=null` → al editar esos 4, el form mandó author vacío y **lo borró** (no quedó en `curated` porque estaba vacío). Frank Miller se perdió.
- **Backfill-if-empty** nunca restaura lo borrado: una vez que `author=null`, ningún job lo vuelve a poner (solo completa si está vacío… y lo pone vacío de nuevo si la fuente no lo trae).

### E. Conteo de tomos contaminado / próximo-tomo confundido
8 ediciones Ivrea tienen un "próximo tomo #N" futuro con `volumes >= N` (contradicción). Investigado: **NO son reediciones**, es el **conteo contaminado** (el de VIZ/JP filtrado al de Ivrea). Reclasificar como reedición habría tapado el bug y roto los "próximo tomo" correctos.

### F. Lógica duplicada / dispersa
- `decodeEntities` existe en `lib/providers/whakoom.ts` **y** en `lib/decodeEntities.ts` (creado después).
- Matching/normalización repartido entre `findOrCreateWork`, `resolveSeries`, `enrichWorks`, `importVizSeries`, scripts. Sin una única fuente de verdad testeada.

## 4. Qué necesitamos (el objetivo)

Por cada Work, datos **organizados, relacionados y verificables**:
1. **Nombres en 4 formas** como campos distintos: **ES, EN, JA (native), romaji**. Hoy hay `title` + `originalTitle` (insuficiente). Lo que falte se consigue de MD/AniList (dan todos los idiomas) usando autor/asistentes para desambiguar.
2. **Autor + asistentes** confiables (de MU/AniList, más que del scrape), en forma **canónica** (ya tenemos la tool de unificación).
3. **Identidad externa estable persistida**: `anilistId` ∥ `muId` ∥ `mdId`, para re-matchear **idempotente** y no depender del título.
4. **Datos por edición** donde corresponde: conteo de tomos, sinopsis por idioma, status, fechas — sin que una edición pise a otra.
5. **Provenance**: saber qué fuente puso cada campo (o, mínimo, respetar `curated` para lo manual y nunca wipear sin querer).

## 5. Rediseño propuesto (estructura + lógica)

### Schema
- **Work — títulos multi-idioma**: `titleEs`, `titleEn`, `titleNative` (ja), `titleRomaji`. `title` queda como el display elegido (preferencia ES > EN > romaji). Migrar `originalTitle` → `titleRomaji`.
- **Work — identidad externa**: `muId Int? @unique`, `mdId String? @unique` (anilistId ya existe). Se persisten al primer match y se reusan.
- **Work — autor**: `assistants String?` (o tabla `Credit` si queremos roles). Preferir fuente confiable.
- **PublisherEdition — sinopsis por edición**: `synopsis String?` opcional (ES de Ivrea/Whakoom, EN de VIZ). El Work elige cuál mostrar según el idioma preferido.
- (Provenance opcional, fase posterior): `Work.fieldSources Json?` o respetar `curated` estrictamente.

### Lógica
- **La identidad del Work NO es el título.** Es `anilistId ∥ muId ∥ mdId`. Pipeline:
  1. De la edición (Ivrea/Whakoom/VIZ) saco título + **romaji** + **author**.
  2. Resuelvo a MU/MD/AniList por romaji + author (desambigua homónimos). Persisto los ids.
  3. Con los ids, traigo los **4 nombres** + author + géneros y backfilleo lo que falte.
  4. `findOrCreateWork` agrupa por esos ids; el título es solo display.
- **`updateWorkAction` no wipea**: el form manda solo los campos **cambiados** (o el server ignora un campo que llega vacío si antes tenía valor y no fue tocado explícitamente).
- **Prioridad de fuente por campo**: synopsis ES (Ivrea/Whakoom) > EN (MU/MD); author (AniList/MU) > scrape; tomos = por edición (Ivrea=AR, VIZ=estándar), nunca cruzados.
- **Centralizar** decodeEntities, normalización y matching en módulos únicos testeados.

## 6. Plan por fases (ordenado por dependencia)

- **Fase 0 — Auditoría (saber qué tenemos):** script que por cada Work reporte qué nombres/ids/author le faltan y de qué fuente saldrían. Sin esto no sabemos el tamaño real del problema.
- **Fase 1 — Schema:** migración con títulos por idioma + `muId`/`mdId` + `assistants` + `PublisherEdition.synopsis`.
- **Fase 2 — Backfill robusto e idempotente:** resolver cada Work a MU/MD/AniList por romaji+author, persistir ids, traer los 4 nombres + author confiable. Con provenance/`curated`.
- **Fase 3 — Guardas:** arreglar `updateWorkAction` (no wipear), centralizar lógica, prioridad de fuentes por campo.
- **Fase 4 — Reparar lo roto actual:** Rai Rai Rai (Ivrea=1 + VIZ=5 separadas), los 8 conteos contaminados, autores perdidos (300/Frank Miller).

> Principio: el matcheo se ancla en **identidad externa estable + autor**, no en el título. El título pasa a ser un atributo de display multi-idioma, no la llave.

## 7. Track de cómics occidentales (futuro — GCD)

MangaUpdates/MangaDex son bases de **manga**: NO cubren los cómics occidentales
(DC/Marvel/Image) que vende Ovni/Panini. Ese es el grueso de las obras sin
matchear (Ovni 619/620 sin romaji) y de los autores perdidos (~91 de Ovni). La
fuente correcta para ese track es **GCD — Grand Comics Database (comics.org)**.

Evaluación (jun 2026, decisión: usarlo cuando sumemos cómics internacionales a escala):
- **Qué da**: series y números con **creadores** (guionista/dibujante/entintador) — el dato de autor que falta. Es la base canónica de cómics.
- **Licencia**: CC BY-SA 4.0 (atribución + share-alike). Mostrar creadores/títulos con atribución a GCD es manejable.
- **Acceso**: **dump completo de la base** cada 2 semanas (+ import JSON/YAML). **Sin API oficial estable** (recomiendan importar el dump); hay un GraphQL comunitario no oficial (`adamhathcock/gcdb-graphql`). **Bloquea fetch de datacenter (403)** como Whakoom → dump local o GraphQL, no scraping en vivo desde Vercel.
- **Límite**: **NO indexa editoriales chicas argentinas** (Ovni Press no aparece). Su fuerte son las series **originales**. → no se matchea "Batman: Año Uno (Ovni)" contra una edición Ovni en GCD; hay que matchear la edición española → **serie original en inglés** ("Batman: Year One") por título traducido + ISBN.
- **Cómo encaja**: como **tercera identidad externa `gcdId`** (junto a anilistId/muId/mdId) — el análogo de MU/MD para el track de cómics. La arquitectura ya lo soporta.

**Plan futuro (no ahora):** bajar el dump de GCD (o GraphQL), matchear los cómics
del catálogo por título original + ISBN, traer creadores → autor, persistir
`gcdId`. Mientras tanto, los autores de cómics que falten se cargan a mano con la
tool "Series sin autor" (son obras conocidas, es más rápido que el pipeline).

Fuentes: comics.org · docs.comics.org/wiki/Data_Distribution · docs.comics.org/wiki/Data_Users · github.com/adamhathcock/gcdb-graphql
