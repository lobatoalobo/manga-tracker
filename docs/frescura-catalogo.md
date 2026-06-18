# Frescura del catálogo (refresh programado)

El catálogo se actualiza crawleando **Whakoom** (Panini/Ovni/Kemuri/Utopía/Larp/
Distrito) e **Ivrea**. Whakoom **bloquea a los runners de GitHub/Vercel**, así que
el refresh NO puede correr en la nube: vive en una PC propia como **tarea
programada de Windows**. Corre contra **producción** (la `DATABASE_URL` de `.env`).

## Qué hace el refresh

`scripts/refresh-catalog.mjs` corre, en orden y tolerando fallos por paso:

1. **Ivrea** — catálogo + tomos + works (`crawl.ts ivrea`).
2. **Whakoom (todas)** — el resto de las editoriales (`crawl.ts whakoom-all`).
3. **Enrich** — géneros/portada/sinopsis desde MangaUpdates + MangaDex
   (`enrich-works.ts`, de a lotes, resumable).

Los pasos 1 y 2 disparan las notis de "tomo nuevo" y "salió en AR" (deseados).

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
