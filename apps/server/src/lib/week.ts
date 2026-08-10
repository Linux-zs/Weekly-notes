const DAY_MS = 86_400_000;

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function utcDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }

export function shanghaiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function isoWeekForDate(dateValue: string) {
  const date = utcDate(dateValue);
  const day = date.getUTCDay() || 7;
  const thursday = new Date(date.getTime() + (4 - day) * DAY_MS);
  const weekYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * DAY_MS);
  const weekNumber = Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * DAY_MS)) + 1;
  return { weekYear, weekNumber };
}

export function isoWeekRange(weekYear: number, weekNumber: number) {
  if (weekNumber < 1 || weekNumber > 53) throw new Error('Invalid ISO week');
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * DAY_MS + (weekNumber - 1) * 7 * DAY_MS);
  const actual = isoWeekForDate(isoDate(monday));
  if (actual.weekYear !== weekYear || actual.weekNumber !== weekNumber) throw new Error('Invalid ISO week');
  return { weekStart: isoDate(monday), weekEnd: isoDate(new Date(monday.getTime() + 6 * DAY_MS)) };
}

export function currentIsoWeek() { return isoWeekForDate(shanghaiToday()); }
