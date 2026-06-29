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
