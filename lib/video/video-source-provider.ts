import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface VideoSourceInfo {
  title: string;
  duration?: number;
  width?: number;
  height?: number;
  description?: string;
  sourceUrl?: string;
}

export interface VideoSourceProvider {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  fetchInfo(url: string): Promise<VideoSourceInfo>;
  download(url: string, outputDir: string, filenamePrefix: string): Promise<{ filePath: string; info: VideoSourceInfo }>;
}

export class YouTubeSourceProvider implements VideoSourceProvider {
  private ytDlpPath: string;

  constructor() {
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

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      await execFileAsync(this.ytDlpPath, ['--version']);
      return { available: true };
    } catch {
      return {
        available: false,
        reason: 'O utilitário yt-dlp não está instalado ou configurado no ambiente.',
      };
    }
  }

  async fetchInfo(url: string): Promise<VideoSourceInfo> {
    const availability = await this.isAvailable();
    if (!availability.available) {
      throw new Error(availability.reason || 'Download de YouTube indisponível');
    }

    try {
      const args = [
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        url,
      ];

      const { stdout } = await execFileAsync(this.ytDlpPath, args);
      const data = JSON.parse(stdout);

      return {
        title: data.title || 'Vídeo do YouTube',
        duration: data.duration || 0,
        width: data.width || 1280,
        height: data.height || 720,
        description: data.description || '',
        sourceUrl: url,
      };
    } catch (err: any) {
      console.error('Error fetching YouTube info:', err);
      throw new Error(`Não foi possível obter informações do vídeo do YouTube: ${err.message}`);
    }
  }

  async download(
    url: string,
    outputDir: string,
    filenamePrefix: string
  ): Promise<{ filePath: string; info: VideoSourceInfo }> {
    const availability = await this.isAvailable();
    if (!availability.available) {
      throw new Error(availability.reason || 'Download de YouTube indisponível');
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputTemplate = path.join(outputDir, `${filenamePrefix}.%(ext)s`);

    const args = [
      '-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--no-warnings',
      '-o', outputTemplate,
      '--write-info-json',
      url,
    ];

    try {
      await execFileAsync(this.ytDlpPath, args);

      // Find the output mp4 file
      const expectedMp4 = path.join(outputDir, `${filenamePrefix}.mp4`);
      let finalFilePath = expectedMp4;

      if (!fs.existsSync(expectedMp4)) {
        // Look for any file matching filenamePrefix in the output dir
        const files = await fs.promises.readdir(outputDir);
        const match = files.find(f => f.startsWith(filenamePrefix) && !f.endsWith('.json'));
        if (!match) {
          throw new Error('Arquivo de vídeo baixado não foi encontrado após o processamento.');
        }
        finalFilePath = path.join(outputDir, match);
      }

      // Read info json if present
      let info: VideoSourceInfo = {
        title: 'Vídeo do YouTube',
        sourceUrl: url,
      };

      const infoJsonPath = path.join(outputDir, `${filenamePrefix}.info.json`);
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
            sourceUrl: url,
          };
          // Clean up info json
          await fs.promises.unlink(infoJsonPath).catch(() => {});
        } catch {
          // Ignore json read errors
        }
      }

      return {
        filePath: finalFilePath,
        info,
      };
    } catch (err: any) {
      console.error('Error downloading YouTube video:', err);
      throw new Error(`Falha no download do vídeo do YouTube: ${err.message}`);
    }
  }
}

export const defaultYouTubeProvider = new YouTubeSourceProvider();
