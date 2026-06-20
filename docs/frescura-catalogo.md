# Frescura del catálogo (refresh programado)

El catálogo se actualiza desde varias fuentes. La clave es **qué corre en la nube
y qué local**:

- **En Vercel (crons, automático):** Ivrea (no bloquea el datacenter) y VIZ.
  - `/api/cron/ivrea-catalogo` (diario) — **catálogo de Ivrea**: tomos/estado/
    portada (`PublisherEdition.volumes`) + propaga totales + notifica "tomo nuevo"
    / "salió en AR". **Acá se actualiza el máximo de tomos de Ivrea.**
  - `/api/cron/ivrea-proximas` (diario) — próximos/reediciones/debuts.
  - `/api/cron/viz` (semanal) — descubre + refresca + rellena portadas + Blob.
- **Local (tarea de Windows):** SOLO **Whakoom** (Cloudflare bloquea la nube) +
  enrich. `scripts/refresh-catalog.mjs`, contra **producción** (`DATABASE_URL`).

## Qué hace el refresh LOCAL

`scripts/refresh-catalog.mjs` corre, en orden y tolerando fallos por paso:

1. **Whakoom (todas)** — Panini/Ovni/Kemuri/Utopía/Larp/Distrito (`crawl.ts whakoom-all`).
2. **Enrich** — géneros/portada/sinopsis desde MangaUpdates + MangaDex
   (`enrich-works.ts`, de a lotes, resumable).

> Ivrea **ya no corre acá** — se desacopló a Vercel (`/api/cron/ivrea-catalogo`),
> así la frescura del conteo de Ivrea NO depende de la PC local.

## Instalar la tarea (una vez)

```powershell
# Diaria a las 03:00 (default)
powershell -ExecutionPolicy Bypass -File scripts\install-refresh-task.ps1

# O a otra hora
powershell -ExecutionPolicy Bypass -File scripts\install-refresh-task.ps1 -At 04:30
```

Si `Register-ScheduledTask` pide permisos, abrí PowerShell **como Administrador**.
La tarea corre como tu usuario y necesita `node` en el PATH. Tiene
`StartWhenAvailable`: si la PC estaba apagada a esa hora, corre apenas se prende.

## Operar

```powershell
Start-ScheduledTask     -TaskName NakamaCatalogRefresh   # correr ya (probar)
Get-ScheduledTaskInfo   -TaskName NakamaCatalogRefresh   # último resultado
Unregister-ScheduledTask -TaskName NakamaCatalogRefresh -Confirm:$false  # quitar
```

Logs en `logs/refresh-<timestamp>.log` (se guardan los últimos 30). También
podés correr el refresh a mano sin la tarea:

```powershell
node scripts\refresh-catalog.mjs
```

## Limitación

Depende de que la PC esté encendida. Si necesitás independencia total de tu
máquina, las alternativas son un **self-hosted runner** de GitHub o un **VPS**
siempre prendido corriendo el mismo orquestador por cron.
