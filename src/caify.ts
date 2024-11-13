export interface StoreOptions {
    chunkSize?: number;
    emit?: (event: string, data:any) => void;
}

// Store an arbitrarily sized chunk of data and return the root caify hash
export async function store(data:Uint8Array, options:StoreOptions={}):Promise<Uint8Array> {

}