const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/** The pixel size a PNG or JPEG file declares (PNG: the IHDR chunk; JPEG: its start-of-frame marker); undefined for any other bytes. */
export function imageSize(bytes: Buffer): {width: number; height: number} | undefined {
    if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
    for (let at = 2; at + 9 < bytes.length; ) {
        if (bytes[at] !== 0xff) return undefined;
        const marker = bytes[at + 1];
        // Markers without a length: standalone (TEM, RSTn) and fill bytes.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
            at += marker === 0xff ? 1 : 2;
            continue;
        }
        // SOF0-SOF15 declare the frame size, except DHT (c4), JPG (c8) and DAC (cc).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return {width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5)};
        }
        at += 2 + bytes.readUInt16BE(at + 2);
    }
    return undefined;
}
