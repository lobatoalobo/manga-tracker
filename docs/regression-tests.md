# Regression tests — Nakama

Suite completa por módulo para correr antes de un release grande (o tras tocar un
área). Más exhaustiva que [smoke-tests.md](smoke-tests.md). Complementa la
[qa-checklist.md](qa-checklist.md) (que está ordenada por riesgo de datos).

Cada caso: **ID · Pasos → Esperado**. Marcá `[x]`. Anotá entorno + build + fecha.
Las "⚠ zona de atención" señalan hallazgos abiertos de la [auditoría](auditoria.md).

---

## A. Autenticación y cuenta
- [ ] **A1** Login con Google nuevo (sin cuenta previa) → se crea usuario, va a /collection.
- [ ] **A2** Login con cuenta existente → recupera su colección.
- [ ] **A3** Logout → vuelve a home no logueado; rutas privadas redirigen.
- [ ] **A4** Acceso directo a ruta privada sin sesión (`/collection`, `/ajustes`, `/compras`) → redirige a home, no rompe.
- [ ] **A5** Borrar cuenta: `/ajustes` → escribir "BORRAR" → confirma → se cierra sesión y los datos desaparecen (probar con cuenta descartable). Reportes/tiendas/indie que subió quedan anonimizados, no borrados.
- [ ] **A6** Export CSV (`/collection` → Exportar) baja un archivo con la colección.

## B. Catálogo / búsqueda / fichas (⚠ calidad de datos: ver qa-checklist P1)
- [ ] **B1** `/catalogo` carga y la búsqueda filtra al instante (texto).
- [ ] **B2** Filtro por género (chip desde una ficha) → llega a /catalogo ya filtrado.
- [ ] **B3** Filtro multi-género con modo "todos/cualquiera" funciona.
- [ ] **B4** Paginación del catálogo (números de página, ←/→).
- [ ] **B5** Tabs A-Z / series / tomos ordenan bien.
- [ ] **B6** Resaltado: series que coleccionás (✓) y deseás (❤) marcadas en la grilla.
- [ ] **B7** Ficha `/serie/[id]`: título/autor/sinopsis/portada/géneros correctos y de ESA serie (spot-check 15-20).
- [ ] **B8** Conteo de tomos = publicados; multi-editorial muestra la edición con más tomos.
- [ ] **B9** Autor en ficha linkea a `/autores/[name]` y lista sus obras.
- [ ] **B10** Serie en preventa: chip "🔜 Próximo a salir" + fecha; ficha sin tomos muestra placeholder "Próximamente".
- [ ] **B11** ⚠ Hentai/R18 NO aparece en búsqueda (probar "Adabana", términos R18).
- [ ] **B12** Series sin portada no rompen la grilla (placeholder).

## C. Colección y progreso
- [ ] **C1** Agregar/quitar edición desde la ficha.
- [ ] **C2** Marcar tomos individuales; "tengo todos"; "hasta el tomo N".
- [ ] **C3** Estado al-día (verde) vs incompleta (ámbar) según owned/total.
- [ ] **C4** Progreso de lectura: "leídos X/total". **No** permite leído > total (probar tipear 999); sí permite leído > owned (online).
- [ ] **C5** Serie preferida (★): se fija primera, borde dorado, en colección propia y compartida.
- [ ] **C6** Importar CSV: subir el export → reimporta sin duplicar; muestra importados/errores.
- [ ] **C7** Dashboard (home logueado): "Tomos" cuenta tomos de colección; "continuar leyendo" correcto.

## D. Deseados y "para comprar"
- [ ] **D1** Marcar/desmarcar deseado desde catálogo y desde ficha.
- [ ] **D2** `/deseados` muestra mensaje de aviso + CTA cuando está vacío.
- [ ] **D3** `/faltantes`: tomos que faltan de la colección + sección "Deseados que ya salieron".
- [ ] **D4** Links de compra (Crumb) abren la búsqueda correcta; override admin de Crumb funciona.
- [ ] **D5** ⚠ (perf) usuario con muchos deseados (20+) → /faltantes carga en tiempo razonable.

## E. Compras
- [ ] **E1** Crear compra (tienda, fecha, varios tomos, precio, descuento) → aparece en /compras.
- [ ] **E2** "Agregar a colección" al comprar suma los tomos linkeados.
- [ ] **E3** Editar compra: cambiar ítems/precios → persiste. **Seguridad**: no se pueden editar ítems de otra compra (IDOR S2 corregido).
- [ ] **E4** Cambiar estado por tomo (pendiente/recibido/...).
- [ ] **E5** Borrar compra.
- [ ] **E6** Gasto mensual/anual se calcula bien.

## F. Notificaciones (push + in-app)
- [ ] **F1** Activar push (permiso) → "Probar" llega.
- [ ] **F2** Desactivar push → deja de llegar; **no** afecta a otros dispositivos/usuarios (S3 corregido).
- [ ] **F3** Tomo nuevo: al correr el refresh, llega push **solo** a quien trackea esa serie, y solo si el conteo realmente subió (no re-notifica lo ya avisado).
- [ ] **F4** "Salió en AR" (deseado) notifica una sola vez.
- [ ] **F5** Preferencias por categoría (/ajustes) silencian su tipo.
- [ ] **F6** Silenciar una serie puntual (/ajustes/series) corta sus avisos.
- [ ] **F7** Campanita: contador de no leídas, marcar leídas, borrar todas.

## G. Social
- [ ] **G1** Enviar solicitud de amistad por email; aceptar/rechazar.
- [ ] **G2** Feed de actividad de amigos.
- [ ] **G3** Reacciones y comentarios; borrar comentario propio (no ajeno).
- [ ] **G4** Quitar amigo.

## H. Comunidad (tiendas / indie) + moderación
- [ ] **H1** Proponer tienda → queda PENDING; admin la aprueba/borra; aparece en /tiendas.
- [ ] **H2** Subir obra indie → PENDING; admin aprueba; aparece en /independientes.
- [ ] **H3** **Validación de URL**: en tienda/indie, una URL inválida (`javascript:...`, texto suelto) → error claro, no se guarda.
- [ ] **H4** Reportar dato de una serie → llega a /admin/reportes; **solo admin** puede resolver (S1 corregido).
- [ ] **H5** **Rate limiting**: enviar 6 reportes seguidos / 6 tiendas → al 6º corta con "demasiados intentos".

## I. Compartir / colección pública
- [ ] **I1** Activar compartir → `/u/<slug>` accesible sin login (otra persona).
- [ ] **I2** Ficha pública `/u/<slug>/<id>`: muestra metadata local (sin pegarle a AniList) y progreso de solo lectura.
- [ ] **I3** Desactivar compartir → `/u/<slug>` da 404.
- [ ] **I4** La colección pública NO expone email ni datos privados.

## J. Admin
- [ ] **J1** No-admin: todas las `/admin/**` dan 404.
- [ ] **J2** Mapeos: mapear/auto/editar/borrar edición; bulk; nacional-only.
- [ ] **J3** Editor de Work desde la ficha (título/autor/sinopsis/portada/géneros/preventa + fecha + Crumb).
- [ ] **J4** Herramientas: flush caché, integridad, runner de tareas (dry-run).
- [ ] **J5** Crons protegidos: `GET /api/cron/ivrea-proximas` sin `Authorization` → 401 (S4).

## K. No-funcional / cross-cutting
- [ ] **K1** Mobile: bottom nav, hamburguesa, todas las vistas usables en celu.
- [ ] **K2** PWA: instalar, ícono, push en instalada.
- [ ] **K3** ⚠ Errores: simular DB/red caída → hoy puede mostrar el error boundary global (E1 pendiente). Documentar comportamiento.
- [ ] **K4** Edge/vacíos: colección vacía, serie sin tomos, sin portada, serie muy larga (100+ tomos), 0 resultados de búsqueda.
- [ ] **K5** ⚠ Accesibilidad: navegación por teclado en formularios; lector de pantalla anuncia portadas/inputs (A1–A3 pendientes).
- [ ] **K6** ⚠ Compartir link en WhatsApp/Twitter muestra preview (OG M1 pendiente — hoy NO).
- [ ] **K7** Legal: `/privacidad` y `/terminos` cargan; links en footer y /ajustes.

## L. Datos del catálogo (sesión dedicada)
- [ ] **L1** Abrir 30-40 series al azar → ficha/portada/conteo correctos (acá salen mismaps).
- [ ] **L2** Refresh programado (`refresh-catalog`): corre Ivrea + Whakoom + enrich; log en UTF-8 legible; notis de tomo nuevo coherentes.
- [ ] **L3** Conteos inconsistentes (notif > vol, ej. Panini) → revisar con baseline.

---

### Cómo usar esta suite
- **Release grande / pre-launch**: correr todo (A–L).
- **Cambié un módulo**: correr su sección + [smoke](smoke-tests.md).
- **Bug encontrado**: agregar un caso acá para que no vuelva (regresión = no repetir bugs).
- A futuro: automatizar A1–A4, C1–C4, I1–I3 con Playwright para no depender de QA manual.
