import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { weeksInIsoYear } from './lib';

export function WeekNavigator({
  year,
  selectedWeek,
  current,
  weeks,
  onSelect
}: {
  year: number;
  selectedWeek: number;
  current: { year: number; week: number };
  weeks: Array<{ weekNumber: number; itemCount: number }>;
  onSelect: (week: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
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
            <span className="picker-legend-filled">有内容</span>
          </div>
          <div className="week-picker-grid">
            {Array.from({ length: total }, (_, index) => index + 1).map((number) => {
              const selected = number === selectedWeek;
              const isCurrent = year === current.year && number === current.week;
              const hasContent = populated.has(number);
              return (
                <button
                  key={number}
                  ref={selected ? selectedRef : undefined}
                  className={`week-picker-day${selected ? ' selected' : ''}${isCurrent ? ' current' : ''}${hasContent ? ' has-report' : ''}`}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={`第 ${number} 周${hasContent ? '，有周报内容' : '，暂无周报内容'}${isCurrent ? '，本周' : ''}`}
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
