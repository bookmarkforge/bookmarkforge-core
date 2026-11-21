/* Open Core placeholder: generated type surface of the proprietary module
   `src/modules/translation/pro/ProLocalEngine.ts`. No implementation is present in this repository. */
import type { LocalEngineGenerateOptions, LocalEngineInitOptions } from "../types";
declare class ProLocalEngine {
    private worker;
    private pending;
    private generation;
    private activeTranslateId;
    private initializedKey;
    private webllmModelId;
    private get isWebLLM();
    get isLoaded(): boolean;
    private ensureWorker;
    private handleMessage;
    private post;
    private request;
    init(options: LocalEngineInitOptions): Promise<void>;
    private initWebLLM;
    generate(options: LocalEngineGenerateOptions): Promise<string>;
    cancel(): void;
    dispose(): Promise<void>;
    private terminateWorker;
    private failAll;
}
export declare const proLocalEngine: ProLocalEngine;
export {};
