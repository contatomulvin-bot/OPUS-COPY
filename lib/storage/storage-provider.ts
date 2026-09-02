import { Readable } from 'stream';

export interface SaveFileOptions {
  contentType?: string;
  overwrite?: boolean;
}

export interface StorageProvider {
  save(key: string, data: Buffer | Readable | string, options?: SaveFileOptions): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  getStream(key: string): Promise<Readable | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  getAbsolutePath(key: string): string;
  getUrl(key: string): string;
}
