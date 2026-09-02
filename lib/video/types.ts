import { z } from 'zod';

export type SubtitleStyle = 'CLEAN' | 'BOLD' | 'DYNAMIC';
export type ReframeMode = 'AUTO' | 'CENTER' | 'FIT_BLUR' | 'CENTER_CROP' | 'AUTO_TRACK';
export type RenderQuality = 'HIGH' | 'STANDARD' | 'DRAFT';

export const SubtitleStyleEnum = z.enum(['CLEAN', 'BOLD', 'DYNAMIC']);
export const ReframeModeEnum = z.enum(['AUTO', 'CENTER', 'FIT_BLUR', 'CENTER_CROP', 'AUTO_TRACK']);
export const RenderQualityEnum = z.enum(['HIGH', 'STANDARD', 'DRAFT']);

export const RenderOptionsSchema = z.object({
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
  width: z.number().int().positive().default(1080),
  height: z.number().int().positive().default(1920),
  captionStyle: SubtitleStyleEnum.default('BOLD'),
  captionsEnabled: z.boolean().default(true),
  reframeMode: ReframeModeEnum.default('AUTO'),
  quality: RenderQualityEnum.default('HIGH'),
});

export type RenderOptions = z.infer<typeof RenderOptionsSchema>;

export interface CaptionWord {
  word: string;
  startTime: number;
  endTime: number;
}

export interface Caption {
  id?: string;
  startTime: number; // in seconds relative to clip start or video
  endTime: number;   // in seconds
  text: string;
  words?: CaptionWord[];
}

export interface VideoMetadata {
  duration: number; // in seconds
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  codec?: string;
  hasAudio: boolean;
  audioCodec?: string;
  aspectRatio?: number;
}

export interface CropCalculationResult {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  scaleWidth: number;
  scaleHeight: number;
  filterGraph: string;
  isVerticalSource: boolean;
  aspectRatio: number;
}

export interface RenderResult {
  renderId: string;
  clipId: string;
  outputPath: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  hasSubtitles: boolean;
  metadata: VideoMetadata;
}

export const RENDER_ERRORS = {
  RENDER_FAILED: 'RENDER_FAILED',
  FFMPEG_ERROR: 'FFMPEG_ERROR',
  INVALID_CLIP_TIMESTAMPS: 'INVALID_CLIP_TIMESTAMPS',
  INVALID_RENDER_OPTIONS: 'INVALID_RENDER_OPTIONS',
  OUTPUT_INVALID: 'OUTPUT_INVALID',
  TRANSCRIPT_REQUIRED_FOR_CAPTIONS: 'TRANSCRIPT_REQUIRED_FOR_CAPTIONS',
  SOURCE_VIDEO_NOT_FOUND: 'SOURCE_VIDEO_NOT_FOUND',
  RENDER_NOT_FOUND: 'RENDER_NOT_FOUND',
  DOWNLOAD_NOT_AVAILABLE: 'DOWNLOAD_NOT_AVAILABLE',
} as const;

export type RenderErrorCode = keyof typeof RENDER_ERRORS;
