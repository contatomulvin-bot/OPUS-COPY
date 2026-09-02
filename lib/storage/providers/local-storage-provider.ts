import fs from 'fs';
import path from 'path';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { StorageProvider, SaveFileOptions } from '../storage-provider';

const streamPipeline = promisify(pipeline);

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(process.cwd(), 'uploads');
    this.ensureDirectory(this.baseDir);
    this.ensureDirectory(path.join(this.baseDir, 'originals'));
    this.ensureDirectory(path.join(this.baseDir, 'audio'));
    this.ensureDirectory(path.join(this.baseDir, 'clips'));
    this.ensureDirectory(path.join(this.baseDir, 'renders'));
    this.ensureDirectory(path.join(this.baseDir, 'subtitles'));
  }

  public sanitizeKey(key: string): string {
    // Prevent path traversal completely
    const safeKey = key
      .replace(/\0/g, '') // remove null bytes
      .replace(/(\.\.[\/\\])+/g, '')
      .replace(/^[/\\]+/, '');
    return safeKey;
  }

  private ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  getAbsolutePath(key: string): string {
    const safeKey = this.sanitizeKey(key);
    // Check if key is already an existing relative path from root (e.g. storage/renders/... or uploads/videos/...)
    const rootRelative = path.resolve(process.cwd(), safeKey);
    if (fs.existsSync(rootRelative)) {
      return rootRelative;
    }
    // Check inside baseDir
    const baseRelative = path.resolve(this.baseDir, safeKey);
    if (fs.existsSync(baseRelative)) {
      return baseRelative;
    }
    // Default to rootRelative if it starts with storage/ or uploads/, otherwise baseRelative
    if (safeKey.startsWith('storage') || safeKey.startsWith('uploads')) {
      return rootRelative;
    }
    return baseRelative;
  }

  getUrl(key: string): string {
    const safeKey = this.sanitizeKey(key);
    return `/api/media/${encodeURIComponent(safeKey).replace(/%2F/g, '/')}`;
  }

  async save(key: string, data: Buffer | Readable | string, options?: SaveFileOptions): Promise<string> {
    const filePath = this.getAbsolutePath(key);
    const dir = path.dirname(filePath);
    this.ensureDirectory(dir);

    if (typeof data === 'string' && fs.existsSync(data)) {
      // Source is an existing file path, copy it
      await fs.promises.copyFile(data, filePath);
    } else if (Buffer.isBuffer(data)) {
      await fs.promises.writeFile(filePath, data);
    } else if (typeof data === 'string') {
      await fs.promises.writeFile(filePath, data, 'utf-8');
    } else if (data instanceof Readable) {
      const writeStream = fs.createWriteStream(filePath);
      await streamPipeline(data, writeStream);
    }

    return filePath;
  }

  async get(key: string): Promise<Buffer | null> {
    const filePath = this.getAbsolutePath(key);
    try {
      if (!fs.existsSync(filePath)) return null;
      return await fs.promises.readFile(filePath);
    } catch {
      return null;
    }
  }

  async getStream(key: string): Promise<Readable | null> {
    const filePath = this.getAbsolutePath(key);
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.createReadStream(filePath);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    const filePath = this.getAbsolutePath(key);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.getAbsolutePath(key);
    return fs.existsSync(filePath);
  }
}

export const defaultStorage = new LocalStorageProvider();
