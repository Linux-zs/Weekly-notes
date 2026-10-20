import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

const root = path.resolve(import.meta.dirname, '../../..');

describe('container authentication defaults', () => {
  it('uses the nearest proxy client instead of attacker-prepended forwarding addresses', async () => {
    const previous = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'true';
    const { config } = await import('./config.js');
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
    const app = Fastify({ trustProxy: config.trustProxy });
    app.get('/', (request) => ({ ip: request.ip }));
    try {
      const response = await app.inject({
        url: '/',
        headers: { 'x-forwarded-for': '198.51.100.77, 203.0.113.9' }
      });
      expect(response.json().ip).toBe('203.0.113.9');
    } finally {
      await app.close();
    }
  });
  it('keeps the main compose deployment in production with development login disabled', () => {
    const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
    const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

    expect(compose).toMatch(/NODE_ENV:\s*production/);
    expect(compose).toMatch(/DEV_AUTH_BYPASS:\s*["']false["']/);
    expect(compose).toMatch(/HOST:\s*0\.0\.0\.0/);
    expect(example).toMatch(/^NODE_ENV=production$/m);
    expect(example).toMatch(/^DEV_AUTH_BYPASS=false$/m);
  });

  it('enables development login only in the explicit test compose override', () => {
    const compose = fs.readFileSync(path.join(root, 'compose.test.yaml'), 'utf8');

    expect(compose).toMatch(/NODE_ENV:\s*development/);
    expect(compose).toMatch(/DEV_AUTH_BYPASS:\s*["']true["']/);
    expect(compose).toContain('127.0.0.1:3000:3000');
  });

  it('deploys the immutable CNB image to Aliyun without embedding credentials', () => {
    const pipeline = fs.readFileSync(path.join(root, '.cnb.yml'), 'utf8');

    expect(pipeline).toContain('imports: https://cnb.cool/Linuxzs/udong-ssh/-/blob/main/deploy.yml');
    expect(pipeline).toContain('host: 106.15.195.19');
    expect(pipeline).toContain('username: udong');
    expect(pipeline).toContain('DEPLOY_DIR=/data/Weekly-notes');
    expect(pipeline).toContain('STATE_DIR="${HOME}/.local/state/zhoubao-deploy"');
    expect(pipeline).toContain('--project-directory "$DEPLOY_DIR"');
    expect(pipeline).toContain('IMAGE_NAME=${IMAGE_NAME}:${CNB_COMMIT_SHORT}');
    expect(pipeline).toContain('node apps/server/dist/scripts/backup.js');
    expect(pipeline).toContain('rollback()');
    expect(pipeline).toContain('if [ "$HEALTHY" != true ]');
    expect(pipeline).not.toMatch(/password:\s*\S+/i);
    expect(pipeline).not.toContain('BEGIN OPENSSH PRIVATE KEY');
  });

  it('keeps direct starts safe unless development access is explicitly enabled', () => {
    const config = fs.readFileSync(path.join(root, 'apps/server/src/config.ts'), 'utf8');
    const serverPackage = fs.readFileSync(path.join(root, 'apps/server/package.json'), 'utf8');

    expect(config).toContain("default('production')");
    expect(config).toContain("HOST: z.string().min(1).default('127.0.0.1')");
    expect(config).toContain("DEV_AUTH_BYPASS: z.enum(['true', 'false']).default('false')");
    expect(serverPackage).toContain('NODE_ENV=development DEV_AUTH_BYPASS=true HOST=127.0.0.1');
    expect(serverPackage).toContain('--env-file-if-exists=../../.env');
  });
});
