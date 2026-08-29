const MAX_CLOUD_DOWNLOAD_BYTES = 100 * 1024 * 1024;

async function cancelCloudResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup must not replace the original cloud response error.
  }
}

function getContentLength(response: Response): number | null {
  const raw = response.headers?.get?.("content-length");
  if (!raw) {return null;}
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeLimit(requested: number, hardCap: number): number {
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error("Response size limit must be a positive finite number");
  }
  const normalized = Math.floor(requested);
  if (normalized < 1) {
    throw new Error("Response size limit must be at least one byte");
  }
  return Math.min(normalized, hardCap);
}

/**
 * Reads a cloud download without allowing an unbounded response to materialize
 * in memory. The stream path checks the limit while receiving chunks; the
 * arrayBuffer fallback is retained for Response-like test/runtime objects that
 * do not expose a readable body.
 */
export async function readBoundedCloudResponse(
  response: Response,
  maxBytes: number = MAX_CLOUD_DOWNLOAD_BYTES,
): Promise<ArrayBuffer> {
  const boundedMaxBytes = normalizeLimit(maxBytes, MAX_CLOUD_DOWNLOAD_BYTES);
  const contentLength = getContentLength(response);
  if (contentLength !== null && contentLength > boundedMaxBytes) {
    await cancelCloudResponseBody(response);
    throw new Error(
      `Cloud download exceeds the ${Math.floor(boundedMaxBytes / 1024 / 1024)} MB limit`,
    );
  }

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    } catch (error) {
      await cancelCloudResponseBody(response);
      throw error;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {break;}
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > boundedMaxBytes) {
          // The surrounding catch performs the single cancellation. Keeping
          // cleanup in one place avoids calling cancel() twice on strict
          // ReadableStream implementations while preserving immediate abort.
          throw new Error(
            `Cloud download exceeds the ${Math.floor(boundedMaxBytes / 1024 / 1024)} MB limit`,
          );
        }
        chunks.push(chunk);
      }
    } catch (error) {
      try {await reader.cancel();} catch { /* INTENTIONAL SILENCE: preserve the primary cloud response error. */ }
      throw error;
    } finally {
      try {reader.releaseLock();} catch { /* INTENTIONAL SILENCE: the runtime already released the cloud reader lock. */ }
    }

    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }

  const data = await response.arrayBuffer();
  if (data.byteLength > boundedMaxBytes) {
    throw new Error(
      `Cloud download exceeds the ${Math.floor(boundedMaxBytes / 1024 / 1024)} MB limit`,
    );
  }
  return data;
}

const MAX_CLOUD_METADATA_BYTES = 2 * 1024 * 1024;

/** Reads JSON metadata with a bounded body when the runtime exposes a stream. */
export async function readBoundedJson<T = unknown>(
  response: Response,
  maxBytes: number = MAX_CLOUD_METADATA_BYTES,
): Promise<T> {
  const boundedMaxBytes = normalizeLimit(maxBytes, MAX_CLOUD_METADATA_BYTES);
  const contentLength = getContentLength(response);
  if (contentLength !== null && contentLength > boundedMaxBytes) {
    await cancelCloudResponseBody(response);
    throw new Error("Cloud metadata response exceeds the 2 MB limit");
  }

  if (response.body && typeof response.body.getReader === "function") {
    const bytes = await readBoundedCloudResponse(response, boundedMaxBytes);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  }

  // Keep compatibility with Response-like adapters used by older runtimes and
  // tests. Real Fetch Responses take the bounded stream path above.
  if (typeof response.text === "function") {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > boundedMaxBytes) {
      throw new Error("Cloud metadata response exceeds the 2 MB limit");
    }
    // Some Response-like adapters expose an empty text() shim but a real
    // json() implementation; preserve that compatibility path.
    if (!text.trim() && typeof response.json === "function") {
      return (await response.json()) as T;
    }
    return JSON.parse(text) as T;
  }
  return (await response.json()) as T;
}

export async function readBoundedText(
  response: Response,
  maxBytes: number = MAX_CLOUD_METADATA_BYTES,
): Promise<string> {
  const boundedMaxBytes = normalizeLimit(maxBytes, MAX_CLOUD_METADATA_BYTES);
  const contentLength = getContentLength(response);
  if (contentLength !== null && contentLength > boundedMaxBytes) {
    await cancelCloudResponseBody(response);
    throw new Error("Cloud metadata response exceeds the 2 MB limit");
  }
  if (response.body && typeof response.body.getReader === "function") {
    const bytes = await readBoundedCloudResponse(response, boundedMaxBytes);
    return new TextDecoder().decode(bytes);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > boundedMaxBytes) {
    throw new Error("Cloud metadata response exceeds the 2 MB limit");
  }  return text;
}


