import { describe, it, expect } from "vitest";
import {
  planPullTargets,
  validateRegistry,
  isPrimed,
} from "../pull-prod-images.mjs";

// Helpers para construir líneas de `docker images --format "{{.Repository}}:{{.Tag}}"`.
const web = (sha) => `bookmarkforge/web:${sha}`;
const api = (sha) => `bookmarkforge/api:${sha}`;

describe("validateRegistry", () => {
  it("acepta host y host:puerto, pero no rutas ni traversal", () => {
    expect(validateRegistry("registry.example.com")).toBe(true);
    expect(validateRegistry("registry.example.com:5000")).toBe(true);
    expect(validateRegistry("registry.example.com:65535")).toBe(true);
    expect(validateRegistry("registry.example.com/path")).toBe(false);
    expect(validateRegistry("registry..example.com")).toBe(false);
    expect(validateRegistry("registry.example.com\\path")).toBe(false);
    expect(validateRegistry("registry.example.com:0")).toBe(false);
    expect(validateRegistry("registry.example.com:65536")).toBe(false);
  });
});

describe("planPullTargets", () => {
  it("compone remote+local para web y api con sha válido y registro", () => {
    const targets = planPullTargets("a1b2c3d", "registry.example.com:5000");
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({
      name: "web",
      remote: "registry.example.com:5000/bookmarkforge/web:a1b2c3d",
      local: "bookmarkforge/web:a1b2c3d",
    });
    expect(targets[1]).toEqual({
      name: "api",
      remote: "registry.example.com:5000/bookmarkforge/api:a1b2c3d",
      local: "bookmarkforge/api:a1b2c3d",
    });
  });

  it("normaliza el / final del registro", () => {
    const targets = planPullTargets("a1b2c3d", "reg.example.com:5000/");
    expect(targets[0].remote).toBe("reg.example.com:5000/bookmarkforge/web:a1b2c3d");
  });

  it("devuelve [] con sha vacío o malformado (nada que primar)", () => {
    expect(planPullTargets("", "reg.example.com")).toEqual([]);
    expect(planPullTargets("not-hex", "reg.example.com")).toEqual([]);
    expect(planPullTargets("a1b2c", "reg.example.com")).toEqual([]); // <7 hex
    expect(planPullTargets("a1b2c3d".repeat(2), "reg.example.com")).toEqual([]); // >12 hex
  });

  it("devuelve [] sin registro configurado o con sha válido pero sin registro", () => {
    expect(planPullTargets("a1b2c3d", "")).toEqual([]);
    expect(planPullTargets("a1b2c3d", null)).toEqual([]);
    expect(planPullTargets("a1b2c3d", "   ")).toEqual([]);
  });

  it("acepta letras hex mayúsculas", () => {
    const targets = planPullTargets("ABCDEF7", "reg.example.com");
    expect(targets).toHaveLength(2);
    expect(targets[0].local).toBe("bookmarkforge/web:ABCDEF7");
  });
});

describe("isPrimed", () => {
  it("true solo si web Y api locales por ese sha", () => {
    const list = [web("a1b2c3d"), api("a1b2c3d")];
    expect(isPrimed("a1b2c3d", list)).toBe(true);
  });

  it("false si falta alguna de las dos imágenes por ese sha", () => {
    expect(isPrimed("a1b2c3d", [web("a1b2c3d")])).toBe(false); // falta api
    expect(isPrimed("a1b2c3d", [api("a1b2c3d")])).toBe(false); // falta web
    expect(isPrimed("a1b2c3d", [])).toBe(false);
  });

  it("no se confunde con otras tags (otro sha, latest, otro host)", () => {
    const list = [web("zz99999"), web("latest"), api("a1b2c3d")];
    // web del sha pedido NO está (solo web:zz99999), api sí → no primado
    expect(isPrimed("a1b2c3d", list)).toBe(false);
  });

  it("true insensible al orden del listado", () => {
    const list = [api("a1b2c3d"), "web/otro:tag", web("a1b2c3d")];
    expect(isPrimed("a1b2c3d", list)).toBe(true);
  });

  it("false con sha vacío/inválido o si el listado falló (no-array)", () => {
    expect(isPrimed("", [web("a"), api("a")])).toBe(false);
    expect(isPrimed("a1b2c3d", null)).toBe(false);
    expect(isPrimed("a1b2c3d", undefined)).toBe(false);
  });
});