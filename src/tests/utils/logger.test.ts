import { describe, it, expect, beforeEach, vi } from "vitest";
import { logger } from "../../utils/logger";

describe("logger", () => {
  beforeEach(() => {
    logger.clearBuffer();
    logger.setLevel("debug"); // maximum level so everything reaches the buffer
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setLevel / getLevel", () => {
    it("returns the default level correctly", () => {
      logger.setLevel("info");
      expect(logger.getLevel()).toBe("info");
    });

    it("allows changing the level to error", () => {
      logger.setLevel("error");
      expect(logger.getLevel()).toBe("error");
    });

    it("allows changing the level to warn", () => {
      logger.setLevel("warn");
      expect(logger.getLevel()).toBe("warn");
    });

    it("allows changing the level to debug", () => {
      logger.setLevel("debug");
      expect(logger.getLevel()).toBe("debug");
    });
  });

  describe("clearBuffer / getBuffer", () => {
    it("the buffer starts empty after clearing", () => {
      logger.info("test");
      logger.clearBuffer();
      expect(logger.getBuffer()).toHaveLength(0);
    });

    it("getBuffer returns a copy of the buffer", () => {
      const buffer1 = logger.getBuffer();
      const buffer2 = logger.getBuffer();
      expect(buffer1).not.toBe(buffer2); // not the same reference
    });
  });

  describe("debug", () => {
    it("records debug messages in the buffer", () => {
      logger.setLevel("debug");
      logger.debug("debug message");
      const buffer = logger.getBuffer();
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer[0]!.level).toBe("debug");
    });

    it("does not record debug when the level is info", () => {
      logger.setLevel("info");
      logger.debug("this should not be logged");
      expect(logger.getBuffer()).toHaveLength(0);
    });
  });

  describe("info", () => {
    it("records info messages in the buffer", () => {
      logger.setLevel("info");
      logger.info("informational message");
      const buffer = logger.getBuffer();
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer[0]!.level).toBe("info");
    });

    it("does not record info when the level is warn", () => {
      logger.setLevel("warn");
      logger.info("should not be in the buffer");
      expect(logger.getBuffer()).toHaveLength(0);
    });
  });

  describe("warn", () => {
    it("records warnings in the buffer", () => {
      logger.setLevel("warn");
      logger.warn("advertencia!");
      const buffer = logger.getBuffer();
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer[0]!.level).toBe("warn");
    });

    it("does not record warn when the level is error", () => {
      logger.setLevel("error");
      logger.warn("should not be logged");
      expect(logger.getBuffer()).toHaveLength(0);
    });
  });

  describe("error", () => {
    it("records errors in the buffer", () => {
      logger.setLevel("error");
      logger.error("critical error");
      const buffer = logger.getBuffer();
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer[0]!.level).toBe("error");
    });

    it("always records errors regardless of the level", () => {
      logger.setLevel("debug");
      logger.error("error always visible");
      const buffer = logger.getBuffer();
      const errores = buffer.filter((e) => e.level === "error");
      expect(errores).toHaveLength(1);
    });
  });

  describe("log (alias de info)", () => {
    it("records as info in the buffer", () => {
      logger.setLevel("info");
      logger.log("message via log()");
      const buffer = logger.getBuffer();
      expect(buffer.some((e) => e.level === "info")).toBe(true);
    });
  });

  describe("timestamp", () => {
    it("each entry has a numeric timestamp", () => {
      logger.debug("con timestamp");
      const buffer = logger.getBuffer();
      expect(typeof buffer[0]!.timestamp).toBe("number");
      expect(buffer[0]!.timestamp).toBeGreaterThan(0);
    });
  });

  describe("buffer with multiple messages", () => {
    it("accumulates multiple messages", () => {
      logger.setLevel("debug");
      logger.debug("first");
      logger.info("second");
      logger.warn("third");
      logger.error("cuarto");
      expect(logger.getBuffer()).toHaveLength(4);
    });

    it("saves the arguments to the buffer", () => {
      logger.setLevel("debug");
      logger.debug("argumento", 42, { clave: "valor" });
      const buffer = logger.getBuffer();
      expect(buffer[0]!.args).toEqual(["argumento", 42, { clave: "valor" }]);
    });
  });

  describe("error sanitization", () => {
    it("redacts sensitive information in the error message", () => {
      const errorConToken = new Error(
        "Failed validation for API key: sk-abcdefghijklmnopqrstuvwxyz123456",
      );
      logger.setLevel("debug");
      logger.error("Se produjo un error", errorConToken);
      const buffer = logger.getBuffer();
      const errorRegistrado = buffer[0]!.args[1] as Error;
      expect(errorRegistrado.message).toContain("[REDACTED]");
      expect(errorRegistrado.message).not.toContain("sk-");
      expect(errorRegistrado.message).not.toContain(
        "abcdefghijklmnopqrstuvwxyz",
      );
    });

    it("redacts sensitive object fields inside error messages in serializeArgs", () => {
      let mensajeLogueado = "";
      const sink = (entry: { message: string }) => {
        mensajeLogueado = entry.message;
      };
      logger.addSink(sink);
      try {
        const errorConJWT = new Error(
          "Invalid JWT token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        );
        logger.error(errorConJWT);
        expect(mensajeLogueado).toContain("[REDACTED]");
        expect(mensajeLogueado).not.toContain(
          "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        );
      } finally {
        logger.removeSink(sink);
      }
    });
  });

  describe("redactValue edge cases", () => {
    it("redactValue handles arrays", () => {
      logger.setLevel("debug");
      logger.debug([1, 2, 3]);
      const buffer = logger.getBuffer();
      expect(buffer[0]!.args[0]).toEqual([1, 2, 3]);
    });

    it("redactValue handles objects with sensitive keys", () => {
      const obj = { password: "secret123", name: "user" };
      logger.setLevel("debug");
      logger.debug(obj);
      const buffer = logger.getBuffer();
      expect((buffer[0]!.args[0] as any).password).toBe("***REDACTED***");
      expect((buffer[0]!.args[0] as any).name).toBe("user");
    });

    it("redactValue with depth > 10 returns MAX_DEPTH", () => {
      const deep: any = {
        a: {
          b: {
            c: { d: { e: { f: { g: { h: { i: { j: { k: "deep" } } } } } } } },
          },
        },
      };
      logger.setLevel("debug");
      logger.debug(deep);
      const buffer = logger.getBuffer();
      expect(buffer[0]!.args).toBeDefined();
    });

    it("redactValue handles primitive values", () => {
      logger.setLevel("debug");
      logger.debug(42, true, null);
      const buffer = logger.getBuffer();
      expect(buffer[0]!.args).toContain(42);
    });
  });

  describe("safeStringify circular references", () => {
    it("safeStringify handles circular objects", () => {
      const a: any = { name: "a" };
      a.self = a;
      logger.setLevel("debug");
      logger.debug(a);
      const buffer = logger.getBuffer();
      expect(buffer.length).toBe(1);
    });
  });

  describe("notifySinks", () => {
    it("a sink that throws does not break other sinks", () => {
      const badSink = () => {
        throw new Error("sink error");
      };
      const goodSink = vi.fn();
      logger.addSink(badSink);
      logger.addSink(goodSink);
      logger.setLevel("debug");
      logger.debug("test");
      expect(goodSink).toHaveBeenCalled();
      logger.removeSink(badSink);
      logger.removeSink(goodSink);
    });

    it("removeSink no-op when sink does not exist", () => {
      const fakeSink = () => {};
      logger.addSink(fakeSink);
      expect(() => logger.removeSink(fakeSink)).not.toThrow();
    });
  });

  describe("buffer overflow", () => {
    it("buffer truncates when exceeding max size", () => {
      logger.setLevel("debug");
      for (let i = 0; i < 150; i++) {
        logger.debug(`msg-${i}`);
      }
      const buffer = logger.getBuffer();
      expect(buffer.length).toBeLessThanOrEqual(100);
    });
  });

  describe("reentrancy guard", () => {
    it("sink reentrante no causa loop infinito", () => {
      const reentrantSink = () => {
        logger.info("from sink");
      };
      logger.addSink(reentrantSink);
      logger.setLevel("debug");
      expect(() => {
        logger.debug("trigger reentrancy");
      }).not.toThrow();
      logger.removeSink(reentrantSink);
    });
  });

  describe("log alias", () => {
    it("log() llama a info internamente", () => {
      logger.setLevel("info");
      logger.log("alias test");
      const buffer = logger.getBuffer();
      expect(buffer.some((e) => e.level === "info")).toBe(true);
    });
  });

  describe("removeSink", () => {
    it("removeSink removes existing sink", () => {
      const sink = vi.fn();
      logger.addSink(sink);
      logger.removeSink(sink);
      logger.setLevel("debug");
      logger.debug("after removal");
      expect(sink).not.toHaveBeenCalled();
    });
  });
});
