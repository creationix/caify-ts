const defaultOptions = {
    chunkSize: 2 ** 16,
    hashSize: 32,
    hashAlgorithm: 'SHA-256',
};
export async function process(data, options = {}) {
    const { chunkSize, hashSize, hashAlgorithm } = { ...defaultOptions, ...options };
    if (chunkSize % hashSize) {
        throw new Error('chunkSize must be multiple of hashSize');
    }
    const chunks = options.chunks ?? {};
    let hash;
    let hashLevel;
    await processChunk(data, 0);
    return { hash, level: hashLevel, chunks };
    async function processChunk(chunk, level) {
        const len = chunk.length;
        if (len > chunkSize) {
            const chunkCount = Math.floor(len / chunkSize);
            const manifest = new Uint8Array(chunkCount * hashSize);
            for (let i = 0; i < chunkCount; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, len);
                const hashBuffer = await processChunk(chunk.subarray(start, end), level);
                if (hashBuffer.length !== hashSize) {
                    throw new Error(`Hash size mismatch: ${hashBuffer.length} != ${hashSize}`);
                }
                manifest.set(hashBuffer, i * hashSize);
            }
            return processChunk(manifest, level + 1);
        }
        const hashBuffer = new Uint8Array(await crypto.subtle.digest(hashAlgorithm, chunk)).subarray(0, hashSize);
        hash = toHex(hashBuffer);
        hashLevel = level;
        chunks[hash] = chunk;
        return hashBuffer;
    }
}
export function toHex(hash) {
    const len = hash.length;
    const parts = new Array(len);
    for (let i = 0; i < len; i++) {
        parts[i] = hash[i].toString(16).padStart(2, '0');
    }
    return parts.join('');
}
export function sync(storage, on) {
    let caifyMode = false;
    let chunkSize;
    let hashSize;
    let hashAlgorithm;
    let pendingWants = 0;
    const maxPendingWants = 2;
    const queue = [];
    const wants = {};
    const maxPendingScans = 1;
    let pendingScans = 0;
    const scanQueue = [];
    return {
        caify(newChunkSize, newHashSize, newHashAlgorithm) {
            caifyMode = true;
            chunkSize = newChunkSize;
            hashSize = newHashSize;
            hashAlgorithm = newHashAlgorithm;
        },
        done() {
            if (!caifyMode) {
                return on.error('done: Outside of caify mode');
            }
            caifyMode = false;
        },
        error(message) {
            console.error('CLIENT SENT ERROR:', message);
        },
        async push(hash, level) {
            if (!caifyMode) {
                return on.error(`push ${hash}/${level}: Outside of caify mode`);
            }
            if (wants[hash] !== undefined) {
                return;
            }
            if (level > 0) {
                const chunk = await storage.get(hash);
                if (chunk) {
                    scanQueue.push({ chunk, level });
                    nextTick(checkScanQueue);
                    return;
                }
            }
            else if (await storage.has(hash)) {
                return;
            }
            queue.push({ hash, level });
            nextTick(checkQueue);
        },
        async send(hash, level, chunk) {
            if (!caifyMode) {
                return on.error(`send ${hash}/${level}: Outside of caify mode`);
            }
            const wantedLevel = wants[hash];
            if (wantedLevel === undefined) {
                return on.error(`send ${hash}/${level}: Unwanted send`);
            }
            delete wants[hash];
            pendingWants--;
            if (level !== wantedLevel) {
                return on.error(`send ${hash}/${level}: Expected ${hash}/${wantedLevel}`);
            }
            if (chunk.length > chunkSize) {
                return on.error(`send ${hash}/${level}: Chunk too large (${chunk.length} > ${chunkSize})`);
            }
            if (level > 0) {
                scanQueue.push({ chunk, level });
                nextTick(checkScanQueue);
            }
            const verifyHash = toHex(new Uint8Array(await crypto.subtle.digest(hashAlgorithm, chunk)).subarray(0, hashSize));
            if (hash !== verifyHash) {
                return on.error(`send ${hash}/${level}: Hash mismatch (${hash} != ${verifyHash})`);
            }
            try {
                await storage.put(hash, chunk);
            }
            catch (e) {
                queue.push({ hash, level });
                on.error(`send ${hash}/${level}: ${e.message}`);
            }
            nextTick(checkQueue);
        },
    };
    function checkQueue() {
        if (pendingWants >= maxPendingWants) {
            return;
        }
        const next = queue.pop();
        if (!next) {
            return;
        }
        const { hash, level } = next;
        pendingWants++;
        wants[hash] = level;
        on.want(hash, level);
    }
    async function checkScanQueue() {
        if (pendingScans >= maxPendingScans) {
            return;
        }
        const next = scanQueue.pop();
        if (!next) {
            return;
        }
        const { chunk, level } = next;
        pendingScans++;
        if (chunk.length % hashSize !== 0) {
            throw new Error(`Invalid chunk length ${chunk.length}/${hashSize}`);
        }
        for (let i = 0, l = chunk.length; i < l; i += hashSize) {
            const hash = toHex(chunk.subarray(i, i + hashSize));
            if (hash.length !== hashSize * 2) {
                throw new Error(`Invalid hash length ${hash.length}/${hashSize * 2}`);
            }
            if (level > 1) {
                const child = await storage.get(hash);
                if (child) {
                    scanQueue.push({ chunk: child, level: level - 1 });
                    nextTick(checkScanQueue);
                    continue;
                }
            }
            else if (await storage.has(hash)) {
                continue;
            }
            queue.push({ hash, level: level - 1 });
            nextTick(checkQueue);
        }
        pendingScans--;
        nextTick(checkScanQueue);
    }
}
function nextTick(fn) {
    return Promise.resolve().then(fn);
}
