/** Errores del framework. Tipados para que el caller distinga la fase que falló. */

export class ValidationError extends Error {
  readonly phase = "validate" as const;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class PolicyError extends Error {
  readonly phase = "policy" as const;
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export class ConfirmationRequiredError extends Error {
  readonly phase = "confirm" as const;
  constructor(message = "Confirmación requerida y no provista.") {
    super(message);
    this.name = "ConfirmationRequiredError";
  }
}
