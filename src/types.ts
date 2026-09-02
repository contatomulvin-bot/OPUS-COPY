export type ProjectStatus = 'CREATED' | 'PROCESSING' | 'READY' | 'FAILED';
export type VideoSourceType = 'UPLOAD' | 'YOUTUBE';
export type VideoStatus =
  | 'CREATED'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'EXTRACTING_AUDIO'
  | 'AUDIO_READY'
  | 'TRANSCRIBING'
  | 'TRANSCRIBED'
  | 'ANALYZING'
  | 'ANALYZED'
  | 'RENDERING'
  | 'COMPLETED'
  | 'FAILED';
export type ClipStatus = 'CANDIDATE' | 'SELECTED' | 'RENDERING' | 'COMPLETED' | 'FAILED';
export type RenderStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type SubtitleStyle = 'CLEAN' | 'BOLD' | 'DYNAMIC';
export type ReframeMode = 'CENTER_CROP' | 'AUTO_TRACK' | 'FIT_BLUR';

export type ClipCategory =
  | 'STORY'
  | 'OPINION'
  | 'EDUCATION'
  | 'MOTIVATION'
  | 'HUMOR'
  | 'CONTROVERSY'
  | 'SURPRISE'
  | 'EMOTION'
  | 'FACT'
  | 'ADVICE'
  | 'OTHER';

export interface ClipSubScores {
  hook: number;
  clarity: number;
  emotion: number;
  curiosity: number;
  standaloneContext: number;
  value: number;
}

export interface TranscriptWord {
  id: string;
  segmentId: string;
  word: string;
  startTime: number;
  endTime: number;
}

export interface TranscriptSegment {
  id: string;
  transcriptId: string;
  startTime: number;
  endTime: number;
  text: string;
  createdAt?: string;
  words?: TranscriptWord[];
  _count?: {
    words: number;
  };
}

export interface Transcript {
  id: string;
  videoId: string;
  language: string;
  text: string;
  createdAt?: string;
  updatedAt?: string;
  segmentsCount?: number;
  wordsCount?: number;
  segments: TranscriptSegment[];
}

export interface RenderOptions {
  subtitleStyle?: SubtitleStyle;
  subtitlesEnabled?: boolean;
  reframeMode?: ReframeMode;
  targetWidth?: number;
  targetHeight?: number;
}

export interface Render {
  id: string;
  clipId: string;
  status: RenderStatus;
  progress?: number;
  currentStep?: string;
  options?: string | RenderOptions;
  outputPath?: string;
  downloadUrl?: string;
  streamUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  clip?: Clip;
}

export interface Clip {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  title: string;
  description: string;
  hook: string;
  category?: ClipCategory;
  score: number;
  scores?: string | ClipSubScores;
  matchedText?: string;
  status: ClipStatus;
  createdAt: string;
  updatedAt: string;
  renders: Render[];
}

export interface Video {
  id: string;
  projectId: string;
  originalName: string;
  sourceType: VideoSourceType;
  sourceUrl?: string;
  storagePath: string;
  duration: number;
  width: number;
  height: number;
  fileSize: number | string;
  audioPath?: string;
  status: VideoStatus;
  currentStep?: string;
  progress?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  transcript?: Transcript;
  clips: Clip[];
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  videoCount?: number;
  clipCount?: number;
  completedRendersCount?: number;
  primaryVideo?: Video;
  videos: Video[];
}

export interface SystemStatus {
  ffmpeg: {
    available: boolean;
    path: string;
  };
  youtube: {
    available: boolean;
    reason?: string;
  };
  gemini: {
    configured: boolean;
    keyProvided: boolean;
  };
  storage: {
    type: string;
    basePath: string;
  };
}

export interface DashboardStats {
  projectCount: number;
  videoCount: number;
  clipCount: number;
  renderCount: number;
}

export interface JobProgress {
  jobId: string;
  projectId?: string;
  videoId?: string;
  clipId?: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  currentStep: string;
  stepLabel: string;
  error?: string;
  updatedAt: string;
  result?: any;
}
