import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Registro de feature flags. La metadata vive acá (tipada); el estado on/off
 * editable vive en la tabla `FeatureFlag` (override). Una flag que no está en la
 * DB usa su `default`. Para sumar una feature nueva: agregá una entrada acá y
 * gateá con `isEnabled("...")`.
 */
export const FEATURE_FLAGS = {
  "genre-filters": {
    label: "Filtros por género",
    description: "Panel de filtros (géneros + demografía) en el catálogo.",
    default: true,
  },
} as const;

export type FlagKey = keyof typeof FEATURE_FLAGS;
export type Flags = Record<FlagKey, boolean>;

/** Estado actual de todas las flags (override de DB sobre los defaults). */
export const getFlags = cache(async (): Promise<Flags> => {
  const rows = await prisma.featureFlag.findMany().catch(() => []);
  const override = new Map(rows.map((r) => [r.key, r.enabled]));
  const out = {} as Flags;
  for (const key of Object.keys(FEATURE_FLAGS) as FlagKey[]) {
    out[key] = override.get(key) ?? FEATURE_FLAGS[key].default;
  }
  return out;
});

export async function isEnabled(key: FlagKey): Promise<boolean> {
  return (await getFlags())[key];
}
