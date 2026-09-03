import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { prisma, getOrCreateDemoUser } from './lib/db/prisma';
import { serializePrisma } from './lib/utils/serializer';
import { defaultProjectService } from './lib/services/project-service';
import { defaultPipelineService } from './lib/services/pipeline-service';
import { defaultVideoIngestionService } from './lib/services/video-ingestion-service';
import { defaultTranscriptService } from './lib/services/transcript-service';
import { defaultClipService } from './lib/services/clip-service';
import { defaultRenderService } from './lib/services/render-service';
import { defaultJobQueue } from './lib/jobs/local-job-queue';
import { defaultStorage } from './lib/storage/providers/local-storage-provider';
import { defaultVideoProcessor } from './lib/video/video-processor';
import { defaultYouTubeProvider } from './lib/video/video-source-provider';
import { RenderOptionsSchema, RENDER_ERRORS } from './lib/video/types';
import {
  CreateProjectSchema,
  YouTubeUrlSchema,
  UpdateClipSchema,
  RenderClipSchema,
} from './lib/validation/schemas';

dotenv.config();

const uploadBaseDir = path.resolve(process.cwd(), 'uploads');
const videosDir = path.join(uploadBaseDir, 'videos');
const audioDir = path.join(uploadBaseDir, 'audio');
const rendersDir = path.join(uploadBaseDir, 'renders');
const subtitlesDir = path.join(uploadBaseDir, 'subtitles');

[uploadBaseDir, videosDir, audioDir, rendersDir, subtitlesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, videosDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/avi', 'audio/mpeg', 'audio/wav'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp4|mov|webm|mkv|avi|mp3|wav)$/i)) cb(null, true);
    else cb(new Error('Formato de arquivo não suportado. Use MP4, MOV, WEBM, MKV ou áudio.'));
  },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  const sendError = (res: Response, code: string, message: string, status = 400, details?: any) =>
    res.status(status).json({ error: { code, message, details } });

  app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  app.get('/api/system/status', async (req, res) => {
    const [ffmpegOk, ytDlpInfo] = await Promise.all([defaultVideoProcessor.isAvailable(), defaultYouTubeProvider.isAvailable()]);
    const hasGeminiKey = !!process.env.GEMINI_API_KEY;
    res.json({
      ffmpeg: { available: ffmpegOk, path: 'ffmpeg' },
      youtube: ytDlpInfo,
      gemini: { configured: hasGeminiKey, keyProvided: hasGeminiKey },
      storage: { type: 'local', basePath: uploadBaseDir },
    });
  });

  app.get('/api/stats', async (req, res) => {
    try { res.json(await defaultProjectService.getDashboardStats()); }
    catch (err: any) { sendError(res, 'STATS_ERROR', err.message, 500); }
  });

  app.get('/api/projects', async (req, res) => {
    try { res.json(serializePrisma(await defaultProjectService.getAllProjects())); }
    catch (err: any) { console.error(err); sendError(res, 'FETCH_PROJECTS_FAILED', err.message, 500); }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const validation = CreateProjectSchema.safeParse(req.body);
      if (!validation.success) return sendError(res, 'INVALID_INPUT', 'Nome do projeto inválido', 400, validation.error.format());
      res.status(201).json(serializePrisma(await defaultProjectService.createProject(validation.data.name)));
    } catch (err: any) { sendError(res, 'CREATE_PROJECT_FAILED', err.message, 500); }
  });

  app.get('/api/projects/:id', async (req, res) => {
    try {
      const project = await defaultProjectService.getProjectById(req.params.id);
      if (!project) return sendError(res, 'PROJECT_NOT_FOUND', 'Projeto não encontrado', 404);
      res.json(serializePrisma(project));
    } catch (err: any) { sendError(res, 'PROJECT_GET_FAILED', err.message, 500); }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      await defaultProjectService.deleteProject(req.params.id);
      res.json({ success: true, message: 'Projeto excluído com sucesso' });
    } catch (err: any) { sendError(res, 'DELETE_PROJECT_FAILED', err.message, 500); }
  });

  app.post('/api/videos/upload', upload.single('video'), async (req: Request, res: Response) => {
    try {
      if (!req.file) return sendError(res, 'INVALID_INPUT', 'Nenhum arquivo de vídeo enviado.');
      await getOrCreateDemoUser();
      let projectId = req.body.projectId;
      const displayName = typeof req.body.projectName === 'string' ? req.body.projectName.trim() : '';

      if (!projectId) {
        const projectName = displayName || path.parse(req.file.originalname).name || 'Novo Projeto';
        const project = await defaultProjectService.createProject(projectName);
        projectId = project.id;
      }

      const video = await defaultVideoIngestionService.ingestUpload(
        projectId,
        {
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          tempFilePath: req.file.path,
        },
        { autoExtractAudio: req.body.extractAudio !== 'false', displayName }
      );

      res.status(201).json(serializePrisma({ video, projectId, message: 'Upload e processamento inicial concluídos com sucesso' }));
    } catch (err: any) {
      console.error(err);
      sendError(res, 'UPLOAD_FAILED', err.message, 500);
    }
  });

  app.post('/api/videos/youtube', async (req, res) => {
    try {
      const validation = YouTubeUrlSchema.safeParse(req.body);
      if (!validation.success) return sendError(res, 'INVALID_YOUTUBE_URL', 'URL do YouTube inválida ou em formato não suportado', 400, validation.error.format());

      const { url, projectName } = validation.data;
      const displayName = typeof projectName === 'string' ? projectName.trim() : '';
      await getOrCreateDemoUser();

      const ytStatus = await defaultYouTubeProvider.isAvailable();
      if (!ytStatus.available) return sendError(res, 'YOUTUBE_PROCESSING_UNAVAILABLE', ytStatus.reason || 'yt-dlp indisponível.', 503);

      let projectId = req.body.projectId;
      if (!projectId) {
        const project = await defaultProjectService.createProject(displayName || 'Vídeo do YouTube');
        projectId = project.id;
      }

      const video = await defaultVideoIngestionService.ingestYouTube(
        projectId,
        url,
        { autoExtractAudio: req.body.extractAudio !== 'false', displayName }
      );

      res.status(201).json(serializePrisma({ video, projectId, message: 'Vídeo do YouTube baixado e preparado com sucesso' }));
    } catch (err: any) {
      console.error(err);
      sendError(res, 'DOWNLOAD_FAILED', err.message, 500);
    }
  });

  app.post('/api/videos/:id/extract-audio', async (req, res) => {
    try { res.json(serializePrisma({ message: 'Áudio extraído com sucesso', video: await defaultVideoIngestionService.extractAudio(req.params.id) })); }
    catch (err: any) { sendError(res, 'AUDIO_EXTRACTION_FAILED', err.message, 500); }
  });

  app.post('/api/videos/:id/process', async (req, res) => {
    try {
      const video = await prisma.video.findUnique({ where: { id: req.params.id } });
      if (!video) return sendError(res, 'VIDEO_NOT_FOUND', 'Vídeo não encontrado', 404);
      res.json(serializePrisma({ message: 'Processamento iniciado', job: await defaultPipelineService.processVideo(video.id, { forceRetry: req.body.forceRetry === true }) }));
    } catch (err: any) { sendError(res, 'PROCESS_FAILED', err.message, 500); }
  });

  app.post('/api/videos/:id/transcribe', async (req, res) => {
    try {
      const transcript = await defaultTranscriptService.transcribeVideo(req.params.id, {
        forceRetranscribe: req.body.forceRetranscribe === true,
        language: req.body.language || 'pt',
      });
      res.status(200).json(serializePrisma({ message: 'Transcrição concluída com sucesso', transcript }));
    } catch (err: any) {
      console.error(err);
      const code = err.message?.startsWith('AUDIO_NOT_FOUND') ? 'AUDIO_NOT_FOUND' : err.message?.startsWith('TRANSCRIPTION_UNAVAILABLE') ? 'TRANSCRIPTION_UNAVAILABLE' : err.message?.startsWith('INVALID_TRANSCRIPTION') ? 'INVALID_TRANSCRIPTION' : err.message?.startsWith('TRANSCRIPTION_TIMEOUT') ? 'TRANSCRIPTION_TIMEOUT' : 'TRANSCRIPTION_FAILED';
      sendError(res, code, err.message || 'Falha ao processar transcrição do vídeo', code === 'AUDIO_NOT_FOUND' ? 404 : code === 'TRANSCRIPTION_UNAVAILABLE' ? 503 : 500);
    }
  });

  app.get('/api/videos/:id/transcript', async (req, res) => {
    try {
      const transcript = await defaultTranscriptService.getTranscript(req.params.id);
      if (!transcript) return sendError(res, 'TRANSCRIPT_NOT_FOUND', 'Transcrição ainda não disponível para este vídeo', 404);
      res.json(serializePrisma(transcript));
    } catch (err: any) { sendError(res, 'FETCH_TRANSCRIPT_FAILED', err.message, 500); }
  });

  app.get('/api/videos/:id/status', async (req, res) => {
    try { res.json(await defaultVideoIngestionService.getVideoStatus(req.params.id)); }
    catch (err: any) { sendError(res, 'STATUS_CHECK_FAILED', err.message, 500); }
  });

  app.post('/api/videos/:id/analyze', async (req, res) => {
    try {
      const result = await defaultClipService.analyzeVideo(req.params.id, {
        force: req.body.force === true,
        maxCandidates: typeof req.body.maxCandidates === 'number' ? req.body.maxCandidates : undefined,
        minClipDuration: typeof req.body.minClipDuration === 'number' ? req.body.minClipDuration : undefined,
        maxClipDuration: typeof req.body.maxClipDuration === 'number' ? req.body.maxClipDuration : undefined,
      });
      res.status(200).json(serializePrisma({ message: 'Análise de melhores momentos concluída com sucesso', cached: result.cached, count: result.clips.length, clips: result.clips }));
    } catch (err: any) {
      console.error(err);
      const code = err.message?.startsWith('VIDEO_NOT_FOUND') ? 'VIDEO_NOT_FOUND' : err.message?.startsWith('TRANSCRIPT_NOT_FOUND') ? 'TRANSCRIPT_NOT_FOUND' : err.message?.startsWith('ANALYSIS_UNAVAILABLE') ? 'ANALYSIS_UNAVAILABLE' : err.message?.startsWith('INVALID_AI_RESPONSE') ? 'INVALID_AI_RESPONSE' : err.message?.startsWith('NO_CLIPS_FOUND') ? 'NO_CLIPS_FOUND' : 'ANALYSIS_FAILED';
      sendError(res, code, err.message || 'Falha ao analisar os melhores momentos do vídeo', code === 'VIDEO_NOT_FOUND' || code === 'TRANSCRIPT_NOT_FOUND' ? 404 : code === 'ANALYSIS_UNAVAILABLE' ? 503 : 500);
    }
  });

  app.get('/api/videos/:id/clips', async (req, res) => {
    try { res.json(serializePrisma(await defaultClipService.getVideoClips(req.params.id))); }
    catch (err: any) { sendError(res, 'FETCH_CLIPS_FAILED', err.message, 500); }
  });

  app.get('/api/projects/:id/clips', async (req, res) => {
    try {
      const clips = await prisma.clip.findMany({ where: { video: { projectId: req.params.id } }, orderBy: { score: 'desc' }, include: { renders: { orderBy: { createdAt: 'desc' } } } });
      res.json(serializePrisma(clips));
    } catch (err: any) { sendError(res, 'FETCH_CLIPS_FAILED', err.message, 500); }
  });

  app.patch('/api/clips/:id', async (req, res) => {
    try { res.json(serializePrisma(await defaultClipService.updateClip(req.params.id, req.body))); }
    catch (err: any) { sendError(res, err.message?.startsWith('INVALID_CLIP') ? 'INVALID_CLIP' : err.message?.startsWith('CLIP_NOT_FOUND') ? 'CLIP_NOT_FOUND' : 'UPDATE_CLIP_FAILED', err.message, err.message?.startsWith('INVALID_CLIP') ? 400 : err.message?.startsWith('CLIP_NOT_FOUND') ? 404 : 500); }
  });

  app.post('/api/clips/:id/select', async (req, res) => {
    try { res.json(serializePrisma(await prisma.clip.update({ where: { id: req.params.id }, data: { status: 'SELECTED' } }))); }
    catch (err: any) { sendError(res, 'SELECT_CLIP_FAILED', err.message, 500); }
  });

  app.post('/api/clips/:id/toggle-select', async (req, res) => {
    try { res.json(serializePrisma(await defaultClipService.toggleSelectClip(req.params.id))); }
    catch (err: any) { sendError(res, 'TOGGLE_SELECT_FAILED', err.message, 500); }
  });

  app.post('/api/clips/:id/render', async (req, res) => {
    try {
      const validation = RenderOptionsSchema.safeParse(req.body);
      const render = await defaultRenderService.createRender(req.params.id, validation.success ? validation.data : {});
      defaultRenderService.processRender(render.id).catch(err => console.error(`Erro assíncrono no render ${render.id}:`, err));
      res.status(201).json(serializePrisma({ message: 'Renderização do Short iniciada com sucesso', render }));
    } catch (err: any) {
      const isTimestampError = err.message?.includes(RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS);
      const isTranscriptError = err.message?.includes(RENDER_ERRORS.TRANSCRIPT_REQUIRED_FOR_CAPTIONS);
      sendError(res, isTimestampError ? RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS : isTranscriptError ? RENDER_ERRORS.TRANSCRIPT_REQUIRED_FOR_CAPTIONS : RENDER_ERRORS.RENDER_FAILED, err.message || 'Falha ao iniciar a renderização do Short', isTimestampError || isTranscriptError ? 400 : 500);
    }
  });

  app.get('/api/renders/recent', async (req, res) => {
    try { res.json(await defaultProjectService.getRecentShorts(parseInt(req.query.limit as string, 10) || 6)); }
    catch (err: any) { sendError(res, 'FETCH_RECENT_SHORTS_FAILED', err.message, 500); }
  });

  app.get('/api/renders/:id', async (req, res) => {
    try {
      const render = await defaultRenderService.getRender(req.params.id);
      const urls = render.outputPath && render.status === 'COMPLETED' ? { downloadUrl: `/api/renders/${render.id}/download`, streamUrl: defaultStorage.getUrl(render.outputPath) } : { downloadUrl: null, streamUrl: null };
      res.json(serializePrisma({ ...render, ...urls }));
    } catch (err: any) {
      const isNotFound = err.message?.includes(RENDER_ERRORS.RENDER_NOT_FOUND);
      sendError(res, isNotFound ? RENDER_ERRORS.RENDER_NOT_FOUND : 'GET_RENDER_FAILED', err.message || 'Falha ao buscar renderização', isNotFound ? 404 : 500);
    }
  });

  app.get('/api/renders/:id/download', async (req, res) => {
    try {
      const render = await prisma.render.findUnique({ where: { id: req.params.id }, include: { clip: true } });
      if (!render) return sendError(res, RENDER_ERRORS.RENDER_NOT_FOUND, 'Render não encontrado', 404);
      if (render.status !== 'COMPLETED' || !render.outputPath) return sendError(res, RENDER_ERRORS.DOWNLOAD_NOT_AVAILABLE, 'O download ainda não está disponível pois o render não foi concluído com sucesso.', 400);
      const filePath = defaultStorage.getAbsolutePath(render.outputPath);
      if (!fs.existsSync(filePath)) return sendError(res, RENDER_ERRORS.OUTPUT_INVALID, 'Arquivo de vídeo renderizado não foi encontrado no servidor.', 404);
      const safeFilename = `short_${render.clip?.title ? render.clip.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) : render.id.substring(0, 8)}.mp4`;
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(filePath).pipe(res);
    } catch (err: any) { sendError(res, 'DOWNLOAD_ERROR', err.message, 500); }
  });

  app.post('/api/renders/:id/retry', async (req, res) => {
    try { res.json(serializePrisma({ message: 'Renderização reiniciada com sucesso', render: await defaultRenderService.retryRender(req.params.id) })); }
    catch (err: any) { sendError(res, 'RETRY_FAILED', err.message, 500); }
  });

  app.post('/api/projects/:id/render-selected', async (req, res) => {
    try {
      const validation = RenderOptionsSchema.partial().safeParse(req.body);
      const summary = await defaultRenderService.batchRenderSelected(req.params.id, validation.success ? validation.data : {});
      res.json(serializePrisma(summary));
    } catch (err: any) { sendError(res, 'BATCH_RENDER_FAILED', err.message, 500); }
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = defaultJobQueue.getJob(req.params.id);
    if (!job) return sendError(res, 'JOB_NOT_FOUND', 'Job não encontrado', 404);
    res.json(job);
  });

  app.get('/api/media/*', (req, res) => {
    try {
      const rawSubPath = req.params[0] || '';
      const filePath = defaultStorage.getAbsolutePath(rawSubPath);
      if (!fs.existsSync(filePath)) return sendError(res, 'FILE_NOT_FOUND', 'Arquivo de mídia não encontrado', 404);
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ass': 'text/plain', '.srt': 'text/plain' };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        if (!Number.isFinite(start) || start < 0 || start >= fileSize || end < start) return res.status(416).end();
        const chunksize = end - start + 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Content-Length': chunksize, 'Content-Type': contentType });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (err: any) { sendError(res, 'STREAM_ERROR', err.message, 500); }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`AI Clipper server running on http://0.0.0.0:${PORT}`));
}

startServer();
