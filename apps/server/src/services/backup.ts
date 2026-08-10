import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';

export async function createBackup() {
  fs.mkdirSync(config.backupDir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const destination=path.join(config.backupDir,`zhoubao-${stamp}.sqlite`);
  await sqlite.backup(destination);
  const cutoff=Date.now()-30*86_400_000;
  for(const entry of fs.readdirSync(config.backupDir,{withFileTypes:true}))if(entry.isFile()&&entry.name.startsWith('zhoubao-')){const file=path.join(config.backupDir,entry.name);if(fs.statSync(file).mtimeMs<cutoff)fs.unlinkSync(file);}
  return destination;
}

export function scheduleBackups(log:FastifyBaseLogger){let last='';setInterval(async()=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());const hour=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hour12:false}).format(new Date());if(hour==='03'&&last!==day){try{const file=await createBackup();last=day;log.info({file},'Daily SQLite backup complete');}catch(error){log.error({err:error},'Daily SQLite backup failed');}}},60_000).unref();}
