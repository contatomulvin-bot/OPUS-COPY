import React, { useState, useEffect } from 'react';
import { Sparkles, Film, Video, Scissors, Clock, Trash2, ArrowRight, CheckCircle2, AlertCircle, Loader2, Youtube, UploadCloud, Download, Play, X } from 'lucide-react';
import { Project, DashboardStats, Render } from '../types';
import { api } from '../lib/api';

interface DashboardProps {
  stats: DashboardStats | null;
  projects: Project[];
  loading: boolean;
  onSelectProject: (project: Project) => void;
  onOpenNewProject: () => void;
  onDeleteProject: (projectId: string, e: React.MouseEvent) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  stats,
  projects,
  loading,
  onSelectProject,
  onOpenNewProject,
  onDeleteProject,
}) => {
  const [recentShorts, setRecentShorts] = useState<Render[]>([]);
  const [loadingShorts, setLoadingShorts] = useState(false);
  const [activePreviewShort, setActivePreviewShort] = useState<Render | null>(null);

  useEffect(() => {
    const fetchRecent = async () => {
      try {
        setLoadingShorts(true);
        const shorts = await api.getRecentShorts(6);
        setRecentShorts(shorts);
      } catch (err) {
        console.error('Failed to fetch recent shorts:', err);
      } finally {
        setLoadingShorts(false);
      }
    };
    fetchRecent();
  }, [stats?.renderCount]);

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return dateString;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
            <CheckCircle2 className="w-3 h-3" />
            <span>Shorts Prontos</span>
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-wider animate-pulse">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Processando IA</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 uppercase tracking-wider">
            <AlertCircle className="w-3 h-3" />
            <span>Falhou</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-white/5 uppercase tracking-wider">
            <Clock className="w-3 h-3" />
            <span>Criado</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* High Density Hero Section */}
      <div className="bg-[#111113] border border-white/10 rounded-2xl p-6 sm:p-7 relative overflow-hidden">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.15em] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sparkles className="w-3 h-3" />
            <span>Pipeline Automatizado 9:16</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Transforme vídeos longos em <span className="text-indigo-400">Shorts 9:16</span> com inteligência artificial.
          </h1>

          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-2xl">
            Importe podcasts, aulas ou links do YouTube. A IA analisa a transcrição completa, identifica os momentos de maior retenção, aplica crop vertical 9:16 e gera legendas dinâmicas.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              id="btn-hero-start"
              onClick={onOpenNewProject}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-lg border border-indigo-500/30 shadow-sm active:scale-95 transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Criar Novo Projeto</span>
            </button>
            <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono">
              <span className="flex items-center gap-1">
                <UploadCloud className="w-3.5 h-3.5 text-zinc-400" />
                <span>Upload Local</span>
              </span>
              <span>/</span>
              <span className="flex items-center gap-1">
                <Youtube className="w-3.5 h-3.5 text-rose-400" />
                <span>YouTube Ingest</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* High Density Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Projetos */}
        <div className="bg-[#111113] border border-white/5 hover:border-white/10 rounded-xl p-4 transition-colors">
          <div className="flex items-center justify-between text-zinc-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Projetos</span>
            <Film className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {stats?.projectCount ?? projects.length}
          </p>
          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Total de projetos criados</p>
        </div>

        {/* Card 2: Vídeos */}
        <div className="bg-[#111113] border border-white/5 hover:border-white/10 rounded-xl p-4 transition-colors">
          <div className="flex items-center justify-between text-zinc-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Vídeos Ingeridos</span>
            <Video className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {stats?.videoCount ?? 0}
          </p>
          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Fontes completas de áudio/vídeo</p>
        </div>

        {/* Card 3: Shorts */}
        <div className="bg-[#111113] border border-white/5 hover:border-white/10 rounded-xl p-4 transition-colors">
          <div className="flex items-center justify-between text-zinc-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Shorts Detectados</span>
            <Scissors className="w-3.5 h-3.5 text-pink-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {stats?.clipCount ?? 0}
          </p>
          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Momentos ranqueados por IA</p>
        </div>

        {/* Card 4: Renderizados */}
        <div className="bg-[#111113] border border-white/5 hover:border-white/10 rounded-xl p-4 transition-colors">
          <div className="flex items-center justify-between text-zinc-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">MP4 Renderizados</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {stats?.renderCount ?? 0}
          </p>
          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Exportações prontas 9:16</p>
        </div>
      </div>

      {/* Projects Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-white">Projetos & Filas de Edição</h2>
            <p className="text-xs text-zinc-500 font-mono">Selecione para gerenciar cortes e renders</p>
          </div>
          <button
            onClick={onOpenNewProject}
            className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>+ Novo Projeto</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center bg-[#111113] border border-white/5 rounded-xl">
            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin mx-auto mb-2" />
            <p className="text-xs text-zinc-400 font-mono">Carregando projetos...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="p-10 text-center bg-[#111113] border border-dashed border-white/10 rounded-xl space-y-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto">
              <Film className="w-5 h-5" />
            </div>
            <div className="max-w-md mx-auto">
              <h3 className="text-sm font-bold text-white">Nenhum projeto no workspace</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Faça upload de um vídeo longo ou cole um link do YouTube para extrair automaticamente seus primeiros Shorts com IA.
              </p>
            </div>
            <button
              onClick={onOpenNewProject}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3.5 py-2 rounded-lg border border-indigo-500/30 shadow-sm active:scale-95 transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Criar Primeiro Short</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((project) => (
              <div
                key={project.id}
                id={`project-card-${project.id}`}
                onClick={() => onSelectProject(project)}
                className="group relative bg-[#111113] hover:bg-[#161619] border border-white/5 hover:border-white/15 rounded-xl p-4 transition-all duration-150 cursor-pointer flex flex-col justify-between shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    {getStatusBadge(project.status)}
                    <button
                      onClick={(e) => onDeleteProject(project.id, e)}
                      title="Excluir projeto"
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 p-1 rounded hover:bg-zinc-800/80 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <h3 className="text-xs font-bold text-zinc-200 group-hover:text-indigo-300 transition-colors line-clamp-2">
                    {project.name}
                  </h3>

                  <div className="mt-3 flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                    <div className="flex items-center gap-1">
                      <Scissors className="w-3 h-3 text-pink-400" />
                      <span>{project.clipCount ?? 0} Shorts</span>
                    </div>
                    {project.primaryVideo?.duration ? (
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-500" />
                        <span>{formatDuration(project.primaryVideo.duration)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 pt-2.5 border-t border-white/5 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                  <span>{formatDate(project.createdAt)}</span>
                  <span className="flex items-center gap-1 font-bold text-indigo-400 group-hover:translate-x-0.5 transition-transform">
                    <span>Ver Cortes</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Rendered Shorts Section */}
      {recentShorts.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-white">Shorts Recentes Renderizados</h2>
              </div>
              <p className="text-xs text-zinc-500 font-mono">Arquivos MP4 verticais 9:16 prontos para download e publicação</p>
            </div>
            <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 border border-white/5 px-2 py-0.5 rounded">
              {recentShorts.length} render(s) concluído(s)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentShorts.map((render) => {
              const clip = render.clip;
              const video = clip?.video;
              const project = video?.project;
              const duration = clip ? clip.endTime - clip.startTime : 0;
              const downloadUrl = `/api/renders/${render.id}/download`;
              const streamUrl = render.outputPath ? api.getMediaUrl(render.outputPath) : '';

              return (
                <div
                  key={render.id}
                  className="bg-[#111113] border border-white/5 hover:border-indigo-500/30 rounded-xl p-3.5 space-y-2.5 transition-all group shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        9:16 MP4
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800/80 px-1.5 py-0.5 rounded">
                        1080x1920
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {formatDate(render.createdAt)}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors line-clamp-1">
                      {clip?.title || 'Short Renderizado'}
                    </h3>
                    {clip?.hook && (
                      <p className="text-[11px] text-amber-300/80 font-medium line-clamp-1 mt-0.5">
                        "{clip.hook}"
                      </p>
                    )}
                    {project && (
                      <p className="text-[10px] text-zinc-500 font-mono mt-1">
                        Projeto: <span className="text-zinc-400">{project.name}</span> • {duration.toFixed(1)}s
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setActivePreviewShort(render)}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>Reproduzir</span>
                    </button>

                    <a
                      href={downloadUrl}
                      download={`short-${render.id.substring(0, 8)}.mp4`}
                      className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                      title="Baixar arquivo MP4 9:16 real"
                    >
                      <Download className="w-3 h-3" />
                      <span>Baixar</span>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Short Preview Modal */}
      {activePreviewShort && activePreviewShort.outputPath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-[#111113] border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
            <div className="p-3.5 border-b border-white/10 flex items-center justify-between bg-[#0A0A0B]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <h3 className="text-xs font-bold text-white truncate max-w-[200px]">
                  {activePreviewShort.clip?.title || 'Short 9:16'}
                </h3>
              </div>
              <button
                onClick={() => setActivePreviewShort(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col items-center bg-black">
              <div className="relative aspect-[9/16] w-full max-w-[240px] rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black">
                <video
                  src={api.getMediaUrl(activePreviewShort.outputPath)}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            <div className="p-3.5 border-t border-white/10 bg-[#0A0A0B] flex items-center justify-between">
              <span className="text-[11px] font-mono text-zinc-400">1080x1920 (Vertical 9:16)</span>
              <a
                href={`/api/renders/${activePreviewShort.id}/download`}
                download={`short-${activePreviewShort.id.substring(0, 8)}.mp4`}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar MP4</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

