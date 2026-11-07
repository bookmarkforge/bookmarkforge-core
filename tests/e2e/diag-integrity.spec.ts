import { expect, test, type Page } from "@playwright/test";
import { setupVault, VAULT_PASSWORD, expectUnlockedApp } from "./vault-helpers";

const dump = async (page: Page, label: string) => {
  const data = await page.evaluate(async () => {
    const ls: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) ls[k] = localStorage.getItem(k) ?? "";
    }
    const idb: Record<string, Record<string, string>> = {};
    const names = await indexedDB.databases();
    for (const { name } of names) {
      if (!name) continue;
      const records: Record<string, string> = {};
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          records[store] = await new Promise<string>((res, rej) => {
            const tx = db.transaction(store, "readonly");
            const out: string[] = [];
            const req = tx.objectStore(store).getAllKeys();
            req.onsuccess = () => {
              const keys = req.result as string[];
              keys.forEach((k) => out.push(String(k)));
              res(out.join("|") || "(empty)");
            };
            req.onerror = () => rej(req.error);
          });
        }
      } finally {
        db.close();
      }
      idb[name] = records;
    }
    return { ls, idb };
  });
  console.log(`\n===== ${label} =====\n${JSON.stringify(data, null, 1)}`);
};

// Read the raw values of the critical vault records from the `secrets`
// store (the spec originally read `kv-store`, which the WIP renamed).
const readSecrets = async (page: Page, keys: string[]) => {
  return await page.evaluate(async (ks) => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const db = await open("bookmarkforge_secure_vault");
    const read = (key: string) =>
      new Promise<string | null>((res, rej) => {
        const tx = db.transaction("secrets", "readonly");
        const req = tx.objectStore("secrets").get(key);
        req.onsuccess = () =>
          res(req.result == null ? null : JSON.stringify(req.result));
        req.onerror = () => rej(req.error);
      });
    const out: Record<string, string | null> = {};
    for (const k of ks) {
      out[k] = await read(k);
    }
    db.close();
    return out;
  }, keys);
};

test("diag integrity records", async ({ page }) => {
  await setupVault(page);
  await expectUnlockedApp(page);
  await dump(page, "after-setup");

  const CRITICAL_KEYS = [
    "vault_verification",
    "vault_verification_integrity",
    "bmf_device_key_wrapped",
    "master_password_setup",
    "vault_salt",
    "encrypted_db_key",
  ];
  const afterSetup = await readSecrets(page, CRITICAL_KEYS);

  await page.reload();
  await page.getByRole("heading", { name: "Vault is locked." }).waitFor();
  await dump(page, "after-reload");
  const afterReload = await readSecrets(page, CRITICAL_KEYS);
  console.log(
    `\n===== records (values, first 120 chars) =====\npw: ${VAULT_PASSWORD}\n` +
      CRITICAL_KEYS.map(
        (k) =>
          `${k}\n  after-setup : ${String(afterSetup[k]).slice(0, 120)}\n  after-reload: ${String(afterReload[k]).slice(0, 120)}\n  identical   : ${afterSetup[k] === afterReload[k]}`,
      ).join("\n"),
  );

  // Assertion-first conversion (2026-09-24). Until this line the spec was a
  // diagnostic, not a test: it computed exactly the property it exists for —
  // the critical vault records surviving a page reload byte-identical — and
  // then only PRINTED it ("identical: true/false"), so a regression that
  // re-wrapped or re-salted the records on unlock passed nightly. The dump
  // stays for triage; the property is now enforced.
  for (const key of CRITICAL_KEYS) {
    expect(
      afterReload[key],
      `${key} must survive the reload byte-identical (after-setup ${afterSetup[key]})`,
    ).toBe(afterSetup[key]);
  }
});
