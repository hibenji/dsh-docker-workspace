function trimUtf8Head(buffer, maxBytes) {
    if (buffer.length <= maxBytes)
        return buffer;
    let start = buffer.length - maxBytes;
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80)
        start++;
    return buffer.subarray(start);
}
export class TailOutputReader {
    maxBytes;
    spillPathProvider;
    tail = Buffer.alloc(0);
    total = 0;
    constructor(maxBytes, spillPathProvider) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
            throw new Error('maxBytes must be a positive integer');
        this.maxBytes = maxBytes;
        this.spillPathProvider = spillPathProvider;
    }
    append(chunk) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.total += bytes.length;
        this.tail = trimUtf8Head(Buffer.concat([this.tail, bytes]), this.maxBytes);
    }
    readFrom(fromByte) {
        const startOffset = this.total - this.tail.length;
        const lossy = fromByte < startOffset;
        const start = lossy ? 0 : Math.min(this.tail.length, Math.max(0, fromByte - startOffset));
        const text = this.tail.subarray(start).toString('utf8');
        const spillPath = this.spillPathProvider?.();
        return {
            text,
            nextOffset: this.total,
            lossy,
            ...(spillPath === undefined ? {} : { spillPath }),
        };
    }
}
//# sourceMappingURL=output.js.map