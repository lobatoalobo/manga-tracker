import type { MutationDefinition } from "./types";

/**
 * Declara una mutación tipada. Identidad (`defineMutation` es identidad en
 * runtime), pero fija el tipo del `input` para que `runMutation(def, input)` lo
 * infiera. La operación (validate/preview/execute) vive fuera del framework.
 */
export function defineMutation<I>(def: MutationDefinition<I>): MutationDefinition<I> {
  return def;
}
