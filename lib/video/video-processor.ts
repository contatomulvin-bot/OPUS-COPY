import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import {
  VideoMetadata,
  SubtitleStyle,
  ReframeMode,
  RenderOptions,
  CropCalculationResult,
  RENDER_ERRORS,
} from './types';
import { defaultAutoReframeProvider } from './reframe/auto-reframe-provider';

const execFileAsync = promisify(execFile);

export interface RenderVerticalOptions {
  inputVideoPath: string;
  outputVideoPath: string;
  startTime: number;
  endTime: number;
  subtitlesPath?: string;
  subtitlesEnabled?: boolean;
  subtitleStyle?: SubtitleStyle;
  reframeMode?: ReframeMode;
  targetWidth?: number;
  targetHeight?: number;
  quality?: 'HIGH' | 'STANDARD' | 'DRAFT';
  onProgress?: (percent: number) => void;
}

export interface VideoProcessor {
  isAvailable(): Promise<boolean>;
  getMetadata(filePath: string): Promise<VideoMetadata>;
  extractAudio(videoPath: string, outputAudioPath: string): Promise<string>;
  cut(videoPath: string, startTime: number, endTime: number, outputPath: string): Promise<string>;
  renderVertical(options: RenderVerticalOptions): Promise<string>;
  validateOutput(
    outputPath: string,
    expectedDuration?: number,
    options?: { minWidth?: number; minHeight?: number }
  ): Promise<{ isValid: boolean; error?: string; metadata: VideoMetadata }>;
}

export class FFmpegVideoProcessor implements VideoProcessor {
  private ffmpegPath: string;
  private ffprobePath: string;

  constructor(ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe') {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.ffmpegPath, ['-version']);
      await execFileAsync(this.ffprobePath, ['-version']);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(filePath: string): Promise<VideoMetadata> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo de vídeo não encontrado: ${filePath}`);
    }

    try {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ];

      const { stdout } = await execFileAsync(this.ffprobePath, args);
      const data = JSON.parse(stdout);

      const videoStream = data.streams?.find((s: { codec_type?: string }) => s.codec_type === 'video');
      const audioStream = data.streams?.find((s: { codec_type?: string }) => s.codec_type === 'audio');

      if (!videoStream) {
        throw new Error('Nenhum stream de vídeo detectado no arquivo.');
      }

      const duration = parseFloat(data.format?.duration || videoStream.duration || '0');
      const width = parseInt(videoStream.width || '1280', 10);
      const height = parseInt(videoStream.height || '720', 10);

      let fps = 30;
      if (videoStream.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/');
        if (parts.length === 2 && parseInt(parts[1], 10) > 0) {
          fps = Math.round(parseInt(parts[0], 10) / parseInt(parts[1], 10));
        }
      }

      return {
        duration: isNaN(duration) ? 0 : duration,
        width,
        height,
        fps: isNaN(fps) || fps <= 0 ? 30 : fps,
        codec: videoStream.codec_name,
        hasAudio: !!audioStream,
        audioCodec: audioStream?.codec_name,
        aspectRatio: width / (height || 1),
        bitrate: parseInt(data.format?.bit_rate || '0', 10) || undefined,
      };
    } catch (err: any) {
      console.error('Error reading video metadata via ffprobe:', err);
      throw new Error(`Falha ao obter metadados do vídeo: ${err.message}`);
    }
  }

  async extractAudio(videoPath: string, outputAudioPath: string): Promise<string> {
    const dir = path.dirname(outputAudioPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const isWav = outputAudioPath.toLowerCase().endsWith('.wav');

    const args = isWav
      ? [
          '-y',
          '-i', videoPath,
          '-vn',
          '-acodec', 'pcm_s16le',
          '-ar', '16000',
          '-ac', '1',
          outputAudioPath,
        ]
      : [
          '-y',
          '-i', videoPath,
          '-vn',
          '-acodec', 'libmp3lame',
          '-ar', '16000',
          '-ac', '1',
          '-b:a', '64k',
          outputAudioPath,
        ];

    await execFileAsync(this.ffmpegPath, args);
    return outputAudioPath;
  }

  async cut(videoPath: string, startTime: number, endTime: number, outputPath: string): Promise<string> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const duration = endTime - startTime;
    if (duration <= 0) {
      throw new Error(`${RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS}: Duração inválida para o corte (${duration}s)`);
    }

    const args = [
      '-y',
      '-ss', startTime.toFixed(3),
      '-i', videoPath,
      '-t', duration.toFixed(3),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ];

    await execFileAsync(this.ffmpegPath, args);
    return outputPath;
  }

  async renderVertical(options: RenderVerticalOptions): Promise<string> {
    const {
      inputVideoPath,
      outputVideoPath,
      startTime,
      endTime,
      subtitlesPath,
      subtitlesEnabled = true,
      reframeMode = 'AUTO',
      targetWidth = 1080,
      targetHeight = 1920,
      quality = 'HIGH',
      onProgress,
    } = options;

    const dir = path.dirname(outputVideoPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const duration = endTime - startTime;
    if (duration <= 0) {
      throw new Error(`${RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS}: Duração do clipe deve ser estritamente maior que 0.`);
    }

    // Get input metadata to calculate accurate crop
    const metadata = await this.getMetadata(inputVideoPath);

    // Calculate crop with AutoReframeProvider
    const cropResult: CropCalculationResult = defaultAutoReframeProvider.calculateCrop(metadata, {
      targetWidth,
      targetHeight,
      reframeMode,
    });

    let filterComplex = '';
    let finalVideoMap = '[vfinal]';

    if (reframeMode === 'FIT_BLUR') {
      filterComplex = `split=2[bg][fg];[bg]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},boxblur=25:5[bgblur];[fg]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease[fgscaled];[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[vbase]`;
    } else {
      filterComplex = `${cropResult.filterGraph}[vbase]`;
    }

    const hasSubtitles = subtitlesEnabled && subtitlesPath && fs.existsSync(subtitlesPath);

    if (hasSubtitles) {
      // Escape Windows or Unix paths for FFmpeg ASS filter
      const escapedSubPath = subtitlesPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filterComplex += `;[vbase]ass='${escapedSubPath}'[vfinal]`;
    } else {
      filterComplex = filterComplex.replace(/\[vbase\]$/, '[vfinal]');
      if (!filterComplex.includes('[vfinal]')) {
        filterComplex += `[vfinal]`;
      }
    }

    // Determine quality flags
    const crf = quality === 'HIGH' ? '20' : quality === 'STANDARD' ? '23' : '26';
    const preset = quality === 'HIGH' ? 'medium' : 'fast';

    const args = [
      '-y',
      '-ss', startTime.toFixed(3),
      '-i', inputVideoPath,
      '-t', duration.toFixed(3),
      '-filter_complex', filterComplex,
      '-map', finalVideoMap,
      ...(metadata.hasAudio ? ['-map', '0:a?', '-c:a', 'aac', '-b:a', '160k'] : []),
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', crf,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputVideoPath,
    ];

    try {
      await this.runProcessWithProgress(this.ffmpegPath, args, duration, onProgress);
      return outputVideoPath;
    } catch (err: any) {
      console.warn('FFmpeg render with filter_complex failed. Attempting fallback:', err.message);

      // Fallback: simplified render without ASS filter
      const fallbackFilter = `crop=min(iw\\,ih*9/16):min(ih\\,iw*16/9),scale=${targetWidth}:${targetHeight},setsar=1`;
      const fallbackArgs = [
        '-y',
        '-ss', startTime.toFixed(3),
        '-i', inputVideoPath,
        '-t', duration.toFixed(3),
        '-vf', fallbackFilter,
        ...(metadata.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outputVideoPath,
      ];

      try {
        await execFileAsync(this.ffmpegPath, fallbackArgs);
        return outputVideoPath;
      } catch (fallbackErr: any) {
        throw new Error(`${RENDER_ERRORS.FFMPEG_ERROR}: ${fallbackErr.message || err.message}`);
      }
    }
  }

  async validateOutput(
    outputPath: string,
    expectedDuration?: number,
    options: { minWidth?: number; minHeight?: number } = {}
  ): Promise<{ isValid: boolean; error?: string; metadata: VideoMetadata }> {
    if (!fs.existsSync(outputPath)) {
      return {
        isValid: false,
        error: `${RENDER_ERRORS.OUTPUT_INVALID}: Arquivo de saída não existe em ${outputPath}`,
        metadata: { duration: 0, width: 0, height: 0, fps: 0, hasAudio: false },
      };
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      return {
        isValid: false,
        error: `${RENDER_ERRORS.OUTPUT_INVALID}: Arquivo gerado tem tamanho 0 bytes.`,
        metadata: { duration: 0, width: 0, height: 0, fps: 0, hasAudio: false },
      };
    }

    try {
      const metadata = await this.getMetadata(outputPath);

      if (metadata.duration <= 0) {
        return {
          isValid: false,
          error: `${RENDER_ERRORS.OUTPUT_INVALID}: Duração do vídeo gerado é 0 segundos.`,
          metadata,
        };
      }

      if (options.minWidth && metadata.width < options.minWidth) {
        return {
          isValid: false,
          error: `${RENDER_ERRORS.OUTPUT_INVALID}: Largura do vídeo (${metadata.width}px) menor que o esperado (${options.minWidth}px).`,
          metadata,
        };
      }

      if (options.minHeight && metadata.height < options.minHeight) {
        return {
          isValid: false,
          error: `${RENDER_ERRORS.OUTPUT_INVALID}: Altura do vídeo (${metadata.height}px) menor que o esperado (${options.minHeight}px).`,
          metadata,
        };
      }

      if (expectedDuration && expectedDuration > 0) {
        const diff = Math.abs(metadata.duration - expectedDuration);
        if (diff > 3.0) {
          console.warn(`Aviso: Duração gerada (${metadata.duration}s) diverge do esperado (${expectedDuration}s) por ${diff.toFixed(1)}s`);
        }
      }

      return {
        isValid: true,
        metadata,
      };
    } catch (err: any) {
      return {
        isValid: false,
        error: `${RENDER_ERRORS.OUTPUT_INVALID}: Falha na validação ffprobe: ${err.message}`,
        metadata: { duration: 0, width: 0, height: 0, fps: 0, hasAudio: false },
      };
    }
  }

  private runProcessWithProgress(
    cmd: string,
    args: string[],
    totalDuration: number,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args);
      let stderrBuffer = '';

      child.stderr.on('data', (data) => {
        const str = data.toString();
        stderrBuffer += str;

        if (onProgress && totalDuration > 0) {
          const match = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (match) {
            const hours = parseFloat(match[1]);
            const mins = parseFloat(match[2]);
            const secs = parseFloat(match[3]);
            const currentTime = hours * 3600 + mins * 60 + secs;
            const pct = Math.min(99, Math.max(1, Math.round((currentTime / totalDuration) * 100)));
            onProgress(pct);
          }
        }
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code) => {
        if (code === 0) {
          if (onProgress) onProgress(100);
          resolve();
        } else {
          reject(new Error(`FFmpeg falhou com código de saída ${code}: ${stderrBuffer.slice(-600)}`));
        }
      });
    });
  }
}

export const defaultVideoProcessor = new FFmpegVideoProcessor();
