# Funko Pops en Nakama — análisis y MVP

Decisión (2026-06-18): el modelo actual **sí** soporta Funko Pops con el encuadre
de **waves**, reusando la maquinaria de completitud. Es expansión post-lanzamiento,
no ahora. Este doc fija el mapeo, los gaps técnicos y el alcance del MVP.

---

## El mapeo: Wave = edición, Funko = tomo

| Manga | Funko | Por qué calza |
|---|---|---|
| `Work` (serie) | **Línea/franquicia** (ej. "Naruto Pop!") | agrupa toda la IP |
| `PublisherEdition` (edición) | **Wave** (label "Naruto · Wave 5", `publisher` = "Funko") | conjunto acotado que se completa |
| `Volume` (tomo) | **Figura** (cada Pop) | unidad que tenés / te falta |
| `OwnedVolume` | Pop que poseés | idéntico |

"Completar una wave" = `owned 4/6` es exactamente como piensa un coleccionista, así
que reusa **sin tocar** la lógica de completitud, "para comprar", deseados, compras,
compartir y browse. Reuso estimado: **~65-70%** del sistema.

## Qué reusa casi gratis
- Completitud (owned X/total, barra, estado al-día/incompleta).
- "Para comprar" = figuras que faltan de la wave (`lib/shopping.ts` calza tal cual).
- Deseados, compras (precio/tienda/valor), colección pública compartible, browse/búsqueda, PWA.

## Gaps técnicos a resolver (chicos pero reales)
1. **Identidad por figura.** Un tomo es casi solo un número; una figura tiene
   **nombre (personaje) + foto propia + número de Pop**. `Volume` ya tiene
   `coverImage` pero **falta `name`/`label`** → columna nueva.
2. **Numeración.** `faltantes` calcula `1..total`. Las figuras tienen números de
   Pop globales (no 1..N). Usar la **posición dentro de la wave (1..N)** como
   `OwnedVolume.volume` y guardar el número de Pop real aparte.
3. **UI type-aware.** Discriminador **`Work.type` (MANGA | FUNKO)** + condicionales
   en los ~39 archivos que tocan volumen/lectura (mayoría es mostrar/ocultar):
   esconder lectura/`readingStatus`, cambiar idioma ("tomos"→"figuras").
4. **Fuente de datos** (el costo real): no hay scraper de waves/figuras. Para el MVP
   alcanza con crawlear la **página oficial de Funko** (no necesita ser completa).

## Funciones LIMITADAS para Funko (decisión del usuario)
- ❌ NO marcar "nacional" (no aplica).
- ❌ NO notificaciones.
- ✅ Catálogo propio crawleado (Funko oficial, parcial está OK).
- ✅ Buscar en nuestra base, ver foto + nombre + wave, **trackear** (agregar a colección).
- ✅ **Compartir** la colección con amigos.
- ➕ Plus (no bloqueante): usar el sistema de **Compras** para trackear costo y que se
  agreguen a la colección desde ahí.
- **Mínimo viable de Funko**: agregar a colección + compartir = suficiente.

## Cambios técnicos del MVP de Funko (cuando se encare)
1. Migración: `Work.type` (default MANGA) + `Volume.name String?`.
2. Crawler `scripts/crawl.ts funko` (o módulo aparte) que pueble Work(type=FUNKO) +
   PublisherEdition(publisher="Funko", label=wave) + Volume(name, coverImage, posición).
3. UI condicional por `type`: ocultar lectura, renombrar "tomos"→"figuras",
   ocultar chip nacional, sacar de notificaciones.
4. Búsqueda/colección/compartir: ya funcionan; verificar que el type FUNKO no rompa
   filtros de género ni preventa.
5. (Plus) Compras: ya es genérico; permitir linkear ítems de compra a figuras.

## Marca
"Nakama" es marca manga. Sumar Funkos es una decisión consciente de volverse
"tracker de colecciones". Definir antes de comunicarlo.

---

## Roadmap a MVP de Nakama (orden, 2026-06-18)

1. **Apagar AniList en prod** (cutover): setear `ANILIST_OFF=1` en Vercel Production +
   redeploy. El código y la data ya están; falta enriquecer géneros (en curso) y el flag.
2. **Asegurar que todo funciona con Ivrea, sin bugs** (la fuente nacional confiable).
   Pasar [smoke-tests.md](smoke-tests.md) + [regression-tests.md](regression-tests.md).
3. **Agregar 1 editorial extranjera sin fallas** (ver [plan-internacional.md](plan-internacional.md)).
4. **Agregar Funko Pops** con el alcance limitado de arriba.

Con esos 4, el usuario considera la app un MVP.

**Post-MVP**: resto de editoriales nacionales → resto de extranjeras.
