async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const body = page.getByRole('textbox', { name: '正文内容' });
  await body.getByText('图片前后均可继续输入中文。', { exact: true }).click();
  await page.keyboard.press('End');
  // Synthetic clipboard dispatch must wait for the browser's native selectionchange event.
  await page.waitForTimeout(150);
  await body.evaluate(el => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array([137, 80, 78, 71])], '截图.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await page.getByText('图片上传中…', { exact: true }).waitFor();
  await page.keyboard.press('Home');
  await page.waitForTimeout(150);
  await page.keyboard.insertText('上传期间继续输入中文');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: /本周交付 完成/ }).click();
  await body.getByRole('img', { name: '截图', exact: true }).waitFor();
  if (!(await body.innerText()).includes('上传期间继续输入中文')) throw new Error('Typing during upload lost');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  const source = await page.getByRole('textbox', { name: 'Markdown 内容' }).inputValue();
  if (!source.includes('上传期间继续输入中文图片前后均可继续输入中文。![截图](/api/attachments/uploaded)')) throw new Error('Upload anchor not mapped: ' + source);
  if (!source.includes('/api/attachments/preview-image')) throw new Error('Original image lost');
  await page.getByRole('button', { name: '返回图文' }).click();
  console.log('PASS: screenshot paste, type during upload, close while pending, mapped insertion, save/reopen');
}
