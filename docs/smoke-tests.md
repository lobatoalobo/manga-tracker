# Smoke tests — Nakama

Objetivo: en **~15 min**, confirmar que lo crítico no está roto después de un
deploy. Si algo de acá falla, **no se publica**. Probar en **mobile** (la mayoría
de los usuarios) y, si hay tiempo, repetir en desktop.

Convención: cada paso tiene **Acción → Esperado**. Marcá `[x]` lo que pasó.
Entorno: anotá si es Producción o Preview/staging y la fecha.

---

## 0. Arranque
- [ ] **Home carga**. Acción: abrir `/` sin sesión. Esperado: carga sin error, se ve el catálogo/landing, sin pantalla de error ni spinner infinito.
- [ ] **Sin errores de consola** críticos (rojo) en DevTools al cargar.

## 1. Auth
- [ ] **Login**. Acción: "Entrar con Google" → elegir cuenta. Esperado: vuelve logueado, te lleva a `/collection`, aparece tu avatar en la nav.
- [ ] **Sesión persiste**. Acción: recargar. Esperado: seguís logueado.

## 2. Descubrimiento / catálogo
- [ ] **Buscar**. Acción: ir a `/catalogo`, escribir "sakamoto". Esperado: aparece Sakamoto Days al instante (filtro client-side), con su portada.
- [ ] **Abrir ficha**. Acción: clickear la serie. Esperado: `/serie/<id>` con título, autor, géneros, portada, ediciones y tomos correctos.
- [ ] **Chip nacional / próximo**. Esperado: si es de editorial AR, muestra "🇦🇷 Edición nacional"; preventas muestran "🔜 Próximo a salir".

## 3. Colección (núcleo)
- [ ] **Agregar edición**. Acción: en una serie, "+ Trackear" una edición. Esperado: queda trackeada (el botón cambia), aparece en `/collection`.
- [ ] **Marcar tomos**. Acción: marcar algunos tomos como que los tenés. Esperado: el progreso (owned/total + barra) se actualiza; estado al-día/incompleta correcto.
- [ ] **Marcar lectura**. Acción: poner "Leyendo", tomo N. Esperado: NO deja poner más que el total de la serie (probar tipear un número alto); muestra "leídos N/total".
- [ ] **Quitar edición**. Acción: quitar la edición agregada. Esperado: desaparece de la colección sin error.

## 4. Deseados / comprar
- [ ] **Marcar deseado**. Acción: corazón en una serie desde el catálogo. Esperado: aparece en `/deseados`.
- [ ] **Para comprar**. Acción: abrir `/faltantes`. Esperado: lista tomos que te faltan de tu colección (o "¡Estás al día!"), con link de compra.

## 5. Notificaciones / push
- [ ] **Push de prueba**. Acción: `/ajustes` → activar push (aceptar permiso) → "Probar". Esperado: llega la notificación push.
- [ ] **Campanita in-app**. Esperado: el contador de no leídas y `/notificaciones` funcionan.

## 6. Compartir / social
- [ ] **Compartir colección**. Acción: activar compartir en `/collection`, abrir `/u/<slug>` en una pestaña incógnito. Esperado: se ve la colección pública (solo lectura), sin pedir login.
- [ ] **Privacidad**. Acción: desactivar compartir, recargar `/u/<slug>` en incógnito. Esperado: 404 (ya no es público).

## 7. Seguridad rápida
- [ ] **Admin gateado**. Acción: como NO-admin, abrir `/admin/herramientas`. Esperado: 404.
- [ ] **Borrar cuenta visible**. Acción: `/ajustes` → existe "Borrar cuenta" con confirmación (NO la ejecutes en una cuenta real).

## 8. Plataforma / ops
- [ ] **Mobile nav**. Acción: en celular, usar la bottom nav (Inicio, Colección, Comprar, Deseados, Perfil). Esperado: todo navegable.
- [ ] **PWA**. Acción: "Instalar app". Esperado: se instala con ícono; abre standalone.
- [ ] **Sentry vivo** (si tocaste algo riesgoso): un error real debería aparecer en sentry.io en ~1 min.
- [ ] **Legal**: footer → `/privacidad` y `/terminos` cargan.

---

### Criterio de aprobación
Smoke OK = secciones 0–4 y 7 **todas verdes**. 5–8 pueden tener un 🟡 menor
documentado, pero nada que bloquee el flujo principal (descubrir → coleccionar →
comprar). Si falla 0, 1, 3 o 7 → **rollback / no publicar**.
