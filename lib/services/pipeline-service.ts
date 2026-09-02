import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { prisma } from '../db/prisma';
import { defaultStorage } from '../storage/providers/local-storage-provider';
import { defaultVideoProcessor } from '../video/video-processor';
import { SubtitleStyle, ReframeMode } from '../video/types';
import { defaultSubtitleGenerator } from '../video/subtitles/subtitle-generator';
import { defaultYouTubeProvider } from '../video/video-source-provider';
import { defaultTranscriptionProvider } from '../transcription/providers/gemini-transcription-provider';
import { defaultClipAnalyzerService } from '../ai/services/clip-analyzer';
import { defaultJobQueue } from '../jobs/local-job-queue';
import { JobProgress } from '../jobs/job-queue';

export interface ProcessVideoOptions { jobId?: string; forceRetry?: boolean; }
export interface RenderClipOptions { subtitleStyle?: SubtitleStyle; subtitlesEnabled?: boolean; reframeMode?: ReframeMode; jobId?: string; }

export class PipelineService {
  async processVideo(videoId: string, options: ProcessVideoOptions = {}): Promise<JobProgress> {
    const video = await prisma.video.findUnique({ where: { id: videoId }, include: { project: true, transcript: { include: { segments: { orderBy: { startTime: 'asc' } } } }, clips: true } });
    if (!video) throw new Error(`Vídeo com ID ${videoId} não foi encontrado.`);
    const jobId = options.jobId || crypto.randomUUID();
    const job = defaultJobQueue.createJob({ jobId, projectId: video.projectId, videoId: video.id, currentStep: 'INGEST', status: 'PROCESSING', progress: 5 });
    this.runPipelineExecution(video.id, jobId, options.forceRetry).catch(err => console.error(`Pipeline failure for video ${video.id}:`, err));
    return job;
  }

  private async runPipelineExecution(videoId: string, jobId: string, forceRetry = false) {
    try {
      const video = await prisma.video.findUnique({ where: { id: videoId }, include: { project: true, transcript: { include: { segments: { orderBy: { startTime: 'asc' } } } }, clips: true } });
      if (!video) throw new Error('Vídeo não encontrado');
      let absoluteVideoPath = defaultStorage.getAbsolutePath(video.storagePath);
      if (video.sourceType === 'YOUTUBE' && (!fs.existsSync(absoluteVideoPath) || video.status === 'CREATED' || video.status === 'DOWNLOADING')) {
        defaultJobQueue.updateJob(jobId, { currentStep: 'DOWNLOAD', progress: 15, stepLabel: 'Baixando vídeo do YouTube...' });
        await prisma.video.update({ where: { id: video.id }, data: { status: 'DOWNLOADING' } });
        if (!video.sourceUrl) throw new Error('URL do YouTube não especificada para o vídeo.');
        const outputDir = path.dirname(absoluteVideoPath);
        const downloadResult = await defaultYouTubeProvider.download(video.sourceUrl, outputDir, `yt_${video.id}`);
        absoluteVideoPath = downloadResult.filePath;
        const relativeStoragePath = path.relative(path.resolve(process.cwd(), 'uploads'), absoluteVideoPath);
        await prisma.video.update({ where: { id: video.id }, data: { storagePath: relativeStoragePath, status: 'DOWNLOADED' } });
      }
      if (!fs.existsSync(absoluteVideoPath)) throw new Error(`Arquivo de vídeo não encontrado em: ${absoluteVideoPath}`);
      defaultJobQueue.updateJob(jobId, { currentStep: 'METADATA', progress: 25, stepLabel: 'Extraindo metadados técnicos do vídeo...' });
      const metadata = await defaultVideoProcessor.getMetadata(absoluteVideoPath);
      const stat = await fs.promises.stat(absoluteVideoPath);
      await prisma.video.update({ where: { id: video.id }, data: { duration: metadata.duration, width: metadata.width, height: metadata.height, fileSize: BigInt(stat.size) } });
      defaultJobQueue.updateJob(jobId, { currentStep: 'AUDIO_EXTRACTION', progress: 40, stepLabel: 'Extraindo trilha de áudio com FFmpeg...' });
      const absoluteAudioPath = defaultStorage.getAbsolutePath(`audio/${video.id}.mp3`);
      if (!fs.existsSync(absoluteAudioPath) || forceRetry) await defaultVideoProcessor.extractAudio(absoluteVideoPath, absoluteAudioPath);
      let segments = video.transcript?.segments || [];
      if (segments.length === 0 || forceRetry) {
        defaultJobQueue.updateJob(jobId, { currentStep: 'TRANSCRIPTION', progress: 55, stepLabel: 'Transcrevendo áudio com IA Gemini...' });
        await prisma.video.update({ where: { id: video.id }, data: { status: 'TRANSCRIBING' } });
        const transcriptionResult = await defaultTranscriptionProvider.transcribe(absoluteAudioPath);
        const transcriptRecord = await prisma.transcript.upsert({ where: { videoId: video.id }, update: { text: transcriptionResult.text, language: transcriptionResult.language }, create: { videoId: video.id, text: transcriptionResult.text, language: transcriptionResult.language } });
        await prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcriptRecord.id } });
        if (transcriptionResult.segments.length > 0) await prisma.transcriptSegment.createMany({ data: transcriptionResult.segments.map(s => ({ transcriptId: transcriptRecord.id, startTime: s.startTime, endTime: s.endTime, text: s.text })) });
        const freshTranscript = await prisma.transcript.findUnique({ where: { id: transcriptRecord.id }, include: { segments: { orderBy: { startTime: 'asc' } } } });
        segments = freshTranscript?.segments || [];
        await prisma.video.update({ where: { id: video.id }, data: { status: 'TRANSCRIBED' } });
      }
      defaultJobQueue.updateJob(jobId, { currentStep: 'AI_ANALYSIS', progress: 75, stepLabel: 'Analisando melhores momentos e ganchos virais...' });
      await prisma.video.update({ where: { id: video.id }, data: { status: 'ANALYZING' } });
      const aiCandidateClips = await defaultClipAnalyzerService.findBestMoments(segments.map(s => ({ id: s.id, startTime: s.startTime, endTime: s.endTime, text: s.text })), { videoDuration: metadata.duration, videoTitle: video.originalName });
      defaultJobQueue.updateJob(jobId, { currentStep: 'CLIP_SELECTION', progress: 90, stepLabel: 'Salvando e ranqueando candidatos a Shorts...' });
      if (forceRetry) await prisma.clip.deleteMany({ where: { videoId: video.id } });
      const createdClips = [];
      for (const candidate of aiCandidateClips) createdClips.push(await prisma.clip.create({ data: { videoId: video.id, startTime: candidate.startTime, endTime: candidate.endTime, title: candidate.title, description: candidate.description, hook: candidate.hook, score: candidate.score, status: 'CANDIDATE' } }));
      await prisma.video.update({ where: { id: video.id }, data: { status: 'COMPLETED' } });
      await prisma.project.update({ where: { id: video.projectId }, data: { status: 'READY' } });
      defaultJobQueue.completeJob(jobId, { clipsCount: createdClips.length, clips: createdClips });
    } catch (err: any) {
      console.error(`Error executing pipeline for video ${videoId}:`, err);
      defaultJobQueue.failJob(jobId, err.message || 'Falha durante o processamento do pipeline');
      await prisma.video.update({ where: { id: videoId }, data: { status: 'FAILED' } }).catch(() => {});
      const v = await prisma.video.findUnique({ where: { id: videoId } });
      if (v?.projectId) await prisma.project.update({ where: { id: v.projectId }, data: { status: 'FAILED' } }).catch(() => {});
    }
  }

  async renderClip(clipId: string, options: RenderClipOptions = {}): Promise<{ renderId: string; job: JobProgress }> {
    const clip = await prisma.clip.findUnique({ where: { id: clipId }, include: { video: { include: { transcript: { include: { segments: { orderBy: { startTime: 'asc' } } } } } } } });
    if (!clip) throw new Error(`Clipe com ID ${clipId} não foi encontrado.`);
    const render = await prisma.render.create({ data: { clipId: clip.id, status: 'PROCESSING' } });
    await prisma.clip.update({ where: { id: clip.id }, data: { status: 'RENDERING' } });
    const jobId = options.jobId || crypto.randomUUID();
    const job = defaultJobQueue.createJob({ jobId, projectId: clip.video.projectId, videoId: clip.videoId, clipId: clip.id, currentStep: 'RENDER', status: 'PROCESSING', progress: 10, stepLabel: 'Iniciando renderização vertical 9:16...' });
    this.executeClipRender(clip.id, render.id, jobId, options).catch(err => console.error(`Clip render error for ${clip.id}:`, err));
    return { renderId: render.id, job };
  }

  private async executeClipRender(clipId: string, renderId: string, jobId: string, options: RenderClipOptions) {
    try {
      const clip = await prisma.clip.findUnique({ where: { id: clipId }, include: { video: { include: { transcript: { include: { segments: { orderBy: { startTime: 'asc' } } } } } } } });
      if (!clip) throw new Error('Clipe não encontrado');
      const absoluteVideoPath = defaultStorage.getAbsolutePath(clip.video.storagePath);
      if (!fs.existsSync(absoluteVideoPath)) throw new Error(`Vídeo fonte não encontrado em: ${absoluteVideoPath}`);
      defaultJobQueue.updateJob(jobId, { progress: 30, stepLabel: 'Formatando legendas sincronizadas...' });
      const clipSegments = (clip.video.transcript?.segments || []).filter(s => s.endTime >= clip.startTime && s.startTime <= clip.endTime);
      const subtitleStyle: SubtitleStyle = options.subtitleStyle || 'BOLD';
      const subtitlesRelativePath = `subtitles/${clip.id}_${subtitleStyle.toLowerCase()}.ass`;
      const absoluteSubtitlesPath = defaultStorage.getAbsolutePath(subtitlesRelativePath);
      if (options.subtitlesEnabled !== false && clipSegments.length > 0) {
        const captions = clipSegments.map(segment => ({ startTime: Math.max(0, segment.startTime - clip.startTime), endTime: Math.max(0, segment.endTime - clip.startTime), text: segment.text }));
        const assContent = defaultSubtitleGenerator.generateASS(captions, subtitleStyle);
        await fs.promises.mkdir(path.dirname(absoluteSubtitlesPath), { recursive: true });
        await fs.promises.writeFile(absoluteSubtitlesPath, assContent, 'utf8');
      }
      defaultJobQueue.updateJob(jobId, { progress: 60, stepLabel: 'Convertendo para 9:16 e aplicando encode FFmpeg...' });
      const outputRelativePath = `renders/short_${clip.id.substring(0, 8)}.mp4`;
      const absoluteOutputPath = defaultStorage.getAbsolutePath(outputRelativePath);
      await defaultVideoProcessor.renderVertical({ inputVideoPath: absoluteVideoPath, outputVideoPath: absoluteOutputPath, startTime: clip.startTime, endTime: clip.endTime, subtitlesPath: options.subtitlesEnabled !== false && clipSegments.length > 0 ? absoluteSubtitlesPath : undefined, subtitlesEnabled: options.subtitlesEnabled !== false && clipSegments.length > 0, subtitleStyle, reframeMode: options.reframeMode || 'CENTER_CROP', targetWidth: 1080, targetHeight: 1920 });
      const validation = await defaultVideoProcessor.validateOutput(absoluteOutputPath, clip.endTime - clip.startTime, { minWidth: 720, minHeight: 1280 });
      if (!validation.isValid) throw new Error(validation.error || 'Vídeo renderizado inválido');
      await prisma.render.update({ where: { id: renderId }, data: { status: 'COMPLETED', outputPath: outputRelativePath } });
      await prisma.clip.update({ where: { id: clip.id }, data: { status: 'COMPLETED' } });
      defaultJobQueue.completeJob(jobId, { renderId, outputPath: outputRelativePath });
    } catch (err: any) {
      console.error(`Render execution failed for ${renderId}:`, err);
      await prisma.render.update({ where: { id: renderId }, data: { status: 'FAILED', errorMessage: err.message || 'Falha na renderização' } }).catch(() => {});
      await prisma.clip.update({ where: { id: clipId }, data: { status: 'FAILED' } }).catch(() => {});
      defaultJobQueue.failJob(jobId, err.message || 'Falha na renderização');
    }
  }
}

export const defaultPipelineService = new PipelineService();
