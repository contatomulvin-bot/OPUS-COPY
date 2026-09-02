import React, { useState } from 'react';
import { X, Check, Clock, AlertCircle, Sparkles, Loader2 } from 'lucide-react';
import { Clip, Video } from '../types';
import { api } from '../lib/api';

interface ClipEditModalProps {
  clip: Clip;
  video: Video;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const ClipEditModal: React.FC<ClipEditModalProps> = ({
  clip,
  video,
  isOpen,
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState(clip.title);
  const [startTime, setStartTime] = useState(clip.startTime.toString());
  const [endTime, setEndTime] = useState(clip.endTime.toString());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const numStart = parseFloat(startTime);
  const numEnd = parseFloat(endTime);
  const duration = !isNaN(numStart) && !isNaN(numEnd) && numEnd > numStart ? numEnd - numStart : 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isNaN(numStart) || numStart < 0) {
      setError('O tempo inicial deve ser um número maior ou igual a 0.');
      return;
    }

    if (isNaN(numEnd) || numEnd <= numStart) {
      setError('O tempo final deve ser estritamente maior que o tempo inicial.');
      return;
    }

    if (video.duration && numEnd > video.duration + 1.0) {
      setError(`O tempo final (${numEnd}s) não pode exceder a duração total do vídeo (${video.duration}s).`);
      return;
    }

    if (!title.trim()) {
      setError('O título não pode estar vazio.');
      return;
    }

    setIsSaving(true);
    try {
      await api.updateClip(clip.id, {
        title: title.trim(),
        startTime: numStart,
        endTime: numEnd,
      });
      await onSaved();
      onClose();
    } catch (err: any) {
      console.error('Erro ao atualizar corte:', err);
      setError(err.message || 'Falha ao salvar as alterações do corte.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#111113] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl space-y-4">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Ajustar Corte</h2>
              <p className="text-[10px] text-zinc-400 font-mono">Refinar timestamps e título do Short</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-4 pt-0 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
              Título do Short
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Ex: O maior erro na carreira..."
              required
            />
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3 text-indigo-400" />
                <span>Início (s)</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3 text-indigo-400" />
                <span>Fim (s)</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                required
              />
            </div>
          </div>

          {/* Duration Summary */}
          <div className="p-3 bg-[#0A0A0B] rounded-xl border border-white/5 flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-400">Duração Resultante:</span>
            <span className="font-bold text-indigo-400">
              {duration > 0 ? `${duration.toFixed(1)} segundos` : 'Inválido'}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Salvar Alterações</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
