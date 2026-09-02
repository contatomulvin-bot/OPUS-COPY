import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Play,
  Pause,
  RotateCw,
  Clock,
  Film,
  Scissors,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  Sliders,
  FileText,
  Search,
  Maximize2,
  Check,
  RotateCcw,
  Mic,
  Volume2,
  Star,
  Layers,
  ChevronDown,
  ChevronUp,
  Tag,
  Info,
} from 'lucide-react';
import { Project, Video, Clip, JobProgress, ClipCategory, ClipSubScores } from '../types';
import { api } from '../lib/api';
import { ClipEditModal } from './ClipEditModal';

interface ProjectViewProps {
  project: Project;
  onBack: () => void;
  onSelectClipToEdit: (clip: Clip, video: Video) => void;
  onRefreshProject: () => Promise<void>;
}

export const ProjectView: React.FC<ProjectViewProps> = ({
  project,
  onBack,
  onSelectClipToEdit,
  onRefreshProject,
}) => {
  const [activeTab, setActiveTab] = useState<'clips' | 'transcript' | 'original'>('clips');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<JobProgress | null>(null);
  const [renderingClips, setRenderingClips] = useState<Record<string, boolean>>({});
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [expandedScoresId, setExpandedScoresId] = useState<string | null>(null);
  const [isBatchRendering, setIsBatchRendering] = useState(false);

  // Live preview player state
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const primaryVideo: Video | undefined = project.videos?.[0];
  const clips: Clip[] = primaryVideo?.clips || [];
  const transcript = primaryVideo?.transcript;
  const selectedClips = clips.filter(c => c.status === 'SELECTED');

  const activeClip = clips.find(c => c.id === selectedClipId) || clips[0] || null;

  // Poll when any render is in progress
  const hasActiveRenders = clips.some(c =>
    c.renders?.some(r => r.status === 'PROCESSING' || r.status === 'QUEUED')
  );

  useEffect(() => {
    if (!hasActiveRenders) return;

    const interval = setInterval(async () => {
      try {
        await onRefreshProject();
      } catch (err) {
        console.error('Error refreshing project for renders:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [hasActiveRenders, onRefreshProject]);

  useEffect(() => {
    if (clips.length > 0 && !selectedClipId) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTimecode = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  const parseSubScores = (clip: Clip): ClipSubScores | null => {
    if (!clip.scores) return null;
    if (typeof clip.scores === 'object') return clip.scores as ClipSubScores;
    try {
      return JSON.parse(clip.scores) as ClipSubScores;
    } catch {
      return null;
    }
  };

  const getCategoryColor = (category?: ClipCategory) => {
    switch (category) {
      case 'STORY':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'OPINION':
        return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
      case 'EDUCATION':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'MOTIVATION':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'HUMOR':
        return 'bg-pink-500/10 text-pink-400 border-pink-500/20';
      case 'CONTROVERSY':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'SURPRISE':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'EMOTION':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'FACT':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'ADVICE':
        return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      default:
        return 'bg-zinc-800 text-zinc-300 border-white/5';
    }
  };

  const getScoreBadgeClass = (score: number) => {
    if (score >= 90) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-black';
    if (score >= 80) return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-bold';
    if (score >= 70) return 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold';
    return 'bg-zinc-800 text-zinc-400 border-zinc-700';
  };

  // Poll video and job status when video is processing or transcribing or analyzing
  useEffect(() => {
    if (!primaryVideo) return;

    let intervalId: any = null;

    const checkStatus = async () => {
      try {
        const res = await api.getVideoStatus(primaryVideo.id);
        if (res.job) {
          setCurrentJob(res.job);
        }

        if (res.status === 'COMPLETED' || res.status === 'READY' || res.status === 'TRANSCRIBED' || res.status === 'ANALYZED') {
          setIsProcessing(false);
          setIsTranscribing(false);
          setIsAnalyzing(false);
          await onRefreshProject();
        } else if (res.status === 'FAILED') {
          setIsProcessing(false);
          setIsTranscribing(false);
          setIsAnalyzing(false);
        } else if (['DOWNLOADING', 'EXTRACTING_AUDIO', 'TRANSCRIBING', 'ANALYZING', 'RENDERING', 'CREATED'].includes(res.status)) {
          if (res.status === 'TRANSCRIBING') {
            setIsTranscribing(true);
          } else if (res.status === 'ANALYZING') {
            setIsAnalyzing(true);
          } else {
            setIsProcessing(true);
          }
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    };

    if (
      primaryVideo.status === 'TRANSCRIBING' ||
      primaryVideo.status === 'EXTRACTING_AUDIO' ||
      primaryVideo.status === 'DOWNLOADING' ||
      primaryVideo.status === 'ANALYZING' ||
      isProcessing ||
      isTranscribing ||
      isAnalyzing
    ) {
      intervalId = setInterval(checkStatus, 2000);
      checkStatus();
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [primaryVideo?.id, primaryVideo?.status, isProcessing, isTranscribing, isAnalyzing, onRefreshProject]);

  // Sync preview video time looping for the active clip
  useEffect(() => {
    const vid = previewVideoRef.current;
    if (!vid || !activeClip) return;

    const handleTimeUpdate = () => {
      setPreviewTime(vid.currentTime);
      if (vid.currentTime >= activeClip.endTime) {
        vid.currentTime = activeClip.startTime;
        if (isPlayingPreview) {
          vid.play().catch(() => {});
        }
      }
    };

    vid.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      vid.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [activeClip, isPlayingPreview]);

  // When active clip changes, seek video to its start
  useEffect(() => {
    const vid = previewVideoRef.current;
    if (vid && activeClip) {
      vid.currentTime = activeClip.startTime;
      setPreviewTime(activeClip.startTime);
    }
  }, [activeClip?.id, activeClip?.startTime]);

  const togglePreviewPlay = () => {
    const vid = previewVideoRef.current;
    if (!vid || !activeClip) return;

    if (vid.paused) {
      if (vid.currentTime < activeClip.startTime || vid.currentTime >= activeClip.endTime) {
        vid.currentTime = activeClip.startTime;
      }
      vid.play().then(() => setIsPlayingPreview(true)).catch(() => {});
    } else {
      vid.pause();
      setIsPlayingPreview(false);
    }
  };

  const handleTranscribeOnly = async (forceRetranscribe = false) => {
    if (!primaryVideo) return;
    setIsTranscribing(true);
    setTranscriptionError(null);
    try {
      await api.transcribeVideo(primaryVideo.id, { forceRetranscribe, language: 'pt' });
      await onRefreshProject();
      setActiveTab('transcript');
    } catch (err: any) {
      console.error('Transcription failed:', err);
      setTranscriptionError(err.message || 'Falha na transcrição do vídeo');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleAnalyzeClips = async (force = false) => {
    if (!primaryVideo) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      await api.analyzeVideo(primaryVideo.id, { force });
      await onRefreshProject();
      setActiveTab('clips');
    } catch (err: any) {
      console.error('Clip analysis failed:', err);
      setAnalysisError(err.message || 'Falha na identificação inteligente dos melhores momentos.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleToggleSelect = async (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.toggleSelectClip(clipId);
      await onRefreshProject();
    } catch (err) {
      console.error('Failed to toggle clip select:', err);
    }
  };

  const handleRetryProcessing = async () => {
    if (!primaryVideo) return;
    setIsProcessing(true);
    try {
      const res = await api.processVideo(primaryVideo.id, true);
      setCurrentJob(res.job);
    } catch (err: any) {
      console.error('Retry failed:', err);
      setIsProcessing(false);
    }
  };

  const handleQuickRender = async (clip: Clip) => {
    setRenderingClips(prev => ({ ...prev, [clip.id]: true }));
    try {
      await api.renderClip(clip.id, {
        subtitleStyle: 'BOLD',
        subtitlesEnabled: true,
        reframeMode: 'CENTER_CROP',
      });
      await onRefreshProject();
    } catch (err) {
      console.error('Render trigger failed:', err);
    } finally {
      setRenderingClips(prev => ({ ...prev, [clip.id]: false }));
    }
  };

  const filteredSegments = (transcript?.segments || []).filter(s =>
    transcriptSearch ? s.text.toLowerCase().includes(transcriptSearch.toLowerCase()) : true
  );

  // Compute pipeline stage statuses
  const isIngested = !!primaryVideo;
  const isTranscribed = !!transcript && (transcript.segments?.length || 0) > 0;
  const isAnalyzed = clips.length > 0;
  const hasRenderedClip = clips.some(c => c.renders?.some(r => r.status === 'COMPLETED'));

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Top Header & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg bg-[#111113] hover:bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Voltar ao Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              <span>Projetos</span>
              <span>/</span>
              <span className="text-indigo-400 font-semibold">{project.name}</span>
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white leading-tight">
              {project.name}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {primaryVideo && (
            <>
              {/* Transcribe Button */}
              <button
                onClick={() => handleTranscribeOnly(isTranscribed)}
                disabled={isTranscribing || isProcessing || isAnalyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#111113] hover:bg-zinc-800 border border-white/10 text-zinc-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
              >
                {isTranscribing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-indigo-400" />
                )}
                <span>
                  {isTranscribing
                    ? 'Transcrevendo...'
                    : isTranscribed
                    ? 'Re-transcrever'
                    : 'Transcrever Áudio'}
                </span>
              </button>

              {/* Analyze Clips Button */}
              <button
                onClick={() => handleAnalyzeClips(clips.length > 0)}
                disabled={!isTranscribed || isAnalyzing || isTranscribing || isProcessing}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/30 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>
                  {isAnalyzing
                    ? 'Analisando vídeo...'
                    : clips.length > 0
                    ? 'Re-analisar Melhores Momentos'
                    : 'Encontrar Melhores Momentos com IA'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error Alert Banners */}
      {transcriptionError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-xs text-red-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{transcriptionError}</span>
          </div>
          <button
            onClick={() => setTranscriptionError(null)}
            className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-0.5 rounded cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {analysisError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-xs text-red-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{analysisError}</span>
          </div>
          <button
            onClick={() => setAnalysisError(null)}
            className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-0.5 rounded cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Real Pipeline Execution Tracker (when processing full pipeline) */}
      {isProcessing && currentJob && (
        <div className="p-4 rounded-xl bg-[#111113] border border-indigo-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white">{currentJob.stepLabel}</h3>
                <p className="text-[11px] text-zinc-400 font-mono">{currentJob.currentStep}</p>
              </div>
            </div>
            <span className="text-xs font-bold font-mono text-indigo-400">{currentJob.progress}%</span>
          </div>

          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${currentJob.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Real Clip Analysis Progress Banner */}
      {isAnalyzing && (
        <div className="p-4 rounded-xl bg-[#111113] border border-indigo-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white">Analisando Inteligência de Cortes com Gemini 3.7 Flash</h3>
                <p className="text-[11px] text-indigo-300 font-mono">
                  Avaliando ganchos, emoção, retenção de narrativa e contexto autônomo...
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span className="text-xs font-bold font-mono text-indigo-400">Processando</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Workstation Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column: Pipeline Stages & Source Info Sidebar (3 Cols) */}
        <div className="lg:col-span-3 space-y-3">
          {/* Pipeline Tracker */}
          <div className="bg-[#111113] rounded-xl border border-white/10 p-3.5 space-y-2.5">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
              Pipeline Status
            </h2>

            <div className="space-y-2 text-xs">
              {/* Stage 1: Ingestion */}
              <div className={`flex items-center gap-2.5 ${isIngested ? 'text-zinc-200 font-semibold' : 'text-zinc-600'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  isIngested ? 'bg-emerald-500/10 border border-emerald-500 text-emerald-400' : 'border border-zinc-800'
                }`}>
                  {isIngested ? <Check className="w-3 h-3 text-emerald-400" /> : '1'}
                </div>
                <span>Ingestão de Mídia</span>
              </div>

              {/* Stage 2: Audio/Transcription */}
              <div className={`flex items-center gap-2.5 ${isTranscribed ? 'text-zinc-200 font-semibold' : isTranscribing ? 'text-indigo-400' : 'text-zinc-600'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  isTranscribed
                    ? 'bg-emerald-500/10 border border-emerald-500 text-emerald-400'
                    : isTranscribing
                    ? 'bg-indigo-500/20 border border-indigo-500 text-indigo-400 animate-pulse'
                    : 'border border-zinc-800'
                }`}>
                  {isTranscribed ? <Check className="w-3 h-3 text-emerald-400" /> : '2'}
                </div>
                <span className="font-medium">
                  {isTranscribing ? 'Transcrevendo...' : 'Transcrição de Áudio'}
                </span>
              </div>

              {/* Stage 3: AI Analysis */}
              <div className={`flex items-center gap-2.5 ${isAnalyzed ? 'text-zinc-200 font-semibold' : isAnalyzing ? 'text-indigo-400' : 'text-zinc-600'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  isAnalyzed
                    ? 'bg-emerald-500/10 border border-emerald-500 text-emerald-400'
                    : isAnalyzing
                    ? 'bg-indigo-500/20 border border-indigo-500 text-indigo-400 animate-pulse'
                    : 'border border-zinc-800'
                }`}>
                  {isAnalyzed ? <Check className="w-3 h-3 text-emerald-400" /> : '3'}
                </div>
                <span>Análise de Ganchos IA</span>
              </div>

              {/* Stage 4: Clip Selection */}
              <div className={`flex items-center gap-2.5 ${clips.length > 0 ? 'text-zinc-200 font-semibold' : 'text-zinc-600'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  clips.length > 0 ? 'bg-emerald-500/10 border border-emerald-500 text-emerald-400' : 'border border-zinc-800'
                }`}>
                  {clips.length > 0 ? <Check className="w-3 h-3 text-emerald-400" /> : '4'}
                </div>
                <span>Cortes Verticais 9:16</span>
              </div>

              {/* Stage 5: Rendering */}
              <div className={`flex items-center gap-2.5 ${hasRenderedClip ? 'text-zinc-300' : 'text-zinc-600'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  hasRenderedClip ? 'bg-emerald-500/10 border border-emerald-500 text-emerald-400' : 'border border-zinc-800'
                }`}>
                  {hasRenderedClip ? <Check className="w-3 h-3 text-emerald-400" /> : '5'}
                </div>
                <span>Renderização MP4</span>
              </div>
            </div>
          </div>

          {/* Source Info Panel */}
          {primaryVideo && (
            <div className="p-3.5 bg-[#111113] rounded-xl border border-white/5 space-y-1.5 font-mono text-[11px]">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Source Info</p>
              <p className="text-zinc-300 truncate" title={primaryVideo.originalName}>{primaryVideo.originalName}</p>
              <p className="text-zinc-500">Res: {primaryVideo.width}x{primaryVideo.height}</p>
              <p className="text-zinc-500">Dur: {formatDuration(primaryVideo.duration)}</p>
              <p className="text-zinc-500">Source: {primaryVideo.sourceType}</p>
            </div>
          )}

          {/* Navigation Tabs Selector */}
          <div className="bg-[#111113] rounded-xl border border-white/10 p-1.5 flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('clips')}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'clips'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <Scissors className="w-3.5 h-3.5" />
                <span>Shorts ({clips.length})</span>
              </span>
            </button>

            <button
              onClick={() => setActiveTab('transcript')}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'transcript'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                <span>Transcrição</span>
              </span>
              <span className="text-[10px] font-mono opacity-70">
                {transcript?.segments?.length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('original')}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'original'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <Film className="w-3.5 h-3.5" />
                <span>Vídeo Original</span>
              </span>
            </button>
          </div>
        </div>

        {/* Center/Right Workstation Area (9 Cols) */}
        <div className="lg:col-span-9 space-y-4">
          {/* TAB 1: SHORTS CANDIDATES & VERTICAL PREVIEW */}
          {activeTab === 'clips' && (
            <div className="space-y-4">
              {clips.length === 0 ? (
                <div className="p-10 text-center bg-[#111113] border border-dashed border-white/10 rounded-xl space-y-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-500/20">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-white">Nenhum Short extraído ainda</h3>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                    {isAnalyzing
                      ? 'A IA está analisando a transcrição e identificando os momentos com maior potencial...'
                      : !isTranscribed
                      ? 'Primeiro conclua a transcrição do vídeo para que a IA possa identificar os melhores momentos.'
                      : 'Clique no botão abaixo para encontrar automaticamente os cortes de maior retenção e engajamento.'}
                  </p>
                  {!isAnalyzing && (
                    <div className="pt-2">
                      {!isTranscribed ? (
                        <button
                          onClick={() => handleTranscribeOnly(false)}
                          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-lg border border-indigo-500/30 shadow-sm active:scale-95 transition-all cursor-pointer"
                        >
                          <Mic className="w-3.5 h-3.5" />
                          <span>Transcrever Áudio Primeiro</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAnalyzeClips(false)}
                          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-lg border border-indigo-500/30 shadow-sm active:scale-95 transition-all cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Encontrar Melhores Momentos com IA</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                  {/* Left sub-column: Vertical 9:16 Workstation Preview (5 Cols) */}
                  <div className="xl:col-span-5 flex flex-col bg-[#111113] border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-white">Preview do Short</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-zinc-400">
                        <span className="px-1.5 py-0.5 bg-zinc-800 rounded border border-white/5">CROP: CENTER</span>
                        <span className="px-1.5 py-0.5 bg-zinc-800 rounded border border-white/5 text-indigo-400">9:16</span>
                      </div>
                    </div>

                    {/* Smartphone Canvas */}
                    <div className="relative aspect-[9/16] w-full max-w-[260px] mx-auto bg-black rounded-2xl border border-white/10 overflow-hidden flex items-center justify-center shadow-2xl">
                      {primaryVideo && (
                        <video
                          ref={previewVideoRef}
                          src={api.getMediaUrl(primaryVideo.storagePath)}
                          playsInline
                          muted={false}
                          className="w-full h-full object-cover"
                        />
                      )}

                      {/* 9:16 Alignment Grid Guides */}
                      <div className="absolute inset-y-0 left-0 w-full flex items-center justify-between px-6 pointer-events-none">
                        <div className="h-3/4 w-px bg-white/10"></div>
                        <div className="h-3/4 w-px bg-white/10"></div>
                      </div>

                      {/* Slanted High Density Highlight Hook Subtitle */}
                      {activeClip && (
                        <div className="absolute bottom-12 left-3 right-3 text-center pointer-events-none z-20">
                          <div className="bg-yellow-400 text-black px-2.5 py-1 font-black text-[10px] uppercase leading-tight italic transform -skew-x-12 inline-block shadow-lg max-w-full">
                            {activeClip.hook || activeClip.title}
                          </div>
                        </div>
                      )}

                      {/* Live Status Tag */}
                      <div className="absolute top-3 left-3 bg-black/80 px-2 py-0.5 rounded-full text-[10px] font-mono text-zinc-300 border border-white/10 pointer-events-none">
                        {previewTime.toFixed(1)}s
                      </div>
                    </div>

                    {/* Live Scrubber Underneath */}
                    <div className="mt-3 bg-[#0A0A0B] rounded-lg border border-white/5 p-2 flex items-center gap-3">
                      <button
                        onClick={togglePreviewPlay}
                        className="text-zinc-300 hover:text-white transition-colors cursor-pointer p-1"
                        title={isPlayingPreview ? 'Pausar' : 'Reproduzir corte'}
                      >
                        {isPlayingPreview ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <div className="flex-1 relative h-4 bg-zinc-900 rounded overflow-hidden border border-white/5">
                        {activeClip && primaryVideo?.duration ? (
                          <div
                            className="absolute inset-y-0 bg-indigo-500/40 border-x border-indigo-400"
                            style={{
                              left: `${(activeClip.startTime / primaryVideo.duration) * 100}%`,
                              width: `${((activeClip.endTime - activeClip.startTime) / primaryVideo.duration) * 100}%`,
                            }}
                          />
                        ) : null}
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                        {activeClip ? `${(activeClip.endTime - activeClip.startTime).toFixed(1)}s` : '0:00'}
                      </span>
                    </div>
                  </div>

                  {/* Right sub-column: Detected Clips High-Density List (7 Cols) */}
                  <div className="xl:col-span-7 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-white">
                          Melhores Momentos Encontrados
                        </h2>
                        <p className="text-[10px] text-zinc-400 font-mono">
                          {clips.length} cortes ranqueados por AI Score
                        </p>
                      </div>
                      <button
                        onClick={() => handleAnalyzeClips(true)}
                        disabled={isAnalyzing}
                        className="flex items-center gap-1 text-[11px] font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg border border-indigo-500/20 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RotateCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                        <span>Re-analisar</span>
                      </button>
                    </div>

                    <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                      {clips.map((clip, index) => {
                        const isSelected = clip.id === activeClip?.id;
                        const latestRender = clip.renders?.[0];
                        const isRendered = latestRender?.status === 'COMPLETED' && latestRender?.outputPath;
                        const isRendering = renderingClips[clip.id] || latestRender?.status === 'PROCESSING';
                        const subScores = parseSubScores(clip);
                        const isScoresOpen = expandedScoresId === clip.id;
                        const isShortSelected = clip.status === 'SELECTED';

                        return (
                          <div
                            key={clip.id}
                            id={`clip-card-${clip.id}`}
                            onClick={() => setSelectedClipId(clip.id)}
                            className={`rounded-xl p-3.5 border transition-all cursor-pointer space-y-2.5 ${
                              isSelected
                                ? 'bg-[#111113] border-indigo-500/60 shadow-lg ring-1 ring-indigo-500/30'
                                : 'bg-[#111113] border-white/5 hover:border-white/15 opacity-90 hover:opacity-100'
                            }`}
                          >
                            {/* Card Top: Number, Badges & Timestamps */}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-black text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-white/5">
                                  #{index + 1}
                                </span>
                                
                                {/* AI Score Badge */}
                                <span className={`text-[11px] px-2 py-0.5 rounded-md border uppercase tracking-wider ${getScoreBadgeClass(clip.score)}`}>
                                  AI Score: {clip.score}
                                </span>

                                {/* Category Badge */}
                                {clip.category && (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-wider ${getCategoryColor(clip.category)}`}>
                                    {clip.category}
                                  </span>
                                )}
                              </div>

                              {/* Timestamps */}
                              <span className="text-[11px] font-mono text-zinc-400 bg-[#0A0A0B] px-2 py-0.5 rounded border border-white/5">
                                {formatTimecode(clip.startTime)} — {formatTimecode(clip.endTime)} ({(clip.endTime - clip.startTime).toFixed(1)}s)
                              </span>
                            </div>

                            {/* Title & Hook */}
                            <div>
                              <h3 className="text-xs sm:text-sm font-bold text-white mb-1 leading-snug">
                                {clip.title}
                              </h3>
                              {clip.hook && (
                                <p className="text-[11px] text-amber-300/90 font-medium bg-amber-500/5 p-1.5 rounded-lg border border-amber-500/10">
                                  <span className="font-bold text-amber-400">Gancho: </span>
                                  "{clip.hook}"
                                </p>
                              )}
                              {clip.description && (
                                <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                                  {clip.description}
                                </p>
                              )}
                            </div>

                            {/* Sub-Scores Drawer/Accordion (Hook, Clarity, Emotion, etc) */}
                            {subScores && (
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedScoresId(isScoresOpen ? null : clip.id);
                                  }}
                                  className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <span>{isScoresOpen ? 'Ocultar critérios de pontuação' : 'Ver critérios de pontuação IA'}</span>
                                  {isScoresOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>

                                {isScoresOpen && (
                                  <div className="mt-2 grid grid-cols-3 gap-1.5 p-2 bg-[#0A0A0B] rounded-lg border border-white/5 text-[10px] font-mono">
                                    <div className="p-1 rounded bg-zinc-900/60">
                                      <span className="text-zinc-500">Hook:</span>{' '}
                                      <span className="text-indigo-300 font-bold">{subScores.hook}/100</span>
                                    </div>
                                    <div className="p-1 rounded bg-zinc-900/60">
                                      <span className="text-zinc-500">Clareza:</span>{' '}
                                      <span className="text-indigo-300 font-bold">{subScores.clarity}/100</span>
                                    </div>
                                    <div className="p-1 rounded bg-zinc-900/60">
                                      <span className="text-zinc-500">Emoção:</span>{' '}
                                      <span className="text-indigo-300 font-bold">{subScores.emotion}/100</span>
                                    </div>
                                    <div className="p-1 rounded bg-zinc-900/60">
                                      <span className="text-zinc-500">Curiosidade:</span>{' '}
                                      <span className="text-indigo-300 font-bold">{subScores.curiosity}/100</span>
                                    </div>
                                    <div className="p-1 rounded bg-zinc-900/60">
                                      <span className="text-zinc-500">Contexto:</span>{' '}
                                      <span className="text-indigo-300 font-bold">{subScores.standaloneContext}/100</span>
                                    </div>
                                    <div className="p-1 rounded bg-zinc-900/60">
                                      <span className="text-zinc-500">Valor:</span>{' '}
                                      <span className="text-indigo-300 font-bold">{subScores.value}/100</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Card Action Controls: Selecionar, Editar, Render */}
                            <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                {/* Toggle Select */}
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleSelect(clip.id, e)}
                                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-colors cursor-pointer border ${
                                    isShortSelected
                                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                      : 'bg-[#0A0A0B] text-zinc-400 hover:text-white border-white/10 hover:bg-zinc-800'
                                  }`}
                                >
                                  <Star className={`w-3 h-3 ${isShortSelected ? 'fill-emerald-400 text-emerald-400' : ''}`} />
                                  <span>{isShortSelected ? 'Selecionado' : 'Selecionar'}</span>
                                </button>

                                {/* Edit Clip */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingClip(clip);
                                  }}
                                  className="px-2.5 py-1.5 bg-[#0A0A0B] hover:bg-zinc-800 text-zinc-300 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg border border-white/10 transition-colors cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Sliders className="w-3 h-3" />
                                  <span>Editar</span>
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {isRendered && latestRender.outputPath ? (
                                  <a
                                    href={api.getMediaUrl(latestRender.outputPath)}
                                    download={`short-${String(index + 1).padStart(2, '0')}.mp4`}
                                    className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg inline-flex items-center gap-1 transition-colors shadow-sm"
                                  >
                                    <Download className="w-3 h-3" />
                                    <span>Download MP4</span>
                                  </a>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleQuickRender(clip); }}
                                    disabled={isRendering}
                                    className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center gap-1 shadow-sm"
                                  >
                                    {isRendering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                    <span>{isRendering ? 'Renderizando...' : 'Renderizar Short'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TRANSCRIPTION */}
          {activeTab === 'transcript' && (
            <div className="bg-[#111113] border border-white/10 rounded-xl p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">Transcrição do Vídeo</h3>
                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                    Idioma: <span className="text-indigo-400 font-bold">{transcript?.language?.toUpperCase() || 'PT'}</span> •{' '}
                    <span className="text-white">{transcript?.segments?.length || 0}</span> segmentos •{' '}
                    <span className="text-zinc-500">{transcript?.wordsCount ? `${transcript.wordsCount} palavras` : 'Timestamps exatos'}</span>
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTranscribeOnly(true)}
                    disabled={isTranscribing}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-[#0A0A0B] hover:bg-zinc-800 border border-white/10 text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3 h-3 ${isTranscribing ? 'animate-spin' : ''}`} />
                    <span>Re-transcrever</span>
                  </button>

                  <div className="relative w-48 sm:w-56">
                    <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Buscar na fala..."
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                      className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg pl-7 pr-2.5 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {!transcript || (transcript.segments?.length || 0) === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-500/20">
                    <Mic className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white mb-1">Transcrição ainda não realizada</h4>
                    <p className="text-[11px] text-zinc-400 max-w-xs mx-auto">
                      Gere a transcrição com timestamps reais para inspecionar as falas e os intervalos de áudio com precisão.
                    </p>
                  </div>
                  <button
                    onClick={() => handleTranscribeOnly(false)}
                    disabled={isTranscribing}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>Iniciar Transcrição com IA</span>
                  </button>
                </div>
              ) : (
                <div className="max-h-[550px] overflow-y-auto space-y-2 pr-1">
                  {filteredSegments.map((segment) => (
                    <div
                      key={segment.id}
                      className="p-2.5 rounded-xl bg-[#0A0A0B]/60 border border-white/5 hover:border-indigo-500/30 transition-all space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-mono text-[10px]">
                          <span className="text-indigo-400 font-bold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                            {formatTimecode(segment.startTime)} - {formatTimecode(segment.endTime)}
                          </span>
                          <span className="text-zinc-500">
                            ({(segment.endTime - segment.startTime).toFixed(2)}s)
                          </span>
                        </div>
                      </div>

                      <p className="text-zinc-200 text-xs leading-relaxed font-sans">
                        {segment.text}
                      </p>

                      {/* Display words tags if available */}
                      {segment.words && segment.words.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {segment.words.map((w, wIdx) => (
                            <span
                              key={w.id || wIdx}
                              title={`${w.startTime.toFixed(2)}s - ${w.endTime.toFixed(2)}s`}
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-white/5 hover:text-indigo-300 hover:border-indigo-500/30 transition-colors"
                            >
                              {w.word}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ORIGINAL VIDEO PLAYER */}
          {activeTab === 'original' && (
            <div className="bg-[#111113] border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">Player Original 16:9</h3>
                  <p className="text-[10px] text-zinc-500 font-mono">
                    Visualização da fonte bruta em resolução total
                  </p>
                </div>
                <span className="text-xs font-mono text-zinc-400">
                  {formatDuration(primaryVideo?.duration)}
                </span>
              </div>

              {primaryVideo ? (
                <div className="relative aspect-video w-full bg-black rounded-xl overflow-hidden border border-white/5">
                  <video
                    src={api.getMediaUrl(primaryVideo.storagePath)}
                    controls
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="text-center py-10 text-zinc-500 text-xs">
                  Nenhum arquivo de vídeo associado
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Clip Edit Modal for Human Validation & Customization */}
      {editingClip && primaryVideo && (
        <ClipEditModal
          clip={editingClip}
          video={primaryVideo}
          isOpen={!!editingClip}
          onClose={() => setEditingClip(null)}
          onSaved={async () => {
            await onRefreshProject();
          }}
        />
      )}
    </div>
  );
};
