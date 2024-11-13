export interface StoreOptions {
  chunkSize?: number // The max of each chunk
  hashSize?: number // The size of the hash
  hashAlgorithm?: AlgorithmIdentifier // The hash algorithm
  chunks?: Record<string, Uint8Array> // The chunks to use
}

const defaultOptions: StoreOptions = {
  chunkSize: 2 ** 16, // full 16-bit size
  hashSize: 32, // full sha256 hash
  hashAlgorithm: 'SHA-256',
}

// C->S "caify" chunkSize hashSize hashAlgorithm - Tell the server the client is ready to send caify data with given parameters
// C->S "done" - Tell the server that the client is done with caify mode
// C->S "push" hash level - Tell the server it needs to have this hash and all dependencies
// C->S "send" hash level chunk - Send a chunk to the server
// C->S "error" message - Tell the serverå that an error occurred

// S->C "want" hash level - Tell the client it wants this hash and the client should sent it
// S->C "ready" - Tell the client that is has no pending work left
// S->C "error" message - Tell the client that an error occurred

export interface CaifyClient {
  caify: (chunkSize: number, hashSize: number, hashAlgorithm: string) => void
  done: () => void
  push: (hash: string, level: number) => void
  send: (hash: string, level: number, chunk: Uint8Array) => void
  error: (message: string) => void
}

export interface CaifyServer {
  want: (hash: string, level: number) => void
  received: (hash: string, level: number) => void
  error: (message: string) => void
}

export interface Storage {
  has(hash: string): Promise<boolean>
  get(hash: string): Promise<Uint8Array | undefined>
  put(hash: string, data: Uint8Array): Promise<void>
}

// Process an arbitrarily sized chunk of data and return the root caify hash
export async function process(data: Uint8Array, options: StoreOptions = {}) {
  const { chunkSize, hashSize, hashAlgorithm } = { ...defaultOptions, ...options }
  // Ensure chunk size is multiple of hash size
  if (chunkSize % hashSize) {
    throw new Error('chunkSize must be multiple of hashSize')
  }
  const chunks: Record<string, Uint8Array> = options.chunks ?? {}
  let hash: string
  let hashLevel: number
  await processChunk(data, 0)
  return { hash, level: hashLevel, chunks }

  async function processChunk(chunk: Uint8Array, level: number) {
    const len = chunk.length
    // If the chunk is larger than the chunk size, split it into chunks recursively
    if (len > chunkSize) {
      const chunkCount = Math.floor(len / chunkSize)
      const manifest = new Uint8Array(chunkCount * hashSize)
      for (let i = 0; i < chunkCount; i++) {
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, len)
        const hashBuffer = await processChunk(chunk.subarray(start, end), level)
        if (hashBuffer.length !== hashSize) {
          throw new Error(`Hash size mismatch: ${hashBuffer.length} != ${hashSize}`)
        }
        manifest.set(hashBuffer, i * hashSize)
      }
      return processChunk(manifest, level + 1)
    }

    // Hash the data and store it in the chunks
    const hashBuffer = new Uint8Array(await crypto.subtle.digest(hashAlgorithm, chunk)).subarray(0, hashSize)
    hash = toHex(hashBuffer)
    hashLevel = level
    chunks[hash] = chunk
    return hashBuffer
  }
}

export function toHex(hash: Uint8Array): string {
  const len = hash.length
  const parts = new Array(len)
  for (let i = 0; i < len; i++) {
    parts[i] = hash[i].toString(16).padStart(2, '0')
  }
  return parts.join('')
}

export function sync(storage: Storage, on: CaifyServer): CaifyClient {
  let caifyMode = false
  let chunkSize: number
  let hashSize: number
  let hashAlgorithm: string

  let pendingWants = 0
  const maxPendingWants = 10
  const queue: { hash: string; level: number }[] = []
  const wants: Record<string, number> = {}

  const maxPendingScans = 2
  let pendingScans = 0
  const scanQueue: { chunk: Uint8Array; level: number }[] = []

  return {
    caify(newChunkSize, newHashSize, newHashAlgorithm) {
      caifyMode = true
      chunkSize = newChunkSize
      hashSize = newHashSize
      hashAlgorithm = newHashAlgorithm
    },
    done() {
      if (!caifyMode) {
        return on.error('done: Outside of caify mode')
      }
      caifyMode = false
    },
    error(message) {
      console.error('CLIENT SENT ERROR:', message)
    },
    // The client wishes us to have this hash and all dependencies
    async push(hash, level) {
      if (!caifyMode) {
        return on.error(`push ${hash}/${level}: Outside of caify mode`)
      }
      if (wants[hash] !== undefined) {
        return
      }
      if (level > 0) {
        const chunk = await storage.get(hash)
        if (chunk) {
          scanQueue.push({ chunk, level })
          nextTick(checkScanQueue)
          return
        }
      } else if (await storage.has(hash)) {
        return
      }

      queue.push({ hash, level })
      nextTick(checkQueue)
    },
    async send(hash, level, chunk) {
      if (!caifyMode) {
        return on.error(`send ${hash}/${level}: Outside of caify mode`)
      }
      // Verify the send
      const wantedLevel = wants[hash]
      if (wantedLevel === undefined) {
        return on.error(`send ${hash}/${level}: Unwanted send`)
      }
      delete wants[hash]
      pendingWants--
      if (level !== wantedLevel) {
        return on.error(`send ${hash}/${level}: Expected ${hash}/${wantedLevel}`)
      }
      if (chunk.length > chunkSize) {
        return on.error(`send ${hash}/${level}: Chunk too large (${chunk.length} > ${chunkSize})`)
      }

      // If this is a manifest, queue it to scan for dependencies
      if (level > 0) {
        scanQueue.push({ chunk, level })
        nextTick(checkScanQueue)
      }

      const verifyHash = toHex(new Uint8Array(await crypto.subtle.digest(hashAlgorithm, chunk)).subarray(0, hashSize))
      if (hash !== verifyHash) {
        return on.error(`send ${hash}/${level}: Hash mismatch (${hash} != ${verifyHash})`)
      }

      try {
        await storage.put(hash, chunk)
      } catch (e) {
        // On failure, put it back on the queue and try again
        queue.push({ hash, level })
        on.error(`send ${hash}/${level}: ${e.message}`)
      }
      nextTick(checkQueue)
    },
  }

  function checkQueue() {
    if (pendingWants >= maxPendingWants) {
      return
    }
    const next = queue.pop()
    if (!next) {
      return
    }
    const { hash, level } = next
    pendingWants++
    wants[hash] = level
    on.want(hash, level)
  }

  async function checkScanQueue() {
    if (pendingScans >= maxPendingScans) {
      return
    }
    const next = scanQueue.pop()
    if (!next) {
      return
    }
    const { chunk, level } = next
    pendingScans++
    if (chunk.length % hashSize !== 0) {
      throw new Error(`Invalid chunk length ${chunk.length}/${hashSize}`)
    }
    for (let i = 0, l = chunk.length; i < l; i += hashSize) {
      const hash = toHex(chunk.subarray(i, i + hashSize))
      if (hash.length !== hashSize * 2) {
        throw new Error(`Invalid hash length ${hash.length}/${hashSize * 2}`)
      }
      if (level > 1) {
        const child = await storage.get(hash)
        if (child) {
          scanQueue.push({ chunk: child, level: level - 1 })
          nextTick(checkScanQueue)
          continue
        }
      } else if (await storage.has(hash)) {
        continue
      }
      queue.push({ hash, level: level - 1 })
      nextTick(checkQueue)
    }
    pendingScans--
    nextTick(checkScanQueue)
  }
}

function nextTick(fn: () => void): Promise<void> {
  return Promise.resolve().then(fn)
}
