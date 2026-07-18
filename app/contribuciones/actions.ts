"use server";

import { requireUserId } from "@/auth";
import { isEnabled } from "@/lib/featureFlags";
import { enforceRateLimit, RL } from "@/lib/rateLimit";
import { ValidationError } from "@/lib/mutations";
import {
  createCatalogProposalUseCase,
  IdempotencyConflictError,
  type CreateCatalogProposalResult,
} from "@/lib/contributions/createProposal";
import type { CreateCatalogProposalInput } from "@/lib/domain/proposal/create";
import {
  addProposalContributionUseCase,
  ProposalNotOpenError,
  type AddProposalContributionResult,
} from "@/lib/contributions/addContribution";
import type { AddProposalContributionInput } from "@/lib/domain/proposal/addContribution";
import { getCatalogProposalDetail } from "@/lib/contributions/readProposal";
import type { CatalogProposalDetail } from "@/lib/domain/proposal/readModel";

export type CreateProposalActionResult =
  | ({ ok: true } & CreateCatalogProposalResult)
  | { ok: false; error: string };

/**
 * Crea una propuesta de catálogo (Community Contributions). Detrás del flag
 * `community-contributions` (off en prod) y sin UI todavía. El usuario NO viaja en
 * el payload: se toma de la sesión. Devuelve el shape `{ ok, ... }` del repo.
 */
export async function createProposalAction(
  input: CreateCatalogProposalInput,
): Promise<CreateProposalActionResult> {
  if (!(await isEnabled("community-contributions")))
    return { ok: false, error: "Las contribuciones no están disponibles." };

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "Necesitás iniciar sesión para contribuir." };
  }

  const rl = await enforceRateLimit("createProposal", RL.createProposal);
  if (!rl.ok) return { ok: false, error: rl.error };

  try {
    const result = await createCatalogProposalUseCase(input, userId);
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof IdempotencyConflictError) return { ok: false, error: e.message };
    console.error("[createProposalAction]", e);
    return { ok: false, error: "No se pudo crear la propuesta." };
  }
}

export type AddContributionActionResult =
  | ({ ok: true } & AddProposalContributionResult)
  | { ok: false; error: string };

/**
 * Agrega una `ProposalContribution` (con ≥1 claim) a una propuesta abierta. Mismo
 * gating que `createProposalAction`: flag `community-contributions` (off en prod),
 * sesión requerida, rate limit. El usuario NO viaja en el payload.
 */
export async function addContributionAction(
  input: AddProposalContributionInput,
): Promise<AddContributionActionResult> {
  if (!(await isEnabled("community-contributions")))
    return { ok: false, error: "Las contribuciones no están disponibles." };

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "Necesitás iniciar sesión para contribuir." };
  }

  const rl = await enforceRateLimit("addContribution", RL.addContribution);
  if (!rl.ok) return { ok: false, error: rl.error };

  try {
    const result = await addProposalContributionUseCase(input, userId);
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof ProposalNotOpenError) return { ok: false, error: e.message };
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof IdempotencyConflictError) return { ok: false, error: e.message };
    console.error("[addContributionAction]", e);
    return { ok: false, error: "No se pudo agregar la contribución." };
  }
}

/**
 * Lectura admin/moderador del detalle de una propuesta (Community Contributions).
 * Detrás del flag `community-contributions`. Devuelve `null` si el flag está apagado,
 * el actor no es admin, el id es inválido o la propuesta no existe (indistinguibles:
 * no revela existencia). El caller mapea `null` a notFound().
 */
export async function getProposalDetailAction(
  proposalId: number,
): Promise<CatalogProposalDetail | null> {
  return getCatalogProposalDetail(proposalId);
}
