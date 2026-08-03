> **Documento histórico.** La fuente de verdad vigente para Retail es `docs/pdd/`.

# Alcance — Slice: Retail Pilot Launch

> Documento de ALCANCE (cerrado). No es Execution Plan ni implementación.
> Cambio de etapa: dejamos de construir el sistema; ahora lanzamos el primer piloto real.

## Naturaleza del slice
Slice de **puesta en marcha**, no de funcionalidad. Entregable = **un piloto real existiendo y siendo observable**, con las capacidades que P0 y los slices previos ya entregaron. Trabajo dominado por operación, datos y documentación; el único código admisible es **read-only** (observar el uso), nunca de dominio.

## Objetivo
Que **Crumb opere una campaña de preventa real, de punta a punta, dentro de Nakama**, y que podamos **observar y aprender** de ese uso.

## Qué incluye

**1. Onboarding técnico-operativo (operación, no feature)**
- Ejecutar en prod el bootstrap del `StoreCommerceProfile` de Crumb (`scripts/seed-crumb-commerce.ts` — validar/ajustar antes de correr; sigue **script-only**, sin UI global-admin).
- Dueño de Crumb con cuenta y como **OWNER**.
- Verificación post-bootstrap read-only (perfil, membership OWNER, `enabled`).

**2. Configuración inicial real (datos)**
- Cargar los datos reales de Crumb con la UI existente (WhatsApp, alias/instrucciones de pago, instrucciones de retiro, descripción pública) y revisarlos con la tienda (primer test de H2).

**3. Contenido real (acción de Crumb, nosotros facilitamos)**
- Acompañar a Crumb a crear **una campaña real con ofertas reales** en el panel existente.
- Dependencia: los volúmenes a ofertar deben existir en el catálogo (si no, es trabajo de catálogo previo, fuera de este slice pero bloqueante).

**4. Observabilidad — solo scripts read-only**
- Instrumentar la lectura de las **3 métricas críticas** (% pagados, tiempo hasta pago, discrepancias de estado) + diagnósticas (RESERVED impagos, consultas por pedido) mediante **scripts de consulta read-only** sobre el ledger existente (`StoreOrder`/`StorePayment`).
- **Sin página interna, sin tablas nuevas, sin migraciones, sin mutaciones.** Producen **reportes repetibles**. Minimizamos código a propósito.
- **Diferido explícito:** una UI de monitoreo se evaluará *solo si* aparecen varias tiendas o el monitoreo manual deja de alcanzar. No ahora.

**5. Documentación para la tienda (runbook)**
- Guía corta "cómo operar tu preventa en Nakama": crear campaña, cargar ofertas, publicar, ver reservas, **registrar un pago**, preparar y entregar. Sobre la UI que ya existe.

**6. Guía para el comprador**
- Reservar ≠ pagar; cómo pagar (alias/instrucciones/WhatsApp); cómo confirmar que el pago quedó registrado. Ataca H1.

**7. Proceso de acompañamiento y soporte**
- Quién observa, con qué cadencia, cómo se captura el feedback (preguntas ya definidas en la estrategia).
- Procedimiento de incidentes triado (ver "Procedimiento ante incidentes").

**8. Checklist de lanzamiento (go/no-go)**
- Verificable: perfil bootstrapeado, OWNER correcto, config completa y revisada, catálogo disponible, campaña real publicada, **validación técnica realizada**, docs entregadas, scripts de observabilidad andando, soporte asignado.

## Definición de éxito — dos hitos distintos

Se separan explícitamente porque **miden cosas diferentes**:

### Hito 1 — Validación técnica del lanzamiento
Un **recorrido completo realizado por nosotros o con un comprador conocido/controlado**: reserva → "Cómo pagar" → pago → `registerPayment` → estado PAID (y, opcionalmente, preparación/retiro).
- **Qué demuestra:** que el **sistema funciona** de punta a punta con datos reales de Crumb.
- **Rol:** es una **práctica recomendada para reducir el riesgo del primer piloto real**, no una condición rígida ni un tilde obligatorio. En condiciones normales debería realizarse **antes** de abrir la campaña a compradores reales; el criterio final, sin embargo, sigue siendo *evidence-first* y el juicio del equipo.

### Hito 2 — Inicio del piloto
El **primer pedido realizado por un comprador real** (no nosotros, no controlado) dentro de una **campaña real publicada de Crumb**.
- **Qué demuestra:** que el **piloto comenzó** — existe adopción real.
- **Rol:** es el evento que marca "el piloto existe" y arranca la ventana de aprendizaje de la estrategia.

> La validación técnica puede pasar sin que el piloto empiece (si ningún comprador real aparece); y lo esperable, en condiciones normales, es que la campaña no se abra a compradores reales antes de haberla hecho. Por eso son hitos separados, no uno solo — el juicio del equipo, con criterio evidence-first, decide.

**Además, para considerar el slice completo:** las 3 métricas críticas son observables vía script; tienda y comprador tienen su guía; el equipo tiene proceso de acompañamiento y soporte.

## Procedimiento ante incidentes — triage, no rollback por defecto

**Principio:** el rollback de código **no es parte del flujo operativo normal**; es una herramienta reservada a incidentes técnicos reales. Ante un problema, primero se **clasifica**:

| Clase | Ejemplos | Respuesta |
|---|---|---|
| **1 · Incidente técnico** | bug, 5xx, `P2022`, corrupción de datos, exposición de datos | Diagnóstico técnico y escalamiento. **Único caso** donde el rollback de código es herramienta disponible (promote/revert; la columna aditiva permanece). |
| **2 · Error operativo de la tienda** | alias mal cargado, olvidó registrar un pago, precio equivocado en una oferta | Corrección de datos/operación por la tienda (asistida si hace falta) con la UI existente + refuerzo del runbook. No es problema del sistema; no hay rollback. |
| **3 · Discrepancia realidad vs datos** | pagó pero figura impago (o viceversa), stock que no coincide | Reconciliación: investigar la causa, corregir con el flujo existente (p. ej. registrar el pago faltante) y **registrar el caso como aprendizaje** (H5). No hay rollback. |
| **4 · Comprensión del comprador** | no entendió reserva≠pago, no supo cómo pagar | Mejorar la guía/comunicación del comprador; feedback a producto (H1/H2). No es incidente técnico; no hay rollback. |

Solo si la clasificación cae en **Clase 1** entra en juego el rollback de código. Las clases 2–4 se resuelven operando, no revirtiendo.

## Fuera de alcance (explícito)
- **P1 / comprobantes**, **SELF_SERVICE**, **cualquier cambio a `CheckoutMode`** (se mantiene solo CONVERSATIONAL).
- **Cualquier capacidad nueva de dominio**, tabla o migración de dominio (la observabilidad es read-only y no crea modelo).
- **Página/UI de monitoreo** (diferida; hoy solo scripts).
- **Notificaciones como feature** (el aviso en el piloto es humano/manual, parte del soporte).
- **Onboarding self-serve / UI global-admin de bootstrap** (sigue script-only).
- **Segunda/tercera tienda**, storefront público rediseñado, integraciones de cobro, marketing/escala.
- **Mejoras del panel de la tienda** (bandeja transversal, etc.): si el uso real revela fricción, se decide como slice posterior.

## Dependencias / riesgos a resolver antes de arrancar
- **Catálogo de Crumb:** los volúmenes a ofertar deben existir (bloqueante si faltan).
- **Cuenta y disponibilidad de Crumb:** contraparte activa y dispuesta a dar feedback.
- **Validar `seed-crumb-commerce.ts`** antes de correrlo en prod (idempotencia, datos correctos).
- **Primer recorrido controlado:** el Hito 1 se hace con comprador conocido antes de exponer a compradores reales (Hito 2).
