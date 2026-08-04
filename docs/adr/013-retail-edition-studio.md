# ADR-013: Retail — Estudio (editor de la edición) y composición editorial

- **Estado**: **Aceptado**
- **Fecha**: 2026-08-04
- **Relacionado**: [ADR-012](012-retail-optional-catalog-link.md) (vínculo de catálogo opcional en la oferta), Fase 0 del rediseño Retail ([execution-plan-fase-0.md](../execution-plan-fase-0.md)), modelo de la edición y principios de producto (docs/vision/retail-design-principles.md, decisiones congeladas D-006/D-008/D-010)
- **Alcance**: decisión arquitectónica y de producto de **P-03 · Estudio**. **No** documenta la implementación (firmas, migración concreta, corte fino de commits) — eso vive en el diseño del slice, posterior a este ADR.

---

## Contexto

Con Fase 0 cerrada (UI Kit + tema + capa de dominio-vista pura), el proyecto cambia de etapa: de **construir la gramática** a **construir el producto**. La pregunta deja de ser "¿cuál es la mejor arquitectura?" y pasa a ser **"¿cómo trabaja un comerciante todos los días?"**.

**P-03 · Estudio** es la primera pantalla que consume Fase 0 y el corazón del flujo: es donde el comerciante arma la edición semanal (qué tomos entran, precios, orden y portada). Alimenta P-04…P-08. Es también la primera pantalla que **cruza el límite de schema** que Fase 0 evitó a propósito.

El dominio de preventas **ya existe y está en producción** (slices 1–8): `PreorderCampaign` (DRAFT/PUBLISHED/CLOSED/CANCELLED, mutabilidad por estado), `PreorderOffer` (`volumeId?` opcional desde ADR-012, snapshots, precios en centavos, `status`, `sortOrder`), y servicios idempotentes con lock `FOR UPDATE` (`campaigns.ts`, `offers.ts`). El editor actual (`CampaignAdminClient`) funciona como **formulario por sección + `router.refresh()`**.

Faltan tres cosas para el Estudio: (a) un modelo de **portada/principal** (gap X-4: hoy no existe columna ni servicio); (b) **uso real del orden** (`sortOrder` existe pero ningún UI lo setea); (c) una **superficie de edición** que haga sentir la edición como un todo, no como un formulario.

---

## Decisión

### 1. Brújula: construir sin pensar en la persistencia

> **Objetivo de P-03: permitir que un comerciante construya una edición completa sin pensar en cómo está persistida.**

Toda decisión de P-03 se evalúa contra esa frase.

### 2. Persistencia por gesto (sin "Guardar", sin buffer local)

Cada acción del comerciante es **una operación de dominio atómica e idempotente**: agregar un tomo, cambiar un precio, ocultar un tomo, reordenar, llevar a portada, elegir la principal. No hay botón "Guardar" global, no hay buffer de borrador en el cliente, no hay editor tipo documento colaborativo. Cada gesto **queda solo** porque es su propia mini-transacción en el servidor (el patrón que `offers.ts`/`campaigns.ts` ya exponen). El texto libre (título, descripción) persiste **onBlur/debounce**, no por tecla. La UI es **optimista con rollback**: refleja el gesto de inmediato y revierte si el servidor lo rechaza.

Esto satisface la brújula sin construir un motor de autosave especulativo: **el borrador no se inventa, ya es el DRAFT en el servidor**.

### 3. DRAFT es el borrador; se reutilizan los servicios existentes

No se inventa un concepto nuevo de borrador: el estado `DRAFT` de `PreorderCampaign` **es** el borrador editable. P-03 **consume** `campaigns.ts` y `offers.ts` (no los reemplaza) y agrega encima, con el mismo patrón (lock + idempotente + autorización central), solo las operaciones que faltan (reorden y portada).

### 4. Modelo de portada: dos columnas explícitas (Schema A)

Se separan **tres conceptos distintos**, cada uno en su lugar:

- **pertenece a portada** → `PreorderOffer.onCover Boolean @default(false)` (llevar-a-portada graduado).
- **es la principal** → `PreorderCampaign.principalOfferId Int?` (relación nombrada a `PreorderOffer`, `onDelete: SetNull`); una sola columna ⇒ **exactamente una principal** por campaña, sin índice parcial.
- **orden** → el `sortOrder` que **ya existe** (se empieza a usar; sin cambio de schema).

Ambas columnas son **aditivas con default seguro**: las campañas existentes quedan con portada vacía (estado válido, ver regla 6).

### 5. Reglas editoriales explícitas (sin heurísticas)

- **Alta de un tomo:** todo tomo nuevo entra **al final del catálogo, fuera de portada** (`onCover = false`, `sortOrder` al final). Subirlo a portada es una **acción explícita** aparte. No hay promoción automática.
- **Eliminar/cancelar la principal:** la portada queda **sin principal** (`principalOfferId → null`). **No** se auto-elige otra (D-008: *la principal se elige, no se hereda*). El comerciante vuelve a elegir cuando quiera.
- **Elegir principal y llevar-a-portada son acciones distintas.** Invariante de dominio (no en DB): si `principalOfferId` está seteado, esa oferta pertenece a la campaña, tiene `onCover = true` y `status = ACTIVE`.

### 6. Portada vacía es un estado válido

Una campaña sin principal ni secundarias es una **portada vacía válida** (D-006): el componente `Portada` renderiza lista pura. No es un error ni bloquea editar; solo la publicación mantiene su precondición existente (≥1 oferta ACTIVE).

### 7. Composición editorial como dominio puro: `edition-composition.ts`

La regla que decide, a partir de las ofertas + `principalOfferId` + `onCover` + `sortOrder`, **cuál es la composición editorial** (principal, secundarias en orden, catálogo-detrás) vive en un módulo de **dominio puro** `lib/domain/retail/edition-composition.ts`. **No** es un view-model de UI (por eso no se llama `edition-view`, para no confundir con `promise-view`): describe una **estructura editorial**, y de ella el componente `Portada` recibe una composición ya resuelta (no elige principal ni reordena).

### 8. La portada entra en el PRIMER slice

El primer entregable de P-03 **incluye la portada** (y por lo tanto la migración X-4 desde el inicio), aunque el slice sea más grande. Razón de producto, no técnica: el comerciante piensa la edición **como un todo** —ordenar y componer la portada son el mismo trabajo, no dos semanas distintas—. Un slice debe **sentirse terminado para el usuario**: al cerrarlo, se abre la app y se puede decir *"ya puedo crear una preventa"*.

---

## Consecuencias

**Buenas**
- El schema **nace sirviendo a la experiencia**: las columnas (regla 4) se derivan del flujo del comerciante, no al revés.
- Persistencia por gesto ⇒ sistema más simple: sin estado de borrador duplicado, sin sincronización cliente/servidor, cada acción tiene significado de negocio y reusa servicios probados.
- Dos columnas explícitas ⇒ portada legible y sin "mini-lenguaje" de rangos; mapea 1:1 al componente `Portada` (principal/secundarias/vacía).
- Reglas editoriales explícitas ⇒ comportamiento **predecible** (sin heurísticas de auto-promoción o auto-herencia de principal).
- Primer slice completo ⇒ el primer commit ya **se siente producto**, no andamiaje.

**Malas / costos**
- El primer slice es **más grande** (incluye migración X-4) — más superficie a revisar antes de mergear.
- La UI optimista con rollback exige **reconciliar el rechazo** de un gesto (revertir estado local), más complejo que el `router.refresh()` actual.
- El **reorden** debe ser atómico (reescribir `sortOrder` de las ofertas afectadas en una tx bajo el lock de campaña); el primer reorden sobre datos existentes (`sortOrder` todo en 0) asigna un orden determinista inicial.
- La relación `PreorderCampaign.principalOfferId ↔ PreorderOffer` introduce un ciclo aditivo que requiere relación nombrada + `SetNull` bien resueltos.

---

## Alternativas consideradas

- **`PreorderOffer.coverRank Int?` (un solo campo).** `null` = catálogo, `0` = principal, `≥1` = secundaria ordenada. **Descartada:** colapsa tres decisiones distintas (pertenencia, principalía, orden) en un campo que se vuelve un mini-lenguaje, y necesita forzar unicidad de rank. Dos columnas explícitas son más claras.
- **Primer slice schema-free (portada en un slice 2).** Técnicamente válido y más chico. **Descartada:** rompe la regla "cada slice debe sentirse terminado para el usuario" — el comerciante no separa "ordenar" de "hacer la portada"; son el mismo trabajo.
- **Buffer de borrador en el cliente + "Guardar" explícito (o autosave estilo documento).** **Descartada:** contradice la brújula (introduce persistencia visible), duplica el estado del DRAFT del servidor y agrega conflictos que la persistencia por gesto evita.
- **Nombre `edition-view.ts`.** **Descartada:** se confunde con `promise-view` (un view-model de UI); esta pieza describe una estructura editorial, no una proyección de pantalla.

---

## Próximo paso (fuera de este ADR)

Diseño del **slice 1 de P-03**: firmas de `edition-composition.ts` + servicios de reorden/portada sobre `offers.ts`/`campaigns.ts`, migración aditiva X-4 concreta (2 columnas, backfill trivial), corte vertical, archivos afectados y tests. Se arma como plan de slice para aprobación **antes** de escribir código o migraciones.
