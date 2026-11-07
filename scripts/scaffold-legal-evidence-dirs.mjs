#!/usr/bin/env node
/**
 * scripts/scaffold-legal-evidence-dirs.mjs — create the evidence folders the
 * register points at.
 *
 * legal/REGISTRO.md names one evidence_ref per provider (proveedores/<id>/)
 * and legal/README.md names three more folders. None of them existed: a
 * reference that resolves to nothing is a promise the project cannot keep,
 * and no gate noticed because the gate only checked that the register existed.
 *
 * The script is idempotent: it never overwrites an existing file.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, "..");
const LEGAL = join(ROOT, "legal");

/** Vendor folders, keyed by the register's provider id. */
const VENDORS = {
  whop: ["Whop", "checkout, licence, refunds, payouts"],
  netlify: ["Netlify", "hosting of the landing and the web app"],
  github: ["GitHub", "repository, issues, CI/CD"],
  email: ["Transactional e-mail provider", "service, onboarding and support messages"],
  "error-monitoring": ["Remote error monitoring (Sentry)", "opt-in crash reports"],
  webrtc: ["Signalling relay", "P2P sync rendezvous (rxdb.info / PubNub)"],
  "ai-user-configured": ["AI providers chosen by the user", "prompts sent by the user to a provider they configured"],
  "domain-dns": ["Domain registrar / DNS", "registration of bookmarkforgeapp.com"],
  "user-cloud": ["Storage providers chosen by the user", "encrypted backups the user uploads to their own cloud"],
};

const TOP_LEVEL = {
  evidencias:
    "# Evidencias\n\nRedacted evidence that must NOT contain secrets: screenshots of the\nWhop seller role, signed acceptance e-mails, invoices, provider\ncorrespondence. Reference them from `legal/REGISTRO.md` (`evidence_ref`).\n",
  revisiones:
    "# Revisiones\n\nDated legal / privacy review notes (one file per review, named\n`YYYY-MM-DD-<topic>.md`). Every entry must say what was reviewed, who\nreviewed it and what the open items are.\n",
};

function writeIfMissing(file, content) {
  if (existsSync(file)) return false;
  writeFileSync(file, content, "utf8");
  return true;
}

let created = 0;
mkdirSync(join(LEGAL, "proveedores"), { recursive: true });
for (const [id, [name, purpose]] of Object.entries(VENDORS)) {
  const dir = join(LEGAL, "proveedores", id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "README.md");
  const content =
    `# ${name}\n\n` +
    `Purpose in BookmarkForge: ${purpose}.\n\n` +
    `Store here the signed DPA, the terms accepted, the SCC / transfer\n` +
    `assessment, the sub-processor list and a short data-flow note. No secrets,\n` +
    `no full payment credentials, no unredacted customer data.\n\n` +
    `Current state: no evidence stored yet — see the row for this provider in\n` +
    `\`legal/REGISTRO.md\` for the status and the next action.\n`;
  if (writeIfMissing(file, content)) {
    created += 1;
    console.log(`created legal/proveedores/${id}/README.md`);
  }
}
for (const [name, content] of Object.entries(TOP_LEVEL)) {
  const dir = join(LEGAL, name);
  mkdirSync(dir, { recursive: true });
  if (writeIfMissing(join(dir, "README.md"), content)) {
    created += 1;
    console.log(`created legal/${name}/README.md`);
  }
}
console.log(`scaffolded ${created} new file(s)`);
