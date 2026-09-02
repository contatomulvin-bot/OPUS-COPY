import path from 'path';
import crypto from 'crypto';
import { StorageProvider } from '../../storage/storage-provider';

export interface UploadedFileInfo {
  originalName: string;
  mimeType: string;
  size: number;
  tempFilePath?: string;
  buffer?: Buffer;
}

export interface StoredVideoResult {
  storagePath: string;
  absolutePath: string;
  originalName: string;
  fileSize: number;
  format: string;
}

export const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv'];

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/mkv',
  'application/octet-stream', // Fallback for raw streams with valid extensions
];

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

export class UploadSourceProvider {
  private storage: StorageProvider;

  constructor(storage: StorageProvider) {
    this.storage = storage;
  }

  validate(file: UploadedFileInfo): { valid: boolean; error?: string } {
    if (!file || (!file.tempFilePath && !file.buffer)) {
      return { valid: false, error: 'Nenhum arquivo de vídeo fornecido.' };
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `O arquivo excede o limite máximo permitido de ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
      };
    }

    const ext = path.extname(file.originalName || '').toLowerCase();
    if (!ALLOWED_VIDEO_EXTENSIONS.includes(ext)) {
      return {
        valid: false,
        error: `Formato de vídeo não suportado: ${ext}. Use MP4, MOV, WEBM ou MKV.`,
      };
    }

    if (file.mimeType && !ALLOWED_VIDEO_MIME_TYPES.includes(file.mimeType.toLowerCase())) {
      return {
        valid: false,
        error: `MIME type inválido: ${file.mimeType}. Apenas formatos de vídeo suportados são aceitos.`,
      };
    }

    return { valid: true };
  }

  async store(file: UploadedFileInfo, videoId: string): Promise<StoredVideoResult> {
    const validation = this.validate(file);
    if (!validation.valid) {
      throw new Error(validation.error || 'Arquivo de vídeo inválido');
    }

    const rawExt = path.extname(file.originalName || '').toLowerCase() || '.mp4';
    const safeExt = ALLOWED_VIDEO_EXTENSIONS.includes(rawExt) ? rawExt : '.mp4';
    
    // Generate safe internal key without user-supplied directory path
    const storageKey = `originals/${videoId}${safeExt}`;

    let savedPath = '';
    if (file.tempFilePath) {
      savedPath = await this.storage.save(storageKey, file.tempFilePath);
    } else if (file.buffer) {
      savedPath = await this.storage.save(storageKey, file.buffer);
    } else {
      throw new Error('Nenhum dado binário encontrado para salvar o arquivo.');
    }

    return {
      storagePath: storageKey,
      absolutePath: savedPath,
      originalName: path.basename(file.originalName || `video_${videoId}${safeExt}`),
      fileSize: file.size,
      format: safeExt.replace('.', ''),
    };
  }
}
