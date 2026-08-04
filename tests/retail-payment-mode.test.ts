import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  puntosDeCobro,
  MATRIZ_COBRO,
  type ConfiguracionPago,
} from "@/lib/domain/retail/payment-mode";
import { MAX_SAFE_TOTAL_CENTS } from "@/lib/domain/retail/payment";

const TOTAL = 10_000; // $100.00

describe("payment-mode · matriz por modo (concepto CP1/CP2 + partición del total)", () => {
  it("sin_pago_previo → CP1 ninguno / CP2 total", () => {
    const { cp1, cp2 } = puntosDeCobro({ modo: "sin_pago_previo" }, TOTAL);
    expect(cp1).toEqual({ concepto: "ninguno", montoCents: 0 });
    expect(cp2).toEqual({ concepto: "total", montoCents: TOTAL });
    expect(cp1.montoCents + cp2.montoCents).toBe(TOTAL);
  });

  it("total → CP1 total / CP2 ninguno", () => {
    const { cp1, cp2 } = puntosDeCobro({ modo: "total" }, TOTAL);
    expect(cp1).toEqual({ concepto: "total", montoCents: TOTAL });
    expect(cp2).toEqual({ concepto: "ninguno", montoCents: 0 });
    expect(cp1.montoCents + cp2.montoCents).toBe(TOTAL);
  });

  it("sena → CP1 seña / CP2 saldo", () => {
    const { cp1, cp2 } = puntosDeCobro({ modo: "sena", tipo: "porcentaje", valor: 30 }, TOTAL);
    expect(cp1.concepto).toBe("sena");
    expect(cp2.concepto).toBe("saldo");
    expect(cp1.montoCents + cp2.montoCents).toBe(TOTAL);
  });

  it("MATRIZ_COBRO documenta los conceptos que resuelve puntosDeCobro", () => {
    expect(MATRIZ_COBRO).toEqual({
      sin_pago_previo: { cp1: "ninguno", cp2: "total" },
      sena: { cp1: "sena", cp2: "saldo" },
      total: { cp1: "total", cp2: "ninguno" },
    });
  });
});

describe("payment-mode · seña fija (con clamp)", () => {
  it("seña fija normal: CP1 = seña, CP2 = total − seña", () => {
    const { cp1, cp2 } = puntosDeCobro({ modo: "sena", tipo: "monto_fijo", valor: 2_500 }, TOTAL);
    expect(cp1.montoCents).toBe(2_500);
    expect(cp2.montoCents).toBe(7_500);
  });

  it("clamp: seña fija > precio ⇒ CP1 = total, CP2 = 0", () => {
    const { cp1, cp2 } = puntosDeCobro({ modo: "sena", tipo: "monto_fijo", valor: 99_999 }, TOTAL);
    expect(cp1.montoCents).toBe(TOTAL);
    expect(cp2.montoCents).toBe(0);
    expect(cp1.montoCents + cp2.montoCents).toBe(TOTAL);
  });
});

describe("payment-mode · seña porcentual", () => {
  it.each([
    [30, 3_000, 7_000],
    [50, 5_000, 5_000],
    [100, 10_000, 0],
  ])("%s%% de $100 → seña %s / saldo %s", (pct, sena, saldo) => {
    const { cp1, cp2 } = puntosDeCobro({ modo: "sena", tipo: "porcentaje", valor: pct }, TOTAL);
    expect(cp1.montoCents).toBe(sena);
    expect(cp2.montoCents).toBe(saldo);
  });
});

describe("payment-mode · redondeo absorbido por el saldo", () => {
  it("33% de un total impar redondea la seña y la suma sigue exacta", () => {
    const total = 3_333; // 33% = 1099.89 → round 1100
    const { cp1, cp2 } = puntosDeCobro({ modo: "sena", tipo: "porcentaje", valor: 33 }, total);
    expect(cp1.montoCents).toBe(1_100); // Math.round(3333*33/100)
    expect(cp2.montoCents).toBe(total - 1_100); // saldo absorbe el redondeo
    expect(cp1.montoCents + cp2.montoCents).toBe(total);
  });
});

describe("payment-mode · total cero (ítem sin cargo)", () => {
  it.each([
    { modo: "sin_pago_previo" } as ConfiguracionPago,
    { modo: "total" } as ConfiguracionPago,
    { modo: "sena", tipo: "monto_fijo", valor: 500 } as ConfiguracionPago,
    { modo: "sena", tipo: "porcentaje", valor: 50 } as ConfiguracionPago,
  ])("%o con total 0 ⇒ ambas celdas en 0, sin throw", (config) => {
    const { cp1, cp2 } = puntosDeCobro(config, 0);
    expect(cp1.montoCents).toBe(0);
    expect(cp2.montoCents).toBe(0);
  });
});

describe("payment-mode · configuraciones inválidas (error de dominio)", () => {
  it.each([0, -10, 150, NaN, Infinity])("porcentaje fuera de (0,100] (%s) lanza", (valor) => {
    expect(() => puntosDeCobro({ modo: "sena", tipo: "porcentaje", valor }, TOTAL)).toThrow();
  });

  it.each([0, -1, 1.5, MAX_SAFE_TOTAL_CENTS + 1])("seña fija inválida (%s) lanza", (valor) => {
    expect(() => puntosDeCobro({ modo: "sena", tipo: "monto_fijo", valor }, TOTAL)).toThrow();
  });

  it.each([-1, 1.5, NaN, MAX_SAFE_TOTAL_CENTS + 1])("total inválido (%s) lanza", (totalCents) => {
    expect(() => puntosDeCobro({ modo: "total" }, totalCents)).toThrow();
  });
});

describe("payment-mode · pureza e independencia del piloto", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/domain/retail/payment-mode.ts", import.meta.url)), "utf8");

  it("no importa react, prisma, componentes ni servicios (lib/retail)", () => {
    expect(src).not.toMatch(/from ["']react["']/);
    expect(src).not.toMatch(/@prisma\/client|["']\.\.?\/.*prisma/);
    expect(src).not.toMatch(/@\/components\//);
    expect(src).not.toMatch(/@\/lib\/retail\b/); // permite @/lib/domain/retail
  });

  it("no fija pilot.modoPago ni un modo por defecto hardcodeado (garantía sobre el CÓDIGO, no la doc)", () => {
    // Se escanea el código SIN comentarios: el header documenta que el piloto no se
    // fija acá, y esa mención no debe hacer fallar la garantía real.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/\bpilot\b/i);
    expect(codeOnly).not.toMatch(/modoPago/); // el modo lo inyecta el llamador, no vive acá
  });
});
