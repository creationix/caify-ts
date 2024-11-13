export interface StoreOptions {
    chunkSize?: number;
    hashSize?: number;
    hashAlgorithm?: AlgorithmIdentifier;
    chunks?: Record<string, Uint8Array>;
}
export interface CaifyClient {
    caify: (chunkSize: number, hashSize: number, hashAlgorithm: string) => void;
    done: () => void;
    push: (hash: string, level: number) => void;
    send: (hash: string, level: number, chunk: Uint8Array) => void;
    error: (message: string) => void;
}
export interface CaifyServer {
    want: (hash: string, level: number) => void;
    received: (hash: string, level: number) => void;
    error: (message: string) => void;
}
export interface Storage {
    has(hash: string): Promise<boolean>;
    get(hash: string): Promise<Uint8Array | undefined>;
    put(hash: string, data: Uint8Array): Promise<void>;
}
export declare function process(data: Uint8Array, options?: StoreOptions): Promise<{
    hash: string;
    level: number;
    chunks: Record<string, Uint8Array>;
}>;
export declare function toHex(hash: Uint8Array): string;
export declare function sync(storage: Storage, on: CaifyServer): CaifyClient;
