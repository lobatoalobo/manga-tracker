/** Unit — helper de contacto WhatsApp (Slice P0). Puro, sin DB. */
import { describe, expect, it } from "vitest";
import { whatsappOrderLink } from "@/lib/retail/contact";

describe("whatsappOrderLink", () => {
  const order = { publicCode: "CRB-ABC123", totalCents: 90000 };

  it("teléfono con formato → link wa.me con solo dígitos y mensaje prearmado (publicCode incluido)", () => {
    const link = whatsappOrderLink({ whatsapp: "+54 9 11 5555-5555" }, order);
    expect(link).not.toBeNull();
    expect(link!.startsWith("https://wa.me/5491155555555?text=")).toBe(true);
    const text = decodeURIComponent(link!.split("text=")[1]);
    expect(text).toContain("CRB-ABC123");
  });

  it("sin teléfono → null (el botón se oculta)", () => {
    expect(whatsappOrderLink({ whatsapp: null }, order)).toBeNull();
    expect(whatsappOrderLink({ whatsapp: "" }, order)).toBeNull();
    expect(whatsappOrderLink({ whatsapp: "   " }, order)).toBeNull();
  });

  it("teléfono con muy pocos dígitos → null (guard)", () => {
    expect(whatsappOrderLink({ whatsapp: "123" }, order)).toBeNull();
  });

  it("el texto queda URL-encodeado (sin espacios crudos)", () => {
    const link = whatsappOrderLink({ whatsapp: "5491155555555" }, order)!;
    const encoded = link.split("text=")[1];
    expect(encoded).not.toContain(" ");
  });
});
