import DOMPurify from 'dompurify';
import { marked } from 'marked';

export const sectionLabels = {
  completed: '本周完成',
  next_plan: '下周计划',
  risk: '问题与风险',
  other: '其他记录'
} as const;
export const sectionHints = {
  completed: '聚焦关键交付、阶段成果与业务价值',
  next_plan: '明确下一阶段目标、动作与预期结果',
  risk: '列明阻塞、影响范围与需协调事项',
  other: '补充重要信息、会议结论与待跟进事项'
} as const;

const markdownImagePattern = /!\[[^\]]*\]\((?:\\.|[^)])*\)/g;

export function stripMarkdownImages(content: string) {
  return content.replace(markdownImagePattern, '').replace(/<img\b[^>]*>/gi, '');
}

export function attachmentImageWidth(content: string, attachmentId: string) {
  const source = `/api/attachments/${attachmentId}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`${source}(?:#w=(\\d{1,3}))?`));
  if (!match) return null;
  return Math.min(100, Math.max(25, Number(match[1] ?? 70)));
}

export function setAttachmentImageWidth(content: string, attachmentId: string, width: number) {
  const source = `/api/attachments/${attachmentId}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clamped = Math.min(100, Math.max(25, Math.round(width)));
  return content.replace(
    new RegExp(`(!\\[[^\\]]*\\]\\(${source})(?:#w=\\d{1,3})?(\\))`, 'g'),
    `$1#w=${clamped}$2`
  );
}

function prepareMarkdownHtml(content: string, hideImages: boolean, sizeImages: boolean) {
  const html = DOMPurify.sanitize(marked.parse(content || '暂无内容', { async: false }) as string);
  if ((!hideImages && !sizeImages) || typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = document.body.firstElementChild!;
  root.querySelectorAll('img').forEach((image) => {
    if (hideImages) {
      image.remove();
      return;
    }
    const match = image.getAttribute('src')?.match(/#w=(\d{1,3})$/);
    const width = Math.min(100, Math.max(25, Number(match?.[1] ?? 70)));
    image.classList.add('detail-sized-image');
    image.setAttribute('style', `width:${width}%;height:auto`);
    image.setAttribute('title', '双击全屏查看');
  });
  if (hideImages) {
    root.querySelectorAll('p').forEach((paragraph) => {
      if (!paragraph.textContent?.trim() && !paragraph.children.length) paragraph.remove();
    });
    if (!root.textContent?.trim() && !root.children.length)
      root.innerHTML = '<p class="markdown-empty">详见周报详情</p>';
  }
  return root.innerHTML;
}

export function Markdown({
  content,
  className = '',
  hideImages = false,
  sizeImages = false
}: {
  content: string;
  className?: string;
  hideImages?: boolean;
  sizeImages?: boolean;
}) {
  const html = prepareMarkdownHtml(content, hideImages, sizeImages);
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
    new Date(`${value}T00:00:00+08:00`)
  );
}
export function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function isoWeekForDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4day - 1) * 86400000);
  return { year, week: Math.floor((date.getTime() - monday.getTime()) / (7 * 86400000)) + 1 };
}
export function weeksInIsoYear(year: number) {
  return isoWeekForDate(`${year}-12-28`).week;
}
export function todayShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}
export function weekRangeForDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  const start = addDays(value, 1 - day);
  return { weekStart: start, weekEnd: addDays(start, 6) };
}
