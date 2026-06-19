ava# Taxonomía de géneros — análisis (no implementado)

Análisis de cómo normalizar los géneros. **No aplicado** — es plan/diseño.

## Estado actual (datos de prod, 2026-06-18)
- **698 obras con género, 75 géneros distintos**, crudos de MangaUpdates/MangaDex.
- Problemas concretos que muestran los datos:
  1. **En inglés**, no en español (la app es es-AR). "Drama/Action/Comedy/Supernatural…".
  2. **Fragmentación por casing/duplicado**: `Sci-fi` (140) **y** `Sci-Fi` (40) son el mismo género contados aparte. Igual `Boys' Love`/`Shounen Ai`/`Yaoi` (BL en 3 nombres), `Girls' Love`/`Yuri`/`Shoujo Ai` (GL en 3).
  3. **Demografía mezclada con género**: `Shounen` (266), `Seinen` (189), `Shoujo` (60), `Josei` (14) NO son géneros — son público objetivo. Hoy compiten en la misma lista.
  4. **Long tail granular**: decenas de tags chicos (`Vampires` 17, `Ghosts` 24, `Zombies` 10, `Aliens` 26, `Demons` 41, `Monster Girls` 12…) que son sub-sabores de Sobrenatural/Terror; `Wuxia` 2, `Ninja` 7, `Samurai` 9 → Artes marciales.
  5. **Sin lista cerrada**: entra lo que devuelvan MU/MD; imposible de curar o traducir consistentemente.

Conclusión: el problema no es solo "muchos con 0"; es que la fuente es cruda, en inglés, con duplicados y mezclando ejes. Una **lista canónica cerrada en español + una capa de mapeo** resuelve los 5.

## Propuesta: 2 ejes + taxonomía canónica

### Eje 1 — Demografía (faceta aparte, NO género)
Shonen · Shojo · Seinen · Josei · Kodomo. Es ortogonal al género (una obra es "Seinen + Terror"). En UI va como filtro separado (chips únicos o select), no mezclado con géneros.

### Eje 2 — Géneros (lista cerrada ~40, agrupados por categoría)
La lista que propusiste es muy buena base. Agrupada (categoría → géneros), 2 niveles para dar **amplitud y granularidad** a la vez:
- **Romance**: Romance · Harem · Reverse Harem · Boys Love · Girls Love
- **Acción/Fantasía**: Acción · Aventura · Fantasía · Fantasía oscura · Isekai · Superpoderes · Artes marciales · Magical Girl
- **Ciencia ficción**: Ciencia ficción · Cyberpunk · Mecha · Space Opera · Postapocalíptico
- **Terror/Suspenso**: Terror · Gore · Thriller · Suspenso · Misterio · Psicológico
- **Vida cotidiana**: Slice of Life · Escolar · Comedia · Drama · Coming of Age
- **Adultos**: Ecchi · Erotismo · Adulto
- **Especializados**: Histórico · Militar · Deportivo · Crimen · Noir · Sobrenatural · Antología · Guía · Artbook · Referencia

(≈40 géneros + 5 demografías.)

## Generalización vs granularidad — la clave
La regla: **mapear el long tail HACIA ARRIBA** a un género canónico (matches más grandes) pero conservar ~40 para que el usuario filtre específico.
Ejemplos de mapeo crudo→canónico (sube el conteo):
- `Sci-fi` + `Sci-Fi` → **Ciencia ficción** (180).
- `Yaoi` + `Shounen Ai` + `Boys' Love` → **Boys Love** (~55).
- `Yuri` + `Shoujo Ai` + `Girls' Love` → **Girls Love** (~21).
- `Vampires` + `Ghosts` + `Zombies` + `Demons` + `Monsters` + `Monster Girls` + `Aliens` → **Sobrenatural** (la mayoría) / algunos a **Terror**.
- `Martial Arts` + `Wuxia` + `Ninja` + `Samurai` → **Artes marciales**.
- `Reincarnation` + `Time Travel` (+ portal) → tienden a **Isekai** o **Fantasía** según caso.
- `Mature`/`Smut`/`Adult` → **Adulto**/**Erotismo**; `Loli`/`Shota`/`Incest` ya bloqueados por el guard R18 (no entran).
- `Magic`/`Demons` legítimos → **Fantasía**; `Police`/`Mafia` → **Crimen**; `Delinquents` → **Escolar**/**Acción** según.

Resultado esperado: de 75 buckets ruidosos a ~40 con conteos sanos, sin tags de 2-3.

## UI / UX
- **Filtros agrupados por categoría**: en mobile, un bottom-sheet "Filtros" con secciones colapsables (categoría → chips de género); en desktop, columnas. Multi-select con el modo **todos/cualquiera** que ya existe (`gmode`).
- **Demografía como faceta propia** (arriba, chips únicos), separada de géneros.
- **Mostrar el conteo** por género (ej. "Romance · 283") y **ocultar los que tienen 0**. Nada de chips vacíos.
- **"Populares" primero**: los 8-10 géneros con más obras visibles de una; el resto detrás de "Ver todos".
- **Deep-links** ya andan (`?genres=`, `?gmode=`); mapear los slugs canónicos.
- Cobertura: ~57% de obras sin género (match MU/MD) — el filtro debe dejar claro que filtra sobre lo clasificado, y conviene un orden por relevancia para que el vacío no parezca "no hay nada".

## Implementación (cuando se aplique)
1. `lib/genres.ts`: `CATEGORIES`, `GENRES` (canónico + categoría), `DEMOGRAPHICS`, y `mapRawGenre(raw) → canónico | null` + `mapRawDemographic(raw)`. Lista cerrada.
2. **Guardar el crudo aparte** (ej. `Work.rawGenres`) y el **canónico** en `Work.genres` → permite re-mapear sin re-enriquecer. (Hoy `enrichedAt`/`originalTitle` ya separan; sumar `rawGenres`.)
3. `enrichWorks`: aplicar el map al escribir.
4. **Normalización one-time**: script que re-mapea los `Work.genres` existentes por la tabla; loguear los crudos **sin mapear** para refinar el map (iterativo).
5. Editor admin de Work: selector contra la lista cerrada (no texto libre) → consistencia.
6. UI de filtros (catálogo) agrupada + demografía.

## Riesgos / decisiones abiertas
- Pérdida de matiz al generalizar (ej. "Cyberpunk" vs "Ciencia ficción"): la lista canónica conserva los matices que importan; el resto sube.
- Demografía: separar requiere un campo nuevo o derivarla de los tags crudos (`Shounen`→demografía, no género).
- "Sobrenatural" es un cajón grande; vigilar que no se vuelva genérico de más.
- Mapeo crudo→canónico es iterativo: arranca con cobertura ~80% y se refina con el log de no-mapeados.
