import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { weeksInIsoYear } from './lib';

export function WeekNavigator({
  year,
  selectedWeek,
  current,
  weeks,
  contentStatus = 'ready',
  onRetry,
  onSelect
}: {
  year: number;
  selectedWeek: number;
  current: { year: number; week: number };
  weeks: Array<{ weekNumber: number; itemCount: number }>;
  contentStatus?: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  onSelect: (week: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [focusedWeek, setFocusedWeek] = useState(selectedWeek);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const populated = new Set(weeks.filter((week) => week.itemCount > 0).map((week) => week.weekNumber));
  const total = weeksInIsoYear(year);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="week-picker-trigger" aria-label={`选择周次，当前第 ${selectedWeek} 周`}>
          第{selectedWeek}周<ChevronDown size={13} aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="week-picker-overlay" />
        <Dialog.Content
          className="week-picker"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            setFocusedWeek(selectedWeek);
            selectedRef.current?.focus();
          }}
        >
          <div className="week-picker-heading">
            <div>
              <Dialog.Title>{year} 年 · 选择周次</Dialog.Title>
              <Dialog.Description>全年 {total} 周，选择后查看对应周报</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭周次选择">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="week-picker-legend" aria-label="周次状态说明">
            <span className="picker-legend-selected">当前选择</span>
            <span className="picker-legend-current">本周</span>
            {contentStatus === 'ready' && <span className="picker-legend-filled">有内容</span>}
          </div>
          {contentStatus !== 'ready' && (
            <p role="status">
              {contentStatus === 'loading' ? '正在读取周次内容状态…' : '周次内容状态暂不可用，仍可选择周次。'}
              {contentStatus === 'error' && onRetry && (
                <button className="button secondary" onClick={onRetry}>
                  重试
                </button>
              )}
            </p>
          )}
          <div className="week-picker-grid">
            {Array.from({ length: total }, (_, index) => index + 1).map((number) => {
              const selected = number === selectedWeek;
              const isCurrent = year === current.year && number === current.week;
              const hasContent = populated.has(number);
              return (
                <button
                  key={number}
                  ref={(node) => {
                    if (node) buttons.current.set(number, node);
                    else buttons.current.delete(number);
                    if (selected) selectedRef.current = node;
                  }}
                  tabIndex={number === focusedWeek ? 0 : -1}
                  onFocus={() => setFocusedWeek(number)}
                  onKeyDown={(event) => {
                    let target: number;
                    switch (event.key) {
                      case 'ArrowLeft':
                        target = number - 1;
                        break;
                      case 'ArrowRight':
                        target = number + 1;
                        break;
                      case 'ArrowUp':
                        target = number - 7;
                        break;
                      case 'ArrowDown':
                        target = number + 7;
                        break;
                      case 'Home':
                        target = event.ctrlKey ? 1 : number - ((number - 1) % 7);
                        break;
                      case 'End':
                        target = event.ctrlKey ? total : number + 6 - ((number - 1) % 7);
                        break;
                      default:
                        return;
                    }
                    event.preventDefault();
                    buttons.current.get(Math.max(1, Math.min(total, target)))?.focus();
                  }}
                  className={`week-picker-day${selected ? ' selected' : ''}${isCurrent ? ' current' : ''}${hasContent ? ' has-report' : ''}`}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={`第 ${number} 周${contentStatus !== 'ready' ? '，内容状态未知' : hasContent ? '，有周报内容' : '，暂无周报内容'}${isCurrent ? '，本周' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    onSelect(number);
                  }}
                >
                  {number}
                  {hasContent && <i aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
