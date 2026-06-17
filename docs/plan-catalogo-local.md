# Plan: catálogo propio (dejar de depender de AniList en runtime)

> Estado: **decisiones tomadas, sin implementar**. Documento de diseño / spec
> viva. Se ejecuta por fases; nada toca prod hasta acordar cada fase.

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
  genres      String[]
  status      String?  // RELEASING | FINISHED | …
  totalVolumes Int?    // referencia (obra completa)
  // Referencias externas: para dedup/enriquecimiento, NO como llave del dominio
  anilistId   Int?     @unique
  whakoomId   String?  @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  editions Edition[]
  authors  WorkAuthor[]
  @@index([normTitle])
}

// Autor local (reemplaza la tabla Mangaka). El índice alfabético sale de acá.
model Author {
  id            Int      @id @default(autoincrement())
  name          String
  normName      String
  anilistStaffId Int?    @unique // referencia opcional: redirige /autor/[staffId] viejos
  works         WorkAuthor[]
  @@index([normName])
}

model WorkAuthor {
  workId   Int
  authorId Int
  role     String? // autor | guion | dibujo | …
  work     Work   @relation(fields: [workId], references: [id], onDelete: Cascade)
  author   Author @relation(fields: [authorId], references: [id], onDelete: Cascade)
  @@id([workId, authorId])
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
  source    String  @default("manual") // crawl:ivrea | whakoom | manual | user
  notifiedVolumes Int @default(0)
  updatedAt DateTime @updatedAt

  volumesList Volume[] // per-tomo + ISBN (incluido desde el arranque, decisión 2)
  @@index([workId])
}

// Tomo individual con su ISBN (Whakoom los tiene). El ISBN por tomo es la llave
// fuerte para matching/dedup (mejor que el título). Incluido desde fase 1.
model Volume {
  id        Int    @id @default(autoincrement())
  editionId Int
  edition   Edition @relation(fields: [editionId], references: [id], onDelete: Cascade)
  number    Int
  isbn      String?
  coverImage String?
  @@unique([editionId, number])
  @@index([isbn])
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

### Fase 1 — ISBN + tomo individual como llave de primer nivel (hacer ya)
- Agregar tomos individuales con `isbn` (modelo `Volume`, decisión 2 = ahora) y
  poblarlos desde el import de Whakoom, que ya trae ISBN por tomo.
- Usar ISBN como criterio de match/dedup donde esté disponible (antes que título).
- **Ganancia inmediata** bajo el modelo actual: arregla homónimos/duplicados/
  deluxe sin tocar identidad. **Bajo riesgo.** No bloquea las fases siguientes.
- (Sobre el modelo actual `PublisherEdition`, se le agrega la relación a `Volume`;
  al migrar a `Edition` en fase 2 los tomos se reapuntan por `editionId`.)

### Fase 2 — Crear `Work` y poblarlo (sin re-keyear usuarios todavía)
- Migración: crear `Work`. Backfill: una `Work` por cada `anilistId` distinto que
  hoy aparezca en `PublisherEdition` + colecciones. Snapshot de portada/títulos/
  autores desde lo que ya tenemos cacheado (y un job offline que completa con
  AniList una sola vez).
- `Work.anilistId` queda como referencia única.
- `PublisherEdition.workId` backfilleado por su `anilistId`.

### Fase 3 — Mover el read-path a la DB local
- `/manga/[id]` (detalle), búsqueda, browse, A-Z y trending leen de `Work`/
  `Edition` locales, **no de AniList**.
- `/autor/[id]` pasa a `Author` local (decisión 4); `Mangaka` se reemplaza por
  `Author`. Se conserva `anilistStaffId` para redirigir los links viejos.
- Se elimina `resolveEditions`/`EditionsCache`/`EditionExclusion` (ya no hay
  matching en vivo: las ediciones cuelgan del work).
- Búsqueda: full-text local sobre `Work.normTitle` + `altTitles`. El universo es
  "AR-publicado + sembrado + agregado a mano" (decisión 1) — coherente para un
  tracker de colecciones argentinas.
- **"Agregar serie" on-demand** (decisión 1): camino para snapshotear desde
  Whakoom (o AniList) a un `Work` local cuando alguien quiere trackear algo que
  todavía no está. Una vez agregado vive en la DB → runtime sigue solo-local.

### Fase 4 — Seed masivo (bulk controlado) + crawls
Decisión 3 = **bulk, pero throttled y resumable** (no martillar). Orden:
- **Seed primario desde los catálogos de editoriales** (Ivrea/Panini/Ovni), que
  *es* la definición del universo "AR-publicado". Ya los crawleamos.
- **Pasada de enriquecimiento con Whakoom**: ISBN + portadas por tomo (`Volume`),
  y obras que el crawl listó mal o le faltan.
- Implementado como **job batch con cursor en `AppState`** (mismo patrón que el
  scan de mangakas): corta/retoma, ritmo educado, sin reventar a Whakoom.
- Mantenimiento posterior: **crawls semanales** (actualizan `Edition`/`Volume` y
  disparan "tomo nuevo" vía `notifiedVolumes`) + agregar on-demand + correcciones
  de usuarios/admin.

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

## Decisiones tomadas

1. **Alcance del catálogo:** universo = obras AR-publicadas + sembradas +
   agregadas a mano. Se mantiene **"agregar serie" on-demand** (snapshot desde
   Whakoom/AniList a un `Work` local) para lo que todavía no está; una vez
   agregado vive en la DB y runtime sigue solo-local.
2. **Tomo individual con ISBN:** **sí, desde el arranque** (modelo `Volume`).
3. **Seed:** **bulk controlado** — primario desde catálogos de editoriales (=
   universo AR), pasada de enriquecimiento con Whakoom, todo como job batch
   throttled/resumable con cursor en `AppState`. Mantenimiento por crawl semanal.
4. **Autores:** **entidad `Author` local** (reemplaza `Mangaka`), con
   `anilistStaffId` opcional para redirigir links viejos.

## Recomendación de arranque

Empezar por **Fase 1 (tomos + ISBN)** —vale con el modelo actual y no compromete
nada— y seguir con Fase 2–3. La Fase 5 (re-key de datos de usuario) se planifica
aparte y con cuidado: es la única irreversible-ish; se hace conservando la columna
`anilistId` vieja para poder revertir.

---

## Ejecución acordada (2026-06-17): rebuild limpio, AniList al final

Estamos **pre-launch sin datos de usuario que preservar** → en vez de migrar
(Fase 5), **wipeamos y reconstruimos limpio**. Más simple y sin la parte
irreversible. Se prueba TODO **sin AniList** primero (kill-switch), para forzar el
read-path local y ver al final cómo afecta AniList.

**Esquema:** reusar las tablas actuales (`Work`, `PublisherEdition`), con `Work`
como centro; dejar de usar `anilistId`; re-keyear colección/deseados/notis/notifs
a `workId`. Renombrar a `Edition`/`Author` queda para después (cosmético).

**Read-path local:** generalizar el patrón de `/nacional/[id]` (ya es 100% local,
sin AniList) a un `/serie/[workId]`; browse / A-Z / búsqueda sobre `Work`;
novedades / próximos tomos / próximas series / reediciones desde `IvreaRelease` +
ediciones, por `workId`.

**Orden (todo en `staging` primero; prod se resetea recién al final, validado):**
1. Kill-switch de AniList (flag) — la app no llama AniList en runtime.
2. **Wipe total** de la base (reset total: catálogo + cuentas + colecciones).
3. **Crawl limpio de Ivrea** → `Work`/ediciones locales (publicado, próximos,
   reediciones) por `workId`.
4. **Read-path local** (`/serie/[workId]`, browse, búsqueda) + colección por
   `workId`.
5. Validar novedades / próximos tomos / próximas series / reediciones / notis
   **solo con Ivrea**.
6. **Whakoom** para lo viejo despublicado de Ivrea → validar.
7. **Whakoom de a 1 editorial** (de la más chica a la más grande), validando
   novedades/próximos/etc. entre cada una.
8. **Recién al final: AniList** (enriquecimiento offline + match), viendo cómo
   afecta.
