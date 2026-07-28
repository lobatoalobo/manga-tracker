import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_STATUS,
  canTransitionNotification, isNotificationEditable, assertNotificationEditable,
  sanitizeMessage, assertNonEmptyMessage, unnotifiedArrivalQuantity, assertValidSelection,
  buildArrivalMessage, reconcileSendKey, MAX_MESSAGE_LENGTH, type SelectionItem,
} from "@/lib/domain/retail/notification";
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

const code = (fn: () => unknown): string => {
  try { fn(); return "NO_THROW"; } catch (e) { return e instanceof RetailError ? e.code : "WRONG"; }
};

// ---------------------------------------------------------------------------
// State machine / editabilidad
// ---------------------------------------------------------------------------
describe("notification state machine", () => {
  it("DRAFT→SENT y DRAFT→CANCELLED; terminales no", () => {
    expect(canTransitionNotification("DRAFT", "SENT")).toBe(true);
    expect(canTransitionNotification("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransitionNotification("SENT", "CANCELLED")).toBe(false);
    expect(canTransitionNotification("SENT", "DRAFT")).toBe(false);
    expect(canTransitionNotification("CANCELLED", "SENT")).toBe(false);
  });
  it("solo DRAFT es editable", () => {
    expect(isNotificationEditable("DRAFT")).toBe(true);
    expect(isNotificationEditable("SENT")).toBe(false);
    expect(code(() => assertNotificationEditable("SENT"))).toBe(RETAIL_ERROR.NOTIFICATION_NOT_EDITABLE);
  });
});

// ---------------------------------------------------------------------------
// Mensaje
// ---------------------------------------------------------------------------
describe("mensaje", () => {
  it("sanitiza HTML y recorta", () => {
    expect(sanitizeMessage("  <b>hola</b>  ")).toBe("bhola/b");
    expect(sanitizeMessage("x".repeat(MAX_MESSAGE_LENGTH + 50)).length).toBe(MAX_MESSAGE_LENGTH);
  });
  it("exige no vacío", () => {
    expect(assertNonEmptyMessage("  hola  ")).toBe("hola");
    expect(code(() => assertNonEmptyMessage("   "))).toBe(RETAIL_ERROR.EMPTY_NOTIFICATION);
    expect(code(() => assertNonEmptyMessage("<>"))).toBe(RETAIL_ERROR.EMPTY_NOTIFICATION); // queda vacío tras sanear
  });
  it("mensaje sugerido incluye ítems y NADA de pago/retiro", () => {
    const msg = buildArrivalMessage({ customerName: "Nati", storeName: "Crumb", publicCode: "CRB-7K4P2M", items: [{ title: "Berserk", volumeNumber: 2, quantity: 1 }, { title: "Jujutsu Kaisen", volumeNumber: 13, quantity: 2 }] });
    expect(msg).toContain("Nati");
    expect(msg).toContain("Berserk 2 × 1");
    expect(msg).toContain("Jujutsu Kaisen 13 × 2");
    expect(msg).toContain("CRB-7K4P2M");
    expect(msg).toContain("llegaron a la tienda");
    for (const banned of ["transferir", "alias", "pagar", "listo para retirar", "vence", "dirección"]) expect(msg.toLowerCase()).not.toContain(banned);
  });
});

// ---------------------------------------------------------------------------
// Cantidades informadas / selección
// ---------------------------------------------------------------------------
describe("cantidades y selección", () => {
  it("unnotifiedArrivalQuantity = arrived - notified (no negativo)", () => {
    expect(unnotifiedArrivalQuantity(5, 2)).toBe(3);
    expect(unnotifiedArrivalQuantity(2, 5)).toBe(0);
  });
  const sel = (lineId: number, qty: number, pending: number): SelectionItem => ({ orderLineId: lineId, quantity: qty, pendingUnnotified: pending });
  it("consolida ítems repetidos y valida tope", () => {
    const m = assertValidSelection([sel(1, 1, 3), sel(2, 2, 2), sel(1, 1, 3)]);
    expect(m.get(1)).toBe(2);
    expect(m.get(2)).toBe(2);
  });
  it("rechaza vacío, cantidad inválida, exceso y ya informado", () => {
    expect(code(() => assertValidSelection([]))).toBe(RETAIL_ERROR.EMPTY_NOTIFICATION);
    expect(code(() => assertValidSelection([sel(1, 0, 3)]))).toBe(RETAIL_ERROR.INVALID_NOTIFICATION_QUANTITY);
    expect(code(() => assertValidSelection([sel(1, 4, 3)]))).toBe(RETAIL_ERROR.ARRIVAL_NOTIFICATION_EXCEEDS_PENDING);
    expect(code(() => assertValidSelection([sel(1, 1, 0)]))).toBe(RETAIL_ERROR.ARRIVAL_ALREADY_NOTIFIED);
  });
});

// ---------------------------------------------------------------------------
// Idempotencia del envío
// ---------------------------------------------------------------------------
describe("reconcileSendKey", () => {
  it("sin dueño → false; misma notificación → true; otra → conflicto", () => {
    expect(reconcileSendKey(null, 10)).toBe(false);
    expect(reconcileSendKey({ notificationId: 10, sendOperationKey: "k" }, 10)).toBe(true);
    expect(code(() => reconcileSendKey({ notificationId: 11, sendOperationKey: "k" }, 10))).toBe(RETAIL_ERROR.NOTIFICATION_OPERATION_KEY_CONFLICT);
  });
});
