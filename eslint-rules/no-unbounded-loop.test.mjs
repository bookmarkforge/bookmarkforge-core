// @vitest-environment node
/**
 * eslint-rules/no-unbounded-loop.test.mjs
 *
 * Vitest unit tests for the no-unbounded-loop rule via ESLint's RuleTester.
 * The rule is pure JS AST (no TS/JSX surface), so the default parser is
 * enough — no tseslint setup needed.
 */
import { describe } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-unbounded-loop.mjs";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

describe("no-unbounded-loop", () => {
  ruleTester.run("no-unbounded-loop", rule, {
    valid: [
      // Iteration cap: counter-vs-constant break (the pruneVersions fix
      // shape).
      `for (;;) { if (iterations >= MAX_ITERATIONS) break; iterations++; processBatch(); }`,
      // Counter compared against a numeric literal.
      `while (true) { if (count >= 100) break; count += 1; work(); }`,
      // Reversed comparison order.
      `for (;;) { if (MAX_ITERATIONS <= iterations) break; iterations++; }`,
      // Member-expression counter and cap.
      `for (;;) { if (this.iterations >= this.MAX_ITERATIONS) break; this.iterations++; work(); }`,
      // Assignment-form counter update.
      `for (;;) { if (iterations >= MAX_ITERATIONS) break; iterations = iterations + 1; }`,
      // Cap exit via throw (defense-in-depth pattern).
      `while (true) { if (batchIndex >= MAX_SYNC_BATCHES) throw new Error("cap"); batchIndex++; }`,
      // Cap break inside try.
      `for (;;) { try { if (iterations >= MAX_ITERATIONS) break; } catch {} iterations++; }`,
      // Stream reader: `.read()` call — bounded by the protocol's done flag.
      `while (true) { const { done, value } = await reader.read(); if (done) break; consume(value); }`,
      `for (;;) { const chunk = await fileReader.read(); if (!chunk) break; append(chunk); }`,
      // Unconditional exits — the body runs at most once.
      `for (;;) { doOnce(); break; }`,
      `function f() { while (true) { return next(); } }`,
      // Loops bounded by their own test are OUT of scope.
      `while (i < MAX_ITERATIONS) { i++; }`,
      `for (let i = 0; i < MAX_ITERATIONS; i++) { work(i); }`,
      // while(1) with a cap is fine too.
      `while (1) { if (attempts >= MAX_ATTEMPTS) break; attempts++; }`,
    ],

    invalid: [
      // The pruneVersions bug shape: batch loop whose only exits are
      // data-volume checks — a collection returning full batches forever
      // allocates until OOM.
      {
        filename: "src/tests/services/GarbageCollectionService.test.ts",
        code: `for (;;) { const batch = await getBatch(); if (batch.length === 0) break; if (batch.length < BATCH_SIZE) break; }`,
        errors: [{ messageId: "noCap" }],
      },
      // A bare `done` flag WITHOUT a reader `.read()` call is not bounded.
      {
        filename: "src/tests/services/GarbageCollectionService.test.ts",
        code: `while (true) { if (done) break; process(); }`,
        errors: [{ messageId: "noCap" }],
      },
      // Conditional return only — unbounded if the condition never holds.
      {
        filename: "src/tests/services/GarbageCollectionService.test.ts",
        code: `function f() { while (true) { if (shouldStop()) return; work(); } }`,
        errors: [{ messageId: "noCap" }],
      },
      // No exit at all.
      {
        filename: "src/tests/services/GarbageCollectionService.test.ts",
        code: `for (;;) { process(); }`,
        errors: [{ messageId: "noCap" }],
      },
      // A break inside a NESTED loop is not an exit of the outer loop.
      {
        code: `for (;;) { for (const item of items) { if (item) break; } }`,
        errors: [{ messageId: "noCap" }],
      },
      // A break inside a switch is not an exit of the loop.
      {
        code: `for (;;) { switch (x) { case 1: break; } }`,
        errors: [{ messageId: "noCap" }],
      },
      // Cap comparison references a name that is never updated — the counter
      // never progresses, so the cap can never be relied on.
      {
        code: `for (;;) { if (count >= MAX_ITERATIONS) break; }`,
        errors: [{ messageId: "noCap" }],
      },
      // Counter side is `items.length` (a length probe, not a mutated
      // counter) — data-volume exit, not an iteration cap.
      {
        code: `for (;;) { if (items.length >= MAX_ITERATIONS) break; items.push(x); }`,
        errors: [{ messageId: "noCap" }],
      },
      // Reader call on a non-reader identifier is not exempted.
      {
        code: `while (true) { const { done } = await stream.read(); if (done) break; }`,
        errors: [{ messageId: "noCap" }],
      },
    ],
  });
});
