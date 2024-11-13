import { process, sync } from './caify.ts'
import type { Storage } from './caify.ts'

const data = await Bun.file(Bun.argv[2]).bytes()

const chunkSize = 2 ** 16
const hashSize = 32
const hashAlgorithm = 'SHA-256'
const { hash, level, chunks } = await process(data, { chunkSize, hashSize, hashAlgorithm })
console.log(`${hash}/${level} had ${Object.keys(chunks).length} chunks`)

const server = sync(newRealStorage(), {
  want(hash, level) {
    // console.log('SERVER-WANT', hash, level)
    server.send(hash, level, chunks[hash])
  },
  received(hash, level) {
    console.log('SERVER-RECEIVED', hash, level)
  },
  error(message) {
    console.error('SERVER-ERROR:', message)
  },
})
server.caify(chunkSize, hashSize, hashAlgorithm)
server.push(hash, level)

// Store chunks to the filesystem using Bnn APIs
function newRealStorage(): Storage {
  const hashToFilename = (hash: string) => `/tmp/caify/${hash}`
  return {
    async has(hash) {
      // console.log('STORAGE:HAS', hash)
      return await Bun.file(hashToFilename(hash)).exists()
    },
    async get(hash) {
      // console.log('STORAGE:GET', hash)
      const file = Bun.file(hashToFilename(hash))
      if (!(await file.exists())) {
        return
      }
      return await file.bytes()
    },
    async put(hash, data) {
      // console.log('STORAGE:PUT', hash)
      await Bun.write(hashToFilename(hash), data)
    },
  }
}
