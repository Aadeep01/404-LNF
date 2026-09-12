export type TranslationStatus = "pending" | "machine_translated" | "edited" | "approved";

export interface Project {
  id: string;
  sourceLanguage: string;
  targetLanguage: string;
  rootUrl: string;
}
