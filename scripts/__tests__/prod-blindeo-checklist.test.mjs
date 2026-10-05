import { describe, expect, it } from "vitest";
import { check, evaluateChecklist, tailOutput } from "../prod-blindeo-checklist.mjs";

describe("prod-blindeo-checklist", () => {
  it("registra los 10 puntos principales", () => {
    const results = Array.from({ length: 10 }, (_, index) =>
      check(`${index + 1}. punto`, true, "ok"),
    );

    expect(results).toHaveLength(10);
    expect(results.map(({ label }) => label)).toEqual(
      Array.from({ length: 10 }, (_, index) => `${index + 1}. punto`),
    );
    expect(evaluateChecklist(results).ok).toBe(true);
  });

  it("hace fallar el checklist cuando un gate falla", () => {
    const results = [
      check("1. bundle", true),
      check("2. secrets", true),
      check("3. rxdb", false, "gate roto"),
      check("4. chunks", true),
    ];

    expect(evaluateChecklist(results)).toMatchObject({ ok: false });
    expect(results.find(({ label }) => label === "3. rxdb")).toMatchObject({
      ok: false,
      detail: "gate roto",
    });
  });

  it("conserva el tail del diagnóstico", () => {
    expect(tailOutput("123456", 3)).toBe("…456");
    expect(tailOutput("  ")).toBe("sin salida");
  });
});
