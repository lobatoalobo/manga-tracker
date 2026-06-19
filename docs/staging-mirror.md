# Staging como espejo de prod

Los crawls/refresh corren contra **prod** (es la fuente de verdad del catálogo),
así que la branch de **staging** queda desactualizada (ej. 329 obras vs 605).
Para probar sobre datos reales **no re-crawleamos staging**: lo clonamos de prod
con **branching de Neon** (copy-on-write, instantáneo, casi sin storage).

## Qué hace `sync-staging`
1. **Resetea** la branch de staging al estado actual de prod (Neon API → restore).
   Mantiene el mismo endpoint, así que `STAGING_DATABASE_URL` no cambia.
2. **Re-aplica las migraciones pendientes** de staging (que aún no están en prod),
   para probar la migración sobre datos reales.
3. **Anonimiza** los datos personales (scrub): emails/nombres/imágenes de usuarios
   → genéricos; borra `Session` / `PushSubscription` / `LoginEvent`. (Las
   colecciones/compras quedan, como data de prueba.)

## Setup (una vez)
En `.env`:
```
NEON_API_KEY=...        # Neon → Account settings → API keys
NEON_PROJECT_ID=...     # en la URL del proyecto en console.neon.tech, o `neonctl projects list`
# opcional, si la branch de staging no tiene "stag" en el nombre:
# NEON_STAGING_BRANCH_ID=br-...
```
El script detecta solo la branch de prod (la **Default**) y la de staging (por
nombre con "stag", o `NEON_STAGING_BRANCH_ID`).

## Uso
```bash
node scripts/sync-staging.mjs          # DRY: muestra qué branches usaría
node scripts/sync-staging.mjs --yes    # ejecuta: reset ← prod + migrate + scrub
```
El **reset** es una llamada HTTP a Neon (no una conexión directa a Postgres), así
que funciona aunque el endpoint directo de la DB esté caprichoso. Los pasos de
`migrate` y `scrub` sí necesitan llegar al Postgres de staging.

## Notas
- ⚠️ **Destructivo para staging**: pisa todo lo que haya en staging con una copia
  de prod. Staging es descartable, ese es el punto. Por eso pide `--yes`.
- **Privacidad**: el scrub evita dejar PII real en staging. El guard de
  `scrub-staging.ts` aborta si `DATABASE_URL` no es la de staging (nunca toca prod).
- **Frecuencia**: on-demand, antes de probar algo grande. No hace falta cron.
- **Cadencia de deploy**: trabajamos en staging y promovemos a prod en lotes
  (ver [[dev-workflow]]).
