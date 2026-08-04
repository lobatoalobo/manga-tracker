# Bloqueante 1 · Acceso a reservas sin cuenta (DT-01)

Artefacto de dominio/infraestructura, no ensayo. Define cómo **nace, se recupera y se mantiene privado** el pedido de una persona sin que exista una cuenta. Cierra [DT-01](../decisiones-congeladas.md).

---

## Decisión

El acceso a un pedido se resuelve con un **enlace-capacidad por pedido** (*capability URL*): al confirmar el pedido, Nakama genera un **token no adivinable** propio de ese pedido; **la URL que lo contiene ES la credencial**. Quien tiene el link ve y gestiona ese pedido; nadie más. **No hay cuenta, contraseña ni login. No existe un índice "mis reservas"** de una persona.

Se separan **dos mecanismos independientes** que suelen confundirse:

| | Mecanismo | Capa | Da acceso al pedido |
|---|---|---|---|
| **M1 · Recuperación + privacidad** | **Token-capacidad por pedido** en la URL, entregado por WhatsApp; **revocable/rotable** por la tienda | Servidor | **Sí** — es la única llave |
| **M2 · Recuerdo de contacto** | **Datos de contacto guardados en el dispositivo** (local, con opt-in explícito), para autocompletar la próxima vez | Cliente (device-local) | **No** — solo autocompleta campos |

M2 es **conveniencia, no identidad**: no viaja al servidor como credencial, no se sincroniza entre dispositivos, no permite encontrar ni abrir ningún pedido.

**Rotación/revocación (M1):** aunque el enlace no caduque por tiempo, la tienda puede **invalidar el token actual y generar uno nuevo** si el link fue compartido o expuesto. El token anterior **deja de autorizar**; el nuevo enlace se reenvía por WhatsApp. No se agrega recuperación self-service ni expiración automática en v1.

---

## Estados

**Del token de acceso (M1):**
- **activo** — autoriza y abre [P-06](../pantallas.md) con el estado vivo del pedido; permite acciones (dar de baja, adjuntar comprobante) mientras la promesa no haya finalizado.
- **finalizado (solo lectura)** — la promesa llegó a un estado final (*retirada / cancelada / caída / vencida*); el link **sigue abriendo P-06** mostrando el desenlace, sin acciones.
- **revocado** — la tienda rotó el token: **deja de autorizar** (el link viejo ya no abre el pedido; solo el nuevo token vale). Es el único caso en que un link deja de funcionar.
- *(No hay expiración automática por tiempo en v1.)*

**Del recuerdo de contacto (M2):** *ausente* (dispositivo sin datos) / *presente* (autocompleta). No es una máquina de estados; es presencia/ausencia local.

---

## Transiciones · quién puede dispararlas

| Transición | Quién | Cuándo |
|---|---|---|
| **Crear token** (nace el acceso) | **Sistema** | Al confirmar el pedido en P-05. Una sola vez; el token es inmutable y ligado a ese pedido. |
| **Entregar el link** | **Sistema** ([SYS-03](../automatizaciones.md)) + **P-05** | SYS-03 lo manda por WhatsApp con cada aviso; P-05 lo ofrece en el acuse ("Seguir mi pedido"). |
| **Abrir el pedido** | **Quien tenga el link** | Cualquiera que posea la URL (es *capability*). Abre P-06. |
| **activo → finalizado** | **Derivado** del estado de la promesa | Cuando la promesa alcanza un final (lo dispara la máquina de estados, no el acceso). |
| **Rotar/revocar token** (activo → revocado + nuevo token activo) | **Comerciante** | Cuando el link se compartió/expuso. El token viejo deja de autorizar; el nuevo se reenvía por WhatsApp. Manual, sin expiración automática. |
| **Guardar contacto (M2)** | **Cliente/navegador**, con **opt-in explícito** | Solo si la persona marcó "Recordar mis datos en este dispositivo" en P-05. |
| **Editar/borrar contacto (M2)** | **Cliente/navegador** | La persona puede editar o borrar los datos guardados en su dispositivo cuando quiera. |
| **Autocompletar (M2)** | **Cliente/navegador** | Al abrir P-04/P-05 en el mismo dispositivo, si hay datos guardados. |
| **Reenviar el link perdido** | **Comerciante** (operativo) | Desde su Workspace reenvía el aviso por WhatsApp. No hay self-service de recuperación en v1. |

---

## Invariantes

**De acceso y privacidad:**
1. **No adivinable** — token aleatorio, **≥128 bits** de entropía, **no derivado** de datos del pedido/persona/número/fecha.
2. **Un token ↔ un pedido** — no es un índice: desde un token **no se pueden enumerar** otros pedidos, ni el histórico de la persona, ni datos de otra persona, ni el Workspace del comerciante.
3. **Nombre + WhatsApp NO dan acceso** — no se puede "buscar mi pedido por teléfono". El único acceso es el link. (Evita enumeración y protege privacidad.)
4. **M2 no es credencial** — el recuerdo device-local autocompleta campos; nunca autoriza ver un pedido ni identifica a la persona ante el servidor.
5. **El link no caduca por tiempo** en v1; solo cambia a *solo lectura* al finalizar la promesa, o a *inválido* si la tienda lo **revoca/rota**. Fuera de esos casos, un link siempre resuelve a un P-06 coherente.
6. **Sin verificación de identidad** — Nakama no valida que quien abre el link sea "la persona"; la posesión del link **es** la autorización (modelo capability, aceptado para v1).

**Técnicas (M1):**
7. **Sin PII ni identificadores predecibles en la URL** — nada de nombre, teléfono, número de pedido correlativo ni fecha; solo el token opaco.
8. **Almacenamiento hasheado** — el servidor guarda el **hash** del token y compara por hash; una fuga de DB no expone links vivos.
9. **El token completo no aparece en logs ni analítica** — se redacta/omite en logs de servidor, access logs, y eventos de analítica.
10. **Política de referrer restrictiva en P-06** — `Referrer-Policy: no-referrer` (o equivalente) para que el token no se filtre por el header `Referer` hacia terceros/recursos externos.

**Del recuerdo local (M2) — conservador:**
11. **Opt-in explícito** — solo se guarda si la persona marca **"Recordar mis datos en este dispositivo"**; por defecto no se guarda nada.
12. **Editable y borrable** — la persona puede ver, editar y **borrar** los datos guardados en su dispositivo en cualquier momento.
13. **No permite encontrar ni abrir pedidos** — M2 solo autocompleta campos de contacto; jamás lista, recupera ni abre un pedido.
14. **No se sincroniza entre dispositivos** — es estrictamente local al navegador/dispositivo.

---

## Qué pantalla consume cada estado

| Pantalla | Qué consume |
|---|---|
| **P-05 · Reserva** | *Crea* el token al confirmar; ofrece "Seguir mi pedido" (el link); **autocompleta** contacto desde M2 si existe; **guarda** contacto en M2 **solo con el opt-in** "Recordar mis datos en este dispositivo". |
| **P-06 · Vista del pedido** | Se entra **por el link**; resuelve el token → renderiza ese pedido. *activo* → acciones habilitadas; *finalizado* → solo lectura; *revocado* → no abre. Único punto de gestión del cliente. Sirve con `Referrer-Policy: no-referrer`. |
| **P-04 · Página pública** | Puede **pre-cargar** contacto (M2) en la selección; recorrer sigue siendo anónimo (no requiere token). |
| **SYS-03 · Avisos** | Incluye el **link directo al pedido** en cada aviso por WhatsApp (nacimiento, llegó la mercadería, etc.). Reenvía el link vigente tras una rotación. |
| **Workspace del comerciante** (P-01 por-persona / detalle del pedido) | Acciones operativas sobre el pedido: **reenviar el link** y **rotar/revocar el token** si se expuso. |

---

## Fuera de v1 (expreso)

- **Cuentas / login / contraseña.**
- **Índice "mis reservas"** multi-pedido de una persona (cross-pedido, cross-dispositivo).
- **Recuperación self-service** del link perdido sin WhatsApp (p. ej. "buscámelo por teléfono/DNI"). En v1 lo **reenvía el comerciante**.
- **Rotación / expiración / revocación** de tokens.
- **Verificación de identidad** (OTP por WhatsApp, validación del número).
- **Recuerdo cross-dispositivo** del contacto (M2 es solo local).

---

## Riesgo aceptado (anotado para el futuro)

Un *capability link* puede reenviarse o filtrarse: quien lo tenga, entra. Se acepta en v1 por bajo impacto (un pedido de manga, sin datos sensibles ni pago automatizado) y a cambio de **cero fricción y cero cuentas**. Mitigaciones futuras si hiciera falta: OTP por WhatsApp para acciones sensibles, o cuentas opcionales que "adopten" los pedidos existentes por su token. Ninguna bloquea v1.
