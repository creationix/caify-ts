# Caify Uploads

## Recursive Block Files

The core data structure of caify is a recursive content-addressed data structure.

Given an arbitrarily sized piece of data, the data is broken into fixed length chunks.  Each chunk is hashed and referenced by that hash (aka content addressed).  A new file is made that is the hashes of all those chunks concatenated together.  If this file is larger than one chunk size, it's recursively chunked and hashed to make a new manifest file.  This recursion happens till the entire data set fits in a single chunk.  Then that final chunk is hashed and the final root hash is the address of the entire dataset.  In order to know when a hash points to a manifest file or a leaf data node, the level is stored along with the final root hash.

Also the algorithm is flexible in that the hash-algorithm, hash-size, and block-size are configurable and often stored along with the root hash.  Initially caify supports `SHA-1`, `SHA-256`, `SHA-384`, and `SHA-512` since those are built-in to most modern browsers.  The block size must be a multiple of the hash size and the hash size must not be bigger than the hash chosen.

Recommended defaults are:

- `hash-size`: 32 bytes
- `block-size`: 256 KiB
- `hash-algorithm`: `SHA-256`

This fits 8,192 hashes per manifest block.

- files up to 256 KiB fit in a single chunk with no manifest needed.
- files up to 2 GiB fit with one level of manifest files (a single manifest file)
- files up to 16 TiB fit with two levels of manifest files (up to 8,193 manifest chunks total)
- files up to 128 EiB fit with 3 levels...

## Caify Enabled Storage Provider

If a storage provider is aware of caify manifest files, it can do smart syncing of huge datasets by scanning for missing chunks server-side and telling the client which chunks are missing and need (re)sending.

For example, consider a browser-based program that wishes to upload a large file from the users computer.

- The user selects a huge file using HTML5 (such as a file upload form)
- The browser converts this into a caify data structure by chunking it in memory.
- The browser then sends the root chunk to the server and tells the server what level this chunk is.
- The server will scan its local stores and respond with a bitfield of all the chunks it's missing.
- The browser will then send these chunks to the server and recurse the process till all needed chunks are sent to the server.
- This simple protocol ensures that no more than one chunk is ever sent without first knowing if the chunk needs to be sent.
- Since most datasets fit in a level 1 structure, there is very little back and forth in the protocol.
- The bitfield ensures minimal bandwidth is wasted communicating what is needed.

## Motivating Example

Let's visualize this using very small settings.

- 1 byte hashes
- 4 byte chunks
- `SHA-1` algorithm

The input is: `Caify is Awesome!` which is exactly 17 bytes:

```sh
echo -n 'Caify is Awesome!' | hexdump -C
00000000  43 61 69 66 79 20 69 73  20 41 77 65 73 6f 6d 65  |Caify is Awesome|
00000010  21                                                |!|
00000011
```

The first chunk is `Caif` or `<4b f5 3a b3>` in hex.

```sh
echo -n 'Caif' | sha1sum 
4bf53ab38489ef137884b4597d6cb91f23cd5417  -
```

Truncating this to 1 byte is `4b`

All 5 chunks are:

- `Caif` - `4bf53ab38489ef137884b4597d6cb91f23cd5417` - `4b`
- `y is` - `82a36d8192a520fab2b5c31c23b12f0373fcc123` - `82`
- ` Awe` - `a2978a22aceec3f7e6ebed150a34374a88695465` - `a2`
- `some` - `eb875812858d27b22cb2b75f992dffadc1b05c66` - `eb`
- `!` - `0ab8318acaf6e678dd02e2b5c343ed41111b393d` - `0a`

The manifest for these 5 chunks is the 5 truncated hashes concatenated together:

`<4b 82 a2 eb 0a>`

Since this is larger than our chunk size of 16 bytes, we need to recurse again.

This time we have only two chunks:

`<4b 82 a2 eb>` - `444516f2f2194953f8ced7b5871ca63d8cbbf36d` - `44`
`<0a>` - `adc83b19e793491b1c6ea0fd8b46cd9f32e592fc` - `ad`

And the second level manifest is:

`<44 ad>` which is within out block size and gives a final hash of:

`5ab4de7018b7a025c4385432842a3385742689da` - `5a`

```
              <5a>
             /    \
            /      \
           /        \
     __<44>__       <ad>
    /  / \  \        |
   /  |   \  \       |
  /   |    \  \      |
<4b> <82> <a2> <eb> <0a>