/**
 * Dominio del subsistema de Identidad — slice "Conferir una Identity". PURO (Prisma-free).
 *
 * Vocabulario normativo (ver Glosario del Dominio):
 * - Identity: estado referencial resultante de una identidad; delgada, pasiva; protege solo
 *   invariantes LOCALES. No es Contenido (Work); no posee sus referencias externas.
 * - Decisión de identidad (Conferir): intención juzgada por Adjudicación (no instrucciones de
 *   persistencia): qué contenido designar, su clase, referencias semilla, y una identidad
 *   estable de la decisión (`decisionId`) para idempotencia/auditoría.
 * - Resultado de ejecución: feedback semántico del Registro (NO éxito/fallo booleano, NO
 *   excepción). En esta slice solo pueden ocurrir tres: EXECUTED / ALREADY_SATISFIED / REJECTED.
 *
 * Este módulo NO conoce el namespace ni la persistencia (eso es del Registro, en infra):
 * construye y valida la Decisión, y afirma los invariantes LOCALES del nacimiento de una
 * Identity. Los invariantes GLOBALES (designación única, unicidad de referencia, handle fresco)
 * son del Registro y se enforzan con restricciones de base (ver lib/infra/identity/registro.ts).
 */
import { ValidationError } from "@/lib/mutations";

/** Único estado de vida que esta slice produce. RETIRED/REDIRECTED son conceptuales (aún no). */
export const IDENTITY_STATE_ACTIVE = "ACTIVE" as const;
export type IdentityLifeState = typeof IDENTITY_STATE_ACTIVE;

/**
 * Clases de contenido válidas (mismo alfabeto que `Work.type`). "Clase VÁLIDA" = pertenencia a
 * este conjunto (lo verifica el constructor de la Decisión). "Clase COHERENTE con el contenido"
 * = igualdad con el tipo del contenido designado (lo verifica el Registro, que lee el Work).
 */
export const VALID_CONTENT_CLASSES: ReadonlySet<string> = new Set([
  "MANGA", "COMIC", "LIGHT_NOVEL", "ARTBOOK", "DATABOOK", "OTHER",
]);

/** Referencia externa semilla: puntero subordinado (provider + id) que resolverá a la identidad. */
export interface SeedReference {
  readonly provider: string;
  readonly externalId: string;
}

/** La Decisión Conferir (intención, no mutación). Inmutable una vez construida. */
export interface ConferDecision {
  readonly decisionId: string;
  readonly designatedWorkId: number;
  readonly contentClass: string;
  readonly seedReferences: readonly SeedReference[];
}

/** Entrada cruda para construir una Decisión (lo que Adjudicación arma tras juzgar "nuevo"). */
export interface ConferDecisionInput {
  decisionId: string;
  designatedWorkId: number;
  contentClass: string;
  seedReferences?: readonly { provider: string; externalId: string }[];
}

/**
 * Construye y VALIDA una Decisión Conferir. El contrato exige TODOS los datos: una decisión
 * incompleta no puede construirse (por eso el Registro nunca ve "información insuficiente" —
 * ver notas de la slice). Normaliza (trim) y rechaza referencias semilla duplicadas dentro de
 * la propia decisión (misma provider+externalId = decisión malformada).
 */
export function conferDecision(input: ConferDecisionInput): ConferDecision {
  const decisionId = (input.decisionId ?? "").trim();
  if (!decisionId) throw new ValidationError("La decisión Conferir requiere un decisionId estable.");

  if (!Number.isInteger(input.designatedWorkId) || input.designatedWorkId <= 0)
    throw new ValidationError("La decisión Conferir requiere un contenido designado válido.");

  const contentClass = (input.contentClass ?? "").trim();
  if (!VALID_CONTENT_CLASSES.has(contentClass))
    throw new ValidationError(`Clase de contenido inválida: ${String(input.contentClass)}.`);

  const seen = new Set<string>();
  const seedReferences: SeedReference[] = [];
  for (const raw of input.seedReferences ?? []) {
    const provider = (raw?.provider ?? "").trim();
    const externalId = (raw?.externalId ?? "").trim();
    if (!provider || !externalId)
      throw new ValidationError("Cada referencia semilla requiere provider y externalId.");
    const key = JSON.stringify([provider, externalId]);
    if (seen.has(key))
      throw new ValidationError("La decisión Conferir tiene referencias semilla duplicadas.");
    seen.add(key);
    seedReferences.push(Object.freeze({ provider, externalId }));
  }

  return Object.freeze({
    decisionId,
    designatedWorkId: input.designatedWorkId,
    contentClass,
    seedReferences: Object.freeze(seedReferences),
  });
}

/**
 * Estado LOCAL inicial de una Identity recién nacida (antes de persistir → `handle` aún null).
 * NO tiene campo de referencias externas: su ausencia ES el invariante "Identity no posee
 * estado local de referencias" (Alternativa B). NO tiene redirección: nace sin destino.
 */
export interface BirthState {
  readonly handle: null;
  readonly state: IdentityLifeState;
  readonly contentClass: string;
  readonly designatedWorkId: number;
  readonly redirectsTo: null;
  readonly retired: false;
}

/**
 * Nacimiento de una Identity (invariantes LOCALES, puros): SIEMPRE activa, designando
 * EXACTAMENTE un contenido, sin destino de redirección, no retirada, con la clase fijada.
 * No consulta repositorios ni asigna handle (eso es del Registro/DB).
 */
export function birthIdentity(decision: ConferDecision): BirthState {
  return Object.freeze({
    handle: null,
    state: IDENTITY_STATE_ACTIVE,
    contentClass: decision.contentClass,
    designatedWorkId: decision.designatedWorkId,
    redirectsTo: null,
    retired: false,
  });
}

/** Identity conferida y persistida (con su handle). Lo que un Resultado EXECUTED/ALREADY expone. */
export interface ConferredIdentity {
  readonly handle: number;
  readonly state: IdentityLifeState;
  readonly contentClass: string;
  readonly designatedWorkId: number;
}

/**
 * Invariantes de dominio que el Registro puede reportar infringidos al conferir. Son códigos de
 * DOMINIO (no detalles de base). "Handle no fresco" NO figura: la estrategia de asignación
 * (sequence + filas nunca borradas) lo hace imposible (ver registro.ts).
 */
export const CONFER_INVARIANT = {
  /** El contenido ya está designado por una identidad activa (designación única). */
  DESIGNATION_TAKEN: "DESIGNATION_TAKEN",
  /** Una referencia semilla ya resuelve hacia otra identidad (unicidad de referencia). */
  REFERENCE_ALREADY_BOUND: "REFERENCE_ALREADY_BOUND",
  /** La clase declarada no coincide con la del contenido designado. */
  CONTENT_CLASS_INCOMPATIBLE: "CONTENT_CLASS_INCOMPATIBLE",
  /** El contenido designado no existe. */
  DESIGNATED_CONTENT_NOT_FOUND: "DESIGNATED_CONTENT_NOT_FOUND",
  /** El `decisionId` ya existe pero con una intención semántica distinta (reuso divergente). */
  DECISION_ID_REUSED_DIVERGENTLY: "DECISION_ID_REUSED_DIVERGENTLY",
} as const;
export type ConferInvariant = (typeof CONFER_INVARIANT)[keyof typeof CONFER_INVARIANT];

/**
 * Identidad SEMÁNTICA de una Decisión Conferir, en forma canónica y estable: contenido designado
 * + clase + referencias semilla como CONJUNTO (ordenado; el orden de las semillas no tiene
 * significado). Dos decisiones con el mismo `decisionId` son "la misma" sii comparten esta huella;
 * si difieren, es reuso divergente del identificador. Se persiste una vez al conferir y se compara
 * por igualdad exacta en el replay — sin releer las referencias ni reconstruir el conjunto.
 * `v:1` versiona el formato por si la identidad semántica se amplía en el futuro.
 */
export function conferDecisionFingerprint(decision: ConferDecision): string {
  const refs = decision.seedReferences
    .map((r) => [r.provider, r.externalId] as const)
    .sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return JSON.stringify({ v: 1, w: decision.designatedWorkId, c: decision.contentClass, r: refs });
}

/** Resultado de ejecución de Conferir (variantes REALMENTE alcanzables en esta slice). */
export type ConferResult =
  | { readonly kind: "EXECUTED"; readonly identity: ConferredIdentity }
  | { readonly kind: "ALREADY_SATISFIED"; readonly identity: ConferredIdentity }
  | { readonly kind: "REJECTED"; readonly invariant: ConferInvariant; readonly message: string };

export const executed = (identity: ConferredIdentity): ConferResult => ({ kind: "EXECUTED", identity });
export const alreadySatisfied = (identity: ConferredIdentity): ConferResult => ({ kind: "ALREADY_SATISFIED", identity });
export const rejected = (invariant: ConferInvariant, message: string): ConferResult => ({ kind: "REJECTED", invariant, message });

/**
 * Puerto del Registro de Identidad para Conferir. La infra lo implementa con Prisma; recibe una
 * Decisión y devuelve un Resultado de ejecución. No juzga (no decide si el contenido es nuevo),
 * no modifica la Decisión para volverla válida.
 */
export interface IdentityRegistro {
  confer(decision: ConferDecision): Promise<ConferResult>;
}
