async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const item = { id: 'preview-item', reportId: 'preview-report', importedFromItemId: null, projectId: 'preview-project', categoryId: null, type: 'completed', contentMd: '## 本周交付\n\n完成 **图文编辑** 与自动保存，记录每一项进展。\n\n![交付进展](/api/attachments/preview-image#w=55)\n\n图片前后均可继续输入中文。\n\n| 工作项 | 状态 |\n| --- | --- |\n| 编辑体验 | 已完成 |\n| 回归验证 | 进行中 |\n\n> 本地验收使用模拟数据，不写入真实周报。', occurredOn: null, progress: 'completed', note: '待团队评审', position: 0, version: 1, tags: [] };
  const report = { id: 'preview-report', weekYear: 2026, weekNumber: 40, weekStart: '2026-09-28', weekEnd: '2026-10-04', version: 1, author: { id: 'preview-user', displayName: '本地验收' }, items: [item], calendarDays: [], holidayDataAvailable: true };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" viewBox="0 0 720 280"><rect width="720" height="280" rx="16" fill="#f1f4f8"/><text x="36" y="52" font-size="24" fill="#24364b" font-family="sans-serif">PROJECT / WEEK 40</text><rect x="36" y="82" width="200" height="150" rx="10" fill="#fff"/><rect x="258" y="82" width="200" height="150" rx="10" fill="#fff"/><rect x="480" y="82" width="204" height="150" rx="10" fill="#fff"/><text x="58" y="138" font-size="14" fill="#65758a">DELIVERED</text><text x="58" y="200" font-size="44" fill="#344b66">12</text><text x="280" y="138" font-size="14" fill="#65758a">IN PROGRESS</text><text x="280" y="200" font-size="44" fill="#344b66">03</text><text x="502" y="138" font-size="14" fill="#65758a">COMPLETION</text><text x="502" y="200" font-size="44" fill="#344b66">80%</text></svg>';
  let uploadCount = 0;
  await page.route('**/api/**', async route => {
    const path = '/' + route.request().url().split('/').slice(3).join('/').split('?')[0];
    const json = data => route.fulfill({ json: data });
    if (path === '/api/me') return json({ user: { id: 'preview-user', displayName: '本地验收', email: null, avatarUrl: null, timezone: 'Asia/Shanghai', workspaceId: 'preview', role: 'owner' } });
    if (path.startsWith('/api/reports/')) return json(report);
    if (path.startsWith('/api/report-weeks/')) return json({ year: 2026, weeks: [{ weekNumber: 40, itemCount: 1 }] });
    if (path === '/api/projects') return json({ projects: [{ id: 'preview-project', name: '产品体验', color: '#CF4F1C', position: 0, archivedAt: null }] });
    if (path === '/api/categories') return json({ categories: [] });
    if (path === '/api/tags') return json({ tags: [] });
    if (path === '/api/report-items/preview-item/attachments') return json({ attachments: [{ id: 'preview-image', originalName: '交付进展.png', sizeBytes: 24500 }, ...(uploadCount ? [{ id: 'uploaded', originalName: '截图.png', sizeBytes: 1000 }] : [])] });
    if (path.startsWith('/api/attachments/')) return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    if (path.endsWith('/images')) { uploadCount++; await page.waitForTimeout(5000); return json({ id: 'uploaded', url: '/api/attachments/uploaded', originalName: '截图.png' }); }
    if (route.request().method() === 'PATCH') {
      Object.assign(item, route.request().postDataJSON(), { version: item.version + 1 }); report.version++;
      return json({ ...item, reportVersion: report.version });
    }
    return json({});
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5173/week/2026/40?item=preview-item');
  await page.getByRole('textbox', { name: '正文内容' }).waitFor();
}
