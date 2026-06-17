# Plan: ediciones internacionales (JP + inglés + español, cualquier país)

> Estado: **diseño acordado (2026-06-17), sin implementar**. Se ejecuta después
> de cerrar AR (Ivrea + editoriales AR vía Whakoom). Ver [[catalogo-local]].

## Objetivo

Sobre el mismo `Work` (obra canónica, ya compartido), poder tener y trackear
**ediciones de cualquier país/idioma**, no solo argentinas:

- **Japonesa**: original (Tankoubon) + formatos (Kanzenban, Bunkoban, Deluxe…).
- **Inglés**: de cualquier país (Viz/Kodansha USA/Yen Press, etc.).
- **Español**: de cualquier país (Planeta-España, Ivrea-ES, Norma, Panini-México,
  Kamite, etc.) — además de las AR que ya tenemos.

El `Work` se matchea por `originalTitle` (romaji, ya guardado) + título/autor.

## Fuentes por idioma (MU/MD NO alcanzan para los 3)

| Idioma | Fuente principal | Da | No da / límite |
| --- | --- | --- | --- |
| **Japonés** | **MangaUpdates** (formatos+conteo) + **MangaDex** (portadas) | conteo por formato, portadas, géneros | ISBN por tomo (difícil) |
| **Español** (cualquier país) | **Whakoom** | ediciones por editorial, conteo de tomos, portadas, a veces ISBN | corre LOCAL (Cloudflare bloquea datacenter, [[whakoom-blocked-vercel]]) |
| **Inglés** (cualquier país) | **MangaUpdates** (lista licenciatarios) + **Google Books API** (tomos+ISBN por idioma) y/o **Comic Vine** | qué editorial existe; con Google Books: lista de tomos + ISBN + portada | el más flojo; MU no da conteo por licencia → Google Books arma la lista por "título vol N" lang=en |

Conclusión: **MU+MD alcanzan para la edición japonesa**. Para español va
**Whakoom** (ya integrado). Para inglés hay que sumar **Google Books** (API
gratis, búsqueda por título+idioma, trae ISBN) — es lo único nuevo a integrar.

## Modelo (encaja en lo actual, cambios chicos)

`PublisherEdition` (= `Edition`) cuelga del `Work`; se le agrega:

```prisma
// nuevos campos en PublisherEdition
language String  @default("es") // "es" | "en" | "ja"
country  String? // "AR" | "ES" | "MX" | "US" | "JP" | … (origen de la edición)
isbnList ...      // ISBN por tomo vive en Volume (ya existe el modelo Volume)
```

- Una obra puede tener N ediciones: `Ivrea Argentina (es/AR)`, `Planeta (es/ES)`,
  `Viz (en/US)`, `Japonesa - Volúmenes (ja/JP)`, `Japonesa - Kanzenban (ja/JP)`.
- Chips por edición: 🇦🇷/🇪🇸/🇲🇽 (es), 🇺🇸/🇬🇧 (en), 🇯🇵 (ja). "Nacional" = `country=AR`.
- **ISBN como llave fuerte** (decisión de [[catalogo-local]]): dedup de tomos y
  cross-check entre fuentes donde esté disponible (EN/ES sí, JP rara vez).

## Linking (a qué Work va cada edición)

1. **Japonés** → por `Work.originalTitle` (romaji) contra MU/MD. (ya funciona)
2. **Español** → matching de Whakoom (título/autor) al Work, igual que las AR.
3. **Inglés** → por el **título en inglés** que da MU (licensed title) + autor;
   ISBN de Google Books refuerza/dedup.

## Mantenimiento (1 pipeline por fuente, periódico)

- **Japonés (MU/MD):** job de enriquecimiento semanal/mensual refresca formatos +
  conteos + portadas. Si MU sube el conteo de un formato → "tomo nuevo" vía
  `notifiedVolumes` (mismo motor que Ivrea).
- **Español (Whakoom):** crawl por editorial (LOCAL), periódico. Mismo motor de
  "tomo nuevo".
- **Inglés (Google Books):** refresh periódico de la lista de tomos/ISBN.
- Notis de tomo nuevo: por edición (`notifiedVolumes`), sin importar la fuente.

## Riesgos / a tener en cuenta

- **Inglés es el más incompleto** (Google Books no siempre tiene toda la serie ni
  fechas; MU solo lista la editorial). Empezar JP+ES (sólidos) y EN como mejor-
  esfuerzo.
- **Carga de mantenimiento:** 3 pipelines de fuente (MU/MD, Whakoom, Google
  Books) + el de Ivrea. Cada uno periódico y resumable.
- **Hentai:** aplicar el guard anti-hentai/doujinshi en TODAS las fuentes (ya está
  en el enriquecimiento MU/MD; replicar en Whakoom/Google Books).
- **Escala del catálogo:** sumar ediciones NO agranda el universo de obras (van al
  mismo Work). Series-solo-extranjeras (que no salen en AR) quedan FUERA por ahora
  (decisión: el universo sigue siendo AR-publicado + su edición JP/EN/ES).

## Fases (cuando se implemente)

1. **Esquema**: `language`/`country` en `PublisherEdition`; backfill AR→(es/AR).
2. **Japonés**: extender el job MU/MD para crear ediciones `ja` (formatos+conteo)
   + portadas. Chips 🇯🇵. (alto valor, bajo riesgo)
3. **Español**: Whakoom por editorial no-AR (Planeta-ES, Norma, Panini-MX…) →
   ediciones `es`/country. (reusa pipeline Whakoom)
4. **Inglés**: integrar Google Books (lista por título+lang=en, ISBN) → ediciones
   `en`. (mejor-esfuerzo)
5. **UI**: en `/serie`, listar ediciones agrupadas por idioma/país con su chip;
   colección por edición.
