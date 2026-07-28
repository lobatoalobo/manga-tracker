# Deployment Runbook — v1.1

> Despliegue del backlog integrado en `main`: **13 migraciones aditivas** (identidad/catálogo + Retail preventas 1–7 + Collection Slice 8) y la aplicación asociada.
> Documento **operativo**. Seguir paso a paso el día del deploy.
> **Versión:** 1.1 · **Última actualización:** 2026-07-28 · **Responsable de deploy:** _<nombre>_ · **Aprobador:** _<nombre>_

---

## 1. Alcance

### 1.1 Qué se despliega
- **13 migraciones gated** (rango `20260722000000` … `20260801000000`), cadena lineal aditiva.
- **Subsistema de identidad de catálogo** (Conferir / Asociar / integridad de referencias / Absorción de Work / Fusionar).
- **Retail — Preventas, Slices 1–7** (comercio, campañas/ofertas, reservas/órdenes, cumplimiento, avisos, pagos, preparación/retiro).
- **Collection — Slice 8** (proyección automática de retiros `PICKED_UP` a posesión) + su **cron horario** de proyección.
- **Collection — Slice 9 F1** (read-side unificado; **solo lectura**, sin cambios de schema).
- La **aplicación** (Next.js) que consume las tablas/columnas nuevas.

### 1.2 Qué queda explícitamente FUERA
- **F2** (backfill desde `OwnedVolume`).
- **F3** (Disposal / reversa + cutover de escritura).
- **F4** (lectura Collection-only).
- **F5** (drop de `OwnedVolume` / tablas legadas).
- **Migración de consumidores de lectura restantes** (grilla, `app/collection`, export, dashboard, notificaciones): en F1 solo se migró el stat "Tomos poseídos" de la Share pública.
- **Backfill de datos** de identidad/retail (no aplica: prod no tiene features vivas de estos subsistemas).
- **Activación de features al público** (feature flags, si aplica): este deploy habilita el esquema, no abre las features.

---

## 2. Prerrequisitos

> **Ninguno es opcional. El snapshot verificado (§2.1) es condición de inicio: sin él, no se arranca el procedimiento operativo (§4).**

### 2.1 Backups (OBLIGATORIO ANTES DE INICIAR)
- [ ] Snapshot de la base de producción etiquetado `pre-backlog-<YYYYMMDD-HHMM>` (snapshot del proveedor **o** `pg_dump -Fc`), tomado **antes** de cualquier paso operativo.
- [ ] **Restore verificado** del snapshot en una base descartable (crear el snapshot no basta: hay que probar que restaura).
- [ ] Ubicación e identificador del snapshot registrados en este runbook.

### 2.2 Ventana de mantenimiento
- Ventana recomendada: **baja actividad** (la migración #4 sobre `Work` toma un lock breve).
- Duración a reservar: ver §12.
- Comunicar la ventana a stakeholders si hay tráfico real.

### 2.3 Versiones requeridas
- **Node**: la del proyecto (`.nvmrc` / `package.json engines`).
- **Prisma CLI y `@prisma/client`**: **6.19.3** (CLI ↔ client deben coincidir).
- **PostgreSQL**: la versión de prod (probado en efímero PostgreSQL 18.x).
- **Next.js**: 16.x (versión del `package.json`).

### 2.4 Variables de entorno
- [ ] `DATABASE_URL` → apunta a **producción** (verificar host en §4.1 antes de migrar).
- [ ] `CRON_SECRET` → presente y correcto (lo exige `/api/cron/collection-projection`, fail-closed).
- [ ] Resto de variables de runtime sin cambios respecto del deploy anterior.
- [ ] El `DATABASE_URL` del **build/release step** (donde corre `migrate deploy`) es el de prod.

### 2.5 Permisos
- [ ] Credencial de base con permisos DDL (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `ADD CONSTRAINT`).
- [ ] Acceso al panel del proveedor de DB (snapshot/restore y métricas de locks).
- [ ] Acceso al panel de deploy (Vercel) para logs y rollback de la app.
- [ ] Aprobación del/los responsable(s) registrada (§4.1).

---

## 3. Preflight (verificaciones previas)

> Ejecutar **todo** en orden. Cualquier resultado inesperado → **no continuar** hasta resolver.

### 3.1 Estado de Git

```bash
git fetch origin
git status --short                 # esperado: working tree limpio
git rev-parse --abbrev-ref HEAD    # esperado: main (o el ref a desplegar)
git log --oneline -1 origin/main   # esperado: d61a4f2 (Merge PR #174) o posterior aprobado
```

**Esperado:** rama correcta, sin cambios sin commitear, HEAD = `origin/main`.

### 3.2 Versión del cliente Prisma

```bash
npx prisma --version
node -e "console.log(require('@prisma/client/package.json').version)"   # esperado: 6.19.3
```

**Esperado:** CLI y client en **6.19.3** (coinciden).

### 3.3 Validación del schema y generación del client

```bash
npx prisma validate     # esperado: "The schema is valid"
npx prisma generate      # migrate deploy NO genera el client: hay que generarlo aparte
```

### 3.4 Estado de migraciones

```bash
npx prisma migrate status
```

**Esperado:** exactamente **estas 13** listadas como *pending / not yet applied*:

```text
20260722000000_add_catalog_identity
20260722010000_add_reference_association_decision
20260722020000_reference_active_target_fk
20260723000000_work_absorption
20260724000000_identity_merge_redirect
20260725000000_store_commerce
20260726000000_preorder_campaigns
20260727000000_preorder_orders
20260728000000_preorder_fulfillment
20260729000000_arrival_notifications
20260730000000_manual_payments
20260731000000_preparation_pickup
20260801000000_slice8_collection
```

**Si aparecen menos de 13** (alguna ya aplicada) → detener y reconciliar antes de continuar.

### 3.5 Consultas SQL de preflight (solo lectura, contra prod)

```sql
-- a) Ninguna tabla nueva debe existir aún (todos NULL):
SELECT to_regclass('"CatalogIdentity"')            AS catalog_identity,
       to_regclass('"IdentityExternalReference"')  AS ext_ref,
       to_regclass('"StoreCommerceProfile"')       AS store_profile,
       to_regclass('"StoreOrder"')                 AS store_order,
       to_regclass('"StoreOrderLineEvent"')        AS line_event,
       to_regclass('"StorePayment"')               AS payment,
       to_regclass('"OwnershipPosition"')          AS ownership,
       to_regclass('"Acquisition"')                AS acquisition;

-- b) La columna nueva de Work NO debe existir aún, y dimensionar el lock de la mig. #4:
SELECT count(*) AS work_rows FROM "Work";
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'Work' AND column_name = 'absorbedIntoId';   -- esperado: 0 filas

-- c) Tipos de las claves padre (deben calzar con las FKs):
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'User' AND column_name = 'id';               -- esperado: text
SELECT table_name, data_type FROM information_schema.columns
  WHERE table_name IN ('Volume','Work','Store') AND column_name = 'id';  -- esperado: integer

-- d) Locks/actividad en vivo (referencia de base antes de empezar):
SELECT pid, state, wait_event_type, left(query,60) AS q
  FROM pg_stat_activity WHERE datname = current_database();
SELECT relation::regclass, mode, granted FROM pg_locks WHERE NOT granted;  -- esperado: vacío
```

**Esperado:** (a) todos NULL; (b) columna inexistente + `work_rows` conocido; (c) `User.id=text`, resto `integer`; (d) sin locks pendientes.

### 3.6 Otras comprobaciones
- [ ] Snapshot `pre-backlog-*` confirmado y restaurable (§2.1) — **ya existe** antes de este punto.
- [ ] `CRON_SECRET` y `DATABASE_URL` de prod verificados (§2.4).
- [ ] Ventana de mantenimiento activa / comunicada.
- [ ] `npm run check` verde en el commit a desplegar (tsc + unit).

---

## 4. Orden exacto de ejecución

> Cada paso: **comando → resultado esperado → si falla**. El snapshot ya existe (§2.1); en el paso 8 se **revalida**, no se crea por primera vez.

| # | Paso | Comando | Esperado | Si falla |
|---|---|---|---|---|
| 1 | Traer código | `git fetch origin && git checkout main && git pull` | HEAD = `origin/main`, tree limpio | Resolver estado Git antes de seguir |
| 2 | Deps | `npm ci` | Instalación limpia y determinista | Revisar lockfile / versión de Node |
| 3 | Versión Prisma | `npx prisma --version` | client/CLI 6.19.3 | Alinear versiones |
| 4 | Validar schema | `npx prisma validate` | "schema is valid" | Corregir; **no** deployar |
| 5 | Generar client | `npx prisma generate` | Sin errores | Investigar; no continuar |
| 6 | Preflight migraciones | `npx prisma migrate status` | 13 pendientes (§3.4) | Reconciliar; abortar si ≠ 13 |
| 7 | Preflight SQL | ejecutar §3.5 (solo lectura) | Todos los "esperado" | Abortar si algo no cuadra |
| 8 | **Revalidar snapshot** | (panel proveedor / verificación) | Backup `pre-backlog-*` **existente y restaurable** | **No continuar** sin backup válido |
| 8.5 | **Checkpoint de destino (GO/NO-GO)** | ver §4.1 | Destino confirmado + aprobación humana | **No continuar** sin confirmación |
| 9 | **Aplicar migraciones** | `npx prisma migrate deploy` | "13 migrations applied" sin error | Ver §9 |
| 10 | Verificar estado | `npx prisma migrate status` | Todas *applied* | Investigar la fallida; §9 |
| 11 | Revisión de consistencia | ver §4.2 | Solo diferencias esperadas (constraints crudos) | Revisar antes de exponer |
| 12 | Deploy de la app | (pipeline Vercel / release) | Build OK, app viva **después** de migrar | Rollback de app al release previo (§9) |
| 13 | Smoke tests | §7.2 (producción, no destructivos) | Todos OK | Evaluar abortar (§8) / §9 |
| 14 | Verificar cron | §7.2 punto 6 | 200, sin pendientes, idempotente | Revisar logs; el barrido es best-effort |
| 15 | Cierre | completar §10 | Checklist completa | Registrar incidencias |

> **Regla de oro:** las migraciones (paso 9) van **antes** de que la app nueva sirva tráfico (paso 12). `prisma migrate deploy` **solo aplica migraciones pendientes**: no detecta drift por sí mismo ni genera el Prisma Client (por eso el paso 5 genera el client y el paso 11 revisa consistencia aparte).

### 4.1 Checkpoint de destino (GO/NO-GO) — obligatorio antes de `migrate deploy`

Mostrar el destino **sin exponer la contraseña** y registrar la aprobación humana:

```bash
# Muestra host / base / usuario / puerto SIN la password
node -e "const u=new URL(process.env.DATABASE_URL); console.log('entorno: PRODUCTION\nhost:', u.hostname, '\nbase:', u.pathname.slice(1), '\nusuario:', u.username, '\npuerto:', u.port)"
git rev-parse HEAD    # commit exacto a desplegar
```

Completar y confirmar **antes** de ejecutar el paso 9:

```text
Entorno:        PRODUCTION
Host:           <db-host>
Base:           <db-name>
Usuario:        <db-user>
Puerto:         <db-port>
Commit:         <full-sha>   (verificado = origin/main)
Migraciones:    13 pendientes (confirmado en §3.4)
Snapshot:       pre-backlog-<YYYYMMDD-HHMM> (restaurable, §2.1)
```

**Autorización requerida para GO:**
- **Confirmación de dos personas** (responsable de deploy + aprobador), **o**
- si hay **una sola** persona responsable, una **confirmación escrita explícita** dejada por escrito en el canal del deploy (no verbal), citando host + base + commit.

```text
GO / NO-GO:  ___________
Confirmado por (1): ______________   hora: ______
Confirmado por (2): ______________   hora: ______   (o "responsable único — confirmación escrita adjunta")
```

### 4.2 Revisión de consistencia post-migración (paso 11)

`migrate deploy` no hace detección completa de drift. Como verificación **supletoria** (read-only), comparar la base con el datamodel esperado:

```bash
# Read-only. Salida legible (resumen). Provider único (PostgreSQL).
npx prisma migrate diff \
  --from-schema-datamodel ./prisma/schema.prisma \
  --to-url "$DATABASE_URL"
```

**Interpretación (importante):** Prisma **no modela** los constraints crudos del proyecto (índice parcial de designación `WHERE state='ACTIVE'`, FK compuesta de referencia ACTIVE, CHECKs de no-autoabsorción / redirección / procedencia / cantidades). Por eso el diff **puede no ser vacío**: puede reportar esos ítems como diferencias. La lectura correcta es **manual**:
- ✅ Aceptable: el diff está vacío **o** solo menciona los constraints crudos documentados.
- ❌ Investigar: cualquier otra diferencia (tabla/columna/índice inesperado, tipo distinto).

> La señal **autoritativa** de que el deploy quedó correcto es `migrate status` = todas *applied* (paso 10) **+** smoke tests (§7.2). El `migrate diff` es un chequeo complementario, no un gate binario. Opcionalmente, `--script` renderiza SQL y `--exit-code` cambia el código de salida (0 sin cambios / 2 con cambios / 1 error), recordando que "2" es esperado por los constraints crudos.

---

## 5. Migraciones (detalle de las 13)

> Todas **aditivas**. "Continuar" = la migración aplicó sin error y `migrate status` avanza.

| # | Migración | Objetivo | Duración esperada | Riesgo | Criterio para continuar |
|---|---|---|---|---|---|
| 1 | `…_add_catalog_identity` | Tablas `CatalogIdentity` + `IdentityExternalReference` (+ índice parcial de designación) | < 1 s | Muy bajo | Ambas tablas + índice parcial presentes |
| 2 | `…_add_reference_association_decision` | Columnas de procedencia en `IdentityExternalReference` (vacía) | < 1 s | Muy bajo | Columnas + índice único `decisionId` |
| 3 | `…_reference_active_target_fk` | FK compuesta ACTIVE + `identityState` + CHECK + `UNIQUE(id,state)` | < 1 s | Bajo | Constraint compuesto instalado |
| 4 | `…_work_absorption` | `Work.absorbedIntoId` + self-FK + CHECK + índice | **Segundos** (escala con `Work`) | **Medio** (única sobre tabla existente; lock breve) | Columna/índice/constraints OK; sin lock sostenido; dentro de §6 timeouts |
| 5 | `…_identity_merge_redirect` | Redirección/procedencia en `CatalogIdentity` (3 col + self-FK + 3 CHECK) | < 1 s | Bajo | Columnas + constraints OK |
| 6 | `…_store_commerce` | `StoreCommerceProfile` + `StoreMember` | < 1 s | Muy bajo | Tablas + únicos |
| 7 | `…_preorder_campaigns` | `PreorderCampaign` + `PreorderOffer` | < 1 s | Muy bajo | Tablas + FKs a Store/User/Volume |
| 8 | `…_preorder_orders` | `StoreOrder` + `StoreOrderLine` | < 1 s | Muy bajo | Tablas + únicos `(campaign,user)` / `(order,offer)` |
| 9 | `…_preorder_fulfillment` | Contadores en `StoreOrderLine` (vacía) + `StoreOrderLineEvent` | < 1 s | Muy bajo | Ledger + `operationKey` único |
| 10 | `…_arrival_notifications` | `StoreOrderNotification` + `…Item` | < 1 s | Muy bajo | Tablas + únicos |
| 11 | `…_manual_payments` | `StorePayment` + proyección en `StoreOrder` (vacía) | < 1 s | Muy bajo | Tabla + columnas de proyección |
| 12 | `…_preparation_pickup` | Contadores `prepared/pickedUp` en `StoreOrderLine` (vacía) | < 1 s | Muy bajo | Columnas creadas |
| 13 | `…_slice8_collection` | `OwnershipPosition` + `Acquisition` + `ownerUserIdSnapshot` + CHECKs | < 1 s | Muy bajo | Tablas + únicos + CHECKs de cantidad |

**Migración a vigilar: #4 (`Work`).** `ADD COLUMN` nullable es instantáneo; el costo está en validar FK+CHECK y crear el índice (todas las filas `NULL` → válidas), y escala con el tamaño de `Work`. Ver §6 (timeouts) y §11 (riesgo).

---

## 6. Timeouts operativos de la migración #4 (`Work`)

> Valores **a definir tras medir en staging con datos representativos** (§9 de staging). No fijar un número a ciegas.

```text
lock_timeout acordado:                    <valor>
statement_timeout acordado:               <valor>
duración máxima aceptable de la mig. #4:  <valor>   (umbral de aborto, §8)
```

**Cómo aplicarlos (evaluar y validar en staging antes de usar en prod):**
- `prisma migrate deploy` corre cada migración en su propia transacción y **no** expone un flag de timeout ni inyección por statement.
- **No** editar los archivos de migración para agregar `SET lock_timeout` / `SET statement_timeout` (no se modifican las migraciones ya aprobadas).
- Si se decide imponer timeouts, hacerlo a **nivel de conexión/rol/sesión** del deploy, por ejemplo vía parámetros del `DATABASE_URL` (`?options=-c%20lock_timeout%3D...`), `PGOPTIONS`, o `ALTER ROLE <deploy_user> IN DATABASE <db> SET lock_timeout = '...'` — **verificando primero en staging** que el runner de migraciones respeta esos valores y que las migraciones actuales aplican correctamente bajo ellos.
- Si no se confirma soporte en staging, **no** imponer `SET` en prod: usar la vigilancia manual de locks (§8) como control.

---

## 7. Smoke tests

### 7.1 Smoke tests de STAGING (flujo completo, puede crear datos)

1. `npx prisma migrate status` → todas *applied*. **Resultado esperado:** 13 applied.
2. Conferir una identidad sobre un Work → **identidad `ACTIVE` creada**.
3. Conferir una **segunda** identidad ACTIVE sobre el mismo Work → **rechazada** (índice parcial).
4. Asociar una referencia externa a la identidad → **`EXECUTED`**.
5. Crear comercio + membresía (OWNER) → **perfil comercial visible**.
6. Crear campaña + oferta y publicarla → **campaña `PUBLISHED`**.
7. Reservar (orden) → **`StoreOrder RESERVED`** con líneas y snapshots de precio.
8. Marcar llegada parcial → **`arrivedQuantity` sube**; evento `MARKED_ARRIVED` en el ledger.
9. Registrar pago → **`paidCents`/`paymentStatus` recomputados**; `StorePayment CONFIRMED`.
10. Preparar + retirar (`PICKED_UP`) → **evento `PICKED_UP` con `ownerUserIdSnapshot` (dueño)**.
11. Verificar proyección **inmediata** → **`Acquisition` creada + `OwnershipPosition` incrementada**.
12. Reintentar el mismo retiro (misma `operationKey`) → **sin segundo evento ni doble incremento**.
13. Disparar `/api/cron/collection-projection` con `CRON_SECRET` → **200, tally idempotente**.
14. Abrir `/u/<slug>` con posesión → **stat "Tomos poseídos" correcto**.
15. `scripts/audit-ownership.ts` (sin `--repair`) → **drift = 0**.

### 7.2 Smoke tests de PRODUCCIÓN (por defecto NO destructivos)

1. `npx prisma migrate status` → **todas *applied***.
2. Existencia de estructura → **13 tablas nuevas + columnas/índices/constraints presentes** (consulta read-only):

```sql
SELECT to_regclass('"CatalogIdentity"'), to_regclass('"OwnershipPosition"'),
       to_regclass('"Acquisition"'), to_regclass('"StorePayment"'),
       to_regclass('"StoreOrderLineEvent"');                       -- todos NOT NULL
SELECT column_name FROM information_schema.columns
  WHERE table_name='Work' AND column_name='absorbedIntoId';        -- 1 fila
SELECT conname FROM pg_constraint
  WHERE conname IN ('Work_no_self_absorption_check',
                    'IdentityExternalReference_identity_active_fkey',
                    'Acquisition_quantity_positive');              -- presentes
```

3. Healthcheck de la app → **200** en el endpoint de salud / home.
4. Apertura de **rutas existentes** (públicas y ya en producción) → **render sin errores** (sin 500 "relation does not exist").
5. Consulta **read-only** de una Share existente `/u/<slug>` → **carga correcta**; el stat unificado no rompe.
6. Invocación **autorizada** del cron `/api/cron/collection-projection` con `CRON_SECRET`, **cuando no existan pendientes** → **200, tally sin trabajo (no-op idempotente)**.
7. Auditoría **read-only** `scripts/audit-ownership.ts` (sin `--repair`) → **drift = 0**.

**Creación de datos de prueba en producción (por defecto NO se hace).** Solo si se decide explícitamente, requiere **todas** estas condiciones:
- [ ] Aprobación explícita (§4.1).
- [ ] Usuario, comercio y campaña **identificados como datos de prueba** (nombres/flags reconocibles).
- [ ] Claves de operación (`operationKey`/`recordOperationKey`/`acquisitionKey`) **únicas** y trazables.
- [ ] **Plan de limpieza definido de antemano**.
- [ ] Confirmación de que la limpieza **no viola el carácter append-only del ledger**.

**Restricción de limpieza:** la limpieza **NUNCA** borra eventos del ledger (`StoreOrderLineEvent`) ni `Acquisition` (hechos históricos inmutables). Si se crean datos de prueba, se aíslan bajo entidades de prueba borrables por sus FKs (Cascade desde `User`/`Store` de prueba donde aplique) **sin** eliminar filas del ledger de órdenes reales. Ante duda, **no crear datos de prueba en prod**: usar staging.

---

## 8. Criterios de abortar

Detener el deploy si:
- `prisma migrate status` en preflight **no** muestra exactamente 13 pendientes.
- Preflight SQL (§3.5) revela una tabla/columna nueva **ya existente** (aplicación parcial previa).
- **No** hay snapshot `pre-backlog-*` verificado y restaurable.
- El **checkpoint de destino (§4.1)** no obtiene GO / falta la confirmación requerida.
- `prisma migrate deploy` devuelve **cualquier error**.
- La migración **#4** supera la **duración máxima aceptable** (§6) o mantiene lock sostenido sobre `Work` en ventana con tráfico.
- `pg_locks` muestra **contención sostenida** durante la migración.
- Post-migración: la app arroja `relation/column does not exist` (orden invertido app↔migración).
- Smoke tests **críticos** de producción (1, 2, 3, 7) fallan.

---

## 9. Rollback

> Diagnóstico **primero**, siempre: ante cualquier fallo de migración, ejecutar `npx prisma migrate status` para conocer el estado real antes de decidir.

### 9.1 Rollback DURO (restore de snapshot)
**Cuándo:** corrupción o inconsistencia de datos, fallo con estado irreparable, o smoke tests críticos fallidos sin forward-fix claro.
**Cómo:**
1. Poner la app en mantenimiento / rollback del release de app al anterior.
2. Restaurar el snapshot `pre-backlog-*` en la base de prod (panel del proveedor o `pg_restore`).
3. Verificar `npx prisma migrate status` (las 13 vuelven a *pending*).
4. Confirmar que la app previa funciona sobre la base restaurada.

### 9.2 Forward-fix (sin restore)
**Cuándo:** fallo **atómico** de una migración (Prisma aborta esa migración en su tx; las previas quedan aplicadas y consistentes) por causa corregible (permiso, timeout, ventana de lock).
**Procedimiento controlado:**
1. **Diagnosticar** el estado real:

```bash
npx prisma migrate status
```

2. **Verificar manualmente** el estado real del schema para la migración fallida (¿aplicó parcialmente? ¿nada? ¿todo salvo el registro?): inspección read-only de tablas/columnas/constraints involucrados (`information_schema`, `pg_constraint`, `to_regclass`).
3. **Reconciliar el historial** con `migrate resolve`, **solo cuando corresponda** y **después** de la verificación manual del paso 2:

```bash
# Si el schema quedó SIN los cambios de esa migración (revertido/no aplicado):
npx prisma migrate resolve --rolled-back <migration_name>

# Si el schema YA tiene los cambios pero no quedó registrada como aplicada:
npx prisma migrate resolve --applied <migration_name>
```

4. Corregida la causa, reintentar:

```bash
npx prisma migrate deploy   # retoma desde la pendiente
```

5. **SQL de reversión (si hiciera falta deshacer objetos):** debe existir como **script previamente revisado, probado en staging y aprobado**. **No** se improvisan `DROP` en producción.

**Prohibido como procedimiento ordinario:**
- **No** editar directamente la tabla `_prisma_migrations`.
- **No** hacer `DROP` improvisado de objetos en prod.
- La reconciliación del historial se hace **exclusivamente** vía `migrate resolve`, tras verificar el estado real del schema.

### 9.3 Regla de decisión
- Fallo **atómico corregible** → **forward-fix** (§9.2): diagnosticar → verificar schema → `migrate resolve` si corresponde → reintentar.
- Datos comprometidos / estado inconsistente / smoke crítico irrecuperable → **rollback duro** (§9.1).
- Ante duda con **datos** → **rollback duro** (el carácter aditivo hace que el snapshot restaure el estado exacto).

---

## 10. Checklist final (estilo aviación)

```text
☐ Aprobación de deploy registrada (§4.1)
☐ Ventana de mantenimiento activa
☐ Versiones verificadas (Prisma 6.19.3, Node, PG)
☐ Variables de entorno confirmadas (DATABASE_URL prod, CRON_SECRET)
☐ Backup pre-backlog confirmado y restaurable (prerrequisito)
☐ Git en main, tree limpio, HEAD correcto
☐ prisma validate OK
☐ prisma generate ejecutado (client generado)
☐ migrate status = 13 pendientes
☐ Preflight SQL OK (sin tablas/columnas nuevas; tipos de FK correctos)
☐ Checkpoint de destino GO (host/base/usuario/commit + confirmación humana)
☐ migrate deploy exitoso (13 aplicadas)
☐ migrate status = todas applied
☐ Revisión de consistencia (migrate diff) = solo constraints crudos documentados
☐ App desplegada (después de migrar)
☐ Smoke tests de producción OK (§7.2)
☐ Cron de Collection funcionando (idempotente, sin pendientes)
☐ Ownership sin drift (audit read-only = 0)
☐ Observabilidad sin alarmas (locks/conexiones/errores)
☐ Cierre comunicado
```

---

## 11. Riesgos conocidos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Lock de la migración #4 sobre `Work` bajo tráfico | Media | Medio | Ventana de baja actividad; medir `work_rows` (§3.5b); timeouts acordados (§6); umbral de aborto (§8) |
| App desplegada **antes** que las migraciones | Baja | Alto | Orden en pipeline: `migrate deploy` en release step previo al serving |
| Versión Prisma CLI ≠ client | Baja | Medio | Verificar en preflight (§3.2); `npm ci` |
| `DATABASE_URL` apuntando a base equivocada | Baja | Crítico | Checkpoint de destino (§4.1) con confirmación humana |
| `CRON_SECRET` ausente/incorrecto | Baja | Bajo | Verificar en §2.4; el cron es fail-closed (no rompe datos) |
| `migrate diff` reporta diferencias | Media | Bajo | Esperado: los constraints crudos no se modelan en Prisma; revisión manual (§4.2) |
| Advisory lock del barrido no liberado (crash) | Baja | Bajo | Cliente dedicado `connection_limit=1`; `$disconnect`/muerte de sesión libera el lock |
| Migración parcial previa (tabla ya existe) | Muy baja | Alto | Preflight §3.5a aborta antes de aplicar |
| Snapshot no restaurable | Muy baja | Crítico | **Verificar** el restore en base descartable antes del deploy (§2.1) |
| `ownerUserIdSnapshot` sin FK → huérfano | Nula (en este deploy) | Bajo | Prod no tiene filas `PICKED_UP`; auditable con `findCorruptPickups`/`findTerminalPickups` |
| Reconciliación de historial mal hecha (`_prisma_migrations`) | Baja | Alto | Solo vía `migrate resolve` tras verificar schema (§9.2); nunca editar la tabla a mano |

---

## 12. Tiempo estimado

| Fase | Estimado |
|---|---|
| Preflight (Git, Prisma, SQL) | 10–15 min |
| Checkpoint de destino + revalidación de backup | 5 min |
| Migraciones (`migrate deploy`, 13; dominado por #4) | 1–5 min |
| Deploy de la app (build + release Vercel) | 5–10 min |
| Smoke tests de producción (§7.2) | 10–15 min |
| Revisión de consistencia / observabilidad / cierre | 5–10 min |
| **Total (con margen)** | **~35–50 min** |

> El tiempo de migraciones es dominado por la #4; si `Work` es grande, sumar el margen y preferir ventana sin tráfico. El backup **no** cuenta en esta ventana: es prerrequisito previo (§2.1).

---

### Anexo — Notas de contexto
- **Conteo:** son **13** migraciones (no 11).
- **Estado real pendiente/aplicada:** autoridad = `prisma migrate status` contra la base. Este runbook asume las 13 pendientes por los headers de migración + memoria del proyecto.
- **`migrate deploy`** (Prisma 6.19.3): aplica migraciones pendientes; **no** detecta drift completo por sí mismo; **no** genera el Prisma Client (se genera aparte, §3.3 / paso 5).
- **`migrate diff`** (Prisma 6.19.3): comando **read-only** que compara dos fuentes (`--from-...` / `--to-...`); flags disponibles: `--from-url`/`--to-url`, `--from-schema-datamodel`/`--to-schema-datamodel`, `--from-schema-datasource`/`--to-schema-datasource`, `--from-migrations`/`--to-migrations`, `--shadow-database-url`, `--script`, `--exit-code`.
- **`migrate resolve`** (Prisma 6.19.3): `--applied <name>` / `--rolled-back <name>` (+ `--schema`) para reconciliar historial; nunca editar `_prisma_migrations` a mano.
- **Constraints crudos documentados** (Prisma no los modela; pueden aparecer en `migrate diff`): índice parcial de designación (`WHERE state='ACTIVE'`), FK compuesta de referencia ACTIVE, CHECKs de no-autoabsorción / coherencia de redirección / procedencia de merge / cantidades de Collection.
- **Post-deploy, fuera de este runbook:** F2–F5 y migración de consumidores de lectura restantes (documento aparte cuando se planifiquen).
