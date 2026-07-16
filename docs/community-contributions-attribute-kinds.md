# Community Contributions — Catálogo de `attributeKind` (MVP)

> **Contrato de dominio.** Fuentes de verdad congeladas: [ADR-006](adr/006-community-contributions.md),
> [domain model](community-contributions-domain-model.md),
> [persistence model](community-contributions-persistence-model.md). Este documento
> enumera los `attributeKind` del **MVP** y sus contratos de valor. **Sin
> `schema.prisma`, sin SQL, sin migraciones, sin código.** Box sets e identidad de
> creadores (ADR-005) quedan **fuera de alcance**.

## Convenciones compartidas (se enuncian una vez)

- **Claim = `(attributeKind, claimOperation, value?)`** + evidencia + confianza (ver G para `claimOperation`).
- **Cardinalidad**: *singular* (un valor por sujeto), *set* (conjunto sin orden, con **sub-clave** de coexistencia), *lista* (orden significativo).
- **Acuerdo/Conflicto**: en *singular*, se computan sobre el valor del atributo. En *set*, se computan **por sub-clave** (dos claims con misma sub-clave y distinto valor = conflicto; distinta sub-clave = coexisten).
- **Evidencia (tiers, del persistence model)**: **fuerte** = sitio/tienda/catálogo oficial, ISBN verificable; **media** = MU/MD/AniList/Whakoom, librerías; **débil** = redes/blogs/wikis/capturas sin URL. "Obligatoria/recomendada/opcional" es **política de moderación ajustable** salvo donde se marque hard.
- **Normalización**: nunca pisa el valor original (se guarda verbatim); las claves normalizadas son **derivadas** (ver I).
- **Curated al aplicar**: por defecto, **todo campo aplicado desde una contribución se marca `curated`** (los crons no lo pisan). Se indica lo contrario si aplica.
- **Referencias cross-BC**: blandas (persistence model §B).

---

## A. Catálogo propuesto (MVP)

**Work (identidad descriptiva):** `TITLE_LOCALIZED`, `TITLE_NATIVE`, `TITLE_ROMAJI`, `TITLE_ALTERNATIVE`, `WORK_TYPE`, `ORIGINAL_LANGUAGE`, `COUNTRY_OF_ORIGIN`, `WORK_STATUS`, `START_DATE`, `END_DATE`, `SYNOPSIS_LOCALIZED`.
**Work (créditos):** `CREATOR_CREDIT`.
**Work (ids externos):** `EXTERNAL_WORK_ID`.
**Edition:** `EDITION_PUBLISHER`, `EDITION_COUNTRY`, `EDITION_LANGUAGE`, `EDITION_FORMAT`, `EDITION_LABEL_OR_IMPRINT`, `EDITION_STATUS`, `EDITION_RELEASE_DATE`, `EDITION_ANNOUNCED_TOTAL_VOLUMES`, `EDITION_IS_UPCOMING`, `EXTERNAL_EDITION_ID`.
**Volume:** `VOLUME_NUMBER`, `VOLUME_TITLE`, `VOLUME_RELEASE_DATE`, `VOLUME_ISBN`, `VOLUME_PAGE_COUNT`, `VOLUME_COVER`, `VOLUME_STATUS`, `EXTERNAL_VOLUME_ID`.

**Consolidaciones respecto de tu lista (ver revisión adversarial):**
- **`CONTENT_CLASS` → atributo estructural AUTORITATIVO y SEPARADO de la Proposal (NO es un attributeKind y NO deriva de `WORK_TYPE`).** Se **siembra** al originar la Proposal (del `WORK_TYPE` inicial en un Alta, o del contentClass del Work referenciado en una Corrección) y es **inmutable por las claims** (ADR-006). `WORK_TYPE` es un attributeKind descriptivo pero **acotado a la contentClass** de la Proposal (§C): una claim descriptiva **nunca** cambia el discriminador estructural. Un cambio **manga↔cómic** es **operación estructural** (estructural, §C), nunca un `UpdateWork` silencioso.
- **`TITLE_PRIMARY` → DERIVADO** (rol de "título de display", por prioridad **configurable** `es-AR > es > en > romaji > nativo`). No se almacena como texto propio. Un **override de moderador** se registra como **designación/procedencia** (un **puntero** a cuál claim de título es la primaria, en la Resolución) — **no** como copia del texto → **sin segunda verdad**. **No es un kind.**
- **`DUPLICATE_OF` / `BAD_MERGE` / `SPLIT_INTO` / `WRONG_CONTENT_CLASS` → NO son attributeKinds** (ver §D).

## B. Tabla resumen por kind

| Kind | Nivel | Familias | Cardinalidad | Valor (resumen) | Evidencia | Clave promovida | Dedup | Mutation |
|---|---|---|---|---|---|---|---|---|
| TITLE_LOCALIZED | Work | Alta, Corrección | set (sub-clave: language) | `{language, text}` | recomendada (media) | **sí** (normTitle) | sí | Create/UpdateWork |
| TITLE_NATIVE | Work | Alta, Corrección | singular | `{language=ja…, text}` | recomendada | no | débil | Create/UpdateWork |
| TITLE_ROMAJI | Work | Alta, Corrección | singular | `text` (romanización) | recomendada | **sí** (romajiKey) | sí (puente) | Create/UpdateWork |
| TITLE_ALTERNATIVE | Work | Alta, Corrección | set (sub-clave: text norm) | `{language?, text}` | opcional (débil) | no | débil | Create/UpdateWork |
| WORK_TYPE | Work | Alta, Corrección | singular | enum acotado a la contentClass (§C taxonomía) | **obligatoria (media+)** | no (contentClass es atributo aparte) | acotado por contentClass | Create/UpdateWork (solo intra-clase) |
| ORIGINAL_LANGUAGE | Work | Alta, Corrección | singular | enum BCP-47 acotado | recomendada | no | débil | Create/UpdateWork |
| COUNTRY_OF_ORIGIN | Work | Alta, Corrección | singular | enum ISO-3166 | opcional | no | no | Create/UpdateWork |
| WORK_STATUS | Work | Alta, Corrección | singular | enum `ONGOING\|COMPLETED\|HIATUS\|CANCELLED\|UNKNOWN` | opcional | no | no | Create/UpdateWork |
| START_DATE | Work | Alta, Corrección | singular | PartialDate (§F) | opcional | no | no | Create/UpdateWork |
| END_DATE | Work | Alta, Corrección | singular | PartialDate (§F) | opcional | no | no | Create/UpdateWork |
| SYNOPSIS_LOCALIZED | Work | Alta, Corrección | set (sub-clave: language) | `{language, text}` | opcional (débil) | no | no | Create/UpdateWork |
| CREATOR_CREDIT | Work | Alta, Corrección | set (sub-clave: name+role) | `{displayName, role, externalCreatorId?, source?, order?}` | recomendada | no | no (advisory) | Create/UpdateWork |
| EXTERNAL_WORK_ID | Work | Alta, Corrección | set (sub-clave: provider) | `{provider, externalId}` | **obligatoria (fuerte)** | **sí** (provider+id) | **sí (id fuerte)** | AttachExternalId |
| EDITION_PUBLISHER | Edition | Alta, Corrección | singular | enum/ref publisher | recomendada (media) | no | (edición) | Add/UpdateEdition |
| EDITION_COUNTRY | Edition | Alta, Corrección | singular | enum ISO-3166 | recomendada | no | no | Add/UpdateEdition |
| EDITION_LANGUAGE | Edition | Alta, Corrección | singular | enum BCP-47 acotado | recomendada | no | no | Add/UpdateEdition |
| EDITION_FORMAT | Edition | Alta, Corrección | singular | enum `SINGLES\|KANZENBAN\|DELUXE\|OMNIBUS_2IN1\|OTHER` | opcional | no | no | Add/UpdateEdition |
| EDITION_LABEL_OR_IMPRINT | Edition | Alta, Corrección | singular | `text` | opcional | no | no | Add/UpdateEdition |
| EDITION_STATUS | Edition | Alta, Corrección | singular | enum `ONGOING\|COMPLETED\|UNKNOWN` | opcional | no | no | Add/UpdateEdition |
| EDITION_RELEASE_DATE | Edition | Alta, Corrección | singular | PartialDate | opcional | no | no | Add/UpdateEdition |
| EDITION_ANNOUNCED_TOTAL_VOLUMES | Edition | Alta, Corrección | singular | int ≥ 0 | recomendada | no | no | Add/UpdateEdition |
| EDITION_IS_UPCOMING | Edition | Alta, Corrección | singular | bool | opcional | no | no | Add/UpdateEdition |
| EXTERNAL_EDITION_ID | Edition | Alta, Corrección | set (sub-clave: provider) | `{provider, externalId}` | **obligatoria (fuerte)** | (posible) | sí (id edición) | AttachExternalId |
| VOLUME_NUMBER | Volume | Alta, Corrección | singular | number (permite decimal p/ .5) | **hard (dominio)** | no | (por edición) | Add/UpdateVolume |
| VOLUME_TITLE | Volume | Alta, Corrección | singular | `{language?, text}` | opcional | no | no | Add/UpdateVolume |
| VOLUME_RELEASE_DATE | Volume | Alta, Corrección | singular | PartialDate | opcional | no | no | Add/UpdateVolume |
| VOLUME_ISBN | Volume | Alta, Corrección | singular | `text` ISBN-10/13 | recomendada (fuerte si presente) | **sí** (isbnNorm) | **sí (id fuerte)** | Add/UpdateVolume |
| VOLUME_PAGE_COUNT | Volume | Alta, Corrección | singular | int > 0 | opcional | no | no | Add/UpdateVolume |
| VOLUME_COVER | Volume | Alta, Corrección | set (sub-clave: face/variant) | `{face, artifactRef\|imageRef}` (§H) | **obligatoria (media+)** | no | no | ReplaceCover |
| VOLUME_STATUS | Volume | Alta, Corrección | singular | enum `ANNOUNCED\|PUBLISHED\|OUT_OF_PRINT\|UNKNOWN` | opcional | no | no | Add/UpdateVolume |
| EXTERNAL_VOLUME_ID | Volume | Alta, Corrección | set (sub-clave: provider) | `{provider, externalId}` | obligatoria (fuerte) | no | sí | AttachExternalId |

## C. Contratos de valor detallados (los no triviales)

**Valores localizados (`TITLE_LOCALIZED`, `SYNOPSIS_LOCALIZED`, `VOLUME_TITLE`, `TITLE_ALTERNATIVE`, `TITLE_NATIVE`)** — esquema `{ language, text }`.
- **`language`** = **enum allowlist acotado y versionado**, NO BCP-47 arbitrario en MVP: **`es-AR`, `es`, `en`, `ja`**. `es-AR` y `es` son **locales distintos** (español de Argentina ≠ español genérico). El set es **extensible + versionado** (§K); un tag fuera del allowlist se **rechaza** en MVP.
- **`TITLE_ROMAJI`** es texto plano (romanización), fuente de la clave `romajiKey` (puente de dedup).
- **Normalización sin pérdida**: el `text` se guarda **verbatim**; las claves normalizadas (`normTitle`, `romajiKey`) son **derivadas** y no lo pisan.
- **Anti-duplicación**: se desalienta el mismo texto normalizado bajo dos kinds de título (validación soft).

**`TITLE_PRIMARY` (derivado, NO kind) y su override** — la primacía se **deriva** por prioridad configurable `es-AR > es > en > romaji > nativo`. Un **override de moderador** se registra como **designación** en la Resolución: un **puntero a la claim de título elegida** (por su identidad/valor), **no** una copia del texto. Así:
- el **texto** vive una sola vez (en su claim de título);
- la **primacía** es un puntero/decisión (regla o override), no una segunda verdad;
- el catálogo **materializa** el string de display (`Work.title`) a partir de esa designación (proyección aplicada), sin ser fuente de verdad de la primacía.

**WORK_TYPE / contentClass — separación estructural (resuelve la contradicción con ADR-006).**
- **`contentClass`** ∈ `{ MANGA, COMIC }` es un **atributo estructural AUTORITATIVO y SEPARADO** de la Proposal (y del Work): se **siembra** al originarse, es **inmutable por las claims**, y es la barrera dura de `sameContentClass` (dedup/guard). **No** deriva de `WORK_TYPE`.
- **`WORK_TYPE`** es un attributeKind **descriptivo** (enum), pero **cada valor pertenece a exactamente UNA contentClass** (tabla abajo). Una claim `WORK_TYPE` es válida **solo si su valor pertenece a la contentClass de la Proposal**. Refinar el tipo **dentro** de la misma clase (ej. MANGA↔LIGHT_NOVEL↔ARTBOOK) es una Corrección normal.
- **Un cambio cross-class (manga↔cómic) NO es una claim `WORK_TYPE` común**: se rechaza como corrección descriptiva. Es un **problema estructural** que exige una operación estructural dedicada (con guard cross-type), no un `UpdateWork` silencioso. **Fuera del flujo de claims del MVP** (se trata como reporte/estructural o admin; nunca deriva de `WORK_TYPE`).

**Taxonomía mínima `WORK_TYPE → contentClass` (sin ambigüedad):**

| contentClass | WORK_TYPE válidos |
|---|---|
| **MANGA** | `MANGA` · `LIGHT_NOVEL` · `ARTBOOK` · `DATABOOK` · `OTHER_MANGA` |
| **COMIC** | `COMIC` · `OTHER_COMIC` |

`OTHER` se **parte** en `OTHER_MANGA` / `OTHER_COMIC` → **ningún** `WORK_TYPE` queda sin contentClass. (manhwa/manhua = manga-class; en MVP `WORK_TYPE=MANGA` + `COUNTRY_OF_ORIGIN`; agregables luego por la regla de admisión, todos manga-class → sin riesgo de discriminador.)

**CREATOR_CREDIT** — `{displayName, role, externalCreatorId?, source?, order?}`.
- `displayName` = **nombre mostrado** (string, verbatim).
- `role` = enum de rol de catálogo (STORY, ART, STORY_ART, SCRIPT, PENCILS, INK, COLOR, LETTER, ASSISTANT, UNKNOWN).
- `externalCreatorId?` = **opcional**, se guarda tal cual (provider+id) **sin resolver** — es dato de catálogo.
- `source?` = origen del crédito; `order?` = orden de display.
- **Aclaración obligatoria:** aporta **solo créditos de catálogo** (`Work.credits`). **NO toca ni resuelve el grafo de identidad de creadores (ADR-005).** No hay reconciliación de identidad, no hay aliasing (Ito/Itou), no hay merge de personas. `externalCreatorId` se persiste como dato opaco, no como ancla de identidad.

**EXTERNAL_*_ID** — `{provider, externalId}`. Sub-clave = `provider` (un id por provider por sujeto). **Providers MVP (cerrados, no se suman otros):**
- `EXTERNAL_WORK_ID`: **MangaUpdates, MangaDex, AniList**.
- `EXTERNAL_EDITION_ID`: **Whakoom**.
- `EXTERNAL_VOLUME_ID`: **Whakoom**.
- **Nombres de provider canónicos y versionados** (enum del contrato, §K), no strings libres. Extensible fuera de MVP (GCD, Comic Vine, Open Library…) por la regla de admisión.
- **Si un provider cambia o elimina un id upstream**: el id que aceptamos es un **hecho del ledger** (una claim aplicada) → **no se borra ni reescribe** por un cambio upstream. La corrección es explícita: una nueva Corrección `REMOVE` (id inválido) o `SET` (id nuevo); la **clave promovida `externalKey` se recomputa**; el registro histórico de la claim original persiste. Un id que dejó de resolver upstream **no** invalida retroactivamente la resolución que lo usó.
- **Riesgo alto:** un id externo equivocado linkea la serie/edición/tomo equivocada → **evidencia verificable obligatoria (hard) + verificación del moderador** antes de aplicar; unicidad por sujeto (un id no puede apuntar a dos sujetos). Participa del dedup como **id fuerte**.

**VOLUME_NUMBER** — `number` (permite `.5` para especiales/entre-tomos). **Hard requirement de dominio** para Alta de Volume (sin número no hay tomo identificable). Validación: ≥ 0; único por edición (dos claims con mismo número = conflicto de identidad del tomo, no de valor).

**Fechas** (`*_DATE`) — ver §F (PartialDate).
**Portadas** (`VOLUME_COVER`) — ver §H.

## D. Matriz kind × Target × Family

Regla general (deriva de la matriz Family×Target del persistence model §C):
- **ALTA** usa kinds del nivel del **NuevoSujeto** (Work / Edition / Volume). Alta-Work **además** admite el set mínimo de kinds de **primera Edition** (ver §E), por la invariante de visibilidad.
- **CORRECCIÓN** usa kinds del nivel del **Target referenciado** (Work / Edition / Volume existente).
- **REPORTE** **no usa** attributeKinds descriptivos (§D).

| Nivel del kind | Válido en Target… | ALTA | CORRECCIÓN | REPORTE |
|---|---|---|---|---|
| Work-kinds | NuevoSujeto WORK / Ref WORK | ✅ (alta work) | ✅ (corrige work) | ❌ |
| first-Edition-kinds dentro de Alta-Work | NuevoSujeto WORK | ✅ (edición mínima) | — | ❌ |
| Edition-kinds | NuevoSujeto EDITION / Ref EDITION | ✅ (alta edición) | ✅ (corrige edición) | ❌ |
| Volume-kinds | NuevoSujeto VOLUME / Ref VOLUME | ✅ (alta volumen) | ✅ (corrige volumen) | ❌ |
| (report payload, no-descriptivo) | Relación estructural | ❌ | ❌ | ✅ |

## E. Required sets por operación

Se separa **hard requirement de dominio** (sin esto la Mutation es inválida/incoherente) de **política de moderación** (evidencia, umbrales — ajustable).

**Alta de Work** — debe producir obra **visible**. *Hard de dominio:*
- ≥1 título (`TITLE_LOCALIZED` **o** `TITLE_NATIVE` **o** `TITLE_ROMAJI`);
- `WORK_TYPE` (de él sale `contentClass`);
- **visibilidad**: **o** el set mínimo de **primera Edition** (`EDITION_PUBLISHER` + `EDITION_COUNTRY` + `EDITION_LANGUAGE`) **o** `EDITION_IS_UPCOMING = true` (debut sin edición).
- *Recomendado:* `TITLE_ROMAJI` (dedup) y `ORIGINAL_LANGUAGE`.
- *Política:* ≥1 evidencia fuerte.
- **Qué vive en la Proposal-Work vs en la primera Edition:** los kinds Work-level describen la obra; el **set mínimo de Edition** describe la primera edición y se aplica en la **misma** Mutation `CreateWork(+FirstEdition)`. La proposal Alta-Work, por la invariante de visibilidad, **puede portar claims de dos niveles** (work + primera edition) — deliberado, acotado a ese set mínimo.

**Alta de Edition** — *Hard:* Work padre (Target) existente; `EDITION_PUBLISHER`, `EDITION_COUNTRY`, `EDITION_LANGUAGE`; **`EDITION_RELEASE_DATE` o `EDITION_IS_UPCOMING`**. *Recomendado:* `EDITION_ANNOUNCED_TOTAL_VOLUMES`, `EDITION_FORMAT`.

**Alta de Volume** — *Hard:* Edition padre existente; `VOLUME_NUMBER`; **identificación suficiente** = `VOLUME_COVER` **o** `VOLUME_ISBN` **o** `EXTERNAL_VOLUME_ID`. *Opcional:* `VOLUME_RELEASE_DATE`, `VOLUME_PAGE_COUNT`, `VOLUME_ISBN` si existe.

**Corrección** — *Hard:* ≥1 claim válida que **SET/ADD/REMOVE/MARK_*** un dato del Target existente (§G). Sin claim aplicable, la corrección es vacía → inválida.

**Reporte** — *Hard:* **relación estructural válida** en el Target (par WORK↔WORK para duplicado; WORK para mala fusión) + **≥1 evidencia** + **explicación** (motivo). *Política:* fuerza de evidencia exigida.

## F. Contrato de fechas parciales (`PartialDate`)

No usar `Date` obligatorio (perdería información). Contrato:

```
PartialDate = {
  precision: EXACT | YEAR_MONTH | YEAR | UNKNOWN | UPCOMING_UNDATED,
  year?:  int,     // requerido salvo UNKNOWN / UPCOMING_UNDATED
  month?: 1..12,   // requerido si YEAR_MONTH o EXACT
  day?:   1..31    // requerido si EXACT (válido para el mes/año)
}
```
- **Validación** por `precision`: EXACT⇒year+month+day válidos; YEAR_MONTH⇒year+month; YEAR⇒year; UNKNOWN/UPCOMING_UNDATED⇒sin componentes. `year` en rango plausible.
- **UNKNOWN** = afirmación positiva de "no se conoce" (≠ dato faltante). **UPCOMING_UNDATED** = anunciado sin fecha.
- **Traducción a Mutation:** EXACT → campo fecha real donde el catálogo lo soporta (ej. tomo); YEAR/YEAR_MONTH → **etiqueta borrosa** existente del catálogo (`releaseLabel` "2026"/"2026-07"); UPCOMING_UNDATED → `upcoming=true` sin fecha; UNKNOWN → limpia/deja nulo el campo con marca de "desconocido" (no reintroduce ruido). Nunca se degrada una fecha exacta a menos precisión al aplicar.

## G. `claimOperation` — decisión firme: **SÍ, en la Claim**

El **resultado** de una corrección no se representa solo con el valor ni con `null`. Se agrega un campo **`claimOperation`** en la Claim, **ortogonal** al `attributeKind`:

| operación | significado | valor | válido en |
|---|---|---|---|
| **SET** | fija/reemplaza el valor | presente | singular; set (define un miembro por sub-clave) |
| **ADD** | agrega a un conjunto/lista | presente | set / lista |
| **REMOVE** | quita un valor específico | identifica el valor a quitar | set / lista; singular (borra el valor erróneo) |
| **MARK_UNKNOWN** | afirma "valor desconocido" | ausente | atributos opcionales |
| **MARK_NOT_APPLICABLE** | afirma "no aplica" (ej. END_DATE de serie en curso) | ausente | atributos opcionales |

Por qué en la Claim y no implícito en el kind: la operación **depende del intento de corrección**, no solo de la cardinalidad. Un `START_DATE` puede SET-earse **o** MARK_UNKNOWN; un `TITLE_ALTERNATIVE` puede ADD-earse **o** REMOVE-earse; un `END_DATE` puede MARK_NOT_APPLICABLE (serie en curso). Ninguna de esas se deriva del kind. La cardinalidad del kind **restringe** qué operaciones son válidas (tabla), pero **no** las determina. **`null` no representa estas semánticas** (distingue "desconocido" de "no aplica" de "quitar").

## H. Modelo de portada (`VOLUME_COVER`)

- **Valor de la Claim** = `{ face: FRONT|BACK|SPINE|VARIANT, artifactRef | imageRef }`, donde `artifactRef` → un `EvidenceArtifact` subido, o `imageRef` → una `EvidenceReference` de imagen oficial (URL de editorial/tienda).
- **¿El artefacto es evidencia y valor a la vez?** Se separan: el **artefacto/imagen es el VALOR** (la portada propuesta); una **`EvidenceReference` aparte** (página oficial/tienda de origen) es la **evidencia** que prueba que es la portada real. Así "la imagen" y "prueba de que es la correcta" no se confunden.
- **Front/back/variante:** `face` es la sub-clave del set → coexisten front + back + variantes; **la portada primaria es la `FRONT`** (o derivada por prioridad si hay varias).
- **Al aceptar:** `Apply` **promueve** el artefacto al **almacenamiento oficial del catálogo** (R2, `curated`), setea la portada del Volume/Work al **asset oficial**, y el ledger conserva el **tombstone del artefacto** + una **referencia al asset oficial** resultante (procedencia). El **dueño del asset es el catálogo**, no la Proposal.
- **Qué queda en el ledger:** la claim (con `artifactRef`), su evidencia, y la referencia al asset oficial promovido. No los bytes (política §F).
- **Corregir/retirar una portada oficial:** nueva **Corrección** `VOLUME_COVER` (SET mejor / REMOVE) → re-`Apply`. El asset viejo sigue política de assets del catálogo (no del ledger).
- **Evitar que una URL temporal sea el valor de catálogo:** el valor de catálogo es **siempre** el asset oficial promovido (R2, propiedad del catálogo). La URL firmada/temporal del artefacto de la propuesta **nunca** se persiste como valor del catálogo — es fuente, se promueve.

## I. Claves promovidas (MVP — set mínimo justificado)

Solo se promueve lo que se consulta **cross-proposal** para preflight/dedup. Ninguna se promueve por comodidad.

| Clave | Deriva de | Autoritativa/cache | Recompute | Preflight/dedup | Riesgo FP |
|---|---|---|---|---|---|
| **contentClass** | **sembrado al originar** (no de WORK_TYPE) | **autoritativa** (discriminador estructural) | **no se recomputa** — inmutable en la Proposal | separa manga/cómic; **guard cross-type** | bajo |
| **normTitle** | mejor `TITLE_LOCALIZED`/título | **cache derivada** | cuando cambia la resolución del título | match de proposals pendientes + catálogo | **medio** (genéricos → mitigado por contentClass) |
| **romajiKey** | `TITLE_ROMAJI` | cache derivada | al fijarse/corregir romaji | puente de dedup (idiomas) | bajo-medio |
| **isbnNorm** | `VOLUME_ISBN` | cache derivada | al fijarse el ISBN | dedup de tomo (id fuerte) | muy bajo |
| **externalKey** (`provider+externalId`) | `EXTERNAL_*_ID` | cache derivada | al fijarse el id | dedup por id fuerte | muy bajo |

**Descartado en MVP:** **clave promovida de autor principal**. Motivo: es **identidad-adjacente** (variantes Ito/Itou) y no confiable pre-ADR-005; promoverla arriesga falsos matches. El autor queda como **claim advisory** para el moderador en el preflight, **no** como clave de dedup. (Se prefiere falso negativo a over-merge.)

## J. Mapeo a Mutations

| Mutation | Consume (kinds) | Validaciones previas | Curated resultante | ResolutionRecord registra |
|---|---|---|---|---|
| **CreateWork (+FirstEdition)** | títulos, WORK_TYPE, ORIGINAL_LANGUAGE, COUNTRY, STATUS, dates, SYNOPSIS, CREATOR_CREDIT, EXTERNAL_WORK_ID + set mínimo de Edition (o upcoming) | required set (§E); **guard cross-type**; preflight anti-dup no-bloqueante | todos los campos aplicados | `appliedWorkId` (+ `appliedEditionId` si hubo primera edición) |
| **UpdateWork** | cualquier kind Work-level; `WORK_TYPE` **solo intra-clase** | Target Work existente; whitelist; curated/drift; **una claim `WORK_TYPE` cross-class se rechaza** (no muta contentClass) | el/los campos corregidos | `appliedWorkId` |
| **ReclassifyContentClass** *(estructural, no-claim)* | *(ninguna descriptiva)* — operación estructural | **guard cross-type**; fuera del flujo de claims del MVP (reporte/admin) | contentClass | work + cambio de clase |
| **AddEdition** | EDITION_* + EXTERNAL_EDITION_ID | Work padre existente; no-duplica edición (publisher+país+idioma) | campos de la edición | `appliedEditionId` |
| **UpdateEdition** | EDITION_* | Edition existente; whitelist; curated/drift | campos corregidos | `appliedEditionId` |
| **AddVolume** | VOLUME_* + EXTERNAL_VOLUME_ID | Edition padre; VOLUME_NUMBER; no-duplica número | campos del tomo | `appliedVolumeId` |
| **UpdateVolume** | VOLUME_* | Volume existente; whitelist; curated/drift | campos corregidos | `appliedVolumeId` |
| **AttachExternalId** | EXTERNAL_WORK/EDITION/VOLUME_ID | id no colisiona con otro sujeto (unique); **verificación fuerte** | el id (curated) | ref al sujeto + id |
| **ReplaceCover** | VOLUME_COVER | artefacto DISPONIBLE (no bloqueado); face válido | cover (curated) + promoción a asset oficial | `appliedVolumeId` + ref al asset oficial |
| **MergeWorks** | *(ninguna descriptiva)* — Target relación DUPLICADO | ambos Works existen; **misma contentClass** (nunca cross-type); no-ciclo | — | source/target del merge |
| **SplitWork** | *(ninguna descriptiva)* — Target relación MALA_FUSION; SPLIT_INTO = decisión de resolución | Work existe; plan de split coherente | — | work original + nuevos works resultantes |

## K. Extensibilidad y versionado

**Regla de admisión de un nuevo `attributeKind`** (entra **solo si TODO**):
1. representa un **concepto de negocio distinto**;
2. tiene **esquema de valor y validación propios**;
3. **se resuelve independientemente** (acuerdo/conflicto propios);
4. tiene **traducción a Mutation**;
5. **no es una proyección** (no deriva de otros);
6. **no duplica** otro kind con otro nombre.

Un candidato que no cumpla los 6 **no entra** (ej. `CONTENT_CLASS` falla #5/#6 → derivado; `TITLE_PRIMARY` falla #5 → derivado).

**Versionado del contrato:** cada kind tiene un `contractVersion`. Si cambia el **esquema de valor** de un kind existente, se **incrementa** la versión; las claims viejas conservan su versión y el dominio las **interpreta por versión** (nunca se reescriben — ledger inmutable). Agregar un kind nuevo **no** versiona los existentes. El **set de providers** de `EXTERNAL_*_ID` y los **enums** (WORK_TYPE, formatos, status) son **listas versionadas**, no abiertas.

## L. Kinds explícitamente descartados / postergados

- **`TITLE_PRIMARY`** → **derivado** (primacía + override-puntero), no kind (§A/§C).
- **`CONTENT_CLASS`** → **NO es kind pero tampoco derivado de `WORK_TYPE`**: es atributo estructural **autoritativo e inmutable** de la Proposal (§C). `WORK_TYPE` es el kind descriptivo, acotado a la clase.
- **`DUPLICATE_OF`, `BAD_MERGE`, `SPLIT_INTO`, `WRONG_CONTENT_CLASS`** → **no son attributeKinds** (§D): relación estructural (Target/report) o corrección de `WORK_TYPE`.
- **Clave promovida de autor** → descartada en MVP (identidad-adjacente, §I).
- **Box sets** (`EDITION_FORMAT=BOXSET` + contención de tomos) → fuera de alcance.
- **Créditos con resolución de identidad** (aliasing, merge de personas) → fuera (ADR-005 congelado).
- **Géneros / demografía / reading-links / tags** → **postergados** (los cubre el enrich automático; bajo valor comunitario en MVP; se pueden sumar luego con la regla de admisión).
- **Precios / disponibilidad en tiendas** → fuera (no es identidad de catálogo).

## M. Decisiones de negocio (cerradas)

1. **`TITLE_PRIMARY` → DERIVADO** (confirmado). No es kind; primacía por prioridad configurable `es-AR > es > en > romaji > nativo`; override = **puntero/designación** en la Resolución (no copia de texto); catálogo materializa `Work.title` como proyección. Sin segunda verdad (§C).
2. **Locales → allowlist versionado** (confirmado): `es-AR, es, en, ja`; `es-AR` ≠ `es`; **no** se aceptan tags BCP-47 arbitrarios en MVP; extensible/versionado (§K).
3. **`WORK_TYPE` / `contentClass` → SEPARADOS** (contradicción resuelta, NO se consolidó): `contentClass` es atributo estructural **autoritativo e inmutable-por-claims**, **no** deriva de `WORK_TYPE`; `WORK_TYPE` es descriptivo pero **acotado a la contentClass**; cross-class = operación estructural con guard, nunca `UpdateWork` (§C, taxonomía). `sameContentClass` sigue siendo barrera dura.
4. **Providers externos MVP** (confirmados, cerrados): Work = MangaUpdates/MangaDex/AniList; Edition/Volume = Whakoom. Nombres canónicos/versionados; un id eliminado/cambiado upstream **no** borra el hecho del ledger — se corrige explícitamente (§C).
5. **`EDITION_ANNOUNCED_TOTAL_VOLUMES`** (renombrado): claim afirmable = **total de tomos anunciado por la editorial** (provisional si la edición está ONGOING). Se **distingue** de: (a) el **conteo de `Volume`s cargados** (derivado, entidad), y (b) el conteo real publicado. **El conteo de entidades NO sobrescribe semánticamente** el dato editorial; el catálogo puede priorizar el conteo real para completitud, pero el "anunciado" es su propio dato de referencia. No es un conteo derivado (por eso el nombre).
6. **Umbrales de evidencia → política de moderación ajustable** (confirmado), **no** invariantes hard del dominio, y **la fuerza mínima concreta puede cambiar sin versionar el contrato del kind**. **Excepciones hard** (por integridad, no conveniencia editorial): `EXTERNAL_*_ID` exige evidencia verificable; un Reporte estructural exige ≥1 Evidence; una portada exige artefacto/imageRef + una fuente verificable. Cualquier otro hard requirement debe justificarse por integridad.

---

## Revisión adversarial

- **¿Contradicción `WORK_TYPE → contentClass`?** **Detectada y resuelta.** Hacer `contentClass` **derivado** de `WORK_TYPE` permitía que una claim descriptiva mutara indirectamente el discriminador estructural → contra ADR-006. **Fix:** `contentClass` = atributo estructural **autoritativo, separado, sembrado e inmutable-por-claims**; `WORK_TYPE` descriptivo **acotado a la clase**; cross-class = operación estructural con guard. `sameContentClass` sigue siendo barrera dura; no hay transición silenciosa manga↔cómic por `UpdateWork`.
- **¿Kinds redundantes?** **`TITLE_PRIMARY`** (primacía derivada) → no entra como kind. `CONTENT_CLASS` → no es kind (es estructural, ver arriba). Sin otros duplicados.
- **¿Algún kind mezcla dos conceptos?** `VOLUME_COVER` podría mezclar "valor" y "evidencia" → **separado** explícitamente (artefacto = valor; source = evidencia, §H). `CREATOR_CREDIT` podría rozar identidad → **acotado** a crédito de catálogo, `externalCreatorId` opaco, sin resolución (§C).
- **¿Dato estructural modelado como Claim?** Riesgo en reportes → **evitado** (§D): DUPLICATE/BAD_MERGE/SPLIT viven en Target/Resolution, no como attributeKinds descriptivos.
- **¿Algún valor sin contrato claro?** Fechas → contrato `PartialDate` (§F); localizados → `{language,text}` con allowlist (§C); ids → `{provider,externalId}`; portadas → `{face, ref}`. Ninguno queda como JSON libre.
- **¿Demasiadas claves promovidas?** No: **5** (contentClass, normTitle, romajiKey, isbnNorm, externalKey), todas con uso cross-proposal real; se **descartó** la de autor por comodidad/riesgo.
- **¿Catálogo MVP demasiado amplio?** Cubre exactamente los casos pedidos (alta/corrección Work/Edition/Volume + ids + créditos + sinopsis + portada + reportes). Se **postergaron** géneros/demografía/precios. Es el mínimo que habilita el MVP, no más.
- **¿Algo toca identidad de creadores?** **No.** `CREATOR_CREDIT` es crédito de catálogo; `externalCreatorId` es opaco; sin aliasing ni merge de personas. ADR-005 intacto.
- **¿Contradice ADR-006 / modelos congelados?** No. Respeta: claims como unidad, resolución por claim, evidencia VO/artefacto separada, refs cross-BC blandas, curated al aplicar, guard cross-type, no-hard-delete. `claimOperation` **elabora** (no cambia) el contrato de valor que el persistence model dejó explícitamente para esta etapa.

**Estado:** catálogo de `attributeKind` del MVP consistente con el dominio congelado, sin tocar identidad, con contratos de valor cerrados salvo las 6 decisiones de negocio de §M. Al resolverlas, este contrato queda listo para bajar a **schema**.
