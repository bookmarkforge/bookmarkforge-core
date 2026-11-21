/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/webrtc-sync/sdp-codec.ts`. No implementation is present in this repository. */
import { type SyncPairOfferMeta } from "./validation";
export declare function minimizeSDP(sdp: string): string;
export declare function encodeLocalDescription(localDescription: {
    type: string;
    sdp: string;
}, pairField: SyncPairOfferMeta | null): string;
export declare function parseEncodedPayload(encoded: string): {
    description: RTCSessionDescriptionInit | null;
    pair: SyncPairOfferMeta | null;
    pairMalformed: boolean;
};
