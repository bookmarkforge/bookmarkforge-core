/**
 * saveClipboardImage.ts — persist a clipboard/pasted image as an encrypted
 * document attachment inside the local vault.
 *
 * Flow: initDB() reads the unlocked vault credential (same boundary as every
 * other write path) → attachmentStore.persistFile stores the bytes in the
 * encrypted documentAttachments collection → a document is created whose
 * single BlockNote image block references `bmf-attachment://<id>`, so the
 * editor hydrates and renders it like any uploaded image.
 */
import { initDB } from "../../container/database";
import { generateId } from "../../utils/id";
import { attachmentStore, attachmentUrl } from "../../services/documentAttachments";
import { safeGet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";

export interface SaveClipboardImageResult {
  documentId: string;
}

export async function saveClipboardImage(
  payload: { blob: Blob; filename: string },
  title?: string,
): Promise<SaveClipboardImageResult> {
  const db = await initDB();
  const documentId = generateId();
  const attachmentId = await attachmentStore.persistFile(
    documentId,
    payload.blob,
    payload.filename,
    db,
  );
  await db.documents.insert({
    id: documentId,
    folderId: "root",
    title: title?.trim() || payload.filename,
    blocks: [
      {
        type: "image",
        props: { url: attachmentUrl(attachmentId), name: payload.filename },
      },
    ],
    textContent: "",
    tags: ["pasted-image"],
    links: [],
    embedding: [],
    processed: false,
    isPrivate: safeGet(STORAGE_KEYS.DEFAULT_PRIVATE) === "true",
    isDeleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { documentId };
}
