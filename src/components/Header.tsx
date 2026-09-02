import React from 'react';
import { Scissors, CheckCircle2, AlertCircle, Sparkles, HardDrive, Cpu } from 'lucide-react';
import { SystemStatus, Project } from '../types';

interface HeaderProps {
  systemStatus: SystemStatus | null;
  selectedProject?: Project | null;
  onNavigateHome: () => void;
  onOpenNewProject: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  systemStatus,
  selectedProject,
  onNavigateHome,
  onOpenNewProject,
}) => {
  return (
    <header className="h-14 border-b border-white/10 flex items-center justify-between px-4 sm:px-6 bg-[#111113] shrink-0 sticky top-0 z-40">
      {/* Brand & Context */}
      <div className="flex items-center gap-3">
        <div
          onClick={onNavigateHome}
          id="brand-header-logo"
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="bg-indigo-600 p-1.5 rounded-lg shadow-sm group-hover:bg-indigo-500 transition-colors">
            <Scissors className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-base tracking-tight text-[#E4E4E7]">AI Clipper</span>
        </div>

        {selectedProject ? (
          <>
            <div className="h-4 w-[1px] bg-white/20 mx-1 hidden sm:block"></div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400 truncate max-w-xs md:max-w-md">
              <span className="text-zinc-500 font-mono">PROJ:</span>
              <span className="text-zinc-300 font-medium truncate">{selectedProject.name}</span>
            </div>
          </>
        ) : (
          <>
            <div className="h-4 w-[1px] bg-white/20 mx-1 hidden sm:block"></div>
            <span className="text-xs text-zinc-500 hidden sm:block font-mono">9:16 VIRAL ENGINE</span>
          </>
        )}
      </div>

      {/* System Status & Actions */}
      <div className="flex items-center gap-3">
        {/* System Ready Badge */}
        <div className="hidden md:flex items-center gap-2 bg-zinc-800/50 px-2.5 py-1 rounded-full border border-white/5 text-[11px] text-zinc-300">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span className="font-medium">
            {systemStatus?.gemini.configured && systemStatus?.ffmpeg.available
              ? 'System Ready'
              : 'Checking Core'}
          </span>
        </div>

        {/* FFmpeg & Gemini Hardware Chips */}
        <div className="hidden lg:flex items-center gap-2 text-[10px] font-mono text-zinc-400">
          <div className="flex items-center gap-1 bg-[#0A0A0B] px-2 py-0.5 rounded border border-white/5" title="FFmpeg Processor">
            <Cpu className="w-3 h-3 text-zinc-400" />
            <span>FFmpeg</span>
            {systemStatus?.ffmpeg.available ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-rose-400" />
            )}
          </div>

          <div className="flex items-center gap-1 bg-[#0A0A0B] px-2 py-0.5 rounded border border-white/5" title="Gemini 3.7 AI Model">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>Gemini AI</span>
            {systemStatus?.gemini.configured ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-400" />
            )}
          </div>
        </div>

        {/* New Project CTA */}
        <button
          id="btn-header-new-project"
          onClick={onOpenNewProject}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg border border-indigo-500/30 shadow-sm active:scale-95 transition-all cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Criar Shorts</span>
        </button>
      </div>
    </header>
  );
};

