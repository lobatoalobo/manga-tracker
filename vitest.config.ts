import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Alias compartido por ambos proyectos (@ -> raíz del repo).
const alias = { "@": fileURLToPath(new URL("./", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    // Dos proyectos con entornos distintos, sin solapamiento de archivos:
    //  - node: la suite existente (dominio/servicios), idéntica a antes.
    //  - ui:   tests de componentes React en jsdom, aislados en tests/ui/**.
    // `**/*.test.ts` NO matchea `.test.tsx`, y `ui` solo mira tests/ui/**.
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "ui",
          include: ["tests/ui/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["tests/ui/setup.ts"],
        },
      },
    ],
  },
});
