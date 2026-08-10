import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { sqlite } from '../db/index.js';
import { workspaceRoot } from '../config.js';

const schema=z.object({year:z.number().int(),sourceUrl:z.url(),days:z.array(z.object({date:z.iso.date(),kind:z.enum(['holiday','adjusted_workday']),name:z.string().min(1),note:z.string().optional()}))});
const year=process.argv[2]??String(new Date().getFullYear());
const file=path.resolve(workspaceRoot,`data/holidays/cn/${year}.json`);
const data=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')));
if(String(data.year)!==year)throw new Error('Filename year does not match JSON year');
sqlite.transaction(()=>{sqlite.prepare('DELETE FROM calendar_days WHERE source_year=?').run(data.year);const insert=sqlite.prepare('INSERT INTO calendar_days(date,kind,name,source_year,source_url,note) VALUES(?,?,?,?,?,?)');data.days.forEach(day=>insert.run(day.date,day.kind,day.name,data.year,data.sourceUrl,day.note??null));})();
console.log(`Imported ${data.days.length} calendar overrides for ${year}.`);
