import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { StorageProvider } from '../../storage/storage-provider';

const execFileAsync = promisify(execFile);

export interface YouTubeVideoInfo {
  title: string;
  duration: number;
  width: number;
  height: number;
  description: string;
  sourceUrl: string;
}

export interface YouTubeDownloadResult {
  storagePath: string;
  absolutePath: string;
  info: YouTubeVideoInfo;
  fileSize: number;
}

export class YouTubeProvider {
  private ytDlpPath: string;
  private storage: StorageProvider;

  constructor(storage: StorageProvider) {
    this.storage = storage;

    // On Windows, do not select the repository's extensionless Unix binary.
    // Prefer a Windows local binary when present, otherwise use yt-dlp from PATH.
    const isWindows = process.platform === 'win32';
    const localBin = path.resolve(process.cwd(), 'bin', isWindows ? 'yt-dlp.exe' : 'yt-dlp');

    if (fs.existsSync(localBin)) {
      this.ytDlpPath = localBin;
    } else {
      this.ytDlpPath = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
    }
  }

  static isValidYouTubeUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    const ytRegex = /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{11}([?&].*)?$/;
    return ytRegex.test(trimmed);
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      await execFileAsync(this.ytDlpPath, ['--version']);
      return { available: true };
    } catch {
      return {
        available: false,
        reason: 'YOUTUBE_PROCESSING_UNAVAILABLE: O utilitário yt-dlp não está instalado ou disponível no ambiente.',
      };
    }
  }

  async fetchInfo(url: string): Promise<YouTubeVideoInfo> {
    if (!YouTubeProvider.isValidYouTubeUrl(url)) {
      throw new Error('INVALID_YOUTUBE_URL: A URL fornecida não é uma URL válida do YouTube.');
    }

    const availability = await this.isAvailable();
    if (!availability.available) {
      throw new Error(availability.reason || 'YOUTUBE_PROCESSING_UNAVAILABLE');
    }

    // Pass safe array of arguments, never raw shell concatenation
    const args = [
      '--dump-single-json',
      '--no-warnings',
      '--no-playlist',
      url.trim(),
    ];

    try {
      const { stdout } = await execFileAsync(this.ytDlpPath, args, { timeout: 30000 });
      const data = JSON.parse(stdout);

      return {
        title: data.title || 'Vídeo do YouTube',
        duration: data.duration || 0,
        width: data.width || 1280,
        height: data.height || 720,
        description: data.description || '',
        sourceUrl: url.trim(),
      };
    } catch (err: any) {
      console.error('Error in yt-dlp fetchInfo:', err);
      throw new Error(`DOWNLOAD_FAILED: Não foi possível obter informações do vídeo: ${err.message}`);
    }
  }

  async download(url: string, videoId: string): Promise<YouTubeDownloadResult> {
    if (!YouTubeProvider.isValidYouTubeUrl(url)) {
      throw new Error('INVALID_YOUTUBE_URL: A URL fornecida não é uma URL válida do YouTube.');
    }

    const availability = await this.isAvailable();
    if (!availability.available) {
      throw new Error(availability.reason || 'YOUTUBE_PROCESSING_UNAVAILABLE');
    }

    const storageKey = `originals/${videoId}.mp4`;
    const targetPath = this.storage.getAbsolutePath(storageKey);
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const outputTemplate = path.join(targetDir, `${videoId}.%(ext)s`);

    // Safe isolated arguments array
    const args = [
      '-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--no-warnings',
      '-o', outputTemplate,
      '--write-info-json',
      url.trim(),
    ];

    try {
      await execFileAsync(this.ytDlpPath, args, { timeout: 180000 });

      // Determine downloaded file path
      let downloadedFile = targetPath;
      if (!fs.existsSync(targetPath)) {
        const files = await fs.promises.readdir(targetDir);
        const match = files.find(f => f.startsWith(videoId) && !f.endsWith('.json'));
        if (!match) {
          throw new Error('DOWNLOAD_FAILED: O arquivo baixado não foi encontrado no storage.');
        }
        downloadedFile = path.join(targetDir, match);
      }

      const stat = await fs.promises.stat(downloadedFile);

      // Read metadata from info.json if available
      let info: YouTubeVideoInfo = {
        title: 'Vídeo do YouTube',
        duration: 0,
        width: 1280,
        height: 720,
        description: '',
        sourceUrl: url.trim(),
      };

      const infoJsonPath = path.join(targetDir, `${videoId}.info.json`);
      if (fs.existsSync(infoJsonPath)) {
        try {
          const raw = await fs.promises.readFile(infoJsonPath, 'utf-8');
          const parsed = JSON.parse(raw);
          info = {
            title: parsed.title || 'Vídeo do YouTube',
            duration: parsed.duration || 0,
            width: parsed.width || 1280,
            height: parsed.height || 720,
            description: parsed.description || '',
            sourceUrl: url.trim(),
          };
          await fs.promises.unlink(infoJsonPath).catch(() => {});
        } catch {
          // ignore info json read errors
        }
      }

      return {
        storagePath: storageKey,
        absolutePath: downloadedFile,
        info,
        fileSize: stat.size,
      };
    } catch (err: any) {
      console.error('Error downloading YouTube video:', err);
      throw new Error(`DOWNLOAD_FAILED: Falha no download do vídeo do YouTube: ${err.message}`);
    }
  }
}
