# Spike de Modelo de Identidad (cómics)

> **No** es un spike para "evaluar GCD". Es para **validar el modelo de identidad de
> nuestro dominio** antes de escribir schema (ADR-004). GCD es el instrumento de
> medición. Este es el **último artefacto de diseño** antes de mirar cómics reales.

## Objetivo

Responder, con evidencia sobre una muestra chica, **a qué nivel bibliográfico ancla
un `Work` de cómic y con qué cardinalidad** — la pregunta central que ADR-004 dejó
abierta y que **cambia el schema**.

## Hipótesis a validar (si alguna es falsa, cambia el modelo)

- **H0 — GCD tiene una entidad usable como ancla:** existe en GCD una entidad que
  puede actuar como identidad canónica para la mayoría de los Works AR. **Se valida
  ANTES que todo:** puede pasar algo peor que N:M — que GCD modele el mundo distinto
  (p. ej. solo issues/series, nunca TPBs) y ni siquiera haya candidato correcto. Si
  H0 falla, la cardinalidad es irrelevante.
- **H1 — Identidad canónica clara (lado nuestro):** cada `Work` AR tiene UN nivel
  bibliográfico natural (serie / issue / TPB / arco) que lo representa.
- **H2 — Cardinalidad DOMINANTE (a descubrir, no asumir):** existe una cardinalidad
  predominante entre `Work` y la identidad externa; **el resultado dirá cuál** (1:1 /
  1:N / N:M). El spike descubre el modelo, no lo presupone.
- **H3 — Match automatizable:** con señales baratas (título original + editorial de
  origen + año) se resuelve la mayoría sin humano.
- **H4 — Confianza asignable:** se puede poner `CONFIRMED/HIGH/…` automático en la
  mayoría; el humano queda para la cola de ambiguos.

## Criterios de ÉXITO (el spike termina cuando podemos responder)

0. **H0**: GCD tiene una entidad-ancla usable (si no, se aborta acá).
1. **Nivel canónico** para ≥ **80%** de la muestra.
2. **Cardinalidad**: sabemos cuál domina (1:1 / 1:N / N:M) con el **% de cada una**.
3. **% que requiere revisión manual** (y es tolerable: objetivo < ~30%).
4. **Confianza automática**: podemos asignarla sin humano en la mayoría.
5. **Catálogo de casos que rompen el modelo**, con su **motivo** (los que fuerzan N:M
   o ambigüedad).

> **Por qué 80%** (y no 70/90): deja una cola manual tolerable para un catálogo
> mantenido por una sola persona. No es un umbral sagrado; es la línea donde el ahorro
> de trabajo justifica la integración.

## Criterios de FRACASO / abort (igual de importantes)

- **N:M domina** (> ~40% de los casos mapean a varias entidades) → el modelo 1:1 no
  sirve; hay que rediseñar (relación N:M) **o diferir GCD**.
- **Identidad ambigua** para > ~40% (no se puede nombrar el nivel) → GCD no es un ancla
  confiable para ediciones AR **ahora**.
- **Automatización baja** (la mayoría necesita humano) → el ROI no cierra; se difiere.

En cualquiera de esos casos: los cómics **siguen mostrándose** (Fase 1 ya lo hace, sin
identidad externa); el enrich/dedup de cómics queda manual/posterior. ADR-004 ya deja
esto explícitamente abierto.

## Selección de la muestra (máximo aprendizaje, NO cupo)

No son "10 fáciles + 10 difíciles" por cumplir un número: son los **~20 casos más
INFORMATIVOS**. Si hay 8 Absolute, 5 Omnibus, 4 Deluxe, con **2-3 de cada tipo**
alcanza para validar el patrón; mejor gastar un cupo en un **caso raro no previsto**
(ej. un crossover publicado en AR como tomo único). Cubrir a propósito los tipos que
rompen el modelo: recopilatorios · omnibus · deluxe/absolute · crossovers · one-shots
· miniseries · series largas · reediciones.

**Regla de saturación:** 20 es el punto de partida, no una cuota. Si antes de los 20
todas las hipótesis quedan claramente confirmadas/refutadas → se concluye. Si siguen
apareciendo patrones nuevos → se amplía hasta que dejen de aparecer casos relevantes.

**Al elegir la muestra** se presenta la lista CON el motivo de cada caso (por qué es
informativo) ANTES de analizar — para detectar a tiempo tipos de publicación olvidados.

## Campos a registrar por caso

| Campo | Para qué decisión |
|---|---|
| `workId`, título AR, editorial AR | referencia |
| **¿GCD tiene entidad-ancla?** (sí / no) | H0 (se chequea primero) |
| **Nivel del Work AR** (serie/issue/TPB/HC/absolute/arco/omnibus/otro) | qué es NUESTRO lado (H1) |
| **Entidad GCD elegida** (Series / Issue / Story / Book / TPB / Volume / none) | qué es el lado GCD |
| **↳ el gap entre ambos niveles** es lo que suele generar el N:M | cardinalidad (H2) |
| **¿Una entidad de GCD alcanza?** (sí / N entidades) | cardinalidad (H2) |
| **Señales disponibles**: ¿título original conocido? ¿editorial origen inferible? ¿año? ¿#issues? | ¿automatizable? (H3) |
| **¿Correspondencia inequívoca?** (sí / ambigua / no encontrada) | automatización + confianza (H4) |
| **Motivo de ambigüedad** (homónimo / recopilatorio / reedición / cambio de título / crossover / sin datos / no encontrado) | AGRUPAR: quizá el 80% de la ambigüedad es 1 causa |
| **Confianza estimada** (CONFIRMED/HIGH/MEDIUM/LOW/NONE) | calibra el enum del modelo |
| **¿Requiere humano?** (sí/no) | costo operativo |
| Notas | casos raros |

## Decisión según el resultado (por qué juntamos cada dato)

| Resultado | Decisión |
|---|---|
| **H0 falla** (GCD no tiene entidad-ancla usable) | **Diferir GCD**; no es la fuente de identidad para AR ahora. Se aborta antes de la cardinalidad. |
| **1:1 domina**, nivel claro ≥80% | Diseñar `ExternalIdentity` **1:1**, integrar GCD (dump + matcher). |
| **N:M minoritario** (< ~15%) y concentrado (ej. recopilatorios) | **Mantener 1:1** como modelo principal; los casos especiales, a mano o extensión futura. **NO se rediseña el dominio por una minoría.** |
| **N:M frecuente** | **RE-EVALUAR ROI antes de modelar N:M**: ¿vale que TODO el dominio pague esa complejidad por esos casos? Recién si la respuesta es sí → relación N:M. (No es salto automático.) |
| Automatización baja pero identidad clara | Pipeline con **cola de revisión** fuerte; reevaluar si vale la pena ahora. |
| Ambiguo / roto | **Diferir GCD**; cómics visibles sin identidad externa; enrich manual. |

## Entregable del spike (NO una planilla)

El spike no termina en una tabla de observaciones, sino en una **recomendación de
arquitectura documentada**:

1. **Estado de cada hipótesis** — H0/H1/H2/H3/H4: ✅ confirmada / ⚠️ parcial / ❌ refutada.
2. **Patrones encontrados** — ej. "85% ancla a una Series de GCD; los recopilatorios
   generan N:M; los one-shots son 1:1; los Omnibus requieren humano".
3. **Decisión recomendada** — ej. "mantener 1:1; escape manual para recopilatorios; no
   implementar N:M por ahora" → alimenta el diseño de `ExternalIdentity` (ADR-004).

## RESULTADO (2026-06-29) — muestra decisiva, patrón saturado

Se corrieron casos decisivos (Batman: Year One, Amazing Spider-Man Omnibus de
McFarlane, Absolute Batman 2024, Enrique Alcatena/Utopía) contra GCD (comics.org). El
patrón saturó rápido porque el hallazgo clave es **estructural** (cómo modela GCD),
no de muestreo.

### Hallazgo que rompe el modelo

**GCD modela a nivel EDICIÓN/IMPRESIÓN, no a nivel OBRA.** Cada edición/printing/
formato es su **propia Series** de GCD. Ej. "Batman: Year One" son ~6 series
distintas: `DC 1988`, `Deluxe DC 2005`, `DC 2007`, `Deluxe DC 2017`, `Absolute`, etc.
**GCD no tiene una entidad "obra" que las unifique** (lo más cercano es la *Story*, un
nivel más abajo y mucho más difícil de matchear).

### Estado de las hipótesis

- **H0 — ⚠️ PARCIAL.** GCD es rico para Big-Two/US (Marvel/DC/Image) e incluso cataloga
  ediciones internacionales (Panini France/Deutschland). Pero para **indie argentino
  (Utopía/Alcatena) FALLA**: indexa al *creador*, no la colección local. H0 depende del
  origen.
- **H1 — ❌ REFUTADA** al nivel que esperábamos: **no existe una identidad canónica
  única** por obra en GCD; es edition-centric.
- **H2 — descubierta:** la relación dominante es `Work(edición AR) ↔ GCD Series` ~**1:1
  a nivel edición**. PERO eso **NO deduplica** nuestras ediciones repetidas: las 4
  "Batman: Año uno" AR mapearían a **4 series GCD distintas** — GCD las parte igual que
  nosotros. Un `gcdId` de series **no colapsa** los duplicados.
- **H3/H4 — debilitadas:** matchear a nivel edición (¿cuál de 6 printings?) es más
  ambiguo que a nivel serie → menos automatizable, menos confianza automática.

### Patrones

1. GCD **edition-centric**: no hay id de "obra"; cada edición es una serie.
2. Cataloga **ediciones internacionales** (incl. Panini) → posible match exacto de
   nuestra edición AR, pero más ruido de desambiguación.
3. **Indie/local (Utopía) mal cubierto** — GCD es US-mainstream.
4. **"Absolute" sobrecargado**: imprint 2024 vs formato "Absolute Edition" histórico.
5. **Insight de fondo:** los cómics **no tienen** un concepto de "obra" limpio en las
   bases externas como sí lo tiene el manga (AniList = una serie). Portar el modelo de
   identidad del manga **no funciona** para cómics.

### Decisión recomendada

**Diferir GCD como capa de identidad/dedup.** La hipótesis "Work → 1 gcdId →
auto-dedup" es **falsa**: GCD es edition-centric (no colapsa nuestras ediciones) y
débil para indie AR. Concretamente:

- **NO** construir `ExternalIdentity`-sobre-GCD-para-dedup ahora (ADR-004 queda
  Propuesto/en pausa; su apertura "GCD podría no ser el ancla" se confirmó).
- El **dedup de cómics sigue siendo un problema de dominio nuestro** (clustering de
  ediciones, como hicimos a mano con el manga) — una fuente que parte las ediciones
  igual que nosotros no las une.
- Los **cómics quedan visibles** (Fase 1, ya hecho) **sin identidad externa**.
- Uso más angosto que SÍ podría valer *después*: GCD como **enriquecimiento por
  edición** de Big-Two (título original, créditos, año) — metadata, no identidad; a
  evaluar cuando pese.

## Aprendizajes permanentes (trascienden GCD)

No son decisiones ni tareas — son conocimiento reutilizable. Si en un año se evalúa
Comic Vine / League of Comic Geeks / ISBN / Wikidata, se empieza desde acá, no se
repite el experimento:

1. **Las bases bibliográficas de cómics modelan EDICIONES, no OBRAS.** (GCD, y
   probablemente las demás.) No asumir un id de "obra".
2. **No asumir que un proveedor externo define la identidad de dominio.** El proveedor
   modela SU mundo, no el nuestro.
3. **La identidad de un `Work` debe SURGIR DEL DOMINIO**, no del modelo de datos de un
   proveedor. Para cómics eso implica que el dedup depende de señales de dominio
   (título original, autores, personajes, continuidad, páginas, qué issues recopila),
   NO de un id externo. Por eso nadie lo resuelve "conectando una API".
4. **Evaluar un proveedor por el PROBLEMA que resuelve, no por la cantidad de datos que
   ofrece.** GCD ofrece muchísimos datos y aun así no resuelve el nuestro.
5. **El manga tuvo suerte:** AniList/MU dan una identidad a nivel obra casi gratis. Fue
   la excepción, no la regla. No generalizar de ahí.

**Conexión con lo ya construido:** cuando toque el dedup de cómics, va a ser una
extensión del trabajo de dominio que ya existe (invariantes puros tipo `sameSeries`/
`workDomainKey` en `lib/domain/work/`, ADR-002), NO un proveedor nuevo. Identidad de
cómic = invariantes de dominio, no un `gcdId`.

## Fuera de alcance del spike

Géneros, sinopsis, créditos (metadata — se suman después, no cambian el modelo). El
**dump completo de GCD** (Fase 5) — el spike se hace con lookups humanos livianos sobre
la muestra (investigación, no scraping a escala).
