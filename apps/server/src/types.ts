import type { FastifyReply, FastifyRequest } from 'fastify';

export interface CurrentUser {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  workspaceId: string;
  role: 'owner' | 'member';
}

declare module 'fastify' {
  interface FastifyRequest { currentUser: CurrentUser | null; }
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser) return reply.code(401).send({ error: 'UNAUTHORIZED', message: '请先登录' });
}
