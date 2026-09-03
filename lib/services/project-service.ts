import { prisma, DEMO_USER_ID, getOrCreateDemoUser } from '../db/prisma';
import { serializePrisma } from '../utils/serializer';

export class ProjectService {
  async getAllProjects() {
    await getOrCreateDemoUser();
    const projects = await prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        videos: {
          orderBy: { createdAt: 'desc' },
          include: {
            clips: {
              include: {
                renders: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
            transcript: true,
          },
        },
      },
    });

    const mapped = projects.map(p => {
      const allClips = p.videos.flatMap(v => v.clips);
      const totalRenders = allClips.filter(c => c.renders.some(r => r.status === 'COMPLETED')).length;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        videoCount: p.videos.length,
        clipCount: allClips.length,
        completedRendersCount: totalRenders,
        // IMPORTANT: videos are ordered newest-first, so this can never point
        // at an older source after a new URL/upload is added to the project.
        primaryVideo: p.videos[0] || null,
      };
    });

    return serializePrisma(mapped);
  }

  async getProjectById(id: string) {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        // Deterministic source selection: newest video is always first.
        videos: {
          orderBy: { createdAt: 'desc' },
          include: {
            transcript: {
              include: {
                segments: {
                  orderBy: { startTime: 'asc' },
                },
              },
            },
            clips: {
              orderBy: { score: 'desc' },
              include: {
                renders: {
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
      },
    });

    if (!project) return null;

    return serializePrisma(project);
  }

  async createProject(name: string) {
    await getOrCreateDemoUser();
    const created = await prisma.project.create({
      data: {
        name,
        userId: DEMO_USER_ID,
        status: 'CREATED',
      },
    });
    return serializePrisma(created);
  }

  async deleteProject(id: string) {
    const deleted = await prisma.project.delete({
      where: { id },
    });
    return serializePrisma(deleted);
  }

  async getDashboardStats() {
    await getOrCreateDemoUser();
    const [projectCount, videoCount, clipCount, renderCount] = await Promise.all([
      prisma.project.count(),
      prisma.video.count(),
      prisma.clip.count(),
      prisma.render.count({ where: { status: 'COMPLETED' } }),
    ]);

    return {
      projectCount,
      videoCount,
      clipCount,
      renderCount,
    };
  }

  async getRecentShorts(limit = 6) {
    await getOrCreateDemoUser();
    const renders = await prisma.render.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        clip: {
          include: {
            video: {
              include: {
                project: true,
              },
            },
          },
        },
      },
    });
    return serializePrisma(renders);
  }
}

export const defaultProjectService = new ProjectService();
