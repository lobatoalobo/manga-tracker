# Architectural Decision Records (ADR)

Cada ADR captura **una decisión arquitectónica y el *por qué*** en el momento en
que se tomó. La auditoría y el código cambian; un ADR es inmutable (si la decisión
se revierte, se escribe uno nuevo que la supersede, no se edita el viejo).

Dentro de un año, "por qué descartamos el recorder en la v1" o "por qué Prisma
queda fuera del dominio salvo en el core de catálogo" vale más reconstruirlo desde
un ADR que desde el código.

## Formato

```
# ADR-NNN: <título>
- **Estado**: Propuesto | Aceptado | Supersedido por ADR-XXX
- **Fecha**: YYYY-MM-DD
## Contexto
## Decisión
## Consecuencias  (buenas y malas)
## Alternativas consideradas  (y por qué se descartaron)
```

## Índice

| ADR | Título | Estado |
|---|---|---|
| 001 | Fronteras de dominio (bounded contexts) | _pendiente (Fase 1)_ |
| 002 | [Mutation Framework](002-mutation-framework.md) | Aceptado |
| 003 | Dominio de catálogo | _pendiente (Fase 2)_ |
| 004 | [Capa de Identidad Externa](004-external-identity.md) | Propuesto (gate: spike de granularidad) |
| 005 | Identidad de creadores | _en rama de identidad (staging), congelado_ |
| 006 | [Contribuciones comunitarias al catálogo](006-community-contributions.md) | Aceptado (dominio) |
| 007 | [Familias de proyección del motor Apply](007-apply-projection-families.md) | Aceptado |
| 008 | [Coordinación Identidad–Contenido en Fusionar](008-merge-identity-content-coordination.md) | Aceptado (T1) — Fusionar IMPLEMENTADA ([slice](../identity-merge-slice.md)) |
| 009 | [Integridad de referencias frente a transiciones de Identity](009-reference-integrity-identity-transitions.md) | Aceptado (T2) — validado contra REDIRECTED real de Fusionar |
| 010 | [Proyección de colección automática (Slice 8)](010-slice8-collection-projection.md) | Aceptado — **IMPLEMENTADO** ([slice](../retail-slice-8-collection-projection.md)) |
