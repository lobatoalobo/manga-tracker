# Backlog — Nakama

> **Fuente de verdad del backlog.** Este archivo reemplaza tener que preguntar
> "¿qué hay pendiente?". Está organizado por prioridad: primero el camino a MVP,
> después pre-launch, features, y todo lo diferido / a futuro.
>
> **Mantenerlo vivo:** al cerrar un ítem, marcarlo ✅ con fecha (no borrarlo —
> sirve de historial). Al sumar trabajo nuevo, agregarlo en la sección que
> corresponda. Convención de estado: 🔴 crítico · 🟡 importante · 🟢 nice-to-have ·
> ✅ hecho · ⏳ en curso · ❄️ diferido/futuro.
>
> Última actualización: **2026-06-24**.

---

## 1. Camino a MVP (orden definido por el usuario)

Con estos 4 pasos el usuario considera la app un MVP. Detalle en `docs/analisis-funkos.md`, `docs/plan-internacional.md`.

1. **Apagar AniList en prod (cutover).** `ANILIST_OFF=1` en Vercel Production + redeploy. Código y data ya en prod; géneros enriquecidos. → *verificar que el flag esté prendido en prod.*
2. **Ivrea sin bugs.** Fuente nacional confiable: pasar smoke + regression (`docs/smoke-tests.md`, `docs/regression-tests.md`, `docs/qa-checklist.md`).
3. **1 editorial extranjera sin fallas.** Ediciones JP+EN+ES sobre el mismo `Work` (ver §6 Internacional). Candidata operativa: VIZ (EN). Necesita flag de origen correcto (NO 🇦🇷).
4. **Funko Pops (alcance limitado).** Modelo *waves* (ver §6 Funkos).

Catálogo del MVP = **solo Ivrea** (`CATALOG_PUBLISHERS = ["Ivrea Argentina"]`). Para sumar editoriales se amplía esa lista. Post-MVP: resto de nacionales (Panini/Ovni) → resto de extranjeras.

---

## 2. Pre-launch (production-readiness) — **prioridad sobre gamification**

No se anuncia hasta tener Full QA. Detalle y estado fino en la memoria `pre-launch`.

### 🔴 Críticas
1. **AniList en runtime** — ✅ mitigado (sin llamadas en path de usuario con `ANILIST_OFF`). Queda solo admin/batch. No borrar `lib/anilist.ts`.
2. **Frescura del catálogo** — ✅ automatizado (`scripts/refresh-catalog.mjs` + tarea programada). *Pendiente usuario: que la tarea diaria corra (PC prendida).*
3. **Legal mínimo** — ✅ /privacidad, /terminos, borrar cuenta. *Pendiente menor: `NEXT_PUBLIC_CONTACT_EMAIL` en Vercel.*
4. **Moderación + anti-abuso UGC** — ✅ rate limiting + validación de URLs + moderación admin (indie/tiendas).

### 🟡 Importantes (no bloqueantes)
5. **Costo a escala** — estimar Neon (autosuspende, compute/hora) + Vercel a cientos/miles de usuarios.
6. **Monitoreo de errores** — ✅ Sentry integrado (NO-OP sin DSN). *Pendiente config: `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` en Vercel.*
7. **Backups** — confirmar retención point-in-time de Neon y saber restaurar.
8. **Performance** — paginar server-side cuando el browse "All" crezca (hoy manda ~1800 obras al cliente).

**Roll-out sugerido:** beta cerrada (amigos) + Full QA → resolver 🔴 → soft launch (link sin anuncio) con Sentry → anuncio público tras 1–2 semanas limpias.

---

## 3. Backlog de features (priorizado)

1. **Próximos a salir** — badge "Pronto" por `releaseDate` + filtro en la barra. (núcleo hecho; revisar filtro)
2. **Búsqueda** — cards con chip 🇦🇷 Nacional primero, resto alfabético.
3. **Colección — estado + progreso** — Incompleta/Al día + leído (owned/total, read/owned). Barra fina al pie de cada card (largo = %owned, color = estado) + "leídos x/owned".
4. **Serie preferida** (1 por usuario) — flag `favorite`, borde dorado, fijada primera, primera al compartir.
5. **Índice alfabético en A-Z** — saltar/filtrar por letra inicial.
5b. **Tipo de contenido** — enum `Work.type` (MANGA | COMIC | LIGHT_NOVEL | ARTBOOK | DATABOOK | OTHER). Clasificar por heurística de título + override manual; chips/filtros "solo manga / cómics / novelas / todo". **Nada se borra** — la detección de cómics se recicla para taguear. (`flag-comics` solo lista.)

---

## 4. Notificaciones

Núcleo ✅ (push agrupado anti-spam, Deseados "Salió en Argentina", silenciar por serie, próximo tomo + reediciones por modelo local con cron diario). Detalle en memoria `notifications-plan`.

❄️ **Diferido:**
- Email (**Resend**) + **digest/resumen semanal**.
- #3 "completá la serie" y #4 "serie completada" (casi gratis sobre el motor de tomos nuevos).

---

## 5. Backlog diferido (no olvidar)

- Insights de colección; comparar colecciones entre amigos; feed de novedades por editorial.
- Recomendaciones (AniList), tags de AniList, reseñas más visibles.
- Upload real de portadas para Autores independientes (Vercel Blob).
- **Compras Fase 2** — `/compras` rediseñado (compra agrupada hecho); tabla + filtros diferidos a Fase 2 (memoria `compras-fase2`).
- **Géneros** — subir cobertura (~43%): romaji de Whakoom + persistir muId/mdId (memoria `enrich-genres`).
- **Editoriales nuevas** — IDs de Whakoom para Kemuri/Utopía/Larp/etc. (memoria `editoriales-nuevas`).
- **Portadas en R2** — falta setup del bucket Cloudflare R2 (memoria `covers-r2`).
- **Mangaka index** — cron semanal Vercel ya existe; índice propio de autores (memoria `mangaka-index`).
- **Community editing** — herramientas de edición de catálogo pensadas para uso comunitario futuro (modelo Whakoom).

---

## 6. A futuro / post-MVP (❄️)

- **Internacional** — ediciones JP+EN+ES sobre el mismo `Work`. Fuentes: MU/MD (JP), Whakoom (ES), Google Books (EN). Diseñado, sin implementar (`docs/plan-internacional.md`, memoria `internacional`).
- **VIZ próximos** — Series nuevas / Próximos tomos también para VIZ (hoy Ivrea-only por las fechas) (memoria `viz-proximos`).
- **Funkos** — modelo *waves*: `Work`=franquicia, `PublisherEdition`=wave, `Volume`=figura. Reusa completitud. SIN nacional, SIN notis. El costo real es la fuente de datos (`docs/analisis-funkos.md`).
- **Cómics internacionales** — `comics.org` (GCD) como fuente futura para DC/Marvel; `gcdId` como 3ª identidad externa (memoria `gcd-comics-source`).
- **Artbooks / box sets** — **BuscaLibre** como fuente AR validada (SSR, ISBN en URL, precio); integrar post-VIZ (memoria `buscalibre-source`).
- **Community lists** — listas "Top X" (3–10) recomendadas por la comunidad, detrás de feature flag (memoria `community-lists`).
- **Test environment** — ambiente de Test/staging separado de producción a futuro (memoria `test-environment`).

### Gamification (FASE GRANDE — analizar a fondo ANTES de codear)
Perfil estilo Steam → achievements computados (50/100/200 mangas) → badges/chips (incluye badge de reportes resueltos desde `Report.status`) → skins/cosméticos. Pensar modelo de datos, anti-trampa, privacidad de perfil, cosmético vs funcional. **Puede esperar** (pesa más el pre-launch).

---

## 7. Pendientes operativos puntuales

- **Recrawl Ivrea contradicciones** — 7 series con conteo contradictorio (Ao Ashi, Bastardo, Drama Queen, Eizouken, Saint Seiya Lost Canvas, Dai Dark, Dungeon Elf): correr `recrawl-ivrea --contradictions` **cuando Ivrea desbanee** la IP (memorias `pending-ivrea-recrawl`, `ivrea-ip-ban`). NUNCA asumir conteos.
- **PR del próximo lote** — el commit del tool `whakoom-ivrea-diff.ts` está en `staging`, pendiente de entrar al próximo PR a `main` (workflow de lotes, memoria `dev-workflow`).
- **Works partidos por idioma (romaji)** — ✅ limpiado (2026-06-24): `scripts/merge-romaji-dups.ts` fusionó **41 grupos** (+5 Junji Ito previos) + borró 26 ediciones redundantes (prod+staging). La prevención (`findOrCreateWork` puente romaji+autor) evita nuevos. **Quedan 3 a mano (datos malos, NO mergear automático):** `jujutsu kaisen` (ver abajo), `yu gi oh` (#2564 Arc-V tiene `originalTitle` que colapsa con el base #20 — corregir originalTitle), `shaman king zero` (#133 Flowers con `originalTitle` errado — corregir).
- **Mostrar Panini (post-MVP)** — hoy `VISIBLE_PUBLISHERS = Ivrea + VIZ`; Panini/Ovni están en la base pero **ocultos** (decisión MVP solo-Ivrea, memoria `mvp-plan`). Para activarlos: ampliar `CATALOG_PUBLISHERS`/`VISIBLE_PUBLISHERS` en `lib/catalog.ts`. **Antes de mostrar Panini hay que deduplicar** lo que quedó partido. Caso conocido: **Jujutsu Kaisen** está en 2 works — #287 "Jujutsu Kaisen" (AL 101517, +VIZ, +Panini "jujutsu-kaisen" 30t genérica/auto-map vieja) y #310 "Jujutsu Kaisen: Contiendas de brujería" (AL 105469, Panini real 31t + novela + fanbook). Unificar: conservar #287, traer la Panini real (Contiendas 31t) de #310, borrar la Panini duplicada de #287, y decidir qué hacer con novela/fanbook (son productos aparte, hoy modelados como ediciones del manga). Ninguno tiene colección/deseados (seguro de tocar). No urgente.

---

## 8. Descartado

Cafecito con barra de objetivo · calendario de lanzamientos AR (sin data fiable) · scanner ISBN (mapeo poco fiable) · fanfics/fanart (moderación/riesgo).

---

## Preferencias transversales (aplican a TODO lo nuevo)

- **Mobile-first** — la mayoría usa el celu; UI responsive siempre.
- **Regla de oro: nunca asumir nada** — esperar números/datos reales, no inferir conteos.
- **No pisar lo editado a mano** — los jobs son backfill-if-empty (`Work.curated`).
- **`npm run check` antes de commit** (tsc + tests); `npm run audit` tras cambios de data.
- **Whakoom/Ivrea solo desde donde corresponde** — Whakoom local (bloquea datacenter), Ivrea solo desde Vercel cron (baneo de IP local).
