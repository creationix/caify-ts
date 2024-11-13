export interface StoreOptions {
    chunkSize?: number;
    emit?: (event: string, data: any) => void;
}
export declare function store(data: Uint8Array, options?: StoreOptions): Promise<Uint8Array>;
