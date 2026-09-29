import { Node, type JSONContent, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from '@tiptap/markdown';
import { marked } from 'marked';

export function safeEditorUrl(value: unknown, image = false): boolean {
  if (
    typeof value !== 'string' ||
    !value ||
    [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127 || c === '\\')
  )
    return false;
  if (value.startsWith('//')) return false;
  return (
    /^(https?:\/\/)/i.test(value) || (!image && /^(mailto:|tel:)/i.test(value)) || !/^[^/?#]*:/.test(value)
  );
}

export function imageWidth(src: string) {
  return Math.min(100, Math.max(25, Number(src.match(/#w=(\d{1,3})$/)?.[1] ?? 70)));
}

// An opaque, inert node: unsupported source is never interpreted as HTML.
const RawMarkdown = Node.create({
  name: 'rawMarkdown',
  group: 'block',
  atom: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    'pre',
    { class: 'raw-markdown', title: '原文保留块，请通过 Markdown 源码修改' },
    ['code', {}, node.attrs.source]
  ],
  renderMarkdown: (node) => node.attrs?.source ?? ''
});

const DetailImage = Image.extend({
  renderHTML({ node }) {
    const { src, alt, title } = node.attrs;
    return [
      'img',
      {
        ...(safeEditorUrl(src, true) ? { src } : {}),
        alt: alt ?? '',
        title: title || '双击全屏查看',
        style: `width:${imageWidth(src ?? '')}%;height:auto`
      }
    ];
  },
  renderMarkdown(node) {
    const escape = (s: string) => s.replace(/[\\[\]]/g, '\\$&');
    const src = String(node.attrs?.src ?? '')
      .replace(/>/g, '%3E')
      .replace(/</g, '%3C');
    const title = node.attrs?.title ? ` "${String(node.attrs.title).replace(/[\\"]/g, '\\$&')}"` : '';
    return `![${escape(node.attrs?.alt ?? '')}](${/[()\s]/.test(src) ? `<${src}>` : src}${title})`;
  }
}).configure({ inline: true });

export function detailExtensions() {
  return [
    StarterKit.configure({
      underline: false,
      link: { openOnClick: false, autolink: false, isAllowedUri: (url) => safeEditorUrl(url) }
    }),
    DetailImage,
    TableKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    RawMarkdown,
    Markdown
  ];
}

function unsafeNodes(node: JSONContent): boolean {
  return (
    (node.type === 'image' && !safeEditorUrl(node.attrs?.src, true)) ||
    Boolean(node.marks?.some((mark) => mark.type === 'link' && !safeEditorUrl(mark.attrs?.href))) ||
    Boolean(node.content?.some(unsafeNodes))
  );
}

function semanticHtml(md: string) {
  const doc = new DOMParser().parseFromString(marked.parse(md, { async: false }) as string, 'text/html');
  // Ignore formatting whitespace between block elements, but preserve code and inline spacing.
  const visit = (el: Element) => {
    if (el.matches('pre,code')) return;
    for (const child of Array.from(el.childNodes)) {
      if (
        child.nodeType === 3 &&
        !child.textContent?.trim() &&
        /^(BODY|UL|OL|TABLE|THEAD|TBODY|TR|BLOCKQUOTE)$/.test(el.tagName)
      )
        child.remove();
      else if (child instanceof Element) visit(child);
    }
  };
  visit(doc.body);
  return doc.body.innerHTML.trim();
}

/** Guard the Beta parser with a semantic round trip, falling back per source block. */
export function parseDetailMarkdown(editor: Editor, source: string): JSONContent {
  const manager = editor.markdown!;
  const raw = (text: string): JSONContent => ({ type: 'rawMarkdown', attrs: { source: text } });
  const tokens = marked.lexer(source);
  // Definitions can be unused or shared. Rendering equivalence cannot prove they survived.
  if (Object.keys(tokens.links).length) return { type: 'doc', content: [raw(source)] };
  const blocks = tokens.filter((t) => t.type !== 'space').map((t) => t.raw);
  const content = blocks.flatMap((block) => {
    try {
      // Tokens own their separator newlines; do not import those as extra empty paragraphs.
      const parsed = manager.parse(block.replace(/\n+$/, ''));
      const wrapImages = (node: JSONContent) => {
        if (!node.content) return;
        if (
          ['doc', 'blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader'].includes(node.type ?? '')
        )
          node.content = node.content.map((child) =>
            child.type === 'image' ? { type: 'paragraph', content: [child] } : child
          );
        node.content.forEach(wrapImages);
      };
      wrapImages(parsed);
      const validated = editor.schema.nodeFromJSON(parsed);
      validated.check();
      const output = manager.serialize(validated.toJSON());
      let hasHtml = false;
      marked.walkTokens(marked.lexer(block), (token) => {
        if (token.type === 'html') hasHtml = true;
      });
      if (unsafeNodes(parsed) || hasHtml || semanticHtml(block) !== semanticHtml(output)) return [raw(block)];
      return parsed.content ?? [];
    } catch {
      return [raw(block)];
    }
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
