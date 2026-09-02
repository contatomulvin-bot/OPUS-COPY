import crypto from 'crypto';
import { JobProgress, JobQueue, JobStatus, PipelineStep } from './job-queue';

export class LocalJobQueue implements JobQueue {
  private jobs: Map<string, JobProgress> = new Map();

  private getStepLabel(step: PipelineStep): string {
    switch (step) {
      case 'INGEST':
        return 'Preparando vídeo...';
      case 'DOWNLOAD':
        return 'Baixando vídeo do YouTube...';
      case 'METADATA':
        return 'Analisando formato e dimensões...';
      case 'AUDIO_EXTRACTION':
        return 'Extraindo trilha de áudio...';
      case 'TRANSCRIPTION':
        return 'Transcrevendo áudio com IA...';
      case 'AI_ANALYSIS':
        return 'Analisando momentos de maior engajamento...';
      case 'CLIP_SELECTION':
        return 'Gerando e deduplicando Shorts candidatos...';
      case 'RENDER':
        return 'Convertendo para 9:16 e gerando legendas...';
      case 'COMPLETED':
        return 'Concluído com sucesso!';
      default:
        return 'Processando...';
    }
  }

  createJob(initialData: Partial<JobProgress>): JobProgress {
    const jobId = initialData.jobId || crypto.randomUUID();
    const currentStep: PipelineStep = initialData.currentStep || 'INGEST';
    const job: JobProgress = {
      jobId,
      projectId: initialData.projectId,
      videoId: initialData.videoId,
      clipId: initialData.clipId,
      status: initialData.status || 'PROCESSING',
      progress: initialData.progress ?? 5,
      currentStep,
      stepLabel: initialData.stepLabel || this.getStepLabel(currentStep),
      error: initialData.error,
      updatedAt: new Date(),
      result: initialData.result,
    };

    this.jobs.set(jobId, job);
    return job;
  }

  getJob(jobId: string): JobProgress | null {
    return this.jobs.get(jobId) || null;
  }

  updateJob(jobId: string, updates: Partial<JobProgress>): JobProgress {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return this.createJob({ jobId, ...updates });
    }

    const currentStep = updates.currentStep || existing.currentStep;
    const updated: JobProgress = {
      ...existing,
      ...updates,
      currentStep,
      stepLabel: updates.stepLabel || (updates.currentStep ? this.getStepLabel(currentStep) : existing.stepLabel),
      updatedAt: new Date(),
    };

    this.jobs.set(jobId, updated);
    return updated;
  }

  failJob(jobId: string, error: string, step?: PipelineStep): JobProgress {
    return this.updateJob(jobId, {
      status: 'FAILED',
      error,
      currentStep: step,
      stepLabel: `Erro: ${error}`,
    });
  }

  completeJob(jobId: string, result?: any): JobProgress {
    return this.updateJob(jobId, {
      status: 'COMPLETED',
      progress: 100,
      currentStep: 'COMPLETED',
      stepLabel: 'Concluído com sucesso!',
      result,
    });
  }

  getJobsByProject(projectId: string): JobProgress[] {
    return Array.from(this.jobs.values()).filter(j => j.projectId === projectId);
  }

  getJobsByVideo(videoId: string): JobProgress[] {
    return Array.from(this.jobs.values()).filter(j => j.videoId === videoId);
  }
}

export const defaultJobQueue = new LocalJobQueue();
