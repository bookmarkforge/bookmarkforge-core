/**
 * src/modules/translation/prompts/prompts.ts
 *
 * Typed access to the versioned prompt pack (`translation.prompts.json`).
 *
 * The JSON is the shipped artifact (task: "System Prompts exactos en formato
 * JSON"); this module is the ONLY reader. It validates the pack at import time
 * so a partial/corrupt pack fails closed instead of interpolating "undefined"
 * into a system prompt and silently degrading every translation.
 *
 * Prompt-injection posture: the source text is never concatenated into the
 * SYSTEM prompt. It only ever enters the user message, wrapped in <source>
 * (and <draft> for the review pass), and the system prompt states that those
 * blocks are data. Glossary rules ARE user-authored data, but they are
 * sanitized (single line, capped length) before inlining.
 */

import rawPack from "./translation.prompts.json";
import {
  localeDisplayName,
  MAX_GLOSSARY_CHARS,
  MAX_GLOSSARY_ENTRIES,
  REVIEW_TEMPERATURE,
  TRANSLATION_TEMPERATURE,
} from "../constants";
import type { GlossaryEntry } from "../types";

interface PromptTemplate {
  id: string;
  temperature: number;
  systemPrompt: string;
  userPromptTemplate: string;
  glossaryLineTemplate?: string;
  glossaryBlockTemplate?: string;
}

export interface TranslationPromptPack {
  version: string;
  contract: {
    output: string;
    temperature: number;
    maxTemperature: number;
    preserveMarkup: boolean;
    untrustedInputTags: string[];
    placeholderPatterns: string[];
  };
  translate: PromptTemplate;
  review: PromptTemplate;
}

function assertTemplate(name: string, value: unknown): asserts value is PromptTemplate {
  const tpl = value as Partial<PromptTemplate> | null;
  if (
    !tpl ||
    typeof tpl.id !== "string" ||
    typeof tpl.systemPrompt !== "string" ||
    tpl.systemPrompt.length === 0 ||
    typeof tpl.userPromptTemplate !== "string" ||
    tpl.userPromptTemplate.length === 0
  ) {
    throw new Error(`[translation] prompt pack is missing a valid "${name}" template`);
  }
}

function validatePack(pack: TranslationPromptPack): TranslationPromptPack {
  if (!pack || typeof pack !== "object" || typeof pack.version !== "string") {
    throw new Error("[translation] prompt pack has no version");
  }
  assertTemplate("translate", pack.translate);
  assertTemplate("review", pack.review);
  return pack;
}

const pack: TranslationPromptPack = Object.freeze(
  validatePack(rawPack as TranslationPromptPack),
);

export function getPromptPack(): TranslationPromptPack {
  return pack;
}

/**
 * Replace `{{token}}` placeholders with literal values.
 *
 * Deliberately NOT `String.replace(value, ...)`: an authored target-language
 * string containing `$&`, `$'` or ``$``` would otherwise be interpreted as a
 * replacement pattern and corrupt the prompt. Split/join treats every value as
 * bytes.
 */
function applyTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

/** Collapse a glossary field to a single safe line (no prompt structure). */
function sanitizeGlossaryField(value: string, maxChars: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, maxChars);
}

/**
 * Render the mandatory glossary rules appended to the translate system prompt.
 *
 * Entries are capped twice (count and total characters) so a large library
 * cannot crowd out the block being translated — the failure mode of an
 * over-long system prompt on a 3B model is dropped content, not better
 * terminology. Returns "" when there is nothing to inject.
 */
export function renderGlossaryRules(glossary: GlossaryEntry[] | undefined): string {
  const block = pack.translate.glossaryBlockTemplate;
  const line = pack.translate.glossaryLineTemplate;
  if (!block || !line || !glossary || glossary.length === 0) {return "";}

  const rendered: string[] = [];
  let used = 0;
  for (const entry of glossary.slice(0, MAX_GLOSSARY_ENTRIES)) {
    const source = sanitizeGlossaryField(String(entry.source ?? ""), 120);
    const target = sanitizeGlossaryField(String(entry.target ?? ""), 160);
    if (!source || !target || source === target) {continue;}
    const note = sanitizeGlossaryField(String(entry.note ?? ""), 120);
    const renderedLine = applyTemplate(line, {
      source,
      target,
      noteSuffix: note ? ` (${note})` : "",
    });
    if (used + renderedLine.length > MAX_GLOSSARY_CHARS) {break;}
    rendered.push(renderedLine);
    used += renderedLine.length + 1;
  }
  if (rendered.length === 0) {return "";}
  return applyTemplate(block, { glossaryLines: rendered.join("\n") });
}

export interface BuildTranslatePromptOptions {
  sourceLocale: string;
  targetLocale: string;
  glossary?: GlossaryEntry[];
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  /** Prompt-pack ids, so cached pairs can be invalidated on a prompt change. */
  translatePromptId: string;
  version: string;
}

/**
 * Build the pass-1 (fidelity translation) prompt for one chunk.
 *
 * Temperature is pinned here, not by the caller: the pipeline cannot
 * accidentally ask a 3B model to be creative.
 */
export function buildTranslatePrompt(
  text: string,
  options: BuildTranslatePromptOptions,
): BuiltPrompt {
  const sourceLanguageName = localeDisplayName(options.sourceLocale);
  const targetLanguageName = localeDisplayName(options.targetLocale);
  const glossaryRules = renderGlossaryRules(options.glossary);

  const systemBase = applyTemplate(pack.translate.systemPrompt, {
    sourceLanguageName,
    sourceLocale: options.sourceLocale,
    targetLanguageName,
    targetLocale: options.targetLocale,
  });

  return {
    systemPrompt: glossaryRules ? `${systemBase}\n\n${glossaryRules}` : systemBase,
    userPrompt: applyTemplate(pack.translate.userPromptTemplate, { text }),
    temperature: TRANSLATION_TEMPERATURE,
    translatePromptId: pack.translate.id,
    version: pack.version,
  };
}

export interface BuildReviewPromptOptions {
  sourceLocale: string;
  targetLocale: string;
  glossary?: GlossaryEntry[];
}

/**
 * Build the pass-2 (editorial review) prompt.
 *
 * The draft is untrusted data exactly like the source: a model that echoed an
 * injected instruction into its draft must not get that instruction executed
 * on the second pass.
 */
export function buildReviewPrompt(
  sourceText: string,
  draftTranslation: string,
  options: BuildReviewPromptOptions,
): BuiltPrompt {
  const sourceLanguageName = localeDisplayName(options.sourceLocale);
  const targetLanguageName = localeDisplayName(options.targetLocale);
  const glossaryRules = renderGlossaryRules(options.glossary);

  const systemBase = applyTemplate(pack.review.systemPrompt, {
    sourceLanguageName,
    sourceLocale: options.sourceLocale,
    targetLanguageName,
    targetLocale: options.targetLocale,
  });

  return {
    systemPrompt: glossaryRules ? `${systemBase}\n\n${glossaryRules}` : systemBase,
    userPrompt: applyTemplate(pack.review.userPromptTemplate, {
      sourceText,
      draftTranslation,
    }),
    temperature: REVIEW_TEMPERATURE,
    translatePromptId: pack.review.id,
    version: pack.version,
  };
}

