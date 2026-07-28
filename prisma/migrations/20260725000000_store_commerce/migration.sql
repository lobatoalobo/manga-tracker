-- Retail / Preventas — Slice 1: infraestructura comercial de tienda.
-- NO APLICADA aún: la base es compartida/gated (ver memoria del proyecto). Se aplica con
-- `prisma migrate deploy` sobre staging/base desechable, nunca desde scripts locales.
--
-- Aditivo: crea DOS tablas satélite. NO toca `Store` ni `User` (sus relaciones son virtuales; las FKs
-- viven acá). Una tienda del directorio sigue existiendo sin capacidad comercial (perfil OPCIONAL).

-- StoreCommerceProfile: capacidad comercial 1:1 con Store.
CREATE TABLE "StoreCommerceProfile" (
    "id"                  SERIAL NOT NULL,
    "storeId"             INTEGER NOT NULL,
    "slug"                TEXT NOT NULL,
    "enabled"             BOOLEAN NOT NULL DEFAULT false,
    "whatsapp"            TEXT,
    "paymentAlias"        TEXT,
    "paymentInstructions" TEXT,
    "pickupInstructions"  TEXT,
    "publicDescription"   TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCommerceProfile_pkey" PRIMARY KEY ("id")
);

-- StoreMember: administradores/empleados de la operación comercial (OWNER | STAFF).
CREATE TABLE "StoreMember" (
    "id"        SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "userId"    TEXT NOT NULL,
    "role"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreMember_pkey" PRIMARY KEY ("id")
);

-- 1:1 con Store (una sola capacidad comercial por tienda) + slug direccionable único.
CREATE UNIQUE INDEX "StoreCommerceProfile_storeId_key" ON "StoreCommerceProfile"("storeId");
CREATE UNIQUE INDEX "StoreCommerceProfile_slug_key" ON "StoreCommerceProfile"("slug");

-- Una membresía por usuario por tienda + índice para "mis tiendas".
CREATE UNIQUE INDEX "StoreMember_profileId_userId_key" ON "StoreMember"("profileId", "userId");
CREATE INDEX "StoreMember_userId_idx" ON "StoreMember"("userId");

-- FKs (Cascade: borrar la tienda borra su perfil; borrar el perfil o el usuario borra la membresía).
ALTER TABLE "StoreCommerceProfile" ADD CONSTRAINT "StoreCommerceProfile_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreMember" ADD CONSTRAINT "StoreMember_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "StoreCommerceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreMember" ADD CONSTRAINT "StoreMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
