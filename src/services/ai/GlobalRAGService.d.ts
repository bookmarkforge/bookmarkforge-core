/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/ai/GlobalRAGService.ts`. No implementation is present in this repository. */
export interface RAGResult {
    id: string;
    title: string;
    content: string;
    type: "bookmark" | "document";
    score: number;
    url?: string;
}
declare class GlobalRAGService {
    searchContext(query: string, limit?: number, excludeParentId?: string, signal?: AbortSignal, includePrivate?: boolean): Promise<RAGResult[]>;
    formatContext(results: RAGResult[]): string;
}
export declare const globalRAGService: GlobalRAGService;
export {};
