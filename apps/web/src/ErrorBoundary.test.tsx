// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('offers recovery when a child cannot render', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): never {
    throw new Error('chunk failed');
  }
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>
  );
  expect(screen.getByRole('alert').textContent).toContain('页面暂时无法显示');
  expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy();
});
