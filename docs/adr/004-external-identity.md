# ADR-004: Capa de Identidad Externa

- **Estado**: Propuesto → **EN PAUSA** (2026-06-29). El spike de granularidad
  ([../spikes/gcd-identity-spike.md](../spikes/gcd-identity-spike.md)) **refutó GCD
  como ancla**: es edition-centric (no colapsa nuestras ediciones duplicadas) y débil
  para indie AR. No se construye la capa sobre GCD ahora. El concepto sigue válido
  para cuando aparezca un proveedor con identidad a nivel obra.
- **Fecha**: 2026-06-29
- **Relacionado**: memoria `data-architecture-redesign` (identidad por id externo),
  ADR-002 (Mutation Framework → auto-merge), `gcd-comics-source`.

## Contexto

La misión del catálogo es **único, limpio y sin duplicados** de lo publicado en AR.
El activo central es `Work → Edition → Volumes`; géneros/sinopsis/portadas son
**enriquecimiento**. El problema difícil no es la metadata: es la **identidad** —
*"¿esta obra es la misma que aquella?"* (la pregunta que respondimos a mano en el
dedup de duplicados nacional/internacional).

Hoy la identidad externa vive como **columnas sueltas y ad-hoc** en `Work`:
`anilistId`, `muId`, `mdId`. Funciona para manga porque AniList/MU/MD modelan bien
"una serie". Para **cómics** no: una obra puede existir como serie, issue, TPB,
hardcover, deluxe, absolute, arco, y edición traducida (Ovni/España). GCD
(comics.org) modela **distintos niveles bibliográficos** con entidades distintas.

Queremos integrar GCD. Pero el valor de GCD **no es** género/sinopsis (decorativos,
incrementales) — es **identidad estable cross-market**: anclar nuestro `Work` a "la
misma obra en el resto del mundo", lo que **automatiza la deduplicación** y habilita
enriquecer incremental sin volver a resolver "¿qué obra es esta?".

## Decisión (conceptual — NO schema todavía)

Introducir una **Capa de Identidad Externa** como **concepto de dominio**: un `Work`
tiene cero o más identidades externas, cada una = *(proveedor, referencia externa,
decisión de match + procedencia)*. Los **proveedores** (AniList, MU, MD, GCD, …
futuros: Comic Vine, ISBN) son **adapters de infraestructura** sobre ese concepto —
el dominio no conoce "GCD", conoce "una identidad externa" (paralelo a los puertos
del Mutation Framework).

**Identidad ≠ metadata.** Identidad = *qué obra es, en el mundo*. Metadata =
decoración (género, sinopsis, portada). La metadata se **deriva** de la identidad,
aguas abajo, y se puede sumar cuando se quiera sin tocar la identidad.

### La pregunta CENTRAL, deliberadamente sin responder acá

> **¿A qué nivel bibliográfico ancla un `Work`?** (serie · issue · TPB · hardcover ·
> arco). Y en consecuencia: **¿la cardinalidad es `Work → 1 identidad` o `Work → N`?**
> (el caso "1 edición recopilatoria de Ovni = 3 issues de GCD").

Esto **cambia el modelo entero** y **no se decide por diseño** — se decide **midiendo
GCD real** (spike). Fijar el schema antes es diseñar elegante sobre una suposición.
El ADR queda abierto también a: **"GCD podría no ser el ancla correcta"** (si p. ej.
la mayoría son TPBs mal cubiertos, el ancla podría ser ISBN u otro nivel).

### Principios que el modelo eventual DEBE respetar (no son columnas)

1. **Confianza = DECISIÓN, no un float opaco.** Un match es `CONFIRMED / HIGH /
   MEDIUM / LOW / REJECTED`, separado del **score técnico** crudo que lo produjo (si
   se guarda). Nadie, en un año, sabe qué significa `0.73`.
2. **Procedencia del match:** con qué **estrategia** y **versión** del matcher se
   generó (hoy `título+editorial+año`; mañana `+autor +isbn +fuzzy +embeddings`). Al
   revisar un match viejo hay que saber cómo se hizo.
3. **El tipo de entidad puede importar** (GCD tiene niveles): el modelo probablemente
   necesite distinguir a qué *clase* de entidad apunta el `externalId`. **A confirmar
   con el spike.**
4. **Proveedor-agnóstico + extensible:** sumar un proveedor nuevo no cambia el
   dominio, solo agrega un adapter.
5. **Los ids actuales migran acá:** `anilistId`/`muId`/`mdId` son las primeras
   instancias (proveedor correspondiente, `CONFIRMED`, estrategia "manual/id").

### Cómo la identidad automatiza el dedup (el pago real)

Identidad con confianza cierra el loop con ADR-002: `gcdId` (o cualquier id)
**compartido** entre dos `Work` con `CONFIRMED` → **auto-merge** vía la mutación
`mergeWork`; `MEDIUM/LOW` → **cola de revisión** (lo que hicimos a mano con
`inspect-dups`/`fix-dups`, ahora automatizable). La identidad no es un dato: es lo
que **elimina el trabajo manual de dedup**.

## Consecuencias

**Buenas:**
- Deduplicación **automatizable** (no más "¿este Batman es el mismo Batman?").
- Enriquecimiento (género/sinopsis/créditos) desacoplado de la identidad: se suma
  incremental sin re-resolver la obra.
- Proveedores extensibles (GCD → Comic Vine → ISBN → …) sin tocar el dominio.
- Converge con la separación dominio/infra (ADR-002) y el rediseño de datos ya
  planeado (`data-architecture-redesign`).

**Malas / costos:**
- **Gate de spike** antes del schema: no se avanza a Prisma hasta resolver la
  granularidad. (Es el punto — evita construir sobre una suposición falsa.)
- Migrar los 3 ids actuales a la capa nueva (trabajo + cuidado con lo curado).
- El matching de cómics AR↔GCD es **difícil** (granularidad, homónimos, año).

## Alternativas consideradas

- **`gcdId` como otra columna en `Work`** — descartado: repite el patrón ad-hoc, no
  maneja cardinalidad `N`, sin procedencia ni confianza; no escala a más proveedores.
- **GCD como proveedor de metadata (género/sinopsis)** — descartado: pierde el valor
  real (la identidad); la metadata es incremental y secundaria.
- **Diseñar el schema completo ahora** — descartado: prematuro antes del spike de
  granularidad; alto riesgo de modelar mal la cardinalidad.

## Próximo paso (no es este ADR)

**Spike de ~40 cómics** (Ovni/Panini, DC/Marvel) para medir, por cada uno:
**nivel de identidad correcto** (serie/issue/TPB/arco), **% identidad única**, **%
automático / ambiguo / sin match**, y la **cardinalidad real**. Requiere decidir el
acceso a datos (dump de GCD vs muestra liviana). Con eso se diseña el modelo — recién
ahí, columnas de Prisma.
