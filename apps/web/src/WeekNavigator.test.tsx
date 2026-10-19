// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeekNavigator } from './WeekNavigator';
afterEach(cleanup);
describe('glass week picker', () => {
  it.each([
    [2026, 53],
    [2025, 52]
  ])('shows all weeks for %s and restores focus on Escape', async (year, total) => {
    render(
      <WeekNavigator
        year={year}
        selectedWeek={42}
        current={{ year, week: 42 }}
        weeks={[
          { weekNumber: 42, itemCount: 2 },
          { weekNumber: 41, itemCount: 0 }
        ]}
        onSelect={vi.fn()}
      />
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /选择周次/ });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button', { name: /^第 / })).toHaveLength(total);
    const selected = within(dialog).getByRole('button', { name: '第 42 周，有周报内容，本周' });
    expect(selected.getAttribute('aria-current')).toBe('page');
    expect(selected.classList.contains('current')).toBe(true);
    expect(selected.querySelector('i')).not.toBeNull();
    expect(document.activeElement).toBe(selected);
    expect(
      within(dialog).getByRole('button', { name: '第 41 周，暂无周报内容' }).querySelector('i')
    ).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('selects a week with the keyboard, closes, and supports the close button', async () => {
    const onSelect = vi.fn();
    render(
      <WeekNavigator
        year={2026}
        selectedWeek={53}
        current={{ year: 2025, week: 53 }}
        weeks={[]}
        onSelect={onSelect}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /选择周次/ }));
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭周次选择' }));
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '第 1 周，暂无周报内容' }));
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /选择周次/ }));
    await user.click(screen.getByRole('button', { name: '关闭周次选择' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
