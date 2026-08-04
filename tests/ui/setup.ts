// Setup EXCLUSIVO del proyecto `ui` (jsdom). Registra los matchers de
// @testing-library/jest-dom en el `expect` de Vitest y aporta su augmentación
// de tipos. No se carga en el proyecto `node`.
import "@testing-library/jest-dom/vitest";

// Auto-cleanup entre tests. El registro automático de RTL depende de que exista
// el `afterEach` global (globals: true), que acá NO usamos; lo hacemos explícito
// para que cada test arranque con un DOM limpio.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
