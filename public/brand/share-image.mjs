// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
export function imageDimensions(bytes) {
    if (bytes.length < 24 || bytes.length >= 5 * 1024 ** 2)
        throw Error("Choose a supported raster image smaller than 5 MiB.");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (start, size) => String.fromCharCode(...bytes.subarray(start, start + size));
    if (v.getUint32(0) === 0x89504e47 &&
        v.getUint32(4) === 0x0d0a1a0a &&
        ascii(12, 4) === "IHDR")
        return {
            width: v.getUint32(16),
            height: v.getUint32(20),
            format: "image/png",
        };
    if (v.getUint16(0) === 0xffd8) {
        for (let offset = 2; offset + 8 < bytes.length;) {
            if (bytes[offset] !== 0xff)
                break;
            const marker = bytes[offset + 1], length = v.getUint16(offset + 2);
            if (length < 2 || offset + length + 2 > bytes.length)
                break;
            if ([0xc0, 0xc1, 0xc2].includes(marker))
                return {
                    width: v.getUint16(offset + 7),
                    height: v.getUint16(offset + 5),
                    format: "image/jpeg",
                };
            offset += length + 2;
        }
    }
    if (bytes.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
        const chunk = ascii(12, 4), u24 = (at) => bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16);
        if (chunk === "VP8X")
            return { width: u24(24) + 1, height: u24(27) + 1, format: "image/webp" };
        if (chunk === "VP8L" && bytes[20] === 0x2f) {
            const bits = v.getUint32(21, true);
            return {
                width: (bits & 0x3fff) + 1,
                height: ((bits >>> 14) & 0x3fff) + 1,
                format: "image/webp",
            };
        }
        if (chunk === "VP8 " &&
            bytes[23] === 0x9d &&
            bytes[24] === 1 &&
            bytes[25] === 0x2a)
            return {
                width: v.getUint16(26, true) & 0x3fff,
                height: v.getUint16(28, true) & 0x3fff,
                format: "image/webp",
            };
    }
    throw Error("Sharing image format is not a supported raster.");
}
// Canvas exports use 8-bit RGB/RGBA without interlacing. Validate the complete
// encoded raster with bounded streaming inflation before publication.
export async function validateCardPNG(bytes) {
    const size = imageDimensions(bytes);
    if (size.format !== "image/png" || size.width !== 1200 || size.height !== 630)
        throw Error("Choose a 1200 × 630 PNG exported by Launch Kit.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [];
    let offset = 8, seenHeader = false, seenEnd = false, dataStarted = false, dataEnded = false, channels = 0;
    const crc = (start, end) => {
        let value = 0xffffffff;
        for (let i = start; i < end; i++) {
            value ^= bytes[i];
            for (let bit = 0; bit < 8; bit++)
                value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
        }
        return (value ^ 0xffffffff) >>> 0;
    };
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset), end = offset + 12 + length;
        if (end > bytes.length ||
            crc(offset + 4, offset + 8 + length) !==
                view.getUint32(offset + 8 + length))
            throw Error("The PNG is incomplete or has damaged chunks.");
        const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (!seenHeader && kind !== "IHDR")
            throw Error("The PNG header must be first.");
        if (kind === "IHDR") {
            if (seenHeader ||
                length !== 13 ||
                bytes[offset + 16] !== 8 ||
                ![2, 6].includes(bytes[offset + 17]) ||
                bytes[offset + 18] !== 0 ||
                bytes[offset + 19] !== 0 ||
                bytes[offset + 20] !== 0)
                throw Error("Use the original non-interlaced RGB or RGBA PNG exported by Launch Kit.");
            channels = bytes[offset + 17] === 6 ? 4 : 3;
            seenHeader = true;
        }
        else if (kind === "IDAT") {
            if (dataEnded || length === 0)
                throw Error("The PNG image data is invalid.");
            dataStarted = true;
            parts.push(bytes.subarray(offset + 8, offset + 8 + length));
        }
        else if (kind === "IEND") {
            if (length !== 0 || !dataStarted || end !== bytes.length)
                throw Error("The PNG image is incomplete.");
            seenEnd = true;
            offset = end;
            break;
        }
        else {
            if (dataStarted)
                dataEnded = true;
            if (kind === "acTL" ||
                kind === "PLTE" ||
                kind[0] === kind[0].toUpperCase())
                throw Error("Use the original static RGB or RGBA PNG exported by Launch Kit.");
        }
        offset = end;
    }
    if (!seenEnd || offset !== bytes.length)
        throw Error("The PNG image is incomplete.");
    const compressedLength = parts.reduce((sum, part) => sum + part.length, 0), compressed = new Uint8Array(compressedLength);
    let at = 0;
    for (const part of parts) {
        compressed.set(part, at);
        at += part.length;
    }
    const stream = new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream("deflate")), reader = stream.getReader(), stride = 1200 * channels + 1, expected = stride * 630;
    let inflated = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (inflated + value.length > expected)
                throw Error("The PNG decompressed size exceeds its declared dimensions.");
            for (let i = 0; i < value.length; i++)
                if ((inflated + i) % stride === 0 && value[i] > 4)
                    throw Error("The PNG contains an unsupported row filter.");
            inflated += value.length;
        }
    }
    finally {
        await reader.cancel();
    }
    if (inflated !== expected)
        throw Error("The PNG raster does not match its declared dimensions.");
}
