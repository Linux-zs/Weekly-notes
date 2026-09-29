import { EditorContent } from '@tiptap/react';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Code,
  Link,
  Undo2,
  Redo2,
  ImagePlus,
  Table2
} from 'lucide-react';
import type { DetailEditorModel } from './detail-editor-model';
import { safeEditorUrl, imageWidth } from './detail-markdown';

export function DetailEditor({ getModel }: { getModel: () => DetailEditorModel }) {
  const [model] = useState(getModel);
  const [, redraw] = useReducer((n) => n + 1, 0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => model.subscribe(redraw), [model]);
  const editor = model.editor;
  const button = (
    label: string,
    icon: React.ReactNode,
    run: () => void,
    active = false,
    disabled = false
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || model.sourceMode}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );
  const hasRaw = (() => {
    let found = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'rawMarkdown') found = true;
    });
    return found;
  })();
  return (
    <section className="detail-rich-editor" aria-label="图文编辑器">
      <div className="detail-format-toolbar" role="toolbar" aria-label="正文格式">
        {button(
          '粗体',
          <Bold size={16} />,
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive('bold')
        )}
        {button(
          '斜体',
          <Italic size={16} />,
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive('italic')
        )}
        {button(
          '标题',
          <span>H2</span>,
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          editor.isActive('heading')
        )}
        {button(
          '无序列表',
          <List size={16} />,
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive('bulletList')
        )}
        {button(
          '有序列表',
          <ListOrdered size={16} />,
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive('orderedList')
        )}
        {button(
          '引用',
          <Quote size={16} />,
          () => editor.chain().focus().toggleBlockquote().run(),
          editor.isActive('blockquote')
        )}
        {button(
          '代码块',
          <Code size={16} />,
          () => editor.chain().focus().toggleCodeBlock().run(),
          editor.isActive('codeBlock')
        )}
        {button(
          '链接',
          <Link size={16} />,
          () => setLink(editor.getAttributes('link').href ?? ''),
          editor.isActive('link')
        )}
        {button('插入表格', <Table2 size={16} />, () =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        )}
        {button(
          '撤销',
          <Undo2 size={16} />,
          () => editor.chain().focus().undo().run(),
          false,
          !editor.can().undo()
        )}
        {button(
          '重做',
          <Redo2 size={16} />,
          () => editor.chain().focus().redo().run(),
          false,
          !editor.can().redo()
        )}
        {button(
          '添加图片',
          <>
            <ImagePlus size={16} />
            <span>图片</span>
          </>,
          () => fileInput.current?.click()
        )}
        <button
          type="button"
          className="source-toggle"
          aria-pressed={model.sourceMode}
          disabled={model.uploads.length > 0}
          title={model.uploads.length ? '请先完成或取消图片上传' : '编辑 Markdown 源码'}
          onClick={() => model.toggleSource()}
        >
          {model.sourceMode ? '返回图文' : 'Markdown 源码'}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) model.addUpload(file);
            event.target.value = '';
          }}
        />
      </div>
      {link !== null && (
        <form
          className="detail-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!link) editor.chain().focus().extendMarkRange('link').unsetLink().run();
            else if (safeEditorUrl(link))
              editor.chain().focus().extendMarkRange('link').setLink({ href: link }).run();
            else return;
            setLink(null);
          }}
        >
          <input
            aria-label="链接地址"
            value={link}
            placeholder="https://…"
            onChange={(e) => setLink(e.target.value)}
          />
          <button type="submit" disabled={Boolean(link) && !safeEditorUrl(link)}>
            应用
          </button>
          <button type="button" onClick={() => setLink(null)}>
            取消
          </button>
        </form>
      )}
      {hasRaw && <p className="raw-markdown-notice">部分内容已保留为原文块，可通过 Markdown 源码修改。</p>}
      <div hidden={model.sourceMode}>
        <EditorContent editor={editor} />
      </div>
      {model.sourceMode && (
        <textarea
          className="detail-source"
          aria-label="Markdown 内容"
          value={model.value}
          onChange={(event) => {
            model.setSource(event.target.value);
            redraw();
          }}
        />
      )}
      {!model.sourceMode && editor.isActive('image') && (
        <label className="detail-image-width">
          图片宽度 {imageWidth(editor.getAttributes('image').src ?? '')}%
          <input
            aria-label="选中图片宽度"
            type="range"
            min="25"
            max="100"
            step="5"
            value={imageWidth(editor.getAttributes('image').src ?? '')}
            onChange={(event) => {
              const src = String(editor.getAttributes('image').src).replace(/#w=\d{1,3}$/, '');
              editor.commands.updateAttributes('image', { src: `${src}#w=${event.target.value}` });
            }}
          />
          <span>双击图片可全屏查看</span>
        </label>
      )}
      {model.uploads.length > 0 && (
        <ul className="detail-upload-list" aria-live="polite">
          {model.uploads.map((upload) => (
            <li key={upload.id}>
              <span>
                {upload.file.name} · {upload.pending ? '上传中…' : upload.error}
              </span>
              {!upload.pending && (
                <>
                  <button type="button" onClick={() => void model.retryUpload(upload.id)}>
                    重试上传
                  </button>
                  <button type="button" onClick={() => model.cancelUpload(upload.id)}>
                    取消
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="detail-editor-hint">可直接粘贴截图 · PNG / JPEG / GIF / WebP，最大 8 MB</p>
    </section>
  );
}
