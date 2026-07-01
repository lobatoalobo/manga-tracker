# Spike de Modelo de Identidad (cómics)

> **No** es un spike para "evaluar GCD". Es para **validar el modelo de identidad de
> nuestro dominio** antes de escribir schema (ADR-004). GCD es el instrumento de
> medición. Este es el **último artefacto de diseño** antes de mirar cómics reales.

## Objetivo

Responder, con evidencia sobre una muestra chica, **a qué nivel bibliográfico ancla
un `Work` de cómic y con qué cardinalidad** — la pregunta central que ADR-004 dejó
abierta y que **cambia el schema**.

## Hipótesis a validar (si alguna es falsa, cambia el modelo)

- **H1 — Identidad canónica clara:** cada `Work` AR tiene UN nivel bibliográfico
  natural (serie / issue / TPB / arco) que lo representa.
- **H2 — Cardinalidad 1:1:** `Work ↔ ExternalIdentity` es 1:1 (no `Work → N`
  entidades de GCD).
- **H3 — Match automatizable:** con señales baratas (título original + editorial de
  origen + año) se resuelve la mayoría sin humano.
- **H4 — Confianza asignable:** se puede poner `CONFIRMED/HIGH/…` automático en la
  mayoría; el humano queda para la cola de ambiguos.

## Criterios de ÉXITO (el spike termina cuando podemos responder)

1. **Nivel canónico** para ≥ **80%** de la muestra.
2. **Cardinalidad**: sabemos si es 1:1 o N:M, con el **% de cada uno**.
3. **% que requiere revisión manual** (y es tolerable: objetivo < ~30%).
4. **Confianza automática**: podemos asignarla sin humano en la mayoría.
5. **Catálogo de casos que rompen el modelo** (los que fuerzan N:M o ambigüedad).

## Criterios de FRACASO / abort (igual de importantes)

- **N:M domina** (> ~40% de los casos mapean a varias entidades) → el modelo 1:1 no
  sirve; hay que rediseñar (relación N:M) **o diferir GCD**.
- **Identidad ambigua** para > ~40% (no se puede nombrar el nivel) → GCD no es un ancla
  confiable para ediciones AR **ahora**.
- **Automatización baja** (la mayoría necesita humano) → el ROI no cierra; se difiere.

En cualquiera de esos casos: los cómics **siguen mostrándose** (Fase 1 ya lo hace, sin
identidad externa); el enrich/dedup de cómics queda manual/posterior. ADR-004 ya deja
esto explícitamente abierto.

## Estratificación de la muestra (empezar con 20: 10 fáciles + 10 difíciles)

Los **casos difíciles son los que rompen el modelo** — incluir a propósito:
recopilatorios · omnibus · deluxe/absolute · crossovers · one-shots · miniseries ·
series largas · reediciones. Si el modelo sobrevive a esos 10, el resto es fácil.
Iterativo: si los 20 muestran patrones nuevos, se agregan más.

## Campos a registrar por caso

| Campo | Para qué decisión |
|---|---|
| `workId`, título AR, editorial AR | referencia |
| **¿Qué representa?** (serie/issue/TPB/HC/absolute/arco/omnibus/otro) | nivel de identidad (H1) |
| **¿Una entidad de GCD alcanza?** (sí / N entidades) | cardinalidad (H2) |
| **¿Mezcla material?** (¿es recopilatorio de varios issues?) | detecta el caso N |
| **Señales disponibles**: ¿título original conocido? ¿editorial origen inferible? ¿año? ¿#issues? | ¿automatizable? (H3) |
| **¿Correspondencia inequívoca?** (sí / ambigua / no encontrada) | automatización + confianza (H4) |
| **Confianza estimada** (CONFIRMED/HIGH/MEDIUM/LOW/NONE) | calibra el enum del modelo |
| **¿Requiere humano?** (sí/no) | costo operativo |
| Notas | casos raros |

## Decisión según el resultado (por qué juntamos cada dato)

| Resultado | Decisión |
|---|---|
| H1+H2 se sostienen (1:1, nivel claro ≥80%) | Diseñar `ExternalIdentity` **1:1**, integrar GCD (dump + matcher). |
| Nivel claro pero **N:M** frecuente | Modelo con relación **N:M** (Work ↔ identidad ↔ entidades); reconsiderar el ancla. |
| Automatización baja pero identidad clara | Pipeline con **cola de revisión** fuerte; reevaluar si vale la pena ahora. |
| Ambiguo / roto | **Diferir GCD**; cómics visibles sin identidad externa; enrich manual. |

## Fuera de alcance del spike

Géneros, sinopsis, créditos (metadata — se suman después, no cambian el modelo). El
**dump completo de GCD** (Fase 5) — el spike se hace con lookups humanos livianos sobre
la muestra (investigación, no scraping a escala).
