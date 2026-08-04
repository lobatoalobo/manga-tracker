> **Documento histórico.** La fuente de verdad vigente para Retail es `docs/pdd/`.

# Retail Pilot Launch Plan — Slice: Retail Pilot Launch

> Plan de LANZAMIENTO del piloto (implementación + operación). No es un slice de funcionalidad.
> Alcance cerrado en [retail-pilot-launch-scope.md](retail-pilot-launch-scope.md). Aprobado; listo para implementar.

## 1. Objetivo del slice
Dejar a **Crumb operando una campaña de preventa real de punta a punta en Nakama**, y el uso **observable** mediante un script read-only — sin agregar capacidades de dominio. El slice entrega la *preparación completa + validación técnica + apertura*; el **inicio del piloto (Hito 2)** es un evento que luego observamos, no algo que el código pueda forzar (ver §6).

## 2. Principios y restricciones
- **No se agrega dominio:** ninguna tabla, migración de dominio, ni capacidad nueva.
- **No P1 / no comprobantes / no SELF_SERVICE / no cambios a `CheckoutMode`** (solo CONVERSATIONAL).
- **Observabilidad = un único script read-only parametrizable** sobre el ledger existente (`StoreOrder`/`StorePayment`): sin escrituras, sin UI, reportes repetibles.
- **Bootstrap sigue script-only** (sin UI global-admin nueva).
- **Verificación de host explícita** antes de toda corrida contra staging o prod (patrón de P0).
- **Rollback de código = solo para incidentes técnicos** (Clase 1 del triage); lo operativo se corrige operando.
- Se preservan datos reales (deshabilitar, no borrar).

## 3. Alcance
Definido y cerrado en el documento de alcance. **Incluye:** onboarding operativo de Crumb, config real, contenido real (campaña), observabilidad read-only, documentación (tienda/comprador/soporte/checklist), proceso de acompañamiento, validación técnica (Hito 1) y apertura. **Fuera:** todo lo listado en "Fuera de alcance" del scope (P1, SELF_SERVICE, CheckoutMode, dominio nuevo, UI de monitoreo, notificaciones-feature, multi-tienda, etc.).

## 4. Tareas por etapas

**Etapa 0 — Prerrequisitos y verificación (read-only, sin tocar prod)**
- **T0.1** Revisar `scripts/seed-crumb-commerce.ts`: confirmar idempotencia y que solo crea `Store`+perfil+OWNER (upserts). Aclarar el encabezado "seed de DESARROLLO" dado que se correrá contra prod — ajuste de **comentario/doc únicamente**, no de lógica.
- **T0.2** Verificar prerrequisitos de datos (consulta read-only): (a) el usuario **OWNER de Crumb existe** (se logueó al menos una vez); (b) los **volúmenes a ofertar existen** en el catálogo — o listar faltantes. **Bloqueante** si faltan (catálogo previo, fuera de este slice).
- *Salida:* GO/NO-GO de prerrequisitos.

**Etapa 1 — Observabilidad (un único script read-only) — código**
- **T1.1** `scripts/pilot-report.ts`: **un solo script parametrizable** (flags por slug y/o campaña), NO varios especializados. Emite en una corrida las 3 métricas críticas (% pagados, tiempo hasta pago, discrepancias realidad↔datos) + diagnósticas (RESERVED impagos, consultas por pedido). **Excluye por diseño** las órdenes marcadas como controladas (Hito 1). Solo `findMany`/`aggregate`/`$queryRaw SELECT`; sin escrituras ni tablas nuevas; salida markdown/stdout repetible.
- **T1.2** Validar el script contra **staging** con un escenario sembrado (patrón de QA de P0): números esperados, luego limpiar datos QA.
- *Gate:* `npm run check` verde; script probado en staging; verificación de que no hay una sola escritura.

**Etapa 2 — Documentación — docs**
- **T2.1** Runbook de la tienda (`docs/retail-pilot-store-runbook.md`): crear campaña, ofertas, publicar, ver reservas, **registrar pago**, preparar, entregar (sobre la UI existente).
- **T2.2** Guía del comprador (`docs/retail-pilot-buyer-guide.md`): reservar≠pagar, cómo pagar, cómo confirmar el pago.
- **T2.3** Playbook de soporte (`docs/retail-pilot-support-playbook.md`): quién observa, cadencia, captura de feedback + **tabla de triage de incidentes (4 clases)**.
- **T2.4** Checklist de lanzamiento go/no-go (`docs/retail-pilot-launch-checklist.md`).

**Etapa 3 — Ensayo general en staging (sin prod)**
- **T3.1** Correr todo el procedimiento contra **staging**: seed (con cuenta QA como OWNER) → config → campaña+ofertas de prueba → recorrido completo comprador→pago→`registerPayment`→PAID (+ opcional preparación/retiro) → correr `pilot-report` → limpiar datos QA. Valida el procedimiento entero antes de tocar prod.

**Etapa 4 — Onboarding en producción (operación; sin migración)**
- **T4.1** Bootstrap en **prod** (host verificado): `seed-crumb-commerce.ts` con `--owner <email real de Crumb>`. Verificación read-only post-bootstrap (perfil, membership OWNER, `enabled`).
- **T4.2** Config real de Crumb (OWNER, asistido) vía UI: WhatsApp, alias/instrucciones de pago, retiro, descripción. Revisar con la tienda.
- **T4.3** Campaña real + ofertas creadas por/con Crumb vía UI (requiere catálogo de T0.2).

**Etapa 5 — Validación técnica del lanzamiento en prod (Hito 1)**
- **T5.1** Recorrido controlado en prod con **comprador conocido**: reserva → "Cómo pagar" → pago (coordinado con Crumb) → `registerPayment` → PAID. **Marcar la orden como controlada** para excluirla de métricas; decidir con Crumb si se cancela o se conserva documentada.
- **T5.2** Correr `pilot-report` contra prod y confirmar que refleja el recorrido, sin discrepancias.
- *Práctica recomendada evidence-first:* hacerlo antes de abrir a compradores reales; el criterio final es el juicio del equipo.

**Etapa 6 — Apertura y observación (Hito 2)**
- **T6.1** Crumb **abre/publica** la campaña a compradores reales (operación). **Con esto se cierra el trabajo de ingeniería** (ver §6, Engineering Done).
- **T6.2** Observación con la cadencia definida (script + captura de feedback). El **primer pedido de un comprador real = Hito 2 / inicio del piloto** (ver §6, Pilot Running).

## 5. Riesgos
- **Catálogo incompleto** → bloquea ofertas. Mitigar en T0.2 como pre-requisito duro.
- **Correr el seed con el wrapper equivocado** (staging↔prod) → verificación de host explícita antes de cada corrida.
- **Header "de desarrollo" del seed** corriendo en prod → aclarado en T0.1; el script es apto (idempotente, sin datos falsos), pero su framing debe reflejar el uso real.
- **Orden controlada de Hito 1 contaminando métricas** → exclusión por diseño en T1.1 + marcado.
- **Crumb inactivo / sin comprador real** → Hito 2 no ocurre; es dependencia externa, no fallo del slice (no bloquea Engineering Done).
- **El loop de pago falla en la vida real** → es precisamente lo que el piloto mide; cubierto por el triage de incidentes.

## 6. Definición de terminación — Engineering Done vs Pilot Running

Dos conceptos **distintos y separados**, para que quede inequívoco cuándo termina el trabajo de ingeniería:

### Engineering Done (cuándo termina el trabajo de este slice)
El trabajo de ingeniería se considera **terminado** cuando se cumple todo lo siguiente — todo bajo control del equipo:
- Script `pilot-report` **read-only verificado**, probado en staging, `npm run check` verde, mergeado.
- Docs entregadas y revisadas (runbook tienda, guía comprador, playbook soporte+triage, checklist), mergeadas.
- **Ensayo general en staging** (Etapa 3) completado en verde de punta a punta.
- Prod: perfil de Crumb bootstrapeado, OWNER correcto, **config real cargada y revisada**, **campaña real publicada**.
- **Hito 1** (validación técnica) completado en prod y reflejado por `pilot-report`, sin discrepancias.
- Observabilidad operativa contra prod (excluyendo la orden controlada).
- **Campaña abierta a compradores reales** (T6.1).
- Sin cambios de dominio/esquema/migraciones; `CheckoutMode` intacto; sin P1/SELF_SERVICE.

En ese punto **el slice está terminado**. **El primer comprador real (Hito 2) NO es requisito de Engineering Done** — no depende del equipo y no bloquea el cierre del trabajo de ingeniería.

### Pilot Running (qué sigue después, sin ser trabajo de ingeniería)
Cerrado el trabajo de ingeniería, **el piloto entra en marcha**: es una fase de **observación y aprendizaje**, no de construcción.
- Se observa con la cadencia definida vía `pilot-report` + captura de feedback (tienda y comprador).
- El **Hito 2 (primer pedido de comprador real)** marca el *inicio efectivo del piloto* y arranca la ventana de aprendizaje de la estrategia — pero es un **evento observado**, no un entregable de ingeniería.
- Los incidentes se atienden por el **triage de 4 clases** (rollback de código solo para Clase 1).
- La evidencia acumulada alimenta la decisión —*evidence-first*— sobre el próximo slice (incluida la eventual habilitación de P1).

> Regla clara: **Engineering Done no espera a Hito 2.** El equipo entrega un piloto listo, validado y observable; que aparezca el primer comprador real pertenece a *Pilot Running*, no al cierre del trabajo técnico.

## 7. Plan de validación
- **Script:** revisión estática de que solo hay lecturas + prueba en staging con escenario sembrado (números esperados) + `npm run check`.
- **Procedimiento:** ensayo general completo en staging (Etapa 3) antes de prod.
- **Prod:** verificación read-only post-bootstrap; Hito 1 controlado; `pilot-report` confirma el estado.
- No se corre `next build` contra una base no aislada; el script read-only va por los wrappers con verificación de host.

## 8. Estrategia de despliegue
- **Artefactos de código (el script read-only) + docs** → un PR a `main`, **merge commit** (estándar), como cambio **no-dominio**. **No hay migración** (sin cambio de esquema) → **no aplica migrate-first**. El script no corre solo: se ejecuta a mano con wrapper + verificación de host.
- **Actos operativos en prod** (bootstrap, config, campaña, Hito 1, apertura) → pasos del runbook/checklist, **manuales y verificados**, fuera del deploy de código.
- **Orden:** mergear script+docs → ensayo staging → onboarding prod → Hito 1 → apertura.

## 9. Rollback (solo cambios técnicos — Clase 1)
- **Script/docs:** revert del PR (inertes; sin impacto runtime).
- **Bootstrap defectuoso en prod:** corregir datos vía UI o script correctivo puntual; si el perfil quedó mal, **deshabilitar** (`setCommerceEnabled false`) en vez de borrar (no se destruyen datos reales); re-ejecutar el seed corregido (idempotente). **Sin migración que revertir.**
- Todo lo operativo (config, campaña, orden controlada) **no es rollback de código**: se corrige operando (Clases 2–4 del triage).
