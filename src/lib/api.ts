import { Project, Video, Clip, Render, SystemStatus, DashboardStats, JobProgress } from '../types';

export class ApiError extends Error {
  code: string;
  details?: any;
  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error || {};
    throw new ApiError(error.message || `Erro na requisição: ${res.statusText}`, error.code || 'UNKNOWN_ERROR', error.details);
  }
  return data as T;
}

export const api = {
  async getSystemStatus(): Promise<SystemStatus> { const res = await fetch('/api/system/status'); return handleResponse<SystemStatus>(res); },
  async getStats(): Promise<DashboardStats> { const res = await fetch('/api/stats'); return handleResponse<DashboardStats>(res); },
  async getProjects(): Promise<Project[]> { const res = await fetch('/api/projects'); return handleResponse<Project[]>(res); },
  async getProject(id: string): Promise<Project> { const res = await fetch(`/api/projects/${id}`); return handleResponse<Project>(res); },
  async createProject(name: string): Promise<Project> { const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); return handleResponse<Project>(res); },
  async deleteProject(id: string): Promise<{ success: boolean }> { const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' }); return handleResponse<{ success: boolean }>(res); },
  async uploadVideo(file: File, projectName?: string, onProgress?: (percent: number) => void): Promise<{ video: Video; projectId: string; job: JobProgress }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); const formData = new FormData(); formData.append('video', file); if (projectName) formData.append('projectName', projectName);
      xhr.upload.addEventListener('progress', e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); });
      xhr.addEventListener('load', () => { if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Resposta inválida do servidor')); } } else { try { const d = JSON.parse(xhr.responseText); reject(new ApiError(d.error?.message || 'Falha no upload', d.error?.code || 'UPLOAD_ERROR')); } catch { reject(new Error(`Falha no upload: status ${xhr.status}`)); } } });
      xhr.addEventListener('error', () => reject(new Error('Erro de conexão durante o upload'))); xhr.open('POST', '/api/videos/upload'); xhr.send(formData);
    });
  },
  async ingestYouTube(url: string, projectName?: string): Promise<{ video: Video; projectId: string; job: JobProgress }> { const res = await fetch('/api/videos/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, projectName }) }); return handleResponse(res); },
  async processVideo(videoId: string, forceRetry = false): Promise<{ message: string; job: JobProgress }> { const res = await fetch(`/api/videos/${videoId}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceRetry }) }); return handleResponse(res); },
  async extractAudio(videoId: string): Promise<{ message: string; video: Video }> { const res = await fetch(`/api/videos/${videoId}/extract-audio`, { method: 'POST' }); return handleResponse(res); },
  async transcribeVideo(videoId: string, options?: { forceRetranscribe?: boolean; language?: string }): Promise<{ message: string; transcript: any }> { const res = await fetch(`/api/videos/${videoId}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options || {}) }); return handleResponse(res); },
  async getTranscript(videoId: string): Promise<any> { const res = await fetch(`/api/videos/${videoId}/transcript`); return handleResponse(res); },
  async getVideoStatus(videoId: string): Promise<any> { const res = await fetch(`/api/videos/${videoId}/status`); return handleResponse(res); },
  async getJob(jobId: string): Promise<JobProgress> { const res = await fetch(`/api/jobs/${jobId}`); return handleResponse<JobProgress>(res); },
  async analyzeVideo(videoId: string, options?: { force?: boolean; maxCandidates?: number; minClipDuration?: number; maxClipDuration?: number }): Promise<{ message: string; cached: boolean; count: number; clips: Clip[] }> { const res = await fetch(`/api/videos/${videoId}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options || {}) }); return handleResponse(res); },
  async getVideoClips(videoId: string): Promise<Clip[]> { const res = await fetch(`/api/videos/${videoId}/clips`); return handleResponse(res); },
  async toggleSelectClip(clipId: string): Promise<Clip> { const res = await fetch(`/api/clips/${clipId}/toggle-select`, { method: 'POST' }); return handleResponse(res); },
  async updateClip(clipId: string, data: { startTime?: number; endTime?: number; title?: string; hook?: string; description?: string; status?: string }): Promise<Clip> { const res = await fetch(`/api/clips/${clipId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return handleResponse(res); },
  async renderClip(clipId: string, options?: { subtitleStyle?: 'CLEAN' | 'BOLD' | 'DYNAMIC'; subtitlesEnabled?: boolean; reframeMode?: 'CENTER_CROP' | 'AUTO_TRACK' | 'FIT_BLUR' }): Promise<{ message: string; render: Render }> { const res = await fetch(`/api/clips/${clipId}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options || {}) }); return handleResponse(res); },
  async getRender(renderId: string): Promise<Render> { const res = await fetch(`/api/renders/${renderId}`); return handleResponse(res); },
  async retryRender(renderId: string): Promise<{ message: string; render: Render }> { const res = await fetch(`/api/renders/${renderId}/retry`, { method: 'POST' }); return handleResponse(res); },
  async getRecentShorts(limit = 6): Promise<Render[]> { const res = await fetch(`/api/renders/recent?limit=${limit}`); return handleResponse(res); },
  async batchRenderSelected(projectId: string, options?: { subtitleStyle?: 'CLEAN' | 'BOLD' | 'DYNAMIC'; subtitlesEnabled?: boolean; reframeMode?: 'CENTER_CROP' | 'AUTO_TRACK' | 'FIT_BLUR' }): Promise<{ totalSelected: number; queued: number; message: string; renders: Render[] }> { const res = await fetch(`/api/projects/${projectId}/render-selected`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options || {}) }); return handleResponse(res); },
  getMediaUrl(storagePath: string): string { if (!storagePath) return ''; const safeKey = storagePath.replace(/^[/\\]+/, ''); return `/api/media/${encodeURIComponent(safeKey).replace(/%2F/g, '/')}`; }
};
