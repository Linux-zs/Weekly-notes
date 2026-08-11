import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';

const holidaySchema = z.object({
  year: z.number().int().min(2000).max(2200),
  sourceUrl: z.url(),
  days: z.array(
    z.object({
      date: z.iso.date(),
      kind: z.enum(['holiday', 'adjusted_workday']),
      name: z.string().min(1),
      note: z.string().optional()
    })
  )
});

export function importHolidayYear(year: number) {
  const file = path.resolve(config.holidayDataDir, `cn/${year}.json`);
  if (!fs.existsSync(file)) throw new Error(`${year} 年节假日数据文件不存在`);
  const data = holidaySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (data.year !== year) throw new Error('文件年份与数据年份不一致');
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM calendar_days WHERE source_year=?').run(data.year);
    const insert = sqlite.prepare(
      'INSERT INTO calendar_days(date,kind,name,source_year,source_url,note) VALUES(?,?,?,?,?,?)'
    );
    data.days.forEach((day) =>
      insert.run(day.date, day.kind, day.name, data.year, data.sourceUrl, day.note ?? null)
    );
  })();
  return { year: data.year, count: data.days.length, sourceUrl: data.sourceUrl };
}
