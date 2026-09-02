import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Download,
  CheckCircle2,
  Sliders,
  Type,
  Maximize2,
  Loader2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Clip, Video, SubtitleStyle, ReframeMode } from '../types';
import { api } from '../lib/api';

interface ClipEditorModalProps {
  clip: Clip;
  video: Video;
  isOpen: boolean;
  onClose: () => void;
  onClipUpdated: (updatedClip: Clip) => void;
}

export const ClipEditorModal: React.FC<ClipEditorModalProps> = ({
  clip,
  video,
  isOpen,
  onClose,
  onClipUpdated,
}) => {
  const [startTime, setStartTime] = useState(clip.startTime);
  const [endTime, setEndTime] = useState(clip.endTime);
  const [title, setTitle] = useState(clip.title);
  const [hook, setHook] = useState(clip.hook || '');
  const [description, setDescription] = useState(clip.description || '');

  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>('BOLD');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [reframeMode, setReframeMode] = useState<ReframeMode>('CENTER_CROP');

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip.startTime);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSubtitleText, setCurrentSubtitleText] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStatusLabel, setRenderStatusLabel] = useState('');
  const [completedRenderUrl, setCompletedRenderUrl] = useState<string | null>(
    clip.renders?.[0]?.status === 'COMPLETED' && clip.renders?.[0]?.outputPath
      ? api.getMediaUrl(clip.renders[0].outputPath)
      : null
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const maxVideoDuration = video.duration || 3600;

  // Sync state if clip changes
  useEffect(() => {
    setStartTime(clip.startTime);
    setEndTime(clip.endTime);
    setTitle(clip.title);
    setHook(clip.hook || '');
    setDescription(clip.description || '');
    setCurrentTime(clip.startTime);

    const latest = clip.renders?.[0];
    if (latest?.status === 'COMPLETED' && latest?.outputPath) {
      setCompletedRenderUrl(api.getMediaUrl(latest.outputPath));
    } else {
      setCompletedRenderUrl(null);
    }
  }, [clip]);

  // Video time tracking and subtitle synchronization
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handleTimeUpdate = () => {
      const time = vid.currentTime;
      setCurrentTime(time);

      // Loop playback strictly within [startTime, endTime]
      if (time >= endTime) {
        vid.currentTime = startTime;
        if (isPlaying) {
          vid.play().catch(() => {});
        }
      }

      // Find matching subtitle segment
      if (subtitlesEnabled && video.transcript?.segments) {
        const matching = video.transcript.segments.find(
          s => time >= s.startTime && time <= s.endTime
        );
        setCurrentSubtitleText(matching?.text || '');
      } else {
        setCurrentSubtitleText('');
      }
    };

    vid.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      vid.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [startTime, endTime, subtitlesEnabled, video.transcript?.segments, isPlaying]);

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;

    if (vid.paused) {
      if (vid.currentTime < startTime || vid.currentTime >= endTime) {
        vid.currentTime = startTime;
      }
      vid.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  const handleRestart = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = startTime;
    vid.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  const handleSaveTrim = async () => {
    setIsSaving(true);
    try {
      const updated = await api.updateClip(clip.id, {
        startTime,
        endTime,
        title,
        hook,
        description,
      });
      onClipUpdated({ ...clip, ...updated });
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRenderShort = async () => {
    setIsRendering(true);
    setRenderProgress(10);
    setRenderStatusLabel('Iniciando renderização FFmpeg 9:16...');

    try {
      // First persist any trim changes
      await api.updateClip(clip.id, {
        startTime,
        endTime,
        title,
        hook,
        description,
      });

      const { renderId, job } = await api.renderClip(clip.id, {
        subtitleStyle,
        subtitlesEnabled,
        reframeMode,
      });

      // Poll render job
      let pollCount = 0;
      const interval = setInterval(async () => {
        pollCount++;
        try {
          const freshJob = await api.getJob(job.jobId);
          setRenderProgress(freshJob.progress || 50);
          setRenderStatusLabel(freshJob.stepLabel || 'Renderizando vídeo...');

          if (freshJob.status === 'COMPLETED') {
            clearInterval(interval);
            setIsRendering(false);
            const freshRender = await api.getRender(renderId);
            if (freshRender.outputPath) {
              setCompletedRenderUrl(api.getMediaUrl(freshRender.outputPath));
            }
          } else if (freshJob.status === 'FAILED') {
            clearInterval(interval);
            setIsRendering(false);
            setRenderStatusLabel(`Erro: ${freshJob.error || 'Falha na renderização'}`);
          }
        } catch {
          if (pollCount > 40) {
            clearInterval(interval);
            setIsRendering(false);
          }
        }
      }, 2000);
    } catch (err: any) {
      console.error('Render error:', err);
      setIsRendering(false);
      setRenderStatusLabel('Erro ao iniciar renderização.');
    }
  };

  if (!isOpen) return null;

  const clipDuration = Math.max(0, endTime - startTime);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        id="modal-clip-editor"
        className="w-full max-w-5xl max-h-[92vh] bg-[#111113] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#0A0A0B]">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-bold font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
              9:16 EDITOR
            </span>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">{title || 'Editor de Short'}</h2>
              <p className="text-[11px] text-zinc-400">
                Ajuste início/fim, enquadramento vertical e legendas dinâmicas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: 2 Columns */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-5 p-5">
          {/* Left Column: 9:16 Smartphone Preview (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center bg-[#0A0A0B] border border-white/5 rounded-xl p-3.5">
            <div className="text-[10px] font-bold text-zinc-400 mb-2 flex items-center justify-between w-full uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Preview 9:16</span>
              </span>
              <span className="font-mono text-zinc-500">1080x1920</span>
            </div>

            {/* Smartphone Container */}
            <div className="relative w-[230px] sm:w-[250px] aspect-[9/16] bg-black rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center group">
              {/* Video Element */}
              <video
                ref={videoRef}
                src={completedRenderUrl || api.getMediaUrl(video.storagePath)}
                muted={isMuted}
                playsInline
                className={`w-full h-full ${
                  reframeMode === 'CENTER_CROP' ? 'object-cover' : 'object-contain'
                }`}
              />

              {/* Subtitle Overlay in Live Preview */}
              {subtitlesEnabled && currentSubtitleText && !completedRenderUrl && (
                <div className="absolute bottom-12 left-2.5 right-2.5 text-center pointer-events-none z-20">
                  {subtitleStyle === 'BOLD' && (
                    <div className="bg-yellow-400 text-black px-2.5 py-1 font-black text-xs uppercase leading-tight italic transform -skew-x-12 inline-block shadow-lg">
                      {currentSubtitleText}
                    </div>
                  )}
                  {subtitleStyle === 'DYNAMIC' && (
                    <div className="font-black text-xs text-cyan-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] uppercase tracking-wider bg-indigo-950/90 px-2 py-1 rounded border border-cyan-500/40 inline-block">
                      {currentSubtitleText}
                    </div>
                  )}
                  {subtitleStyle === 'CLEAN' && (
                    <div className="font-semibold text-xs text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)] bg-black/80 px-2 py-0.5 rounded inline-block">
                      {currentSubtitleText}
                    </div>
                  )}
                </div>
              )}

              {/* Floating Controls Overlay */}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                <button
                  onClick={handleRestart}
                  className="pointer-events-auto p-2 rounded-full bg-black/80 hover:bg-black text-white text-xs backdrop-blur-sm transition-transform active:scale-90 cursor-pointer"
                  title="Reiniciar corte"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={togglePlay}
                  className="pointer-events-auto p-3 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white backdrop-blur-sm transition-transform active:scale-90 shadow-lg cursor-pointer"
                  title={isPlaying ? 'Pausar' : 'Reproduzir'}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="pointer-events-auto p-2 rounded-full bg-black/80 hover:bg-black text-white text-xs backdrop-blur-sm transition-transform active:scale-90 cursor-pointer"
                  title={isMuted ? 'Ativar som' : 'Mudo'}
                >
                  {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Live Timecode Pill */}
              <div className="absolute top-2.5 left-2.5 bg-black/80 px-2 py-0.5 rounded-md text-[9px] font-mono text-zinc-300 border border-white/10 pointer-events-none">
                {currentTime.toFixed(1)}s / {endTime.toFixed(1)}s
              </div>
            </div>

            {/* Quick Play/Pause underneath phone */}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={togglePlay}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-white transition-colors cursor-pointer"
              >
                {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isPlaying ? 'Pausar' : 'Play'}</span>
              </button>
              <button
                onClick={handleRestart}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                title="Voltar ao início do corte"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right Column: Controls & Render Engine (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Trim Adjustments */}
            <div className="bg-[#0A0A0B] border border-white/5 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] font-bold text-white uppercase tracking-wider">Ajuste de Início e Fim</span>
                </div>
                <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                  Duração: {clipDuration.toFixed(1)}s
                </span>
              </div>

              {/* Start Time Stepper */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span className="text-[11px]">Início do Corte:</span>
                  <span className="font-mono text-indigo-400 text-[11px] font-bold">{startTime.toFixed(1)}s</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStartTime(Math.max(0, Number((startTime - 0.5).toFixed(1))))}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-mono text-zinc-200 cursor-pointer"
                  >
                    -0.5s
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, endTime - 1)}
                    step={0.1}
                    value={startTime}
                    onChange={(e) => setStartTime(parseFloat(e.target.value))}
                    className="flex-1 accent-indigo-500"
                  />
                  <button
                    onClick={() => setStartTime(Math.min(endTime - 1, Number((startTime + 0.5).toFixed(1))))}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-mono text-zinc-200 cursor-pointer"
                  >
                    +0.5s
                  </button>
                </div>
              </div>

              {/* End Time Stepper */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span className="text-[11px]">Fim do Corte:</span>
                  <span className="font-mono text-indigo-400 text-[11px] font-bold">{endTime.toFixed(1)}s</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEndTime(Math.max(startTime + 1, Number((endTime - 0.5).toFixed(1))))}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-mono text-zinc-200 cursor-pointer"
                  >
                    -0.5s
                  </button>
                  <input
                    type="range"
                    min={startTime + 1}
                    max={maxVideoDuration}
                    step={0.1}
                    value={endTime}
                    onChange={(e) => setEndTime(parseFloat(e.target.value))}
                    className="flex-1 accent-indigo-500"
                  />
                  <button
                    onClick={() => setEndTime(Math.min(maxVideoDuration, Number((endTime + 0.5).toFixed(1))))}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-mono text-zinc-200 cursor-pointer"
                  >
                    +0.5s
                  </button>
                </div>
              </div>
            </div>

            {/* Subtitles & Styling */}
            <div className="bg-[#0A0A0B] border border-white/5 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[11px] font-bold text-white uppercase tracking-wider">Estilo das Legendas</span>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subtitlesEnabled}
                    onChange={(e) => setSubtitlesEnabled(e.target.checked)}
                    className="rounded bg-zinc-800 border-zinc-700 text-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="text-[11px]">Legendas Ativas</span>
                </label>
              </div>

              {subtitlesEnabled && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSubtitleStyle('BOLD')}
                    className={`p-2 rounded-lg border text-[11px] font-bold transition-all text-center cursor-pointer ${
                      subtitleStyle === 'BOLD'
                        ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300'
                        : 'border-white/5 hover:border-white/10 text-zinc-400 bg-zinc-900/50'
                    }`}
                  >
                    BOLD YELLOW
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubtitleStyle('DYNAMIC')}
                    className={`p-2 rounded-lg border text-[11px] font-bold transition-all text-center cursor-pointer ${
                      subtitleStyle === 'DYNAMIC'
                        ? 'border-cyan-400 bg-cyan-400/10 text-cyan-300'
                        : 'border-white/5 hover:border-white/10 text-zinc-400 bg-zinc-900/50'
                    }`}
                  >
                    CYAN DYNAMIC
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubtitleStyle('CLEAN')}
                    className={`p-2 rounded-lg border text-[11px] font-bold transition-all text-center cursor-pointer ${
                      subtitleStyle === 'CLEAN'
                        ? 'border-white bg-white/10 text-white'
                        : 'border-white/5 hover:border-white/10 text-zinc-400 bg-zinc-900/50'
                    }`}
                  >
                    CLEAN WHITE
                  </button>
                </div>
              )}
            </div>

            {/* Reframe Mode */}
            <div className="bg-[#0A0A0B] border border-white/5 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5">
                <Maximize2 className="w-3.5 h-3.5 text-pink-400" />
                <span className="text-[11px] font-bold text-white uppercase tracking-wider">Enquadramento 9:16</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReframeMode('CENTER_CROP')}
                  className={`p-2 rounded-lg border text-[11px] font-bold transition-all text-center cursor-pointer ${
                    reframeMode === 'CENTER_CROP'
                      ? 'border-indigo-500 bg-indigo-500/10 text-white'
                      : 'border-white/5 hover:border-white/10 text-zinc-400 bg-zinc-900/50'
                  }`}
                >
                  Center Crop (Preenche 9:16)
                </button>

                <button
                  type="button"
                  onClick={() => setReframeMode('FIT_BLUR')}
                  className={`p-2 rounded-lg border text-[11px] font-bold transition-all text-center cursor-pointer ${
                    reframeMode === 'FIT_BLUR'
                      ? 'border-indigo-500 bg-indigo-500/10 text-white'
                      : 'border-white/5 hover:border-white/10 text-zinc-400 bg-zinc-900/50'
                  }`}
                >
                  Fundo Desfocado (Fit Blur)
                </button>
              </div>
            </div>

            {/* Title & Hook Edit */}
            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Título do Short</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Hook (Gancho Inicial)</label>
                <input
                  type="text"
                  value={hook}
                  onChange={(e) => setHook(e.target.value)}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Render Progress Status */}
            {isRendering && (
              <div className="p-3.5 rounded-xl bg-[#0A0A0B] border border-indigo-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                    <span>{renderStatusLabel}</span>
                  </span>
                  <span className="font-mono text-indigo-400 font-bold">{renderProgress}%</span>
                </div>
                <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="bg-indigo-500 h-full transition-all duration-300"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Actions Bar */}
            <div className="pt-2 flex items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handleSaveTrim}
                disabled={isSaving}
                className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold transition-colors cursor-pointer border border-white/5"
              >
                {isSaving ? 'Salvando...' : 'Salvar Alterações'}
              </button>

              <div className="flex items-center gap-2">
                {completedRenderUrl && (
                  <a
                    href={completedRenderUrl}
                    download={`short-${title.toLowerCase().replace(/\s+/g, '-')}.mp4`}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP4</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={handleRenderShort}
                  disabled={isRendering}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 transition-all cursor-pointer border border-indigo-500/30"
                >
                  {isRendering ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isRendering ? 'Renderizando...' : 'Renderizar 9:16'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

