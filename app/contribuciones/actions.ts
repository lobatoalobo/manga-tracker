"use server";

import { auth, requireUserId } from "@/auth";
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
import { getOwnCatalogProposalDetail } from "@/lib/contributions/readOwnProposal";
import type { OwnCatalogProposalDetail } from "@/lib/domain/proposal/ownReadModel";
import {
  requestProposalInfoUseCase,
  OpenRequestExistsError,
  ProposalNotFoundError,
  ProposalNotRequestableError,
  type RequestProposalInfoResult,
} from "@/lib/contributions/requestProposalInfo";
import type { RequestProposalInfoCommand } from "@/lib/domain/proposal/requestInfo";
import { isAdmin } from "@/lib/admin";
import {
  answerProposalInfoRequestUseCase,
  NotProposalOriginatorError,
  InfoRequestNotAnswerableError,
  type AnswerProposalInfoRequestResult,
} from "@/lib/contributions/answerProposalInfoRequest";
import type { AnswerProposalInfoRequestCommand } from "@/lib/domain/proposal/answerInfo";

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

/**
 * Lectura de una propuesta para el usuario común relacionado (originador o aportante),
 * detrás del flag `community-contributions`. Expone SOLO las contribuciones del viewer.
 * Devuelve `null` si el flag está apagado, no hay sesión, el id es inválido, la
 * propuesta no existe o el viewer no está relacionado (indistinguibles). El caller
 * mapea `null` a notFound().
 */
export async function getOwnProposalDetailAction(
  proposalId: number,
): Promise<OwnCatalogProposalDetail | null> {
  return getOwnCatalogProposalDetail(proposalId);
}

export type RequestProposalInfoActionResult =
  | ({ ok: true } & RequestProposalInfoResult)
  | { ok: false; error: string };

/**
 * Moderación: solicita información sobre una propuesta (→ NEEDS_INFO). Solo admin,
 * detrás del flag `community-contributions`. Anti-enumeración: flag off / anónimo /
 * no-admin / propuesta inexistente → misma respuesta genérica. No devuelve privateNote.
 */
export async function requestProposalInfoAction(
  command: RequestProposalInfoCommand,
): Promise<RequestProposalInfoActionResult> {
  const GENERIC = "No se pudo procesar la solicitud.";

  if (!(await isEnabled("community-contributions"))) return { ok: false, error: GENERIC };

  const session = await auth();
  if (!session?.user?.id || !isAdmin(session.user.email))
    return { ok: false, error: GENERIC };

  try {
    const result = await requestProposalInfoUseCase(command, session.user.id);
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof ProposalNotFoundError) return { ok: false, error: GENERIC }; // anti-enum
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof ProposalNotRequestableError) return { ok: false, error: e.message };
    if (e instanceof OpenRequestExistsError) return { ok: false, error: e.message };
    if (e instanceof IdempotencyConflictError) return { ok: false, error: e.message };
    console.error("[requestProposalInfoAction]", e);
    return { ok: false, error: GENERIC };
  }
}

export type AnswerProposalInfoRequestActionResult =
  | ({ ok: true } & AnswerProposalInfoRequestResult)
  | { ok: false; error: string };

/**
 * El originador responde una solicitud de información (→ vuelve a SUBMITTED cuando no
 * queda ninguna abierta). Detrás del flag; requiere sesión. El chequeo de originador
 * ocurre bajo el lock (write-port), ANTES de la idempotencia. Anti-enumeración:
 * flag off / anónimo / no-originador / propuesta inexistente → respuesta genérica.
 */
export async function answerProposalInfoRequestAction(
  command: AnswerProposalInfoRequestCommand,
): Promise<AnswerProposalInfoRequestActionResult> {
  const GENERIC = "No se pudo procesar la respuesta.";

  if (!(await isEnabled("community-contributions"))) return { ok: false, error: GENERIC };

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: GENERIC };
  }

  try {
    const result = await answerProposalInfoRequestUseCase(command, userId);
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof NotProposalOriginatorError) return { ok: false, error: GENERIC }; // anti-enum
    if (e instanceof ProposalNotFoundError) return { ok: false, error: GENERIC }; // anti-enum
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof InfoRequestNotAnswerableError) return { ok: false, error: e.message };
    if (e instanceof IdempotencyConflictError) return { ok: false, error: e.message };
    console.error("[answerProposalInfoRequestAction]", e);
    return { ok: false, error: GENERIC };
  }
}
