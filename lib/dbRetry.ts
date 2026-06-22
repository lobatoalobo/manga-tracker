/**
 * Reintenta una operación de DB ante caídas transitorias de conexión (el endpoint
 * DIRECTO de Neon prod a veces tira P1001 a mitad de un batch largo). Prisma
 * reconecta en el próximo intento. Backoff incremental; reintenta solo errores de
 * conexión (no de lógica). Para scripts/pipelines de larga duración.
 */
export async function dbRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string } | null)?.code;
      const transient =
        code === "P1001" ||
        code === "P1017" ||
        /Can't reach database|connection|ECONNRESET|terminating|timed out/i.test(msg);
      if (i === attempts - 1 || !transient) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error("dbRetry: unreachable");
}
