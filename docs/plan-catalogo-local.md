# Plan: catálogo propio (dejar de depender de AniList en runtime)

> Estado: **propuesta** (no implementado). Documento de diseño para discutir y
> ejecutar por fases. Nada de esto toca prod hasta acordarlo.

## Objetivo y principio

**En runtime, la app depende solo de nuestra propia base de datos.** AniList,
Whakoom y los catálogos de las editoriales son **fuentes de siembra y de
actualización** (procesos offline: cron semanal / imports / entradas manuales),
nunca dependencias en la ruta de un request.

Motivo: AniList es una base de **obras globales**, no de **ediciones**. Forzar el
match obra-global → edición-AR **por título** es la raíz de los problemas que
venimos sufriendo: homónimos, ids duplicados (Bakemonogatari 44893 vs 101311),
ediciones deluxe que no existen en AniList, y cero ISBN. La identidad del dominio
no debería colgar de AniList.

## Jerarquía de fuentes

| Fuente | Rol | Cuándo |
| --- | --- | --- |
| Catálogo oficial de cada editorial (Ivrea, Panini, Ovni…) | **Verdad** para qué ediciones/tomos existen | Crawl semanal |
| Whakoom | **Siembra rápida** + relleno de huecos (ISBN, portadas, qué ediciones existen, relaciones ya debugueadas) | Seed inicial + gap-fill periódico |
| Usuarios / admin | Correcciones y ediciones que no trae ningún crawl | Continuo (herramientas ya construidas) |
| AniList | **Enriquecimiento opcional** (portada, géneros, score, sinopsis) — snapshot guardado localmente | Seed / job offline, nunca en request |

Whakoom es un agregador comunitario, así que para datos sensibles (qué tomos
salieron) la verdad es el catálogo de la editorial; Whakoom siembra y rellena.

## Modelo destino (boceto)

La pieza central es **`Work`**: nuestra identidad canónica de obra. Guarda los
datos de display *snapshoteados* para no llamar a nadie en runtime.

```prisma
model Work {
  id         Int      @id @default(autoincrement())
  // Datos de display (snapshot; se actualizan por job, no en request)
  title       String  // título principal que mostramos (español si lo hay)
  normTitle   String  // normalizado para búsqueda/orden alfabético
  altTitles   String[] // otros títulos (romaji, inglés, japonés…) para matching/búsqueda
  coverImage  String?
  synopsis    String?
  authors     String[] // autores (nombres); índice de mangaka deriva de acá
  genres      String[]
  status      String?  // RELEASING | FINISHED | …
  totalVolumes Int?    // referencia (obra completa)
  // Referencias externas: para dedup/enriquecimiento, NO como llave del dominio
  anilistId   Int?     @unique
  whakoomId   String?  @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  editions Edition[]
  @@index([normTitle])
}

model Edition {
  id        Int     @id @default(autoincrement())
  workId    Int
  work      Work    @relation(fields: [workId], references: [id], onDelete: Cascade)

  publisher String  // "Ivrea Argentina" | "Panini Argentina" | "Ovni Press" | "Japonesa" | …
  title     String  // "BLAME! Master Edition"
  region    String  @default("AR") // AR | JP | INT
  volumes   Int
  status    String?
  url       String?
  // ISBN como llave fuerte (ver fase 1). Para matching y dedup confiable.
  isbn      String? // ISBN del tomo 1 / representativo de la edición
  source    String  @default("manual") // crawl:ivrea | whakoom | manual | user
  notifiedVolumes Int @default(0)
  updatedAt DateTime @updatedAt

  volumesList Volume[] // opcional (fase posterior), per-tomo + ISBN
  @@index([workId])
  @@index([isbn])
}

// Opcional, fase posterior: tomo individual con su ISBN (Whakoom los tiene).
model Volume {
  id        Int    @id @default(autoincrement())
  editionId Int
  edition   Edition @relation(fields: [editionId], references: [id], onDelete: Cascade)
  number    Int
  isbn      String?
  coverImage String?
  @@unique([editionId, number])
}
```

`Edition` reemplaza conceptualmente a `PublisherEdition` (ahora colgado de
`workId` en vez de `anilistId`). `EditionExclusion` / `CrumbMapping` /
`EditionsCache` pasan a referenciar `workId` (o desaparecen: con catálogo local
ya no hay "resolución en vivo" que cachear).

## Qué está keyeado en `anilistId` hoy (lo que hay que migrar)

`Manga`, `TrackedEdition.key`, `EditionsCache`, `PublisherEdition`,
`EditionExclusion`, `CrumbMapping`, `UserNote`, `WishlistItem`, `PurchaseItem`,
`Notification`, `Activity`, `Report`, y la ruta `/manga/[id]` + `/autor/[id]`.
Re-keyear todo esto a `workId` es **la parte cara y riesgosa**, no el scraping.

## Fases

### Fase 1 — ISBN como llave de primer nivel (independiente, hacer ya)
- Agregar `isbn` a `PublisherEdition` (y poblarlo desde el import de Whakoom, que
  ya trae ISBN).
- Usar ISBN como criterio de match/dedup donde esté disponible (antes que título).
- **Ganancia inmediata** bajo el modelo actual: arregla homónimos/duplicados/
  deluxe sin tocar identidad. **Bajo riesgo.** No bloquea las fases siguientes.

### Fase 2 — Crear `Work` y poblarlo (sin re-keyear usuarios todavía)
- Migración: crear `Work`. Backfill: una `Work` por cada `anilistId` distinto que
  hoy aparezca en `PublisherEdition` + colecciones. Snapshot de portada/títulos/
  autores desde lo que ya tenemos cacheado (y un job offline que completa con
  AniList una sola vez).
- `Work.anilistId` queda como referencia única.
- `PublisherEdition.workId` backfilleado por su `anilistId`.

### Fase 3 — Mover el read-path a la DB local
- `/manga/[id]` (detalle), búsqueda, browse, A-Z, trending y `/autor/[id]` leen de
  `Work`/`Edition` locales, **no de AniList**.
- Se elimina `resolveEditions`/`EditionsCache`/`EditionExclusion` (ya no hay
  matching en vivo: las ediciones cuelgan del work).
- Búsqueda: full-text local sobre `Work.normTitle` + `altTitles`. El catálogo será
  más chico que el global de AniList (solo lo publicado en AR + lo que sembramos)
  — coherente para un tracker de colecciones argentinas. Si querés descubrir algo
  que no salió acá, queda un camino opcional "buscar en AniList para sembrar".

### Fase 4 — Seed masivo desde Whakoom + crawls
- Import masivo de Whakoom → `Work` + `Edition` (+ `Volume`/ISBN si activamos).
- Crawls semanales por editorial (Ivrea/Panini/Ovni) que actualizan `Edition` y
  disparan "tomo nuevo" (ya tenemos la infra de `notifiedVolumes`).
- Entradas manuales (admin + reporte de usuarios) para huecos.

### Fase 5 — Re-keyear datos de usuario a `workId` (la cara)
- `Manga`, `TrackedEdition`, `UserNote`, `WishlistItem`, `PurchaseItem`,
  `Notification`, `Activity`, `Report` → de `anilistId` a `workId`.
- Backfill por `anilistId` (todas las series en colecciones ya tienen `Work` de la
  fase 2).
- `/manga/[anilistId]` redirige a `/serie/[workId]` para no romper links/bookmarks.
- **Rollback:** mantener la columna `anilistId` vieja un tiempo (no dropear) para
  poder revertir el read-path si algo sale mal.

### Fase 6 — AniList fuera del request path
- Las llamadas a AniList quedan solo en jobs offline de enriquecimiento (opcional)
  y en el camino "sembrar nueva serie". Cero AniList en runtime.

## Decisiones abiertas (necesito tu input)

1. **Alcance de búsqueda/descubrimiento:** ¿el universo es "solo lo publicado en
   AR + lo sembrado", o querés mantener un "buscar en AniList para agregar" para
   series que todavía no salieron acá? (Define cuánto seed inicial hace falta.)
2. **Per-tomo (`Volume`) con ISBN ahora o después?** Whakoom los tiene; suma
   precisión (portada por tomo, tracking fino) pero es más modelo y más import.
3. **Whakoom seed: ¿bulk de entrada o incremental?** ¿Importamos todo el catálogo
   AR de Whakoom de una, o vamos serie por serie a demanda?
4. **`/autor/[id]`:** ¿autor por nombre local, o mantenemos ids de staff de AniList
   como referencia del autor?

## Recomendación de arranque

Hacer **Fase 1 (ISBN) ya** —vale la pena con el modelo actual y no compromete
nada— y en paralelo cerrar las decisiones abiertas para encarar Fase 2–3. La
Fase 5 (re-key) se planifica aparte y con cuidado: es la única irreversible-ish.
