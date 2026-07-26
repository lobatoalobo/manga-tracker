# Retail / Preventas — Slice 2: PreorderCampaign + PreorderOffer (manual)

Segunda slice del dominio Retail. Permite que una tienda comercial **cree, configure, publique y cierre**
una campaña semanal de preventa, agregando manualmente tomos **reales del catálogo** como ofertas. **NO**
hay órdenes, reservas, pagos, retiros, Excel, importación ni matching (slices posteriores).

## Aggregate y fronteras

- **`PreorderCampaign`** (aggregate root) — actividad HISTÓRICA de una tienda. Cuelga de **`Store`**
  (`storeId`, identidad durable), **NO** del perfil comercial. El perfil se consulta solo para autorizar
  (miembro), verificar habilitación y config.
- **`PreorderOffer`** — un tomo real ofrecido; parte del aggregate de campaña (se edita bajo su lock).
- **El catálogo no conoce Retail** (a nivel de dominio). `PreorderOffer.volume → Volume` (RESTRICT) está
  **modelada en Prisma**, con la back-relation mínima `Volume.preorderOffers`. Retail referencia el catálogo;
  nunca al revés. No se agregó ningún campo comercial (precio/preventa/campaña/stock) al catálogo, y
  `PublisherEdition`/`Work` no ganan ninguna referencia a Retail.

### Dependencia de dominio ≠ relación de persistencia del ORM

Son dos cosas distintas y solo la primera está prohibida:

- **Dependencia de dominio Catálogo→Retail (PROHIBIDA):** ningún servicio, caso de uso ni módulo de Catálogo
  importa Retail, toma decisiones de precios/campañas/disponibilidad, ni usa `Volume.preorderOffers`. El
  catálogo se diseña como si Retail no existiera.
- **Relación de persistencia del ORM (PERMITIDA):** la FK `PreorderOffer.volume → Volume` y su back-relation
  `Volume.preorderOffers` son **metadata de persistencia** que Prisma exige para modelar la FK en ambos
  extremos. No implican dirección de dependencia: existen para que el schema y la base **no tengan drift**
  (misma constraint, mismo RESTRICT, mismo índice que la migración) y para que otros colaboradores no
  encuentren SQL "invisible" para Prisma. `Volume.preorderOffers` **no se navega desde el dominio Catálogo**;
  las lecturas comerciales van siempre por Retail (`PreorderOffer.volume` / snapshots).

## State machine de campaña (`lib/domain/retail/campaign.ts`)

```
DRAFT ──▶ PUBLISHED ──▶ CLOSED        (CLOSED y CANCELLED son TERMINALES)
  │            │
  └──▶ CANCELLED ◀──────┘
```
Prohibido: `CLOSED→PUBLISHED`, `CANCELLED→PUBLISHED`, `PUBLISHED→DRAFT`, `DRAFT→CLOSED`. Reabrir cambiaría
la semántica histórica → no se permite (si algún día hace falta, es decisión de producto documentada). **No
existe `ARCHIVED`**: CLOSED + CANCELLED cubren el historial en v1.

**Offer:** `ACTIVE ↔ HIDDEN`, `ACTIVE/HIDDEN → CANCELLED` (terminal).

## Política temporal (`isCampaignOpen(campaign, now)`)

`status` = historia explícita; el **tiempo** solo decide la disponibilidad pública. `isCampaignOpen` (PURA,
`now` inyectado) = `PUBLISHED` **y** tienda habilitada **y** `opensAt` alcanzado **y** `closesAt` no
alcanzado. **No hay cron**: el reloj nunca cambia el `status`. La UI pública deriva una etiqueta
(`OPEN`/`NOT_YET`/`ENDED`/`CLOSED`) sin persistir. Slice 3 usará `isCampaignOpen` para validar que solo se
reserva sobre campañas abiertas.

## Matriz de roles (§11, central en `lib/domain/retail/policy.ts`)

| Acción | Roles | requireEnabled |
|---|---|---|
| CREATE / EDIT_DRAFT / MANAGE_OFFERS | OWNER, STAFF | **sí** |
| PUBLISH | **OWNER** | sí |
| CANCEL | **OWNER** | no |
| CLOSE | OWNER, STAFF | no |
| DELETE_DRAFT | **OWNER** | no |

Congelada en una política central (no dispersa en la UI). Cada servicio la consulta vía
`authorizeCampaignAction` → `authorizeStoreAccess` (Slice 1, session-free, por `storeId` estable).
**Decisión ambigua resuelta (§11):** `CREATE` se permite a OWNER **y** STAFF (preparación) — la
especificación listaba "crear" bajo OWNER pero también "preparación: OWNER y STAFF"; como STAFF ya edita
borradores y ofertas, negarle crear el borrador inicial era inconsistente. La compuerta comercial real
(PUBLISH/CANCEL) queda OWNER-only.

## Reglas de publicación (§12, transaccional bajo lock)

Bajo `FOR UPDATE` de la campaña: autorizar PUBLISH (OWNER + habilitada) → si ya PUBLISHED, idempotente →
`assertCampaignTransition(DRAFT→PUBLISHED)` → `assertPublishable`: tienda habilitada, título válido, fechas
coherentes y **≥1 oferta ACTIVE**. La unicidad de Volume y la validez de precios ya están garantizadas al
agregar (unique + `assertValidPrices`). Registra `publishedAt`. Todo en una transacción.

## Mutabilidad post-publicación (§13, congelada)

Tras `PUBLISHED` **se puede**: corregir la **descripción pública**, **ocultar**/**cancelar** ofertas,
**cerrar** la campaña. **No se puede** (sin una operación explícita futura): cambiar la tienda, el `Volume`
de una oferta, **los precios**, las **fechas**, ni eliminar la campaña o sus ofertas históricas. Los campos
comerciales se **protegen desde la publicación** (aunque todavía no haya reservas) para no cambiar la
semántica cuando Slice 3 sume reservas.

## Precios (§8)

Enteros de **unidad mínima (centavos ARS)** — `listPriceCents`, `preorderPriceCents` — **NO `Float`**
(evita el tipo `Float` del repo y el redondeo). Fuente de verdad = lista + preventa; el **`discountPercent`
es DERIVADO** (`derivedDiscountPercent`), no se persiste (sin tres fuentes de verdad). Reglas: ambos ≥ 0,
`preorder ≤ list`. Moneda única (ARS) en esta slice.

## Snapshots (§7)

Resueltos al agregar la oferta desde `Volume → PublisherEdition → Work`: `titleSnapshot` (Work.title, con
fallback a `PublisherEdition.title`), `volumeNumberSnapshot` (Volume.number), `publisherSnapshot`
(PublisherEdition.publisher), `isbnSnapshot` (Volume.isbn — hoy casi siempre `null` en el catálogo, ver
auditoría de portadas/ISBN). No se inventa metadata que el catálogo no tenga. El snapshot preserva el
display histórico aunque el catálogo cambie.

## FKs y unicidad (§9)

- `PreorderCampaign.storeId → Store` **onDelete: Restrict** — una tienda con campañas **no se borra**.
- `PreorderCampaign.createdByUserId → User` **onDelete: SetNull** (nullable) — la campaña sobrevive si el
  creador borra su cuenta (es una ref de auditoría; la campaña pertenece a la tienda).
- `PreorderOffer.campaignId → PreorderCampaign` **onDelete: Cascade** — borrar un DRAFT borra sus ofertas
  (el dominio SOLO permite borrar DRAFT; nunca hard-delete de publicadas).
- `PreorderOffer.volume → Volume` **onDelete: Restrict** (modelada en Prisma) — no se borra un Volume
  referenciado por una oferta histórica. Sin drift: el schema declara la misma constraint que la migración.
- `@@unique([campaignId, volumeId])` — un Volume aparece a lo sumo una vez por campaña.

## Compatibilidad con Merge

`PreorderOffer → Volume` **sobrevive a la absorción de un Work**: `absorbWorkInto` re-parenta
`PublisherEdition.workId`, pero `Volume.id` y `Volume.editionId` **no cambian**. La oferta sigue apuntando
al mismo Volume; para mostrar la serie se resuelve `Volume → PublisherEdition.workId` (ya apunta al Work
sobreviviente). Además el snapshot conserva el display aunque el título cambie. Retail no bloquea Merge ni
viceversa (Merge opera sobre `CatalogIdentity`, gated; Retail sobre `Volume`, estable).

## Concurrencia (§17)

Todas las mutaciones lockean la **fila de campaña** (`SELECT … FOR UPDATE`) y revalidan bajo lock, así:
- **doble publicación** → la 2ª ve `PUBLISHED` bajo lock → **idempotente** (no re-setea `publishedAt`);
- **dos miembros agregando el mismo Volume** → `@@unique` + P2002 → **`OFFER_ALREADY_EXISTS`** (una gana);
- **publicar mientras se edita una oferta** → serializados por el lock de la campaña;
- **cerrar y cancelar simultáneos** → una gana; la otra ve el estado terminal → `INVALID_CAMPAIGN_TRANSITION`;
- **modificar tras publicar** → `assertDraftEditable` / política post-publicación rechaza.

Semántica elegida: **idempotente** cuando es seguro (re-publicar/re-cerrar/re-cancelar al mismo estado,
ocultar a lo ya oculto), y **error de dominio consistente** cuando la transición es inválida. Verificado en
Postgres real.

## Errores de dominio (§18)

`RetailError` con `code` estable (`CAMPAIGN_NOT_FOUND`, `CAMPAIGN_NOT_EDITABLE`,
`INVALID_CAMPAIGN_TRANSITION`, `CAMPAIGN_HAS_NO_OFFERS`, `OFFER_ALREADY_EXISTS`, `INVALID_PRICE`,
`INVALID_DATES`, `INVALID_TITLE`, `VOLUME_NOT_FOUND`, `STORE_COMMERCE_DISABLED`, …). La autorización usa
`StoreAuthError` (Slice 1). Los conflictos de Prisma (P2002) se **traducen**; no se depende de sus mensajes.

## Rutas

- Admin: `/tiendas/[slug]/admin/preventas` (lista), `…/preventas/nueva` (crear),
  `…/preventas/[campaignId]` (detalle: editar, ofertas, picker de Volume, publicar/cerrar/cancelar).
- Pública: `/tiendas/[slug]/preventas/[campaignId]` (lectura; DRAFT/CANCELLED → 404; sin botón de reservar,
  CTA "Reservas próximamente").

## Qué queda expresamente para Slice 3

Órdenes (`StoreOrder`/`StoreOrderLine`), reservas, carrito, pagos, retiros, colección automática,
`ExternalProductReference`, importación de Excel y matching. `isCampaignOpen` ya deja lista la validación
"solo se reserva sobre campañas abiertas". La protección de precios/fechas post-publicación evita cambiar
la semántica cuando existan reservas.
