import { Editor } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import DOMPurify from 'dompurify';
import { detailExtensions, parseDetailMarkdown, safeEditorUrl } from './detail-markdown';

type Upload = { id: number; file: File; pos: number; error?: string; pending: boolean };
type Callbacks = {
  change: (value: string) => void;
  upload: (file: File) => Promise<{ url: string }>;
  preview: (image: { src: string; alt: string }) => void;
};

/** Lifetime belongs to the report row, not the dialog or a save response. */
export class DetailEditorModel {
  editor: Editor;
  value: string;
  uploads: Upload[] = [];
  sourceMode = false;
  listeners = new Set<() => void>();
  private nextId = 0;
  private replacing = false;
  private disposed = false;
  private composing = false;
  private compositionChanged = false;
  private loaded = false;
  private sourceBeforeEditing = '';
  private readonly uploadKey = new PluginKey('detailUploads');

  constructor(
    value: string,
    public callbacks: Callbacks
  ) {
    this.value = value;
    this.editor = new Editor({
      extensions: detailExtensions(),
      content: '',
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': '正文内容',
          'aria-multiline': 'true',
          class: 'detail-prose markdown'
        },
        transformPastedHTML: (html) =>
          DOMPurify.sanitize(html, {
            FORBID_TAGS: ['style', 'iframe'],
            FORBID_ATTR: ['style']
          }),
        handlePaste: (_view, event) => {
          const clipboardFiles = Array.from(event.clipboardData?.files ?? []);
          const files = (
            clipboardFiles.length
              ? clipboardFiles
              : Array.from(event.clipboardData?.items ?? []).map((item) =>
                  item.kind === 'file' ? item.getAsFile() : null
                )
          ).filter((file): file is File => Boolean(file?.type.startsWith('image/')));
          if (files.length) {
            files.forEach((file) => this.addUpload(file));
            return true;
          }
          // Parse plain text through the same lossless import guard.
          if (!event.clipboardData?.getData('text/html')) {
            const text = event.clipboardData?.getData('text/plain');
            if (text) {
              this.editor.commands.insertContent(parseDetailMarkdown(this.editor, text).content ?? []);
              return true;
            }
          }
          return false;
        },
        handleDoubleClickOn: (_view, _pos, node) => {
          if (node.type.name !== 'image' || !safeEditorUrl(node.attrs.src, true)) return false;
          this.callbacks.preview({ src: node.attrs.src, alt: node.attrs.alt ?? '图片预览' });
          return true;
        },
        handleDOMEvents: {
          compositionstart: () => {
            this.composing = true;
            return false;
          },
          compositionend: () => {
            this.composing = false;
            queueMicrotask(() => {
              if (!this.disposed) this.flushComposition();
            });
            return false;
          }
        }
      },
      onUpdate: () => {
        if (this.replacing) return;
        if (this.composing) this.compositionChanged = true;
        else this.publish();
      },
      onTransaction: () => this.notify()
    });
    this.replace(value);
    this.editor.view.dispatch(this.editor.state.tr.setSelection(Selection.atStart(this.editor.state.doc)));
    this.editor.registerPlugin(
      new Plugin({
        key: this.uploadKey,
        state: {
          init: () => null,
          apply: (transaction) => {
            for (const upload of this.uploads) upload.pos = transaction.mapping.map(upload.pos, 1);
            return null;
          }
        },
        props: {
          decorations: (state) =>
            DecorationSet.create(
              state.doc,
              this.uploads.map((upload) =>
                Decoration.widget(
                  Math.min(upload.pos, state.doc.content.size),
                  () => {
                    const span = document.createElement('span');
                    span.className = 'image-upload-anchor';
                    span.textContent = upload.pending ? '图片上传中…' : '图片上传失败';
                    span.contentEditable = 'false';
                    return span;
                  },
                  { key: `${upload.id}-${upload.pending}`, side: 1 }
                )
              )
            )
        }
      })
    );
  }

  notify = () => this.listeners.forEach((listener) => listener());
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish() {
    const value = this.editor.getMarkdown();
    if (value !== this.value) {
      this.value = value;
      this.callbacks.change(value);
    }
  }

  flushComposition() {
    if (!this.compositionChanged || this.sourceMode) return;
    this.compositionChanged = false;
    this.publish();
  }

  replace(value: string) {
    if (this.loaded && value === this.value) return;
    this.replacing = true;
    this.value = value;
    this.editor
      .chain()
      .setMeta('addToHistory', false)
      .setContent(parseDetailMarkdown(this.editor, value), { emitUpdate: false })
      .run();
    this.replacing = false;
    this.loaded = true;
    if (this.sourceMode) this.sourceBeforeEditing = value;
    this.notify();
  }

  setSource(value: string) {
    this.value = value;
    this.callbacks.change(value);
  }

  toggleSource() {
    if (this.uploads.length) return;
    if (this.sourceMode && this.value !== this.sourceBeforeEditing) {
      this.replacing = true;
      // A source edit is one undoable transaction; toggling alone changes nothing.
      const doc = this.editor.schema.nodeFromJSON(parseDetailMarkdown(this.editor, this.value));
      if (!doc.eq(this.editor.state.doc))
        this.editor.view.dispatch(
          closeHistory(this.editor.state.tr).replaceWith(0, this.editor.state.doc.content.size, doc.content)
        );
      this.editor.view.dispatch(closeHistory(this.editor.state.tr));
      this.replacing = false;
    }
    if (!this.sourceMode) this.sourceBeforeEditing = this.value;
    this.sourceMode = !this.sourceMode;
    this.notify();
  }

  setImageWidth(attachmentId: string, width: number) {
    const tr = this.editor.state.tr;
    this.editor.state.doc.descendants((node, pos) => {
      if (
        node.type.name === 'image' &&
        String(node.attrs.src).split('#')[0] === `/api/attachments/${attachmentId}`
      )
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: `/api/attachments/${attachmentId}#w=${width}`
        });
    });
    if (tr.docChanged) this.editor.view.dispatch(tr);
  }

  addUpload(file: File) {
    const upload = { id: ++this.nextId, file, pos: this.editor.state.selection.from, pending: false };
    this.uploads.push(upload);
    void this.retryUpload(upload.id);
  }

  async retryUpload(id: number) {
    const upload = this.uploads.find((item) => item.id === id);
    if (!upload || upload.pending) return;
    upload.pending = true;
    upload.error = undefined;
    this.refreshUploads();
    try {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(upload.file.type) || upload.file.size > 8 * 1024 * 1024)
        throw new Error('请选择不超过 8 MB 的 PNG / JPEG / GIF / WebP 图片');
      const data = await this.callbacks.upload(upload.file);
      if (this.disposed || !this.uploads.includes(upload)) return;
      if (!safeEditorUrl(data.url, true)) throw new Error('服务器返回了无效的图片地址');
      const node = this.editor.schema.nodes.image.create({
        src: data.url,
        alt: upload.file.name.replace(/\.[^.]+$/, '') || '图片'
      });
      const transaction = closeHistory(this.editor.state.tr).insert(upload.pos, node);
      this.uploads = this.uploads.filter((item) => item !== upload);
      // Transaction mapping preserves the user's CURRENT selection; never focus the old anchor.
      this.editor.view.dispatch(transaction);
      this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    } catch (error) {
      upload.pending = false;
      upload.error = error instanceof Error ? error.message : '图片上传失败';
    }
    if (!this.disposed) this.refreshUploads();
  }

  cancelUpload(id: number) {
    this.uploads = this.uploads.filter((upload) => upload.id !== id);
    this.refreshUploads();
  }

  private refreshUploads() {
    this.editor.view.dispatch(this.editor.state.tr.setMeta(this.uploadKey, true));
    this.notify();
  }

  destroy() {
    this.disposed = true;
    this.editor.destroy();
    this.listeners.clear();
  }
}
