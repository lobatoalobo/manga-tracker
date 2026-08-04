# Automatizaciones del sistema

Responsabilidades que el producto garantiza **por su cuenta**, sin un usuario recorriendo una meta. **No son User Flows** (no hay actor humano persiguiendo un objetivo) ni casos de uso.

Se documentan por **responsabilidad** (*qué* garantiza el sistema), no por implementación: la fuente o el mecanismo (Ivrea / Panini / API / scraping / CSV / cron) puede cambiar sin que la responsabilidad cambie.

IDs `SYS-xx` (antes `F-SYS-xx`; se conservan las referencias existentes).

---

## Inventario

- **SYS-01** · Mantener novedades sincronizadas
- **SYS-02** · Gestionar vencimientos
- **SYS-03** · Gestionar notificaciones

> **Estado (ago 2026):** fichas **diferidas a propósito**. Se completan cuando el diseño de las pantallas y del ciclo de la promesa fije sus efectos. Notas de alcance abajo.

---

## Notas de alcance

**SYS-01 · Mantener novedades sincronizadas.**
Mantener disponible un conjunto de novedades sugeridas para que el comerciante arme el Drop (F-COM-01), sin importar de qué fuente provengan. El comerciante nunca depende de una fuente concreta y **siempre decide qué entra** (el sistema solo ofrece).

**SYS-02 · Gestionar vencimientos.**
Hacer que una promesa que no se retira (o una preventa que pasó su plazo) muera como **vencida** —la tercera rama de muerte de la promesa, junto a *cancelada* (F-CLI-04) y *caída* (F-COM-06)—. Depende de la **fecha de cierre / plazo de retiro**, que es el vacío recurrente aún abierto del PDD.

**SYS-03 · Gestionar notificaciones.**
Avisar a la persona en los momentos que importan —sobre todo *"tu tomo está listo para retirar"*—. El retiro se entera **empujado** por el sistema, no consultado por la persona (ver la observación de F-CLI-03). Diseño anti-spam y agrupado a definir.
