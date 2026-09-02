import React, { useState, useRef } from 'react';
import { X, UploadCloud, Youtube, Sparkles, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Project } from '../types';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: Project) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'youtube' | 'blank'>('upload');
  const [projectName, setProjectName] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      if (!projectName) {
        setProjectName(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!projectName) {
        setProjectName(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (activeTab === 'upload') {
        if (!selectedFile) {
          setError('Selecione um arquivo de vídeo para enviar.');
          setIsSubmitting(false);
          return;
        }

        setStatusMessage('Enviando arquivo de vídeo...');
        const result = await api.uploadVideo(selectedFile, projectName || undefined, (progress) => {
          setUploadProgress(progress);
        });

        setStatusMessage('Vídeo enviado com sucesso! Carregando projeto...');
        const project = await api.getProject(result.projectId);
        onProjectCreated(project);
        onClose();
      } else if (activeTab === 'youtube') {
        if (!youtubeUrl.trim()) {
          setError('Cole a URL de um vídeo do YouTube.');
          setIsSubmitting(false);
          return;
        }

        setStatusMessage('Conectando ao YouTube e preparando download...');
        const result = await api.ingestYouTube(youtubeUrl.trim(), projectName || undefined);

        setStatusMessage('Vídeo do YouTube iniciado! Carregando projeto...');
        const project = await api.getProject(result.projectId);
        onProjectCreated(project);
        onClose();
      } else {
        // Blank project
        const name = projectName.trim() || 'Novo Projeto Shorts';
        setStatusMessage('Criando projeto no banco de dados...');
        const project = await api.createProject(name);
        const fullProject = await api.getProject(project.id);
        onProjectCreated(fullProject);
        onClose();
      }
    } catch (err: any) {
      console.error('Project creation failed:', err);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err.message || 'Ocorreu um erro ao processar o vídeo.');
      }
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        id="modal-new-project-card"
        className="w-full max-w-lg bg-[#111113] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#0A0A0B]">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-bold font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
              NEW PROJECT
            </span>
            <div>
              <h2 className="text-sm font-bold text-white">Criar Projeto de Shorts</h2>
              <p className="text-[11px] text-zinc-400">Importe seu vídeo longo para extrair os melhores cortes</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source Tabs */}
        <div className="flex border-b border-white/10 bg-[#0A0A0B]/50 px-5 pt-2">
          <button
            type="button"
            onClick={() => { setActiveTab('upload'); setError(null); }}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'upload'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Upload de Vídeo</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('youtube'); setError(null); }}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'youtube'
                ? 'border-rose-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Youtube className="w-3.5 h-3.5 text-rose-500" />
            <span>Link do YouTube</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('blank'); setError(null); }}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'blank'
                ? 'border-indigo-400 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Projeto Direto</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start gap-2 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {/* Project Name */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Nome do Projeto {activeTab !== 'blank' && <span className="text-zinc-500 lowercase">(opcional)</span>}
            </label>
            <input
              type="text"
              id="input-project-name"
              placeholder="Ex: Podcast Ep 42 - Os segredos da produtividade"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={isSubmitting}
              className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Tab 1: Upload */}
          {activeTab === 'upload' && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Arquivo de Vídeo (MP4, MOV, WEBM)
              </label>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="video/*,audio/*"
                className="hidden"
              />
              <div
                id="dropzone-upload-video"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-150 flex flex-col items-center justify-center space-y-2 ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : selectedFile
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-white/10 hover:border-white/20 bg-[#0A0A0B]'
                }`}
              >
                {selectedFile ? (
                  <>
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">{selectedFile.name}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                        {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB • Clique para alterar
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 text-zinc-400 flex items-center justify-center">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-zinc-200">
                        Arraste o vídeo aqui ou clique para selecionar
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                        MP4, MOV, WEBM, MKV até 500MB
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: YouTube */}
          {activeTab === 'youtube' && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                URL do Vídeo no YouTube
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Youtube className="w-4 h-4 text-rose-500" />
                </div>
                <input
                  type="url"
                  id="input-youtube-url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
                />
              </div>
              <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                Download direto processado no servidor nativo.
              </p>
            </div>
          )}

          {/* Tab 3: Blank Project */}
          {activeTab === 'blank' && (
            <div className="p-3.5 bg-[#0A0A0B] border border-white/10 rounded-xl space-y-1.5">
              <p className="text-xs font-semibold text-zinc-200">Criação Instantânea de Projeto</p>
              <p className="text-[11px] text-zinc-400">
                Cria a estrutura do projeto diretamente no SQLite. Você poderá vincular mídias e gerar cortes dentro do editor.
              </p>
            </div>
          )}

          {/* Progress / Status during submission */}
          {isSubmitting && (
            <div className="p-3.5 rounded-xl bg-[#0A0A0B] border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  <span>{statusMessage || 'Processando...'}</span>
                </span>
                {activeTab === 'upload' && (
                  <span className="font-mono text-zinc-400 font-bold">{uploadProgress}%</span>
                )}
              </div>
              {activeTab === 'upload' && (
                <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 text-xs font-bold text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              id="btn-submit-new-project"
              disabled={
                isSubmitting ||
                (activeTab === 'upload' && !selectedFile) ||
                (activeTab === 'youtube' && !youtubeUrl)
              }
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg shadow-sm active:scale-95 transition-all cursor-pointer border border-indigo-500/30"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {activeTab === 'blank' ? 'Criar Projeto' : 'Extrair Melhores Momentos'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

