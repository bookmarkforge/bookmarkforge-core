# Python Translation Engine Integration

## Overview

The Python translation engine is a **FUTURE FEATURE** that bridges BookmarkForge to an external Python FastAPI server running on `localhost:8000`. This provides an alternative to the browser-native engines (WebLLM, Ollama, NLLB) for users who:

- Have limited RAM (< 4GB) and no WebGPU
- Prefer Hugging Face models with automatic GPU/NPU detection
- Want lighter-weight models (Opus-MT 250MB vs WebLLM 2GB+)
- Have a dedicated GPU/NPU that the Python server can detect

## Architecture

```
Browser (BookmarkForge)
    │
    ├─► translationService.translate()
    │       │
    │       ├─► TranslationPipeline
    │       │       │
    │       │       ├─► selectTranslationEngine() → "python"
    │       │       │
    │       │       ├─► runGeneration() → pythonGenerate()
    │       │       │       │
    │       │       │       └─► HTTP POST http://localhost:8000/translate
    │       │       │
    │       │       └─► (no worker, direct HTTP)
    │
    └─► Python FastAPI Server (localhost:8000)
            │
            ├─► Auto-detects GPU/NPU (CUDA, MPS, DirectML)
            ├─► Loads Hugging Face models (Opus-MT, NLLB-200, M2M100)
            └─► Returns translation
```

## Implementation Details

### Files Modified/Created

| File | Change | Purpose |
|------|--------|---------|
| `src/modules/translation/types.ts` | Modified | Added "python" to `TranslationEngineId`, "python-api" to `TranslationEngineRuntime`, "python-unreachable" to `TranslationEngineUnavailableReason`, "pythonReachable" to `TranslationCapabilities` |
| `src/modules/translation/constants.ts` | Modified | Added `PYTHON_DEFAULT_ENDPOINT`, `PYTHON_DEFAULT_MODEL`, `PYTHON_PROBE_TIMEOUT_MS`, `PYTHON_MODELS` array, added "python" to `PRO_ENGINES` |
| `src/modules/translation/engines/pythonEngine.ts` | **Created** | HTTP adapter for Python API with `probePythonEndpoint()`, `pythonGenerate()`, `listPythonModels()` |
| `src/modules/translation/engines/engineCatalog.ts` | Modified | Added python to `describeLocal()`, `defaultModelFor()`, `listEngineDescriptors()`, `engineFamily()` |
| `src/modules/translation/engines/engineSelector.ts` | Modified | Added python to `localEngineBlocker()`, default chain `"webllm" → "ollama" → "nllb" → "python"`, `listAvailableEngines()` |
| `src/modules/translation/engines/capabilities.ts` | Modified | Added `pythonReachable` probe using `probePythonEndpoint()` |
| `src/modules/translation/TranslationPipeline.ts` | Modified | Added python to `initLocalEngine()` exclusion, `runGeneration()` python branch, `shouldReview()` python exclusion |
| `src/modules/translation/index.ts` | Modified | Exported `probePythonEndpoint`, `pythonGenerate`, `listPythonModels` |
| `src/modules/translation/README.md` | Modified | Added python to engine matrix |
| `src/utils/networkFirewall.ts` | Modified | Added `pythonTranslation` preset for `http://localhost:8000` |

### Engine Configuration

```typescript
// constants.ts
export const PYTHON_DEFAULT_ENDPOINT = "http://localhost:8000";
export const PYTHON_DEFAULT_MODEL = "opus-mt";
export const PYTHON_PROBE_TIMEOUT_MS = 2_500;

export const PYTHON_MODELS: TranslationModelOption[] = [
  {
    id: "opus-mt",
    label: "Opus-MT (Python API)",
    engine: "python",
    downloadBytes: 250_000_000,
    requiresWebGPU: false,
    minDeviceMemoryGB: 2,
    multilingual: false, // En-Es only by default
    recommended: true, // Best for low-RAM devices
  },
  {
    id: "m2m100",
    label: "M2M100-418M (Python API)",
    engine: "python",
    downloadBytes: 400_000_000,
    requiresWebGPU: false,
    minDeviceMemoryGB: 3,
    multilingual: true,
    recommended: false,
  },
  {
    id: "nllb-200",
    label: "NLLB-200-600M (Python API)",
    engine: "python",
    downloadBytes: 1_200_000_000,
    requiresWebGPU: false,
    minDeviceMemoryGB: 4,
    multilingual: true,
    recommended: false,
  },
];
```

### Engine Selection Flow

The Python engine is **Pro-only** and follows this priority:

1. **WebLLM** (WebGPU, best quality, 2GB+ download)
2. **Ollama** (loopback, if installed, 0 download)
3. **NLLB** (WASM, 650MB download, no WebGPU needed)
4. **Python** (HTTP, external server, 0 download, requires server running)
5. **Cloud** (BYOK, only if configured)

The selector checks `capabilities.pythonReachable` which probes `GET /health` on the Python server.

### Python API Contract

The Python server must implement:

```http
GET /health
→ { "status": "healthy", "device": "cuda|cpu", ... }

GET /models
→ { "models": [{ "id": "opus-mt", "name": "Opus-MT" }, ...] }

POST /translate?text=...&model=opus-mt&clean_code=false
→ { "original": "...", "translated": "...", "model": "opus-mt", "translation_time": "0.5s" }
```

### Network Requirements

- **CSP**: `connect-src` must allow `http://localhost:8000`
- **Network Firewall**: `pythonTranslation` preset added to whitelist
- **Endpoint**: Configurable via `PYTHON_DEFAULT_ENDPOINT` constant

## Usage

### 1. Start Python Server

```bash
# In D:\TRADUCTOR\
iniciar_servidor.bat

# Or manually:
python main.py
```

The server runs on `http://localhost:8000` with:
- Automatic GPU/NPU detection
- Model caching
- Rate limiting
- Security validation

### 2. Use in BookmarkForge

```typescript
import { translationService } from "@/modules/translation";

// Auto-selects best available engine
await translationService.translate({
  documentId: "doc-123",
  text: "Hello world",
  sourceLocale: "en",
  targetLocale: "es",
  engine: "auto", // or "python" for explicit selection
  onEvent: (event) => {
    if (event.type === "engine-selected") {
      console.log("Engine:", event.engine); // "python"
    }
  },
});
```

### 3. Explicit Engine Selection

```typescript
await translationService.translate({
  documentId: "doc-123",
  text: "Hello world",
  sourceLocale: "en",
  targetLocale: "es",
  engine: "python", // Explicit Python engine
  // Optional: specify model
  // modelId is selected from PYTHON_MODELS catalog
});
```

## Privacy & Security

- **Data stays local**: Python server runs on localhost, no data leaves device
- **No API keys needed**: Unlike cloud engines, no BYOK required
- **Pro feature**: Requires Pro license (local translation is Pro)
- **Network firewall**: localhost:8000 added to whitelist presets
- **Rate limiting**: Python server has built-in rate limiting (100 req/min)

## Performance Comparison

| Engine | RAM Min | Download | GPU Required | Quality | Speed |
|--------|---------|----------|--------------|---------|-------|
| WebLLM | 4GB | 2GB | WebGPU | Excellent | Fast |
| Ollama | 8GB | 0 | No | Excellent | Medium |
| NLLB | 4GB | 650MB | No | Good | Medium |
| **Python** | **2GB** | **0** | **No** | **Good** | **Fast** |
| Cloud | 0 | 0 | No | Excellent | Variable |

**Python engine advantages:**
- Lowest RAM requirement (2GB vs 4GB for others)
- No download required (server handles models)
- Automatic GPU detection (uses GPU if available, CPU otherwise)
- Multiple model options (Opus-MT, NLLB-200, M2M100)

## Future Enhancements

- [ ] Streaming support (Python API currently returns full text)
- [ ] Review pass support (currently disabled for python engine)
- [ ] Custom endpoint configuration via settings UI
- [ ] Model selection UI for python engine
- [ ] Health check UI showing server status
- [ ] Auto-start Python server option

## Troubleshooting

### "python-unreachable" error

The Python server is not running. Start it:
```bash
cd D:\TRADUCTOR
iniciar_servidor.bat
```

### "pro-required" error

Python engine is a Pro feature. Upgrade to Pro or use cloud engine.

### Slow translations

Check if GPU is being used:
```bash
curl http://localhost:8000/health
# Should show "device": "cuda" if GPU detected
```

### Model not found

List available models:
```bash
curl http://localhost:8000/models
```

## References

- Python Server: `D:\TRADUCTOR\main.py`
- Python Config: `D:\TRADUCTOR\config.py`
- Python Docs: `D:\TRADUCTOR\OPTIMIZACIONES.md`
- BookmarkForge Module: `src/modules/translation/`
