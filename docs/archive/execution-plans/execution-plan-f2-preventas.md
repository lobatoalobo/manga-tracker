> **Execution Plan de un workstream independiente.** No forma parte de Fase 0 Retail.

# Execution Plan — F2 hasta Preventas

**Manual de ejecución.** Este documento guía la implementación de los próximos meses. **No redefine arquitectura**: asume la [North Star](../../vision-arquitectura.md) como hecho cerrado y el [roadmap F2–F5](#) como dado. Su función es ayudar a tomar decisiones *durante la implementación* sin volver a discutir la visión.

Complementos ya existentes que este plan da por sentados:
- **Constitución técnica:** `docs/vision-arquitectura.md` (cerrada).
- **Runbook de despliegue:** `docs/deployment-runbook-v1.md` (13 migraciones gated).
- **Auditoría técnica Pre-F2** (evidencia base de riesgos).

**Alcance del arco:** `Engineering Cleanup → F2 → F3 → F4 → F5 → Estabilización de catálogo (esp. AR) → MVP Preventas`.

**Herramientas de verificación de referencia** (se citan en todas las etapas):
- `npm run check` = tsc + tests unitarios.
- `npm run test:identity-it` = suite de integración contra Postgres efímero.
- Migraciones **gated** → se aplican en staging vía runbook, nunca local ni directo a prod.
- `reconciliationSink` (de F1) = métrica de divergencia lectura Collection vs legado.
- Feature flags para todo cutover de escritura/lectura.

---

## Cómo leer este documento

Cada etapa responde las mismas 9 preguntas, en este orden:

1. **Objetivo** — qué *propiedad nueva* adquiere el sistema (no la lista de tareas).
2. **Definition of Done** — las *propiedades* que deben cumplirse (no una checklist de tareas).
3. **Riesgos** — técnicos, cómo detectarlos temprano, cómo mitigarlos.
4. **Dependencias** — qué depende de qué, qué va en paralelo, qué nunca empieza antes.
5. **Validación** — criterios *verificables* (tests, migraciones, métricas, smoke, manual).
6. **Deuda técnica** — resolver ya / postergable / nunca aceptar.
7. **ADRs** — cuándo probablemente haga falta uno.
8. **Cambios prohibidos** — buenas ideas que **no** deben hacerse todavía.
9. **Criterio para pasar de etapa** — cuándo (y solo cuándo) se puede empezar la siguiente.

---

# Etapa 0 — Engineering Cleanup

*Prerrequisito de F2. Paga los 3 ítems de alta prioridad de la auditoría y tiende la red de seguridad antes de tocar el eje de colección.*

### 1. Objetivo — propiedad nueva
El sistema adquiere una **red de caracterización sobre el camino legado de colección**: cualquier cambio futuro (F2/F3) que altere el comportamiento observable de `getCollectionItems` **falla un test** en vez de llegar en silencio a un usuario. Secundariamente, cierra dos exposiciones conocidas (admin fail-open, cron huérfano).

### 2. Definition of Done (propiedades)
- El comportamiento observable del camino legado de colección está **fijado por tests golden** que corren en CI y en el harness efímero.
- `isAdmin` es **fail-closed**: sin `ADMIN_EMAIL` seteada, nadie es admin (verificado por test).
- No existe ninguna ruta de cron **huérfana**: `mangakas` está agendada o eliminada, sin referencias colgantes.
- (Opcional, no bloqueante) La auth de cron es un helper único; `app/actions.ts` puede seguir monolítico.

### 3. Riesgos
| Riesgo | Detección temprana | Mitigación |
|---|---|---|
| `ADMIN_EMAIL` no está seteada en algún entorno → el admin real pierde acceso al hacer fail-closed | Verificar env en Vercel (staging+prod) **antes** de mergear EC-2 | Confirmar env presente en ambos entornos como precondición del merge |
| Los golden tests fijan un comportamiento *con bugs* como si fuera correcto | Revisar los casos límite (tomos huérfanos, ediciones sin Work, `anilistId` negativo) al escribirlos | Documentar en el test cuáles golden son "comportamiento actual, no necesariamente deseado" |

### 4. Dependencias
- **EC-1 (caracterización)** no depende de nada y es **prerrequisito duro de F2**.
- EC-2, EC-3, EC-4 son independientes entre sí y de EC-1 → **paralelizables**, mergeables ya.
- EC-5 (partir `app/actions.ts`) es **diferible**; si se hace, nunca en medio de un cutover.

### 5. Validación
- **Tests:** suite de caracterización verde en `npm run check`; test unitario de `isAdmin` (env ausente → `false`, correcto → `true`).
- **Manual:** confirmar `ADMIN_EMAIL` en Vercel staging y prod; confirmar en `vercel.json` el estado final del cron `mangakas`.
- **Sin migraciones.**

### 6. Deuda técnica
- **Resolver ya:** EC-1, EC-2, EC-3.
- **Postergable:** EC-4 (helper de cron), EC-5 (partición de `app/actions.ts`).
- **Nunca aceptar:** entrar a F2 sin la red de caracterización (EC-1). Es el único innegociable de esta etapa.

### 7. ADRs
- **Ninguno.** Es limpieza mecánica, sin decisión arquitectónica.

### 8. Cambios prohibidos
- **No** aprovechar para "mejorar de paso" la lógica de colección legada: caracterizar ≠ refactorizar. Solo se fija comportamiento.
- **No** reescribir `app/actions.ts` completo ahora (tentación de "ya que estoy"): mover el piso mientras se escriben golden tests invalida la red.
- **No** introducir una librería de validación todavía (es deuda media, no de esta etapa).

### 9. Criterio para pasar a F2
Empezar F2 **solo cuando**: EC-1 está verde y estable, la migración de Slice 8 está **aplicada en staging** (vía runbook), y la equivalencia de lectura de F1 sigue verde. EC-2/EC-3 mergeados. EC-4/EC-5 son irrelevantes para el gate.

---

# Etapa F2 — Backfill (Collection autoritativa sobre el histórico)

### 1. Objetivo — propiedad nueva
El sistema adquiere la propiedad de que **la posesión histórica del usuario existe en Collection, no solo en `OwnedVolume`**. Tras F2, la fachada (Opción D) ya lee Collection como autoritativa donde antes solo había legado. **Deja resuelto:** el histórico de posesión deja de vivir *exclusivamente* en el store legado. **Habilita:** cambiar el camino de escritura (F3) sabiendo que el punto de partida de datos ya está en el eje nuevo. Sigue siendo aditivo: no cambia lo que el usuario hace.

### 2. Definition of Done (propiedades)
- Todo `OwnedVolume` **mapeable sin ambigüedad** a un `Volume` tiene su `OwnershipPosition`/`Acquisition` correspondiente en Collection.
- El backfill es **idempotente**: re-ejecutarlo no produce cambios (0 filas nuevas).
- El backfill es **reversible quirúrgicamente**: todas sus filas son identificables y borrables por namespace (`acquisitionKey LIKE 'backfill:%'`) sin tocar adquisiciones reales de retiros PICKED_UP.
- Los `OwnedVolume` **ambiguos/huérfanos no fueron inventados**: están reportados, no escritos.
- La lectura de la fachada tras el backfill es **equivalente** al camino legado para la muestra verificada (divergencia explicada o nula).

### 3. Riesgos
| Riesgo | Detección temprana | Mitigación |
|---|---|---|
| Mapping `OwnedVolume→Volume` incorrecto → posesión atribuida al tomo equivocado | **Dry-run F2.1** (solo lectura) reporta % mapeado limpio vs ambiguo vs huérfano **antes** de escribir | Gate de decisión: si el % ambiguo es alto, se corrige el mapping antes de F2.2 |
| Backfill no idempotente → doble conteo en re-run | IT que corre el backfill dos veces y compara | Reusar `applyAcquisition` de Slice 8 (`createMany skipDuplicates`), nunca `try create/catch` |
| Volumen grande → timeout o carga en prod | Medir duración en staging con dataset real | Lotes + `dbRetry` + resumible; correr en ventana de bajo tráfico |
| Rollback difícil si algo sale mal | Ensayar el `DELETE` namespaced en staging | Namespace `backfill:` desde el primer diseño |

### 4. Dependencias
- Depende de: **Etapa 0 (EC-1)**, migración Slice 8 aplicada en staging.
- Orden interno estricto: **F2.0 (ADR) → F2.1 (dry-run) → [gate] → F2.2 (executor) → F2.3 (equivalencia)**.
- **Nunca** empezar F2.2 (escritura) antes de que F2.1 valide los números de mapping.
- No hay paralelismo interno relevante; F2.1 es una compuerta obligatoria.

### 5. Validación
- **Migración:** Slice 8 aplicada en staging desde cero (ya cubierta por runbook).
- **Tests (IT, Postgres efímero):** backfill de dataset conocido produce posiciones esperadas; **re-run idempotente** (sin cambios); ambiguos no escritos.
- **Métricas:** dry-run reporta 0 pendientes limpios *después* del backfill; `reconciliationSink` reporta divergencia ~0 en la muestra.
- **Smoke (staging):** para N usuarios reales, la Share y el conteo "Tomos poseídos" coinciden antes y después.
- **Manual:** revisar el reporte de ambiguos/huérfanos y confirmar que ninguno se escribió.

### 6. Deuda técnica
- **Resolver ya:** idempotencia y namespace de rollback (son la seguridad de la etapa, no negociables).
- **Postergable:** resolución fina de ambiguos/huérfanos (pueden quedar reportados y tratarse por curaduría luego; no bloquean).
- **Nunca aceptar:** escribir un `OwnershipPosition` "adivinando" el `Volume` de un `OwnedVolume` ambiguo. Viola el principio inmutable #11 (no adivinar).

### 7. ADRs
- **F2.0 = ADR de backfill** (probable y recomendado): congela reglas de mapping, namespace de clave, política de ambigüedad e idempotencia. Es una decisión con consecuencias de datos → amerita ADR.

### 8. Cambios prohibidos
- **No** empezar a escribir a Collection desde la UI todavía (eso es F3): F2 es solo backfill, cero cambio en el camino de escritura del usuario.
- **No** borrar ni modificar `OwnedVolume` en esta etapa: sigue siendo la fuente de escritura viva.
- **No** intentar resolver los ambiguos "a mano rápido" mezclando curaduría con el backfill automático: separá el reporte del ejecutor.
- **No** optimizar prematuramente la fachada para listas grandes (eso llega en F3 con la paginación).

### 9. Criterio para pasar a F3
Empezar F3 **solo cuando**: F2.3 muestra **equivalencia con divergencia 0** (o toda divergencia explicada por ambigüedad conocida y aceptada) **sostenida**, el `DELETE` de rollback fue **ensayado en staging**, y el reporte de ambiguos está revisado. Sin equivalencia verde, no se toca el camino de escritura.

---

# Etapa F3 — Disposal + Cutover de escritura (Collection pasa a ser el origen)

### 1. Objetivo — propiedad nueva
El sistema adquiere la propiedad de que **la mutación de posesión es un hecho de primera clase en Collection**: adquirir *y dar de baja* un tomo se expresan como hechos durables (Acquisition/Disposal), no como un booleano legado. **Deja resuelto:** el usuario ya escribe al eje nuevo. **Habilita:** retirar la lectura legada (F4) y, después, el store legado (F5). Es la etapa de **mayor riesgo** del arco.

### 2. Definition of Done (propiedades)
- Collection puede representar la **remoción** de un tomo (Disposal), simétrica a la adquisición, idempotente y sin bajar de cero.
- El toggle de posesión del usuario **escribe a Collection** (detrás de flag); con flag off, el comportamiento legado queda intacto.
- Todos los consumidores de **lectura** que hoy leen `OwnedVolume` directo están migrados a la fachada `lib/collection-read/`.
- La fachada **pagina server-side** donde alimenta una lista grande (no materializa toda la posesión en memoria para esos consumidores).
- Toda operación de escritura de posesión es **idempotente por `operationKey`** y reversible.

### 3. Riesgos
| Riesgo | Detección temprana | Mitigación |
|---|---|---|
| Cambiar el camino de escritura corrompe posesión de usuarios reales | Rollout gradual (staging → cohorte → 100%) con `reconciliationSink` monitoreado | **Flag** + **dual-write transitorio**: apagar el flag revierte sin deploy |
| Disposal baja `quantity` bajo cero o rompe invariantes bajo concurrencia | IT de carreras con lock; test de "baja repetida" | Reusar patrón de lock ordenado + idempotencia de Slice 8 |
| Migrar un consumidor de lista grande sin paginación → degradación de performance | Medir latencia del consumidor antes/después | Paginación server-side **antes** de migrar cualquier lista grande |
| Divergencia entre dual-write (legado y Collection quedan inconsistentes) | `reconciliationSink` detecta divergencia por usuario | Definir en el ADR quién gana ante divergencia; alertar sobre umbral |

### 4. Dependencias
- Depende de: **F2 completa (equivalencia verde)**, EC-1.
- Orden interno: **F3.0 (ADR) → F3.1 (Disposal domain/infra, sin cablear) → F3.2 (cutover toggle, flag) → F3.3 (migración de consumidores + paginación)**.
- **Paginación server-side** es prerrequisito *dentro* de F3.3 para cualquier consumidor de lista grande.
- Los consumidores de **solo lectura** de F3.3 pueden migrarse en paralelo entre sí (uno por slice, independientes) y solaparse con F3.2.
- **Nunca** cablear el toggle a Collection (F3.2) antes de que Disposal (F3.1) exista y esté testeado.

### 5. Validación
- **Migración:** la migración aditiva de Disposal corre desde cero en efímero.
- **Tests (IT):** Disposal idempotente, no baja bajo cero, carreras con lock; ida y vuelta (marcar→ver→desmarcar→ver) con flag on; con flag off, comportamiento legado idéntico.
- **Métricas:** `reconciliationSink` con divergencia bajo umbral durante el rollout; latencia de consumidores migrados sin regresión.
- **Smoke (staging):** con flag on, marcar/desmarcar refleja correctamente en la fachada; por consumidor migrado, equivalencia con el output legado.
- **Manual:** verificar el rollout por cohortes antes del 100%.

### 6. Deuda técnica
- **Resolver ya:** idempotencia del toggle, invariante `quantity ≥ 0`, paginación antes de listas grandes.
- **Postergable:** unificar el estilo de todos los consumidores de lectura (algunos pueden quedar en la fachada con adaptadores mínimos por un tiempo).
- **Nunca aceptar:** un cutover **sin flag** o sin dual-write que no se pueda revertir en caliente. En la etapa de mayor riesgo, la reversibilidad instantánea es innegociable.

### 7. ADRs
- **F3.0 = ADR de Disposal + estrategia de cutover** (necesario): modelo de baja, invariantes, y la decisión dual-write vs cutover directo, incluyendo la política ante divergencia. Es la decisión arquitectónica central de la etapa.
- Posible **mini-ADR de paginación** de la fachada si introduce un contrato de lectura nuevo (opcional; solo si la decisión no es obvia).

### 8. Cambios prohibidos
- **No** retirar la lectura legada todavía (eso es F4): durante F3 el legado sigue siendo backstop.
- **No** dejar de escribir `OwnedVolume` todavía si se eligió dual-write: cortar el dual-write es F5.
- **No** hacer cutover directo sin flag "porque los tests pasan": el riesgo es de datos de producción, no de lógica.
- **No** aprovechar para agregar features de colección nuevas (ejemplares, pool, multi-canal): fuera de alcance.

### 9. Criterio para pasar a F4
Empezar F4 **solo cuando**: F3.2 está al **100% de usuarios y estable** durante una ventana de observación con divergencia ~0, **todos** los consumidores de lectura están en la fachada (ninguno lee `OwnedVolume` directo), y la paginación está en producción para las listas grandes. Si algún consumidor sigue leyendo el legado directo, F4 no puede empezar.

---

# Etapa F4 — Collection-only reads (retirar el backstop legado de lectura)

### 1. Objetivo — propiedad nueva
El sistema adquiere la propiedad de que **el camino de lectura ya no depende de `OwnedVolume`**. **Deja resuelto:** la lectura de posesión es soberana del eje nuevo. **Habilita:** dejar de escribir y luego eliminar el store legado (F5).

### 2. Definition of Done (propiedades)
- La fachada sirve posesión **solo desde Collection**; el adapter legado ya no participa de la lectura.
- La vista Collection-only es **equivalente** a la vista mezclada para la muestra, con divergencia bajo umbral sostenida en una ventana de observación.
- El código de merge/ambigüedad Opción D queda **eliminado** (ya innecesario) una vez estable.

### 3. Riesgos
| Riesgo | Detección temprana | Mitigación |
|---|---|---|
| Backfill incompleto → un usuario "pierde" tomos al quitar el backstop | `reconciliationSink` monitoreado con flag on antes del 100% | **Flag**: apagar reactiva el backstop legado al instante |
| Eliminar el adapter legado demasiado pronto → no hay vuelta atrás barata | No borrar código (F4.2) hasta cumplir la ventana de observación de F4.1 | Separar F4.1 (flip con flag) de F4.2 (borrado) por una ventana explícita |

### 4. Dependencias
- Depende de: **F2 completa + F3 completa** (todos los consumidores en la fachada) + ventana de observación con divergencia ~0.
- Orden interno: **F4.1 (flip Collection-only, flag) → [ventana de observación] → F4.2 (borrado del adapter legado)**.
- **Nunca** hacer F4.2 (borrado) antes de que F4.1 sea estable.

### 5. Validación
- **Tests:** la fachada Collection-only pasa la suite; tras F4.2, tests actualizados sin referencias al adapter legado.
- **Métricas:** divergencia bajo umbral durante toda la ventana de observación de F4.1.
- **Smoke (staging):** vista Collection-only iguala la mezclada para la muestra.
- **Sin migraciones** (es cambio de código de lectura).

### 6. Deuda técnica
- **Resolver ya:** nada nuevo; es consolidación.
- **Postergable:** limpieza cosmética de tests/estructura tras el borrado.
- **Nunca aceptar:** borrar el adapter legado (F4.2) sin haber cumplido la ventana de observación estable de F4.1.

### 7. ADRs
- **Ninguno probable.** F4 ejecuta una decisión ya tomada en ADR-011 (Opción D → Collection-only). Si apareciera una decisión nueva, sería señal de que algo no estaba previsto: pausar y evaluar.

### 8. Cambios prohibidos
- **No** dropear `OwnedVolume` todavía (eso es F5): en F4 aún se escribe.
- **No** saltear la ventana de observación "porque la muestra dio bien un día": la propiedad es *estabilidad sostenida*, no un snapshot.

### 9. Criterio para pasar a F5
Empezar F5 **solo cuando**: F4.1 (Collection-only) estuvo estable durante la ventana de observación con divergencia ~0, y **ninguna** parte del sistema lee `OwnedVolume`. F4.2 (borrado del adapter) completado.

---

# Etapa F5 — Drop `OwnedVolume` (retiro del store legado)

### 1. Objetivo — propiedad nueva
El sistema adquiere la propiedad de **un único eje de posesión**: `OwnedVolume` deja de escribirse y luego se elimina. **Deja resuelto:** la dualidad de ejes de colección desaparece por completo. **Habilita:** un modelo de datos de colección limpio sobre el cual construir sin arrastrar el legado.

### 2. Definition of Done (propiedades)
- Ninguna parte del código **escribe** `OwnedVolume` (fin del dual-write).
- El modelo/tabla `OwnedVolume` **no existe** en el schema tras la migración destructiva.
- El drop se ejecutó bajo runbook, con **backup restaurable verificado** como precondición.
- Los smoke tests de colección post-drop están **verdes**.

### 3. Riesgos
| Riesgo | Detección temprana | Mitigación |
|---|---|---|
| Drop irreversible con algún lector/escritor residual olvidado | Grep exhaustivo + ventana de retención tras F5.1 (dejar de escribir) antes de dropear | Separar F5.1 (dejar de escribir, flag) de F5.2 (drop) por ventana de retención |
| Necesidad de rollback tras el drop (irreversible por migración) | GO/NO-GO del runbook antes de ejecutar en prod | Único rollback = **restore desde backup**; backup verificado como precondición dura |

### 4. Dependencias
- Depende de: **F4 completa y estable**.
- Orden interno: **F5.1 (dejar de escribir, flag) → [ventana de retención + backup verificado] → F5.2 (drop destructivo, runbook)**.
- **Nunca** ejecutar F5.2 sin backup restaurable verificado y sin la ventana de retención cumplida.

### 5. Validación
- **Migración:** `migrate deploy` de la migración destructiva OK en staging; schema sin `OwnedVolume`.
- **Tests:** suite de colección verde sin `OwnedVolume`.
- **Smoke (prod, no destructivo):** flujos de colección verdes tras el drop.
- **Manual (runbook):** GO/NO-GO de destino, backup validado, confirmación de dos personas para el paso destructivo.

### 6. Deuda técnica
- **Resolver ya:** eliminar toda referencia residual a `OwnedVolume` antes del drop.
- **Postergable:** limpieza de scripts/una-vez que tocaban `OwnedVolume` (archivar).
- **Nunca aceptar:** ejecutar el drop sin backup verificado. Es el único paso irreversible del arco; el descuido acá no tiene forward-fix.

### 7. ADRs
- **Ninguno probable.** Es la ejecución final de ADR-011. El *procedimiento* vive en el runbook, no en un ADR.

### 8. Cambios prohibidos
- **No** apurar el drop para "cerrar la deuda": la etapa destructiva hereda su seguridad de la estabilidad acumulada, no de la prisa.
- **No** editar `_prisma_migrations` a mano ni saltear el runbook (regla ya establecida en el runbook).

### 9. Criterio para pasar a Estabilización de catálogo / Preventas
El eje de colección está unificado (F5 done). A partir de acá, **Preventas puede comenzar en paralelo con la estabilización de catálogo**, sujeto a su propio gate (ver más abajo). No hay dependencia de F5 hacia gobernanza.

---

# Etapa — Estabilización de catálogo (especialmente AR)

*Fase B de la North Star, acotada a lo que Preventas necesita. No es "catálogo soberano completo": es "catálogo estable y confiable, con foco en el catálogo argentino".*

### 1. Objetivo — propiedad nueva
El sistema adquiere la propiedad de que **el catálogo argentino es confiable como base comercial**: las ediciones AR sobre las que se montarán preventas son estables, correctas y no cambian de identidad bajo los pies. **Deja resuelto:** el riesgo de montar dinero sobre datos volátiles. **Habilita:** el MVP de Preventas.

### 2. Definition of Done (propiedades)
- Las ediciones AR relevantes tienen **identidad propia estable** (post F2–F5, sin depender de `anilistId` para su unificación).
- Los datos que Preventas va a **snapshotear** (título, edición, tomo) son correctos y estables para el catálogo AR.
- No hay dedup/reclasificación masiva pendiente que pueda mover identidades AR durante una preventa activa.

### 3. Riesgos
| Riesgo | Detección temprana | Mitigación |
|---|---|---|
| Una fusión/split de identidad AR ocurre *durante* una preventa activa | Auditoría de identidades AR antes de habilitar Preventas | Congelar operaciones de identidad sobre ediciones con preventa activa (banda roja del futuro Trust Engine; por ahora, disciplina manual) |
| Datos AR incompletos (fechas, numeración) llegan malos al snapshot | `npm run audit` sobre el catálogo AR | Curar el catálogo AR antes de habilitar preventas sobre esas series |

### 4. Dependencias
- Depende de: **F2–F5 completos** (identidad y colección soberanas).
- **Puede solaparse con el arranque de Preventas** una vez que el catálogo AR está estable (no requiere estabilizar el catálogo *global* para empezar preventas AR).
- **Nunca** habilitar una preventa sobre una serie cuyo catálogo AR todavía está en curaduría activa.

### 5. Validación
- **Métricas/audit:** `npm run audit` limpio sobre el subconjunto AR; conteo de identidades AR sin contradicciones.
- **Manual:** revisión de las series AR candidatas a preventa.
- **Sin migraciones nuevas necesarias** (usa el modelo ya existente).

### 6. Deuda técnica
- **Resolver ya:** correcciones de identidad AR que afecten series candidatas a preventa.
- **Postergable:** estabilización del catálogo no-AR (internacional), que Preventas MVP no necesita.
- **Nunca aceptar:** habilitar una preventa sobre datos AR que se sabe inestables.

### 7. ADRs
- **Ninguno probable** por la estabilización en sí. Si aparece una decisión de *modelo* de catálogo (p. ej. títulos multi-idioma propios como estructura nueva), eso sería un ADR — pero **está fuera del alcance mínimo de Preventas** y no debe forzarse acá.

### 8. Cambios prohibidos
- **No** intentar la soberanía completa del catálogo (Fase B entera: creadores propios, sinopsis curadas, multi-idioma) antes de Preventas: Preventas solo necesita **AR estable**, no el catálogo terminado.
- **No** empezar Contributions-puerta-única / Provenance / Trust Engine acá: no son prerrequisito de Preventas (ver North Star §9, Fase C).

### 9. Criterio para pasar a Preventas
Ver gate de Preventas.

---

# Etapa — MVP de Preventas

*Fase C de la North Star. Avanza en paralelo con la estabilización de catálogo, no espera a la gobernanza.*

### 1. Objetivo — propiedad nueva
El sistema adquiere la propiedad de un **flujo comercial de preventa end-to-end funcionando sobre el catálogo AR**, aislado de la evolución del catálogo por su propia disciplina de snapshots. **Deja resuelto:** la primera vía de monetización. **Habilita:** validar el modelo de negocio y, más adelante, el marketplace.

### 2. Definition of Done (propiedades)
- Una preventa **congela** (snapshot inmutable) título, precio y referencia de edición al crearse: no lee el catálogo vivo.
- El flujo comercial y físico (reserva → pago manual → arribo → preparación → retiro) funciona con sus invariantes (contadores-as-truth, ledger append-only, dinero en `Int` centavos).
- Una preventa activa **no se rompe** aunque el catálogo mute por detrás (probado).
- El retiro (`PICKED_UP`) proyecta a Collection idempotentemente (Slice 8, ya en `main`).

### 3. Riesgos
| Riesgo | Detección temprana | Mitigación |
|---|---|---|
| Snapshot mal tomado → la preventa muestra datos que luego divergen del catálogo | IT que muta el catálogo tras crear la preventa y verifica que la preventa no cambia | La disciplina de snapshot ya existe en Retail; testear explícitamente el aislamiento |
| Errores de dinero (redondeo) | Tests de contadores/pagos en centavos | Dinero como `Int` centavos (ya es el estándar Retail) |
| Concurrencia en reservas/pagos | IT de carreras con `FOR UPDATE` | Locks ordenados ya establecidos en Retail |

### 4. Dependencias
- **Requiere:** F2–F5 completos **y** catálogo estable, especialmente el argentino.
- **NO requiere:** Contributions como puerta única completa, Provenance completa, Trust Engine completo. (North Star §9, razón técnica: **aislamiento por snapshots**.)
- **Puede desarrollarse en paralelo** con la estabilización de catálogo no-AR y con cualquier trabajo de gobernanza futuro.
- **Nunca** habilitar preventas sobre series con catálogo AR inestable.

### 5. Validación
- **Tests (IT):** flujo completo reserva→pago→arribo→preparación→retiro; **aislamiento por snapshot** (mutar catálogo no altera preventa); idempotencia de operaciones por `operationKey`.
- **Migraciones:** las de Retail (Slices 1–7) + Slice 8, aplicadas vía runbook.
- **Smoke (staging, flujo completo; prod, no destructivo):** crear una preventa de prueba, recorrer estados, verificar proyección a Collection.
- **Métricas:** contadores derivados coinciden con el ledger; `paidCents`/`paymentStatus` recomputados, no independientes.

### 6. Deuda técnica
- **Resolver ya:** cualquier bug de invariante de contadores/dinero/idempotencia (es un dominio con dinero real).
- **Postergable:** importación automática de planillas (explícitamente diferida por el usuario), tabla+filtros de compras (Fase 2), canales adicionales.
- **Nunca aceptar:** que una preventa lea el catálogo vivo en lugar de su snapshot. Rompe el aislamiento que justifica toda la independencia de esta etapa.

### 7. ADRs
- **Probable solo si** aparece una decisión comercial estructural nueva (p. ej. política de reembolsos, multi-tienda). El flujo base ya está diseñado en los slices de Retail; no forzar ADRs para lo ya decidido.

### 8. Cambios prohibidos
- **No** adelantar **marketplace** multi-tienda (Fase F): Preventas MVP es de una tienda/flujo, no un marketplace.
- **No** introducir la **importación automática de planillas** todavía (diferida explícitamente).
- **No** cablear Preventas para que **dependa de la gobernanza del catálogo**: rompería la independencia que la habilita.
- **No** acoplar Retail a Collection ni al catálogo como *módulo* (solo como *dato* vía snapshot/evento).

### 9. Criterio de cierre
Preventas MVP se considera cerrado cuando el flujo end-to-end está verde en staging (flujo completo) y validado en prod (no destructivo), con el aislamiento por snapshot probado y la proyección a Collection funcionando. A partir de acá, el arco de este manual termina; lo que sigue (marketplace, gobernanza completa, comunidad) se retoma desde la North Star con nuevos planes de ejecución.

---

# Reglas transversales de ejecución (válidas en todas las etapas)

### Cambios prohibidos globales (resistir durante toda la ejecución)
- **No reabrir la North Star** salvo conflicto real con un principio inmutable, y siempre por el proceso de enmienda (nunca por deriva).
- **No adelantar gobernanza** (Contributions-puerta-única, Policy Engine, Trust Engine, Provenance completa): pertenecen a las Fases D/E, después de este arco.
- **No automatizar decisiones de catálogo** todavía: no hay Trust Engine en este arco. Toda operación sensible de identidad/datos es manual y revisada.
- **No introducir nuevas fuentes de complejidad** sin evidencia (principio "evidencia ≥2 antes de abstraer"): ni librerías nuevas, ni capas nuevas, ni fuentes externas nuevas que no pida una etapa.
- **No mezclar refactor con cutover**: las etapas de riesgo (F3/F5) no llevan refactors oportunistas.

### Disciplina de reversibilidad (aplica a cada etapa)
Todo cambio de escritura/lectura de producción va detrás de **flag** con rollback en caliente, excepto el drop destructivo final (F5.2), que se protege con **backup verificado + runbook + GO/NO-GO**. Ningún paso irreversible se ejecuta sin que las etapas previas hayan probado, en producción, los supuestos que lo hacen seguro.

### Filosofía de gates (por qué son propiedades, no tareas)
Ninguna etapa pasa a la siguiente "porque terminamos las tareas". Pasa cuando la **propiedad** que la define está probada y estable (equivalencia sostenida, ventana de observación cumplida, divergencia bajo umbral). El costo de esperar una ventana de observación es siempre menor que el de propagar una corrupción al eje que apenas unificamos.

---

*Este es un manual de ejecución, no un documento de arquitectura. Asume la North Star (`docs/vision-arquitectura.md`) como hecho cerrado. Si durante la implementación aparece una tensión con la visión, se resuelve por ADR — no reabriendo este plan ni la constitución, salvo el proceso de enmienda previsto.*
