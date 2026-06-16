# QA checklist — Nakama

Ordenado por **riesgo** (dónde más bugs aparecieron y qué cambió reciente).
Atacar de arriba para abajo. Marcá `[x]` lo verificado.

## 🔴 P1 — Calidad de datos del catálogo (lo más frágil)
Probar varias series por ítem:
- [ ] **Mapeos**: sin homónimos cruzados (Blue Lock↔Blue Period) ni hentai (Adabana). Spot-check 15-20 mapeadas → ¿ficha correcta?
- [ ] **Consistencia edición↔Work**: `edition.anilistId == work.anilistId` (script `verify-author-maps`); portada/sinopsis de la ficha son de esa serie.
- [ ] **Conteos**: tomos = publicados (no cuenta `not-published`); multi-editorial muestra la de MÁS tomos (One Piece 107).
- [ ] **Portadas**: sin cards en blanco (filtro admin "Sin portada"); nacionales correctas.
- [ ] **Cómics/novelas**: no rompen como nacionales (aún sin clasificar).

## 🔴 P2 — Cambios recientes (regresión)
- [ ] **Búsqueda**: nacional-first; **hentai oculto** (buscar "Adabana"/"Adolf"/términos R18 → no aparecen); local hits; paginación.
- [ ] **Preventas**: badge "🔜 Pronto" (~121 series); **fecha manual** (editor → "jul 2026" → "Pronto · jul 2026"); al salir el tomo → "¡Ya salió!".
- [ ] **A-Z nacional**: "All" + letras + buscador global. **A-Z global**: salto de página.
- [ ] **Colección**: estado al-día/incompleta (colores); progreso leído (barras, "leídos x/owned"); **serie preferida** (★, dorada, fijada 1ra — propia y compartida).
- [ ] **Fichas**: `/manga` no tira 400/404 navegando rápido; sinopsis local-first; `/nacional` sin link Whakoom + fecha.

## 🟡 P3 — Flujos core
- [ ] **Colección**: agregar/quitar edición, marcar tomos, import/export CSV, compartir (`/u/<slug>`).
- [ ] **Notificaciones**: Web Push (tomo nuevo / ¡ya salió!, app cerrada); in-app + campanita; preferencias por tipo.
- [ ] **Comprar**: faltantes (links Crumb/tiendas); historial de compras.
- [ ] **Social**: amigos, actividad, reacciones, comentarios.
- [ ] **Indie/tiendas**: submission + moderación admin.
- [ ] **Auth**: login/logout Google; rutas admin dan 404 a no-admin.

## 🟡 P4 — No-funcional / cross-cutting
- [ ] **Mobile**: hamburguesa, bottom nav, todas las vistas en celu.
- [ ] **PWA**: instalar, ícono, push instalada.
- [ ] **Performance**: A-Z "All" en mobile; AniList lento/caído (degradación).
- [ ] **Edge/vacíos**: colección vacía, serie sin tomos, sin portada, series largas, 0 resultados.
- [ ] **Seguridad**: no ver datos de otros usuarios; acciones admin gateadas.

## Metodología
1. **Smoke test** (10 min): home → buscar → abrir serie → agregar → marcar tomo → push.
2. **Pase por feature** (P1→P4), anotando bugs.
3. **Edge cases + mobile**.
4. **Sesión de datos**: abrir 30-40 series al azar → verificar ficha/portada/conteo (acá saldrán mismaps restantes).

## To-do relacionados (no son QA)
- Clasificar cómics/novelas con `type` (backlog).
- Ver [[pre-launch]] checklist (infra/legal/abuso) antes de Live.
