/**
 * Reusable CSV fixtures for importer tests.
 *
 * The fixture exposes a fresh ReadableStream for every call and keeps the
 * source lazy: large tests generate bounded chunks on demand instead of
 * building one giant CSV string or row array in memory.
 */

type CsvChunkSource = Iterable<string> | AsyncIterable<string>;
type CsvChunkFactory = () => CsvChunkSource;

export interface StreamingCsvFileOptions {
  name?: string;
  /** Logical File.size metadata; the stream remains independently lazy. */
  size?: number;
}

function asFactory(
  source: CsvChunkSource | CsvChunkFactory,
): CsvChunkFactory {
  return typeof source === "function" ? source : () => source;
}

/** Create a stream-backed File-like CSV fixture from reusable chunks. */
export function createStreamingCsvFile(
  source: CsvChunkSource | CsvChunkFactory,
  options: StreamingCsvFileOptions = {},
): File {
  const getSource = asFactory(source);
  const name = options.name ?? "bookmarks.csv";
  const size = options.size ?? 1024;

  return {
    name,
    size,
    text: async () => {
      const chunks: string[] = [];
      for await (const chunk of getSource()) {
        chunks.push(chunk);
      }
      return chunks.join("");
    },
    stream: () => {
      const encoder = new TextEncoder();
      const iterator = (async function* streamChunks() {
        yield* getSource();
      })();
      const reader = iterator[Symbol.asyncIterator]();

      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.next();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(encoder.encode(next.value));
            }
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await reader.return?.();
        },
      });
    },
  } as unknown as File;
}

export interface StreamingCsvRowsOptions extends StreamingCsvFileOptions {
  rowCount: number;
  header?: string;
  /** Number of generated rows grouped into each stream chunk. */
  rowsPerChunk?: number;
  row?: (index: number) => string;
}

/**
 * Create a lazy CSV fixture whose rows are generated in bounded chunks.
 * `rowCount` excludes the header, and each row may omit its final newline.
 */
export function createStreamingCsvRowsFile({
  rowCount,
  header = "Title,URL\n",
  rowsPerChunk = 256,
  row = (index) => `Row ${index},https://example-${index}.com\n`,
  name = "bookmarks.csv",
  size = 1024,
}: StreamingCsvRowsOptions): File {
  const safeRowsPerChunk = Math.max(1, Math.floor(rowsPerChunk));
  const safeRowCount = Math.max(0, Math.floor(rowCount));

  return createStreamingCsvFile(
    function* generateChunks() {
      yield header.endsWith("\n") ? header : `${header}\n`;
      for (let start = 0; start < safeRowCount; start += safeRowsPerChunk) {
        const end = Math.min(start + safeRowsPerChunk, safeRowCount);
        let chunk = "";
        for (let index = start; index < end; index++) {
          const line = row(index);
          chunk += line.endsWith("\n") ? line : `${line}\n`;
        }
        yield chunk;
      }
    },
    { name, size },
  );
}
