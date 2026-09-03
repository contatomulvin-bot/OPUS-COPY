import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { ProjectView } from './components/ProjectView';
import { NewProjectModal } from './components/NewProjectModal';
import { ClipEditorModal } from './components/ClipEditorModal';
import { Project, Video, Clip, SystemStatus, DashboardStats } from './types';
import { api } from './lib/api';

export default function App() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [editingClipData, setEditingClipData] = useState<{ clip: Clip; video: Video } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [sysStatus, dashboardStats, allProjects] = await Promise.all([
        api.getSystemStatus().catch(() => null),
        api.getStats().catch(() => null),
        api.getProjects().catch(() => []),
      ]);
      if (sysStatus) setSystemStatus(sysStatus);
      if (dashboardStats) setStats(dashboardStats);
      setProjects(allProjects);
    } catch (err) {
      console.error('Failed to load initial applet data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSelectProject = async (project: Project) => {
    try {
      setSelectedProject(await api.getProject(project.id));
    } catch (err) {
      console.error('Error fetching project detail:', err);
      setSelectedProject(project);
    }
  };

  const handleRefreshCurrentProject = async () => {
    if (!selectedProject) return;
    try {
      const fresh = await api.getProject(selectedProject.id);
      setSelectedProject(fresh);
      setProjects(prev => prev.map(p => (p.id === fresh.id ? fresh : p)));
    } catch (err) { console.error('Error refreshing project:', err); }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Deseja realmente excluir este projeto e todos os seus vídeos e Shorts?')) return;
    try {
      await api.deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (selectedProject?.id === projectId) setSelectedProject(null);
      showToast('Projeto excluído com sucesso.');
      const freshStats = await api.getStats().catch(() => null);
      if (freshStats) setStats(freshStats);
    } catch (err: any) {
      console.error('Error deleting project:', err);
      alert(`Falha ao excluir projeto: ${err.message}`);
    }
  };

  const handleProjectCreated = (newProject: Project) => {
    // Replace any stale copy instead of prepending duplicates.
    setProjects(prev => [newProject, ...prev.filter(p => p.id !== newProject.id)]);
    setSelectedProject(newProject);
    showToast('Projeto criado! Processamento iniciado com sucesso.');
    api.getStats().then(s => setStats(s)).catch(() => {});
  };

  const handleClipUpdated = (updatedClip: Clip) => {
    if (!selectedProject) return;
    const updatedVideos = selectedProject.videos.map(v => v.id === updatedClip.videoId ? { ...v, clips: v.clips.map(c => c.id === updatedClip.id ? updatedClip : c) } : v);
    setSelectedProject({ ...selectedProject, videos: updatedVideos });
    if (editingClipData?.clip.id === updatedClip.id) setEditingClipData({ ...editingClipData, clip: updatedClip });
    showToast('Clipe salvo com sucesso.');
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      <Header systemStatus={systemStatus} onNavigateHome={() => setSelectedProject(null)} onOpenNewProject={() => setIsNewProjectModalOpen(true)} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-5 lg:px-6 py-4 sm:py-6">
        {selectedProject ? <ProjectView project={selectedProject} onBack={() => setSelectedProject(null)} onSelectClipToEdit={(clip, video) => setEditingClipData({ clip, video })} onRefreshProject={handleRefreshCurrentProject} /> : <Dashboard stats={stats} projects={projects} loading={loading} onSelectProject={handleSelectProject} onOpenNewProject={() => setIsNewProjectModalOpen(true)} onDeleteProject={handleDeleteProject} />}
      </main>
      {toastMessage && <div className="fixed bottom-5 right-5 z-50 bg-[#111113] border border-white/10 text-white text-xs font-bold px-3.5 py-2.5 rounded-lg shadow-2xl">{toastMessage}</div>}
      <NewProjectModal isOpen={isNewProjectModalOpen} onClose={() => setIsNewProjectModalOpen(false)} onProjectCreated={handleProjectCreated} />
      {editingClipData && <ClipEditorModal clip={editingClipData.clip} video={editingClipData.video} isOpen={!!editingClipData} onClose={() => setEditingClipData(null)} onClipUpdated={handleClipUpdated} />}
    </div>
  );
}
