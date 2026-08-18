import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');

describe('container authentication defaults', () => {
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
