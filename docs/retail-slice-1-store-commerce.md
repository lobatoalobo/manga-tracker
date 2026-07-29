# Retail / Preventas — Slice 1: infraestructura comercial de tienda

Primera slice del segundo dominio de Nakama (**Retail / Preventas**). Alcance ESTRICTO: dejar la base
para que una tienda pueda existir comercialmente y tener quién la administre. **No** hay campañas,
ofertas, órdenes, reservas, Excel ni matching (slices posteriores).

## Análisis de `Store` (evidencia)

- **Qué representa hoy:** un **directorio público de comiquerías físicas** (dónde conseguir manga en AR).
  Campos = metadata de directorio: `name, address, city, province, phone, hours, website, social`,
  `status` (APPROVED|PENDING, moderación), `submittedBy` (userId **soft**, sin FK; se anula al borrar la
  cuenta — `lib/account.ts`).
- **Pantallas/uso:** `/tiendas` (listado público, `getApprovedStores`), `/admin/tiendas` (moderación),
  componente `ProposeStore` (alta comunitaria → PENDING). Servicio: `lib/stores.ts`.
- **Relaciones:** **ninguna** (sin FK a `User`, sin back-relations). **No tiene `slug`.**
  `app/tiendas/crumb/page.tsx` es una página **estática hardcodeada** (no resuelve `Store`).
- **¿Sirve como tienda comercial?** Como **identidad durable de la tienda, sí**; como contenedor de la
  capacidad comercial, **no**: mezclar alias de pago / instrucciones / miembros dentro del directorio
  moderado conflaciona dos responsabilidades (directorio público vs. operación comercial) y arriesga la
  listado público.
- **Riesgo de modificarla:** bajo si es aditivo, pero cargar columnas comerciales en `Store` acopla un
  aggregate de moderación con uno operativo.

## Decisión arquitectónica (§1)

**Extender con satélites, sin duplicar `Store` y sin tocar su tabla.**

```
Store (identidad durable)
  └─(1:1)→ StoreCommerceProfile  (capacidad comercial + slug direccionable)
             └─(1:N)→ StoreMember  (OWNER | STAFF)  ── userId → User
```

- **No se duplica `Store`**: la identidad de la tienda sigue siendo `Store`. La capacidad comercial es un
  satélite opcional (`StoreCommerceProfile`), así **una tienda puede existir sin perfil comercial**.
- **`Store` no cambia a nivel de tabla**: solo gana una relación **virtual** (`commerceProfile`), sin
  columnas nuevas. Igual `User` (`storeMemberships`, virtual). La migración solo crea las 2 tablas nuevas.
- **No se usa `isAdmin` para administrar tiendas.** `isAdmin` queda **solo** para administración global.

### Decisiones ambiguas documentadas (antes de implementar)

1. **`slug` vive en `StoreCommerceProfile`, no en `Store`.** El slug es una llave de **ruta comercial**
   (`/tiendas/<slug>/admin`); `Store` hoy no tiene slug público. Ponerlo en el perfil evita modificar la
   tabla `Store` y mantiene el slug como concern comercial. (Si un storefront público futuro necesitara un
   slug en `Store`, se promueve con una migración; hoy sería trabajo adelantado.)
2. **`StoreMember` cuelga del `StoreCommerceProfile` (no de `Store`).** Coincide con la jerarquía pedida y
   con que un miembro es alguien que administra la **operación comercial**; agregar miembros presupone
   perfil comercial. Cascada: borrar el perfil borra sus miembros. La membresía se ata a la operación, no
   al directorio.
3. **`enabled` es un flag de capacidad, ortogonal a la autorización de acceso.** `requireStoreMember`
   acepta `requireEnabled`: la pantalla de admin usa `requireEnabled:false` (un OWNER debe poder entrar a
   una tienda deshabilitada para reactivarla); las operaciones comerciales futuras usarán
   `requireEnabled:true`.
4. **Servicio "plano" (`lib/storeCommerce.ts`), no capas dominio/infra todavía.** Coherente con el código
   hermano de comercio (`lib/stores.ts`, `lib/purchases.ts`, `lib/collection.ts`), que son servicios
   planos sobre Prisma. La **única** lógica con valor de dominio en esta slice —la autorización— sí se
   aísla PURA en `lib/domain/store/authorize.ts` para poder testearla sin DB ni sesión. El layering
   completo se introducirá cuando las preventas aporten lógica de dominio real.

## Modelo nuevo (§2)

`StoreCommerceProfile { id, storeId @unique, slug @unique, enabled=false, whatsapp?, paymentAlias?,
paymentInstructions?, pickupInstructions?, publicDescription?, createdAt, updatedAt }` — 1:1 con `Store`
(FK `onDelete: Cascade`).

`StoreMember { id, profileId, userId, role (OWNER|STAFF), createdAt }` — FK a `StoreCommerceProfile`
(Cascade) y a `User` (Cascade). `@@unique([profileId, userId])` (una membresía por usuario por tienda),
`@@index([userId])`.

No se agregan campos que el MVP no use.

## Autorización

`authorizeStoreMember(...)` PURA (dominio) decide: autenticación → perfil existe → membresía → (enabled si
se exige) → rol permitido, o lanza `StoreAuthError` con `code`:
`UNAUTHENTICATED | PROFILE_NOT_FOUND | NOT_A_MEMBER | STORE_DISABLED | FORBIDDEN_ROLE`.
`requireStoreMember(slug, opts)` (infra) resuelve sesión (`auth()`) + perfil/miembro (Prisma) y delega en
la función pura. Toda operación comercial futura DEBE pasar por acá.

## Migración (gated)

`prisma/migrations/20260725000000_store_commerce/` crea `StoreCommerceProfile` + `StoreMember` (+ uniques,
FKs). **No aplicada** a la base compartida (patrón gated del proyecto); se aplica en efímero/staging.

## Endurecimiento (revisión previa a commit) — decisiones congeladas

### FK de entidades HISTÓRICAS futuras: **`storeId` (Store), no `profileId`** — CONGELADO

Se **revierte** la afirmación previa ("Campaign colgará del profile"). `Store` es la **identidad durable**
del comercio; `StoreCommerceProfile` es **configuración/capacidad** (mutable, desactivable, reemplazable).
Por lo tanto:

| | A. `Campaign.profileId` | **B. `Campaign.storeId` (elegida)** |
|---|---|---|
| Desactivar/editar el perfil afecta el historial | **sí (riesgo)** | no |
| Cascade config→órdenes posible | **sí (prohibido)** | no |
| Store sin capacidad comercial | rompe si el perfil no existe | coherente (historial vive en Store) |
| Store que tuvo operaciones pierde historial al borrar el perfil | **sí** | **no** |

**Regla congelada:** `PreorderCampaign` y `StoreOrder` (slices futuras) referenciarán **`storeId → Store`
con `onDelete: Restrict`**. Nunca `Cascade` desde configuración hacia actividad histórica. `Store` se
vuelve inborrable en cuanto tenga operaciones (la FK `Restrict` lo garantiza). La **autorización** de esas
acciones deriva el `profile` desde el `storeId` (relación 1:1) vía `requireStoreMemberByStoreId`.

Reparto de responsabilidades: **Store** = identidad durable + historial (Campaign/Order → storeId,
Restrict); **StoreCommerceProfile** = capacidad/config (Cascade desde Store OK mientras no haya historial);
**StoreMember** = autorización (Cascade desde el profile OK).

### Autorización por slug vs ID estable (§2)

- **Central, sin sesión:** `authorizeStoreAccess(client, locator, userId, opts)` (`lib/storeAccess.ts`) —
  resuelve el perfil por `{slug} | {storeId} | {profileId}` y decide con la función pura. `userId`
  EXPLÍCITO ⇒ testeable y usable derivando la tienda desde una entidad (sin confiar en un slug del cliente).
- **Adaptadores con sesión** (`lib/storeAuth.ts`): `requireStoreMember(slug)` (páginas),
  `requireStoreMemberByStoreId(storeId)` / `requireStoreMemberByProfileId(profileId)` (acciones que ya
  tienen una entidad). Cuando exista una entidad histórica se autoriza por su `storeId`, no por el slug.

### Invariantes de OWNER (§3) — aplicados bajo transacción + lock

Invariante: **todo `StoreCommerceProfile` tiene ≥1 OWNER**. Decisión pura en `lib/domain/store/membership.ts`
(`wouldLeaveNoOwner`/`assertKeepsOwner`), aplicada por la infra bajo `$transaction` + `SELECT … FOR UPDATE`
del padrón OWNER:
- **bootstrap** crea perfil + OWNER en **una** transacción (nunca nace sin OWNER);
- **no** se puede quitar ni degradar (→STAFF) al **último** OWNER (`LAST_OWNER`);
- un OWNER se quita a sí mismo **solo si queda otro** OWNER;
- **concurrencia:** dos operaciones simultáneas no pueden dejar el perfil sin OWNER (el lock del padrón las
  serializa; la perdedora relee bajo lock y recibe `LAST_OWNER`) — **verificado en Postgres real**;
- agregar dos veces al mismo usuario es **idempotente** (`upsert` por `(profileId, userId)`).
- No hay UI de cambio de rol todavía; se protegen las operaciones que ya existen (`addMember`/`removeMember`).

### Bootstrap del primer perfil (§4)

Política: **solo un administrador GLOBAL** crea el perfil, asigna el OWNER inicial y habilita por primera
vez. El dominio la refleja: `bootstrapStoreCommerce({ …, ownerUserId, isGlobalAdmin })` exige
`isGlobalAdmin` (→ `BOOTSTRAP_FORBIDDEN` si no) y crea perfil+OWNER atómicamente. Tras el bootstrap, la
administración es por `StoreMember` vía `requireStoreMember*` — **nunca `isAdmin`**. El seed de dev es la
herramienta de admin actual (pasa `isGlobalAdmin: true`); una acción admin web puede sumarse después. **No**
se implementa "reclamar esta tienda".

### Eliminación y durabilidad (§5)

Cascades actuales (aceptables **mientras no haya actividad histórica**): `Store → StoreCommerceProfile →
StoreMember`. Documentado y congelado para el futuro: (a) el perfil se **desactiva** (`enabled=false`), no
se borra, cuando tenga actividad; (b) `Campaign/Order` usan **`Restrict`** hacia `Store`; (c) **borrar una
Store con operaciones queda bloqueado** (por esa `Restrict`); (d) **ningún cascade futuro puede borrar
órdenes**. No se implementa soft-delete en esta slice (no es estrictamente necesario aún).

## Cómo habilita la Slice 2 (§5)

`PreorderCampaign` colgará de **`Store` (`storeId`, `Restrict`)** como actividad histórica durable; su
**autorización** se resolverá con `requireStoreMemberByStoreId(storeId, { allowedRoles, requireEnabled: true })`
— la costura central ya existe y no depende del slug. `enabled` habilita/pausa la operación;
`whatsapp`/`paymentAlias`/`pickupInstructions` alimentarán el mensaje preparado y el aviso de retiro. Los
miembros STAFF ya podrán transicionar estados cuando existan órdenes. Nada de eso se implementa ahora.
