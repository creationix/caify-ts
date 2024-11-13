import { process, sync } from './caify.ts'
import type { Storage } from './caify.ts'

const hashSize = 20
const desiredChunkSize = 2 ** 18
const chunkSize = desiredChunkSize - (desiredChunkSize % hashSize)
const hashAlgorithm = 'SHA-1'

const chunks = {}

const server = sync(newRealStorage(), {
  want(hash, level) {
    // console.log('SERVER-WANT', hash, level)
    const chunk = chunks[hash]
    if (!chunk) {
      throw new Error(`Chunk not found: ${hash}`)
    }
    server.send(hash, level, chunk)
  },
  received(hash, level) {
    console.log('SERVER-RECEIVED', hash, level)
  },
  error(message) {
    console.error('SERVER-ERROR:', message)
  },
})
server.caify(chunkSize, hashSize, hashAlgorithm)

async function upload(filename: string) {
  const data = await Bun.file(filename).bytes()
  const { hash, level } = await process(data, { chunkSize, hashSize, hashAlgorithm, chunks })
  console.log(`${hash}/${level} ${data.length} - ${Object.keys(chunks).length}`)
  server.push(hash, level)
}

const compress = false
// Store chunks to the filesystem using Bnn APIs
function newRealStorage(): Storage {
  const hashToFilename = (hash: string) =>
    `/tmp/caify/${hash.substring(0, 2)}/${hash.substring(2)}${compress ? '.gz' : ''}`
  return {
    async has(hash) {
      // console.log('STORAGE:HAS', hash)
      // Simulate lan latency
      // await new Promise((resolve) => setTimeout(resolve, 1))
      return await Bun.file(hashToFilename(hash)).exists()
    },
    async get(hash) {
      console.log('STORAGE:GET', hash)
      const file = Bun.file(hashToFilename(hash))
      if (!(await file.exists())) {
        return
      }
      let data = await file.bytes()
      // Simulate lan latency
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 + data.length / 100))
      if (compress) {
        data = Bun.gunzipSync(data)
      }
      // console.log('STORAGE:GOT', hash, data.length)
      return data
    },
    async put(hash, data) {
      // console.log('STORAGE:PUT', hash)
      if (compress) {
        data = await Bun.gzipSync(data)
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 + data.length / 100))
      await Bun.write(hashToFilename(hash), data)
    },
  }
}

for (let i = 2, len = Bun.argv.length; i < len; i++) {
  upload(Bun.argv[i])
}
