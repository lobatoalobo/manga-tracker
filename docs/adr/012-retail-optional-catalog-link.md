# ADR-012: Retail — vínculo de catálogo opcional en la oferta de preventa

- **Estado**: **Aceptado**
- **Fecha**: 2026-07-30
- **Relacionado**: [ADR-010](010-slice8-collection-projection.md) (Collection: `OwnershipPosition` + `Acquisition`), [ADR-011](011-collection-read-side.md) (read-side unificado de colección)
- **Alcance**: decisión arquitectónica. **No** documenta la implementación (fases, firmas, migración concreta) — eso vive en el diseño del slice y en el historial de commits.

---

## Contexto

Nakama nació como un sistema de **gestión de colecciones**: el catálogo bibliográfico (`Work` → `PublisherEdition` → `Volume`) es la autoridad sobre *qué obras existen*, y la posesión del usuario se ancla a esa identidad de catálogo.

Sobre esa base se construyó **Retail**, el subsistema de **preventas** de una tienda. El caso de negocio central de una preventa es **anunciar y vender un lanzamiento que todavía no salió al mercado**: la tienda publica los próximos títulos aproximadamente una semana antes de que existan físicamente y, casi siempre, **antes de que el catálogo los conozca**. Las fuentes que pueblan el catálogo (Ivrea para próximos, Whakoom para el resto) no cubren de forma confiable ese adelanto, y en muchos casos la obra es de una editorial aún no indexada.

Retail heredó del catálogo un acoplamiento fuerte: cada oferta (`PreorderOffer`) y cada línea de pedido (`StoreOrderLine`) **requerían** un `Volume` preexistente. La creación de una oferta obligaba a resolver el ítem contra el catálogo en el momento de publicarla.

---

## Problema

El acoplamiento **oferta → Volume obligatorio** hace estructuralmente imposible el caso de negocio para el que existe la preventa:

- No se puede publicar una oferta de un lanzamiento que el catálogo todavía no tiene.
- Las salidas disponibles eran todas malas: **hardcodear** títulos en un seed, **precargar** volúmenes por código, o forzar a la tienda a fabricar entradas de catálogo bibliográficamente pobres solo para poder vender. Todas contaminan la autoridad del catálogo con datos comerciales provisorios y no verificados.

Al mismo tiempo, aflojar ese acoplamiento no puede romper dos garantías ya existentes:

1. **Collection** (ADR-010) proyecta los retiros (`PICKED_UP`) de Retail a la posesión del usuario, y está **estrictamente indexada por `volumeId`**. Una línea sin `Volume` no tiene a dónde proyectarse.
2. La proyección debe ser robusta: no debe **fallar** ni **reintentar en loop** ante una línea que legítimamente todavía no tiene identidad de catálogo.

La pregunta arquitectónica es entonces: **¿quién es dueño de la descripción de lo que se vende cuando el catálogo todavía no lo conoce, y cómo convive eso con una Collection que exige identidad de catálogo?**

---

## Decisión

### 1. `Offer.volumeId` (y `OrderLine.volumeId`) pasan a ser **opcionales**

El vínculo con el catálogo deja de ser un requisito de existencia de la oferta y pasa a ser una **identidad de catálogo opcional**: puede estar presente (oferta *vinculada*), ausente hoy y resoluble mañana (oferta *manual*), o no aplicar. Una oferta puede describir y vender un ítem comercial **aunque todavía no esté resuelto contra el catálogo**. El catálogo sigue siendo la **autoridad bibliográfica cuando el `Volume` existe**; su ausencia no bloquea la operación comercial.

### 2. Los **snapshots** son el registro histórico inmutable de la descripción comercial publicada

La oferta ya congelaba, al publicarse, una copia de los datos que ve el comprador (título, número, editorial, ISBN, precios). Elevamos ese snapshot de *optimización de lectura* a **fuente autoritativa de la descripción comercial**: es el **registro histórico inmutable de lo que la tienda publicó y el comprador aceptó**, independientemente de que exista o no un `Volume`.

Esto tiene una consecuencia deliberada: la oferta es **auto-descriptiva**. No necesita al catálogo para decir qué se vendió. Cuando hay `Volume`, el catálogo aporta autoridad bibliográfica; cuando no lo hay, el snapshot **es** la descripción. En ningún caso el snapshot se reescribe retroactivamente si el catálogo cambia: describe el acto comercial, no el estado actual del catálogo.

### 3. Se preserva la **separación entre Retail y Collection**

Retail es el **proceso comercial** (describir, vender, cobrar, entregar). Collection es la **verdad de posesión** del usuario, anclada a la identidad de catálogo. Son responsabilidades distintas y se mantienen desacopladas:

- Retail puede operar un ciclo comercial completo (reserva → pago → preparación → retiro) **sin `Volume`**.
- Collection **no** relaja su invariante: sigue indexada estrictamente por `volumeId`. No se le agregan posiciones "sin catálogo".

La ausencia de `Volume` no se filtra hacia Collection como un caso degradado que deba absorber; se trata en la **frontera** entre ambos.

### 4. `PENDING_CATALOG_RESOLUTION` — un resultado **benigno** en esa frontera

Cuando un retiro corresponde a una línea sin `Volume`, la proyección hacia Collection produce un resultado explícito y benigno: **`PENDING_CATALOG_RESOLUTION`**.

- **No es un error** y **no es corrupción** (se distingue explícitamente de `CORRUPT_SOURCE`, que sí es alarma).
- **No aplica** posesión y **no reintenta** en el barrido (evita loops inútiles sobre algo que aún no puede resolverse).
- El hecho de retiro queda **durablemente registrado** y se podrá proyectar en el futuro, sin alterar el snapshot, cuando exista identidad de catálogo.

Es la expresión de dominio de que "todavía no hay a dónde proyectar" es un **estado esperado y estable**, no una falla. El backlog de estos pendientes es observable de forma read-only para el monitoreo del piloto.

### 5. **No** se introdujo una entidad `Product`

Se evaluó introducir una entidad intermedia (`Product`) que representara el "ítem comercial" y a la que la oferta siempre apuntaría (resuelto o no contra el catálogo). **Se descartó.**

La `Offer` con su snapshot **ya cumple naturalmente** el rol de describir el ítem comercial. Introducir `Product` sería una **abstracción accidental**: hoy no existe identidad, ciclo de vida ni reutilización comercial divergentes que la justifiquen (N=1). Agregaría una tabla, una indirección y un acoplamiento nuevos para no aportar ninguna capacidad que la oferta auto-descriptiva no dé ya. Siguiendo el principio de **evidencia antes de abstraer**, la decisión es no crear la abstracción hasta que aparezca divergencia real (p. ej. varias ofertas compartiendo y evolucionando un mismo producto con identidad propia).

---

## Consecuencias

**Positivas**

- El caso de negocio central de la preventa —vender un lanzamiento aún no catalogado— queda soportado **naturalmente**, sin hardcodeos, seeds ni contaminación del catálogo con datos comerciales provisorios.
- La oferta es auto-descriptiva: su descripción comercial no depende del catálogo, y su registro histórico es inmutable frente a cambios posteriores del catálogo.
- Retail y Collection quedan más claramente desacopladas; la invariante volume-keyed de Collection permanece intacta.
- La proyección es robusta ante la ausencia de catálogo: distingue "pendiente" de "corrupto" y no genera reintentos inútiles.
- El modelo se mantiene simple: sin entidad nueva ni indirección prematura.

**Costos y compromisos**

- Aparece un **estado durable nuevo**: retiros de líneas sin `Volume` que **aún no** contribuyen a la posesión del usuario en Collection. Es esperado, pero requiere **observabilidad** (provista, read-only) para vigilar que el backlog no crezca sin control.
- La **resolución tardía** (asociar más adelante una línea/oferta manual a un `Volume` y entonces proyectar a Collection) queda **fuera de alcance** de esta decisión, deliberadamente. La forma exacta de esa resolución —y si será por línea o por oferta— se decidirá con evidencia, no ahora.
- **Compatibilidad hacia adelante obligatoria una vez que exista la primera línea o retiro manual**: columnas `volumeId` nullable, lecturas tolerantes, proyector tolerante y exclusión del barrido dejan de ser reversibles. A partir de ese punto, "rollback" ya no significa revertir el esquema (los datos manuales quedarían ilegibles) sino **detener la creación** de nuevas ofertas manuales mientras se sigue operando lo existente.
- La descripción comercial de una oferta manual **no** tiene la autoridad bibliográfica de un `Volume` del catálogo (p. ej., no hay verificación por autor). Es una decisión aceptada: el catálogo sigue siendo la autoridad cuando existe; la oferta manual es la mejor descripción disponible mientras no exista.
