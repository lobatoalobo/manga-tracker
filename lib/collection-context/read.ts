/**
 * Collection (Slice 8) — lecturas mínimas del modelo nuevo (posiciones + adquisiciones). Suficientes para
 * verificar la slice; NO son una UI completa y NO tocan `OwnedVolume` ni servicios legados. Ver ADR-010 §D7.
 */
import { type PrismaClient } from "@prisma/client";

type Client = PrismaClient;

/**
 * Posiciones de posesión de un usuario. Filtra ESTRICTAMENTE por `userId`, orden determinista por `volumeId`,
 * devuelve la cantidad persistida + los datos mínimos de `Volume` para verificar (número y edición).
 */
export function getUserPositions(client: Client, userId: string) {
  return client.ownershipPosition.findMany({
    where: { userId },
    orderBy: { volumeId: "asc" },
    select: { volumeId: true, quantity: true, volume: { select: { number: true, editionId: true } } },
  });
}

/**
 * Adquisiciones que explican una posición `(userId, volumeId)`. El alcance queda validado por AMBOS
 * identificadores. Orden cronológico determinista (`occurredAt` asc, desempate estable por `id`). Devuelve los
 * cinco atributos del hecho + `acquisitionKey` + `recordedAt`; sin detalles internos de Retail ni interpretar
 * la estructura de la clave.
 */
export function getPositionAcquisitions(client: Client, userId: string, volumeId: number) {
  return client.acquisition.findMany({
    where: { userId, volumeId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { acquisitionKey: true, userId: true, volumeId: true, quantity: true, channel: true, occurredAt: true, recordedAt: true },
  });
}
