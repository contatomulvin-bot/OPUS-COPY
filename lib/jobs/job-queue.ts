export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type PipelineStep =
  | 'INGEST'
  | 'DOWNLOAD'
  | 'METADATA'
  | 'AUDIO_EXTRACTION'
  | 'TRANSCRIPTION'
  | 'AI_ANALYSIS'
  | 'CLIP_SELECTION'
  | 'RENDER'
  | 'COMPLETED';

export interface JobProgress {
  jobId: string;
  projectId?: string;
  videoId?: string;
  clipId?: string;
  status: JobStatus;
  progress: number; // 0 - 100
  currentStep: PipelineStep;
  stepLabel: string;
  error?: string;
  updatedAt: Date;
  result?: any;
}

export interface JobQueue {
  createJob(initialData: Partial<JobProgress>): JobProgress;
  getJob(jobId: string): JobProgress | null;
  updateJob(jobId: string, updates: Partial<JobProgress>): JobProgress;
  failJob(jobId: string, error: string, step?: PipelineStep): JobProgress;
  completeJob(jobId: string, result?: any): JobProgress;
  getJobsByProject(projectId: string): JobProgress[];
  getJobsByVideo(videoId: string): JobProgress[];
}
