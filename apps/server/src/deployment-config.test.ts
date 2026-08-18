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
    expect(example).toMatch(/^NODE_ENV=production$/m);
    expect(example).toMatch(/^DEV_AUTH_BYPASS=false$/m);
  });

  it('enables development login only in the explicit test compose override', () => {
    const compose = fs.readFileSync(path.join(root, 'compose.test.yaml'), 'utf8');

    expect(compose).toMatch(/NODE_ENV:\s*development/);
    expect(compose).toMatch(/DEV_AUTH_BYPASS:\s*["']true["']/);
    expect(compose).toContain('127.0.0.1:3000:3000');
  });
});
