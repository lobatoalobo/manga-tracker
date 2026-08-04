# Bloqueante 3 · Máquina de estados de promesa y pago

Artefacto de dominio: el **backbone**. Define el ciclo de vida de una **promesa** (cumplimiento) y su **faceta de pago**, cómo se **derivan** las transiciones de pago del `modoPago`, y los **mapeos estado → etiqueta** que consumen las pantallas. Es genérico sobre los tres modos ([Bloqueante 2](modelo-pago.md)); **no asume cuál usará Crumb**. Absorbe [DT-04](../decisiones-congeladas.md) y resuelve la parte de dominio de [DT-05](../decisiones-congeladas.md).

---

## Unidad y agregación

- **Promesa** = persona + **un ejemplar** + tienda. Es la **unidad de la máquina**: cada promesa tiene un estado de cumplimiento.
- **Pedido** = la canasta que una persona reservó de una vez = **conjunto de promesas**. Su estado es **derivado** (todas *retiradas* → cumplido; mezcla → parcial).
- **Pago:** cada promesa lleva `precio` y `modoPago`; el **pedido agrega** `total / pagado / saldo`. Los **cargos se disparan por promesa** según su fase y su modo, y se **presentan agregados** a la persona. Esto admite el override de `modoPago` por tomo sin casos especiales.

---

## Faceta A · Cumplimiento

**Estados:**
- **reservado** — la promesa nació ([D-011](../decisiones-congeladas.md), P-05). El ejemplar está prometido; la mercadería no llegó.
- **apartado** — llegó la mercadería y la tienda separó el ejemplar para la persona (P-07). *(Intermedio; en la UI de v1 se fusiona con el aviso — ver transición.)*
- **listo_para_retirar** — apartado **+ avisado**; habilita P-08 y abre la compuerta de cobro por llegada ([D-014](../decisiones-congeladas.md)).
- **retirada** ✓ — cumplida (P-08). La "buena muerte".
- **cancelada** ✗ — la persona la dio de baja ([F-CLI-04](../casos-de-uso.md), [D-013](../decisiones-congeladas.md)).
- **caída** ✗ — la tienda no puede cumplirla (faltante que no llega, P-07).
- **vencida** ✗ — expira por inacción (SYS-02). *Modelada, con disparador automático diferido en v1 (ver Fuera de alcance).*

**Diagrama:**
```
                 P-07 apartar          P-07 avisar            P-08 entregar
 reservado ──────▶ apartado ──────▶ listo_para_retirar ──────▶ retirada ✓
    │                  │                     │
    │ baja cliente     │ baja cliente        │ (no self-service: contactar tienda)
    ▼                  ▼                     │
        cancelada ✗ ◀──┘                     │
                                             │ SYS-02 timeout (diferido v1)
    │ faltante no llega (baja tienda, P-07)  ▼
    └──────────────▶ caída ✗            vencida ✗
```
> En v1, P-07 realiza **apartar + avisar** en un solo gesto: `reservado → listo_para_retirar` (pasando por *apartado* de forma transitoria). *apartado* se mantiene en el modelo para el caso "preparar igual" (aparta lo llegado y avisa parcial).

**Transiciones · actores:**

| Transición | Actor | Dónde |
|---|---|---|
| crear (→ reservado) | Cliente/Sistema | P-05 (nace en el acto, D-011) |
| reservado → apartado → listo_para_retirar | Comerciante | P-07 ("apartar y avisar") |
| listo_para_retirar → retirada | Comerciante | P-08 ("Entregar"), con la compuerta de pago |
| reservado/apartado → cancelada | **Cliente** | P-06 ("dar de baja"); **solo hasta *apartado*** (ver invariante 5) |
| reservado/apartado → caída | **Comerciante** | P-07 (dar de baja un faltante que no llega) |
| listo_para_retirar → vencida | **Sistema** (SYS-02) | timeout sin retiro — **diferido en v1** |

---

## Faceta B · Pago (derivada de `modoPago`)

**Estados:** `sin_cargo` → `por_pagar` → `comprobante_enviado` → `parcial` → `pagado` (según [Bloqueante 2](modelo-pago.md)).

**Dos puntos de cargo, derivados del modo:**

| Punto de cargo | Fase que lo dispara | `sin_pago_previo` | `sena` | `total` |
|---|---|---|---|---|
| **CP1 · al reservar** | entra a `reservado` (P-05) | — (sin_cargo) | **seña** exigible | **total** exigible |
| **CP2 · a la llegada** | entra a `listo_para_retirar` (P-07) | **total** exigible | **saldo** exigible | — (ya saldado) |

Dentro de cada punto de cargo, la faceta avanza: `por_pagar → comprobante_enviado → (validar) → pagado` (o `parcial` si quedó saldo, típico tras una seña).

**Transiciones · actores** (idénticas para CP1 y CP2, cambia el monto):

| Transición | Actor | Dónde |
|---|---|---|
| exigir cargo (→ por_pagar) | Sistema (deriva de `modoPago` × fase) | P-05 (CP1) / P-07 (CP2) |
| enviar comprobante (por_pagar → comprobante_enviado) | Cliente | P-05 (CP1) / P-06 (CP2) |
| validar (comprobante_enviado → pagado \| parcial) | Comerciante | P-08 (o antes) |
| rechazar (comprobante_enviado → por_pagar) | Comerciante | — |
| registrar pago (por_pagar → pagado \| parcial) | Comerciante | P-08 (mostrador) |

---

## Compuertas entre facetas

1. **Nacimiento:** crear la promesa (reservado) **dispara CP1** según `modoPago`.
2. **Llegada:** pasar a `listo_para_retirar` **dispara CP2** según `modoPago`.
3. **Entrega:** `listo_para_retirar → retirada` exige, en el **camino normal**, `saldo == 0`. **Excepción deliberada del comerciante:** entregar con `saldo > 0`, con **confirmación explícita + trazabilidad** (queda *retirada* con **deuda registrada**). *Nakama ordena y advierte; no bloquea de forma absoluta* (ver [Bloqueante 2](modelo-pago.md)).

---

## Muertes de la promesa

| Rama | Quién dispara | Desde | Dinero (v1) |
|---|---|---|---|
| **cancelada** | Cliente (P-06) | reservado / apartado | Si hubo seña/pago (modos `sena`/`total`), queda **saldo a favor a resolver** — su devolución está **fuera de v1** (se registra, no se procesa). |
| **caída** | Comerciante (P-07) | reservado / apartado | Ídem: si se cobró por adelantado, saldo a favor a resolver (fuera de v1). |
| **vencida** | Sistema (SYS-02) | listo_para_retirar | Ídem. Disparador automático **diferido en v1**. |

Las tres son **terminales**: no hay resurrección en v1.

---

## Invariantes

1. **Una promesa está en exactamente un estado de cumplimiento y un estado de pago** a la vez.
2. **`reservado` es inmediato al confirmar** ([D-011](../decisiones-congeladas.md)); no hay solicitud pendiente ni aprobación.
3. **`retirada` solo desde `listo_para_retirar`** ([D-014](../decisiones-congeladas.md)).
4. **Entrega normal exige `saldo == 0`**; la única forma de entregar con saldo es la **excepción con traza**.
5. **Cancelación self-service solo hasta `apartado`** — en `listo_para_retirar` y más allá, dar de baja deja de ser self-service (se contacta a la tienda). [D-013](../decisiones-congeladas.md): nunca exige motivo.
6. **Los estados terminales no transicionan** (retirada/cancelada/caída/vencida).
7. **La faceta de pago no puede adelantarse a su punto de cargo** — no hay `por_pagar` antes de que el modo × fase lo exija.
8. **Cumplimiento y pago son ortogonales salvo en las compuertas** definidas arriba; ninguna otra dependencia cruzada.
9. **Toda transición es de un actor identificado** (cliente / comerciante / sistema); las del sistema son **derivadas**, no arbitrarias.

---

## Mapeo estado → etiqueta (dominio → cliente → tienda)

El cliente nunca ve vocabulario operativo (*apartado*, *faltante*); ve el estado combinado en lenguaje humano (alimenta el **HeroEstado** de P-06). La tienda ve el estado de trabajo.

| Cumplimiento | + Pago | **Cliente** (P-06) | **Tienda** (P-01/07/08) |
|---|---|---|---|
| reservado / apartado | sin_cargo · parcial | "Esperando — te lo guardamos" | reservado · por preparar |
| listo_para_retirar | por_pagar | "¡Llegaron! — a pagar" | listo · a cobrar |
| listo_para_retirar | comprobante_enviado | "Comprobante enviado — por validar" | por validar |
| listo_para_retirar | pagado | "Pagado — a retirar" | listo · pagado |
| retirada | pagado (o con deuda) | "Ya los retiraste ✓" | entregado · cumplida |
| cancelada | — | "Diste de baja tu pedido" | cancelada |
| caída | — | "No pudimos cumplirlo" | caída · dado de baja |
| vencida | — | "Reserva vencida" | vencida |

> Estos mapeos son **datos de dominio**, no componentes (ver [componentes.md](../componentes.md) → "Movido al dominio"). `Pill`, HeroEstado y PedidoPorPersona los renderizan.

---

## Qué pantalla consume qué

| Pantalla | Consume |
|---|---|
| **P-05** | Crea la promesa (reservado); dispara **CP1** según `modoPago`. |
| **P-01** | Muestra promesas (reservado) por tomo/persona; evidencia de pago según modo. |
| **P-07** | reservado → apartado → listo_para_retirar; **caída** (dar de baja faltante); dispara **CP2**. |
| **P-06** | Estado combinado (mapeo cliente); acciones: **cancelar** (hasta apartado), **enviar comprobante** (CP activo). |
| **P-08** | listo_para_retirar → **retirada**; valida/registra pago; **compuerta** (saldo 0 o excepción con traza). |
| **SYS-02** | **vencida** (diferido v1). |
| **SYS-03** | Avisos en transiciones clave: nace, listo_para_retirar (CP2 "pasá a pagar"), pagado. |

---

## Fuera de alcance v1 (expreso)

- **Vencimiento automático** (SYS-02 → *vencida*): la máquina lo modela, pero **v1 no auto-vence**; una promesa estancada se resuelve manualmente.
- **Devoluciones / notas de crédito** cuando muere una promesa ya cobrada (seña/total): se **registra** el saldo a favor, no se procesa.
- **Resurrección / reactivación** de promesas terminales.
- **UI del override de `modoPago` por tomo** (el dominio lo admite).
- **Cantidad >1 con llegada parcial dentro de una línea** (borde ya diferido en P-07): el faltante es por promesa/línea completa en v1.
- **`pilot.modoPago`**: sin definir hasta confirmar con Agustín; la implementación del piloto no se activa hasta elegirlo.
