import { get, set, del, keys } from "idb-keyval";
import { ScannedDocument } from "../types";

const DOCS_KEY_PREFIX = "vietscan_doc_";
const SETTINGS_KEY = "vietscan_settings";

export interface UserSettings {
  autoCaptureEnabled: boolean;
  defaultFilter: string;
  cameraResolution: "high" | "standard";
  ocrLanguage: "vie" | "eng";
  hapticFeedback: boolean;
  twoSidedCardMargin: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  autoCaptureEnabled: true,
  defaultFilter: "document",
  cameraResolution: "high",
  ocrLanguage: "vie",
  hapticFeedback: true,
  twoSidedCardMargin: 10,
};

export class StorageService {
  /**
   * Save or update a scanned document
   */
  static async saveDocument(doc: ScannedDocument): Promise<void> {
    const key = `${DOCS_KEY_PREFIX}${doc.id}`;
    await set(key, doc);
  }

  /**
   * Get all saved documents sorted by updatedAt DESC
   */
  static async getAllDocuments(): Promise<ScannedDocument[]> {
    const allKeys = await keys();
    const docKeys = allKeys.filter((k) => typeof k === "string" && k.startsWith(DOCS_KEY_PREFIX));
    const docs: ScannedDocument[] = [];

    for (const k of docKeys) {
      const doc = await get<ScannedDocument>(k);
      if (doc) docs.push(doc);
    }

    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get single document by ID
   */
  static async getDocumentById(id: string): Promise<ScannedDocument | undefined> {
    return get<ScannedDocument>(`${DOCS_KEY_PREFIX}${id}`);
  }

  /**
   * Delete a document by ID
   */
  static async deleteDocument(id: string): Promise<void> {
    await del(`${DOCS_KEY_PREFIX}${id}`);
  }

  /**
   * Clear all documents
   */
  static async clearAllDocuments(): Promise<void> {
    const allKeys = await keys();
    const docKeys = allKeys.filter((k) => typeof k === "string" && k.startsWith(DOCS_KEY_PREFIX));
    for (const k of docKeys) {
      await del(k);
    }
  }

  /**
   * Get User Settings
   */
  static async getSettings(): Promise<UserSettings> {
    const saved = await get<UserSettings>(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  /**
   * Save User Settings
   */
  static async saveSettings(settings: UserSettings): Promise<void> {
    await set(SETTINGS_KEY, settings);
  }

  /**
   * Calculate storage estimate
   */
  static async getStorageUsage(): Promise<{ usedBytes: number; count: number }> {
    const docs = await this.getAllDocuments();
    let totalLength = 0;
    for (const d of docs) {
      for (const p of d.pages) {
        totalLength += (p.processedImage?.length || 0) + (p.originalImage?.length || 0);
      }
    }
    return {
      usedBytes: totalLength,
      count: docs.length,
    };
  }
}
