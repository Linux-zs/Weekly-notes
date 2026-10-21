import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

type ExportAttachment = { id: string; storedName: string; originalName: string; mimeType: string };

// Call under the storage lock: immutable uploads are pinned before deletes can run.
// The response reads these links outside the lock and never accumulates file bodies.
export async function prepareExport(
  uploadDir: string,
  payload: Record<string, unknown>,
  attachments: ExportAttachment[],
  filesIncluded: boolean
) {
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const pins = await fs.promises.mkdtemp(path.join(uploadDir, '.export-pins-'));
  const cleanup = () => fs.promises.rm(pins, { recursive: true, force: true });
  try {
    for (const [index, attachment] of attachments.entries()) {
      const source = path.resolve(uploadDir, attachment.storedName);
      if (!source.startsWith(path.resolve(uploadDir) + path.sep)) throw new Error('INVALID_ATTACHMENT_PATH');
      await fs.promises.link(source, path.join(pins, String(index)));
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  async function* json() {
    try {
      yield '{';
      let first = true;
      for (const [key, value] of Object.entries({ ...payload, formatVersion: 2, filesIncluded })) {
        yield `${first ? '' : ','}${JSON.stringify(key)}:`;
        first = false;
        if (Array.isArray(value)) {
          yield '[';
          for (let index = 0; index < value.length; index++) {
            yield `${index ? ',' : ''}${JSON.stringify(value[index])}`;
          }
          yield ']';
        } else yield JSON.stringify(value);
      }
      yield ',"files":[';
      for (const [index, attachment] of attachments.entries()) {
        const metadata = JSON.stringify({
          sourceUrl: `/api/attachments/${attachment.id}`,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          encoding: 'base64'
        });
        yield `${index ? ',' : ''}${metadata.slice(0, -1)},"content":"`;
        let remainder = Buffer.alloc(0);
        for await (const chunk of fs.createReadStream(path.join(pins, String(index)))) {
          const bytes = Buffer.concat([remainder, chunk as Buffer]);
          const end = bytes.length - (bytes.length % 3);
          yield bytes.subarray(0, end).toString('base64');
          remainder = Buffer.from(bytes.subarray(end));
        }
        if (remainder.length) yield remainder.toString('base64');
        yield '"}';
      }
      yield ']}';
    } finally {
      await cleanup();
    }
  }
  const stream = Readable.from(json());
  // Also clean up when a client disconnects before consuming the first chunk.
  stream.once('close', () => {
    void cleanup().catch(() => {});
  });
  return stream;
}
