import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareExport } from './export.js';

describe('portable export stream', () => {
  it('keeps a consistent file snapshot and encodes across chunk boundaries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
    try {
      const bytes = Buffer.alloc(200_003, 173);
      await fs.writeFile(path.join(root, 'image'), bytes);
      const stream = await prepareExport(
        root,
        { reports: [{ content: '正文"\n' }] },
        [{ id: 'image-id', storedName: 'image', originalName: '截图.png', mimeType: 'image/png' }],
        true
      );
      await fs.unlink(path.join(root, 'image'));
      let result = '';
      for await (const chunk of stream) result += chunk;
      const exported = JSON.parse(result);
      expect(exported.reports).toEqual([{ content: '正文"\n' }]);
      expect(exported.filesIncluded).toBe(true);
      expect(Buffer.from(exported.files[0].content, 'base64')).toEqual(bytes);
      expect(await fs.readdir(root)).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('cleans up an export cancelled before consumption', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
    try {
      const stream = await prepareExport(root, {}, [], false);
      stream.destroy();
      await new Promise((resolve) => stream.once('close', resolve));
      await expect.poll(async () => fs.readdir(root)).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('fails before sending a partial response if an attachment is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
    try {
      await expect(
        prepareExport(
          root,
          {},
          [{ id: 'missing', storedName: 'missing', originalName: 'x', mimeType: 'image/png' }],
          true
        )
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readdir(root)).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
