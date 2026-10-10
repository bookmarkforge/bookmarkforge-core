// Protocol-level size/security bounds for the WebRTC sync data channel.
// Shared by the message/document validation layer (webrtc-sync/validation)
// and the service class. Behavioral tuning (timeouts, batch sizes) stays in
// WebRTCSyncService.ts.

export const MAX_CHUNK_SIZE = 16384;
export const MAX_TOTAL_PAYLOAD = MAX_CHUNK_SIZE * 2000; // matches sync_start totalChunks cap
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
export const MAX_SYNC_AUTH_LENGTH = 128;
export const MAX_BLOCKS_BYTES = 2 * 1024 * 1024;
// A data-channel frame must stay bounded before JSON.parse allocates an object.
// Chunk payloads may contain escaped Unicode, hence the generous 8x multiplier.
export const MAX_INCOMING_MESSAGE_CHARS = MAX_CHUNK_SIZE * 8;
// QR/signaling descriptions are normally a few KiB. Bound both representations
// before decompression and before JSON parsing to prevent decompression/parse
// work from becoming an input-controlled memory sink.
export const MAX_DESCRIPTION_ENCODED_CHARS = 64 * 1024;
export const MAX_SDP_CHARS = 64 * 1024;
export const MAX_SYNC_DOCS_PER_BATCH = 10_000;
export const MAX_COMPLETED_SYNC_SESSIONS = 16;
// Upper bound for the ISO-8601 incremental-sync cursor exchanged in the
// capability handshake. ISO timestamps are ~24 chars; 40 covers any valid
// ISO representation while keeping the field a bounded, parse-free string.
export const MAX_SYNC_CURSOR_LENGTH = 40;
