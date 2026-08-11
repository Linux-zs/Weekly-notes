import path from 'node:path';
import fs from 'node:fs';
import { constants } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { config, workspaceRoot } from './config.js';
import { sqlite } from './db/index.js';
import { registerAuth } from './auth.js';
import { registerApi } from './routes/api.js';
import { registerCatalog } from './routes/catalog.js';
import { registerSettings } from './routes/settings.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'silent' : 'info' },
    trustProxy: config.trustProxy
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, { limits: { files: 1, fileSize: 8 * 1024 * 1024 } });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null
      }
    },
    strictTransportSecurity: config.isProduction
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !request.url.startsWith('/auth/')) {
      const origin = request.headers.origin;
      const localDev =
        !config.isProduction && Boolean(origin?.match(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/));
      if (origin && origin !== config.APP_ORIGIN && !localDev)
        return reply.code(403).send({ error: 'INVALID_ORIGIN' });
    }
  });
  await registerAuth(app);
  await registerCatalog(app);
  await registerApi(app);
  await registerSettings(app);
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      sqlite.prepare('SELECT 1').get();
      fs.mkdirSync(config.uploadDir, { recursive: true });
      fs.mkdirSync(config.backupDir, { recursive: true });
      fs.accessSync(config.uploadDir, constants.W_OK);
      fs.accessSync(config.backupDir, constants.W_OK);
      return { status: 'ready', storage: 'writable' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  const webRoot = path.resolve(workspaceRoot, 'apps/web/dist');
  if (fs.existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler(async (request, reply) => {
      const acceptsHtml = request.headers.accept?.includes('text/html');
      const isAppRoute =
        request.method === 'GET' &&
        acceptsHtml &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/auth/') &&
        !request.url.startsWith('/assets/');
      if (isAppRoute) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'NOT_FOUND' });
    });
  }
  return app;
}
