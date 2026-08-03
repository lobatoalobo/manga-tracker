# Nakama — Product Design Document (PDD)

Fuente de verdad del producto. El objetivo es que **cualquier pantalla, flujo o componente pueda diseñarse e implementarse leyendo este documento**, sin tener que reconstruir el contexto desde conversaciones.

No es un ensayo. Son especificaciones concretas y accionables.

## Secciones (se cierran en orden)

| # | Sección | Archivo | Estado |
|---|---------|---------|--------|
| 1 | Flujos (User Flows) | [flujos.md](flujos.md) | 🟢 Completa — 8 User Flows + revisión de consistencia |
| 2 | Pantallas | [pantallas.md](pantallas.md) | 🟢 Las 8 con Mock v1 congelado (P-01…P-08) |
| 3 | Casos de uso | [casos-de-uso.md](casos-de-uso.md) | 🟢 9 fichas migradas (F-COM/F-CLI); F-COM-04/05 se descubren vía pantallas |
| — | **Revisión transversal** | [revision-transversal.md](revision-transversal.md) | 🟢 Cierre del arco → plan de implementación (inconsistencias · DT-01…05 · componentes · orden · diferibles) |
| 4 | Componentes | [componentes.md](componentes.md) | 🟢 UI Kit depurado — 11 componentes reales (C-00…C-11) + composiciones + lo movido a dominio |
| — | **Bloqueantes de implementación** | [dominio/](dominio/) | 🟢 3 artefactos: [acceso sin cuenta](dominio/acceso-sin-cuenta.md) ✅ · [modelo de pago](dominio/modelo-pago.md) ✅ general (falta `pilot.modoPago` de Crumb) · [máquina de estados](dominio/maquina-estados.md) ✅ |
| 5 | Especificación funcional por pantalla | — | ✅ Cubierta dentro de [pantallas.md](pantallas.md) |
| 6 | Mockups interactivos | — | 🟢 8 mocks v1 publicados (artefactos) |
| 7 | Implementación | — | ⬜ Pendiente (plan: [revision-transversal.md](revision-transversal.md) §4) |

Se cierra una sección antes de pasar a la siguiente (con excepciones deliberadas: los Casos de uso se adelantaron al documentar Flujos, y algunas fichas se descubren diseñando su pantalla).

> **Distinción clave.** **Flujo (User Flow)** = recorrido de una persona hacia una meta, cruza pantallas. **Caso de uso** = una operación puntual del dominio. **Automatización** = responsabilidad del sistema, sin usuario. Un flujo *encadena* casos de uso; una pantalla *implementa* pasos de varios flujos.

### Registros transversales

Cruzan todas las secciones, se mantienen vivos en paralelo:

- **[Decisiones congeladas](decisiones-congeladas.md)** — decisiones de producto ya tomadas, con ID estable (`D-001`…). Las fichas referencian por ID en vez de re-argumentar.
- **[Automatizaciones del sistema](automatizaciones.md)** — responsabilidades que el producto ejecuta por su cuenta (`SYS-01`…). No son User Flows.

## Convenciones

- **IDs estables**: User Flows `UF-<C|M><N>` · Casos de uso `F-<COM|CLI>-<NN>` · Pantallas `P-<NN>` · Automatizaciones `SYS-<NN>` · Decisiones `D-<NNN>`. Las demás secciones referencian por ID.
- **Meta primero (flujos)**: un User Flow nombra la meta del usuario, no una operación del sistema.
- **Responsabilidad, no implementación**: en automatizaciones se documenta *qué* garantiza, no *cómo* (Ivrea/Panini/API/CSV son intercambiables).

## Alma del producto (contexto, no spec)

Nakama recuerda **relaciones**, no pedidos. La edición semanal guarda las huellas de su comunidad. En el Workspace: *"Nakama muestra; la tienda decide"* — el producto aporta claridad y memoria operativa, nunca reemplaza el criterio comercial (no sugiere cantidades). Detalle en la nota de diseño, fuera de este PDD.
