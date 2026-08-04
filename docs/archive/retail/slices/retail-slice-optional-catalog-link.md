> **Documento histórico.** La fuente de verdad vigente para Retail es `docs/pdd/`.

# Retail Slice — Vínculo de catálogo opcional en la oferta (plan de ejecución)

> Slice mínimo PREVIO al Retail Pilot Launch. Diseño conceptual aprobado (Alternativa A). Este es el plan de
> ejecución definitivo. NO modifica el Retail Pilot Launch Plan.

## Dirección aprobada
- `Offer` es una entidad **auto-descriptiva**; `Volume` pasa a ser una **identidad de catálogo opcional**.
- `Collection` sigue **estrictamente basada en `Volume`** (`Acquisition`/`OwnershipPosition` NOT NULL, sin cambios).
- El ciclo comercial se completa **sin identidad de catálogo**; la proyección hacia Collection queda **diferida**.
- No se introduce entidad `Product` (registrada como opción futura con disparadores explícitos).

## Observaciones registradas (vinculantes)

**1. Terminología de snapshots.** El snapshot **no** es "la autoridad". Es el **registro histórico inmutable de la
descripción comercial publicada**: preserva exactamente qué publicó la tienda y qué vio el comprador. El
**catálogo sigue siendo la autoridad bibliográfica cuando el `Volume` existe**; el snapshot no compite con eso,
lo complementa como memoria comercial.

**2. Ciclo de vida de la oferta manual.** Se define explícitamente y **reutiliza la regla existente**:
- La descripción de una oferta (manual o vinculada) es **editable solo mientras la campaña está `DRAFT`**
  (`assertDraftEditable`, igual que hoy con precios). Al **publicar**, la oferta se **congela** (solo se permite
  ocultar/cancelar).
- **Clave:** una reserva **solo puede existir después de publicar** (`createStoreOrder` exige campaña abierta).
  Por lo tanto, "congelar la descripción cuando exista un comprador" queda satisfecho **por construcción**: al
  primer comprador la campaña ya está publicada y la oferta ya está congelada. No hace falta maquinaria nueva de
  ciclo de vida.
- La **línea de pedido snapshotea al reservar** → el comprador queda protegido aunque, hipotéticamente, algo
  cambiara después. La corrección de un error en `DRAFT` se hace con el flujo existente **quitar + re-agregar**
  (`removeDraftPreorderOffer`); **edición in-place del descriptor NO forma parte de este slice** (opcional futura).

**3. Duplicados manuales.** Sin restricción estructural ni solución sofisticada. Se deja **registrado** que más
adelante se podrá sumar una **validación blanda de negocio** (advertir cuando ya exista una oferta manual muy
similar en la misma campaña). **Fuera de este slice.**

## Alcance
Ver diseño técnico aprobado. En síntesis: `Offer.volumeId` y `OrderLine.volumeId` opcionales; camino de oferta
**manual** además del picker de catálogo; ciclo comercial completo sin `Volume`; Collection **tolera** líneas sin
`Volume` (las posterga, no falla ni reintenta). **Fuera:** resolución tardía + backfill a Collection; entidad
`Product`; edición in-place del descriptor; validación blanda de duplicados; portada para manuales; tocar catálogo.

## Fases de implementación

### F1 — Ensanche de esquema + dominio puro
- Migración expand-only: `PreorderOffer.volumeId` y `StoreOrderLine.volumeId` → **nullable** (relaciones `Volume?`,
  `onDelete: Restrict` y `@@unique` conservados). **Sin columnas nuevas.**
- `lib/domain/retail/offer.ts`: `assertValidManualDescriptor` (título requerido/trim/cap; número opcional ≥ 0).
- `lib/domain/collection/result.ts`: nuevo `PROJECTION_RESULT.PENDING_CATALOG_RESOLUTION`.
- **Criterio de finalización:** `prisma validate` + `generate` OK; la migración aplica **desde cero** en el harness;
  unit tests de dominio verdes; `npm run check` verde. **Sin cambios de comportamiento observables todavía.**

### F2 — Servicio (creación manual + propagación)
- `addPreorderOffer`: unión discriminada `{ volumeId }` (vinculada, como hoy) | `{ manual: {title, volumeNumber?,
  publisher?, isbn?} }` (manual → `volumeId = null`, snapshots del input). `VOLUME_NOT_FOUND` **solo** si se pasó un
  `volumeId` inexistente.
- `createStoreOrder`: ya copia `volumeId`+snapshots desde la oferta (l.119) → el null se propaga; solo ajustar tipos.
- `getPublicCampaign` (`lib/retail/public.ts`): DTO con `volumeId` nullable.
- **Criterio de finalización:** IT verdes de: oferta manual creada (volumeId null, snapshots del input); camino
  vinculado intacto; `VOLUME_NOT_FOUND` condicional; `createStoreOrder` desde oferta manual; **ciclo comercial
  completo sobre orden no vinculada** (pago → conciliación → preparación → pickup). `npm run check` verde.

### F3 — Tolerancia en Collection
- `lib/collection-context/projection.ts`: `PickupEvent.volumeId` → `number | null`; `projectPickupEvent` con
  `volumeId === null` → `PENDING_CATALOG_RESOLUTION` (sin armar fact, sin escribir); `findPendingPickups` agrega
  `AND l."volumeId" IS NOT NULL` (excluye de la barrida → sin reintentos inútiles); `PickupProjectionTally` suma
  `pendingResolution`; observabilidad de pendientes (helper de auditoría o consulta).
- `apply.ts`/`Acquisition`/`OwnershipPosition`: **sin cambios**.
- **Criterio de finalización:** IT verdes de: pickup null → PENDING (sin Acquisition, sin fallo); `findPendingPickups`
  excluye null (no loop); proyección inmediata reporta `pendingResolution`; **pickup vinculado sigue proyectando**;
  auditoría lista pendientes. `npm run check` + harness (con migración desde cero) verdes.

### F4 — UI de carga manual (detrás de flag)
- `CampaignAdminClient.tsx` + `[campaignId]/page.tsx`: modo "ingresar a mano" junto al picker; `volumeId` nullable
  en props. `addOfferAction`: dos modos.
- Gateado por el feature flag (ver abajo).
- **Criterio de finalización:** con flag ON, la tienda crea ambos tipos de oferta por UI; con flag OFF, **solo** el
  comportamiento actual (picker); regresión de campaña vinculada de punta a punta verde; `npm run check` verde.

## Orden exacto de migraciones y despliegue (migrate-first)

1. **Un PR** con F1–F4 (código con el flag **OFF** por defecto) + la migración expand-only. Merge commit.
2. **Ensayo en staging:** aplicar la migración a staging; correr el harness (migración desde cero) + un E2E manual
   (oferta manual → publicar → reservar → pagar → preparar → pickup → PENDING observado); limpiar datos QA.
3. **Migrate-first a prod:** aplicar la migración expand-only a **producción** (`ALTER … DROP NOT NULL` ×2) **antes
   de mergear el código**. Es inocua para el código desplegado (nadie escribe null aún). Verificar 70→71 y columnas
   nullable (read-only).
4. **Merge del PR** → deploy productivo automático **con el flag OFF**. Smoke: nada cambia (comportamiento actual).
5. **Encender el flag** cuando el ensayo esté validado → habilita la creación manual. Validar en prod con un caso
   controlado (o directamente al operar el piloto).

## Estrategia de feature flag
- **Nombre:** `retail-manual-offers` (DB-backed, default **OFF**).
- **Gatea SOLO el camino de escritura:** el modo manual en la UI + la rama manual de `addOfferAction`/
  `addPreorderOffer`. Con OFF, `addPreorderOffer` manual se rechaza (o la UI no lo ofrece) → comportamiento idéntico
  al actual.
- **NO gatea** el ensanche de columnas ni la tolerancia del proyector: esos son **permanentes y seguros** (aditivos,
  backward-compatible). Desacopla "dejar de crear manuales" de "seguir operando las existentes".

## Checklist de validación
- [ ] `prisma validate` + `generate` OK; migración aplica desde cero en el harness.
- [ ] Unit (dominio): `assertValidManualDescriptor`, nuevo `PROJECTION_RESULT`.
- [ ] IT servicio: manual (volumeId null + snapshots), vinculada intacta, `VOLUME_NOT_FOUND` condicional, orden no
      vinculada, **ciclo comercial completo sin Volume**.
- [ ] IT proyección: PENDING sin escribir, exclusión del sweep, tally `pendingResolution`, vinculado intacto,
      auditoría de pendientes.
- [ ] Regresión: campaña **vinculada** de punta a punta incl. pickup → `OwnershipPosition`.
- [ ] `npm run check` (tsc + unit) verde; `node scripts/identity-it.mjs` verde.
- [ ] Compatibilidad: campañas/pedidos existentes sin cambios (ensanche no toca filas).
- [ ] Ensayo en staging E2E manual completo + limpieza de datos QA (residuo 0).
- [ ] Prod post-migración (read-only): columnas nullable, sin migraciones fallidas, sin P2022, smoke sin 5xx.
- [ ] Con flag OFF en prod: comportamiento idéntico al actual.

## Plan de rollback (coherente con la aparición de ofertas manuales)

Doctrina: **el flag es el rollback real; el ensanche de esquema y la tolerancia del proyector son seguridad
permanente y NO se revierten.**

- **Nivel 0 — apagar el flag (preferido).** Frena la creación de **nuevas** ofertas manuales. Las manuales ya
  creadas y sus pedidos **siguen operando** (ciclo comercial completo) y sus pickups siguen **posponiéndose** en
  Collection. Sin pérdida de datos. Es la palanca primaria ante cualquier problema del camino manual.
- **Nivel 1 — fix-forward del proyector/servicio.** Si el bug está en la tolerancia, se corrige hacia adelante. **No**
  revertir a un proyector que asuma `volumeId` no-null mientras exista **cualquier** línea manual (intentaría crear
  `Acquisition` con null → falla/loop).
- **Nivel 2 — revert total del código.** **Solo seguro si aún NO existen ofertas/líneas manuales** (p. ej. bug
  detectado antes de encender el flag o antes de la primera manual). Una vez que hay datos manuales, el revert total
  es inseguro.
- **Migración:** el ensanche (`DROP NOT NULL`) **no se revierte** mientras existan valores null (re-imponer NOT NULL
  fallaría). Queda permanente; es inocuo y backward-compatible (filosofía expand-only).

## Riesgos / decisiones de producto pendientes
- **Rollback con datos manuales:** mitigado por la doctrina flag-first (arriba). A confirmar como política.
- **Duplicados manuales:** aceptados en el mínimo; validación blanda = futura (Observación 3).
- **Portada ausente** en manuales: degradación limpia sin imagen (recomendado aceptar).
- **Edición in-place del descriptor en DRAFT:** fuera de este slice; corrección vía quitar+re-agregar.
- **Resolución tardía / backfill a Collection:** explícitamente **diferido** — el slice **no** decide por-línea vs.
  propagación desde la oferta; solo tolera la ausencia de identidad.
