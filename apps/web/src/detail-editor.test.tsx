// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DetailEditorModel } from './detail-editor-model';
import { parseDetailMarkdown, safeEditorUrl } from './detail-markdown';
import { DetailEditor } from './DetailEditor';
import { closeHistory } from '@tiptap/pm/history';

const models: DetailEditorModel[] = [];
function create(value: string, upload = vi.fn().mockResolvedValue({ url: '/api/attachments/new' })) {
  const callbacks = { change: vi.fn(), upload, preview: vi.fn() };
  const model = new DetailEditorModel(value, callbacks);
  models.push(model);
  return { model, editor: model.editor, ...callbacks };
}
afterEach(() => {
  cleanup();
  models.splice(0).forEach((model) => model.destroy());
});

describe('guarded official Markdown round trip', () => {
  it.each([
    '# 标题\n\n## 二级标题\n\n中文 **粗体**、*斜体*、~~删除~~与 `code`。',
    '- 第一项\n- 第二项\n  - 嵌套项\n\n1. 有序\n2. 列表',
    '> 引用\n>\n> 第二段\n\n---',
    '```ts\nconst html = "<div>";\n```',
    '| 名称 | 状态 |\n| --- | --- |\n| 工作 | 完成 |',
    '| 对齐 |\n| :---: |\n| 原文 |',
    '[链接](https://example.com/path "标题")\n\n中文![截图](/api/attachments/demo#w=55)图片后',
    '- [x] 已完成\n- [ ] 待处理',
    '![括号图片](<https://example.com/a(b).png#w=40>)',
    '![相对地址](images/demo.png#w=45)'
  ])('retains supported semantics: %s', (source) => {
    const { editor, change } = create(source);
    expect(change).not.toHaveBeenCalled();
    expect(editor.getJSON().content?.some((n) => n.type === 'rawMarkdown')).toBe(false);
    const once = editor.getMarkdown();
    const again = parseDetailMarkdown(editor, once);
    expect(again.content?.some((n) => n.type === 'rawMarkdown')).toBe(false);
    expect(editor.markdown!.serialize(again).trim()).toBe(once.trim());
  });

  it.each([
    '<!-- 保留注释 -->',
    '<details><summary>摘要</summary>正文</details>',
    '[参考][ref]\n\n[ref]: https://example.com\n[unused]: https://example.com/unused',
    '[危险](javascript:alert%281%29)',
    '![危险](data:image/svg+xml;base64,AAAA)'
  ])('keeps uncertain/unsafe content inert and lossless: %s', (source) => {
    const { editor } = create(source);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'rawMarkdown', attrs: { source } });
    expect(editor.getMarkdown().trim()).toBe(source);
    expect(editor.view.dom.querySelector('script,details,img,a')).toBeNull();
  });

  it('preserves a raw block while editing its adjacent paragraph', () => {
    const source = '<!-- 不可丢失 -->';
    const { editor } = create(`开头\n\n${source}\n\n结尾`);
    editor.commands.insertContentAt(1, '新');
    expect(editor.getMarkdown()).toContain(source);
    expect(editor.getMarkdown()).toContain('新开头');
  });

  it('rejects dangerous URL schemes and control characters', () => {
    for (const url of [
      'javascript:alert(1)',
      'java\nscript:alert(1)',
      '//evil.example',
      'data:text/html,x',
      '\\evil',
      'file:///etc/passwd'
    ])
      expect(safeEditorUrl(url)).toBe(false);
    expect(safeEditorUrl('/api/attachments/demo#w=50', true)).toBe(true);
    expect(safeEditorUrl('mailto:a@example.com')).toBe(true);
    expect(safeEditorUrl('mailto:a@example.com', true)).toBe(false);
  });
});

describe('persistent editor interactions', () => {
  it('does not rewrite on open/source toggles or rebuild on an acknowledgement', () => {
    const source = '## 标题\n\n正文  \n下一行\n';
    const { model, editor, change } = create(source);
    expect(editor.can().undo()).toBe(false);
    model.toggleSource();
    model.toggleSource();
    expect(editor.can().undo()).toBe(false);
    expect(model.value).toBe(source);
    expect(change).not.toHaveBeenCalled();
    editor.commands.insertContentAt(1, '新');
    const doc = editor.state.doc;
    const selection = editor.state.selection;
    model.replace(model.value);
    expect(editor.state.doc).toBe(doc);
    expect(editor.state.selection).toBe(selection);
    expect(editor.can().undo()).toBe(true);
  });

  it('renders images immediately and preserves Chinese edits and width through reopening', () => {
    const { editor, model } = create('前![图](/api/attachments/demo#w=55)后');
    expect(editor.view.dom.querySelector('img')?.style.width).toBe('55%');
    editor.commands.insertContentAt(1, '中文');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '结尾');
    model.setImageWidth('demo', 40);
    const reopened = create(model.value);
    expect(reopened.editor.view.dom.querySelector('img')?.style.width).toBe('40%');
    expect(reopened.editor.getText()).toContain('中文前');
    expect(reopened.editor.getText()).toContain('后结尾');
  });

  it('maps the upload anchor through typing and keeps the current selection', async () => {
    let resolve!: (value: { url: string }) => void;
    const upload = vi.fn(
      () =>
        new Promise<{ url: string }>((done) => {
          resolve = done;
        })
    );
    const { model, editor } = create('前后', upload);
    editor.commands.setTextSelection(2);
    model.addUpload(new File(['png'], '截图.png', { type: 'image/png' }));
    editor.commands.insertContentAt(1, '继续');
    editor.commands.setTextSelection(1);
    resolve({ url: '/api/attachments/new' });
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.state.selection.from).toBe(1);
    expect(editor.getMarkdown()).toBe('继续前![截图](/api/attachments/new)后');
    editor.commands.undo();
    expect(editor.getText()).toBe('继续前后');
    expect(editor.view.dom.querySelector('img')).toBeNull();
    editor.commands.redo();
    expect(editor.view.dom.querySelector('img')).toBeTruthy();
  });

  it('keeps the mapped anchor on failure and retries without placeholder Markdown', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error('离线'))
      .mockResolvedValueOnce({ url: '/api/attachments/new' });
    const { model, editor } = create('正文', upload);
    editor.commands.setTextSelection(3);
    model.addUpload(new File(['png'], '截图.png', { type: 'image/png' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(model.uploads[0].error).toBe('离线');
    expect(model.value).toBe('正文');
    editor.commands.insertContentAt(1, '新');
    await model.retryUpload(model.uploads[0].id);
    expect(model.value).toBe('新正文![截图](/api/attachments/new)');
  });

  it('deletes and undoes a body image without an attachment API call', () => {
    const { editor, upload } = create('前![图](/api/attachments/demo)后');
    editor.commands.setNodeSelection(2);
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.deleteSelection();
    expect(editor.getMarkdown()).toBe('前后');
    editor.commands.undo();
    expect(editor.getMarkdown()).toContain('/api/attachments/demo');
    expect(upload).not.toHaveBeenCalled();
  });

  it('supports screenshot paste, source editing and safe HTML paste', async () => {
    const { model, editor, upload } = create('正文');
    render(<DetailEditor getModel={() => model} />);
    fireEvent.paste(screen.getByRole('textbox', { name: '正文内容' }), {
      clipboardData: { files: [new File(['png'], '截图.png', { type: 'image/png' })], getData: () => '' }
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(upload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown 源码' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 内容' }), {
      target: { value: '# 新标题' }
    });
    fireEvent.click(screen.getByRole('button', { name: '返回图文' }));
    expect(editor.view.dom.querySelector('h1')?.textContent).toBe('新标题');
    const clean = editor.view.someProp('transformPastedHTML', (fn) =>
      fn('<img src="javascript:alert(1)" onerror="alert(1)"><script>x</script>', editor.view)
    );
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<script');
  });

  it('publishes a Chinese composition only when committed, including a fast close', () => {
    const { model, editor, change } = create('正文');
    render(<DetailEditor getModel={() => model} />);
    fireEvent.compositionStart(screen.getByRole('textbox', { name: '正文内容' }));
    act(() => {
      editor.commands.insertContentAt(1, '中文');
    });
    expect(change).not.toHaveBeenCalled();
    act(() => {
      model.flushComposition();
    });
    expect(change).toHaveBeenCalledWith('中文正文');
    fireEvent.compositionEnd(screen.getByRole('textbox', { name: '正文内容' }));
  });
});
