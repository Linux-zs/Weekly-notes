import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'zhoubao-api-'));
process.env.NODE_ENV='test';
process.env.DEV_AUTH_BYPASS='true';
process.env.DATABASE_PATH=path.join(testRoot,'test.sqlite');
process.env.BACKUP_DIR=path.join(testRoot,'backups');
process.env.UPLOAD_DIR=path.join(testRoot,'uploads');
process.env.APP_ORIGIN='http://127.0.0.1:3000';

let app:any;let sqlite:any;let cookie='';
beforeAll(async()=>{const module=await import('./app.js');app=await module.buildApp();({sqlite}=await import('./db/index.js'));const login=await app.inject({method:'GET',url:'/auth/dev'});cookie=login.headers['set-cookie'].split(';')[0];});
afterAll(async()=>{await app.close();sqlite.close();fs.rmSync(testRoot,{recursive:true,force:true});});

const headers=()=>({cookie,origin:'http://127.0.0.1:3000'});

describe('authenticated weekly report workflow',()=>{
  it('creates, searches, and converts memo content transactionally',async()=>{
    const project=await app.inject({method:'POST',url:'/api/projects',headers:headers(),payload:{name:'集成测试项目',color:'#456990'}});
    expect(project.statusCode).toBe(201);const projectId=project.json().id;
    const tag=await app.inject({method:'POST',url:'/api/tags',headers:headers(),payload:{name:'测试',color:'#78909C'}});
    expect(tag.statusCode).toBe(201);const tagId=tag.json().id;
    const report=await app.inject({method:'PUT',url:'/api/reports/2026/33',headers:headers(),payload:{}});
    expect(report.statusCode).toBe(200);const reportId=report.json().id;
    const item=await app.inject({method:'POST',url:`/api/reports/${reportId}/items`,headers:headers(),payload:{type:'completed',contentMd:'完成 API 集成测试',projectId,tagIds:[tagId]}});
    expect(item.statusCode).toBe(201);
    const boundary='zhoubao-image-boundary';
    const image=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]);
    const multipart=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`),image,Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const uploaded=await app.inject({method:'POST',url:`/api/report-items/${item.json().id}/images`,headers:{...headers(),'content-type':`multipart/form-data; boundary=${boundary}`},payload:multipart});
    expect(uploaded.statusCode).toBe(201);
    const attachment=await app.inject({method:'GET',url:uploaded.json().url,headers:{cookie}});
    expect(attachment.statusCode).toBe(200);
    expect(attachment.headers['content-type']).toContain('image/png');
    const reportWeeks=await app.inject({method:'GET',url:'/api/report-weeks/2026',headers:headers()});
    expect(reportWeeks.statusCode).toBe(200);
    expect(reportWeeks.json().weeks).toContainEqual({weekNumber:33,itemCount:1});
    const search=await app.inject({method:'GET',url:'/api/search?q=API',headers:headers()});
    expect(search.statusCode).toBe(200);expect(search.json().items).toHaveLength(1);
    const memo=await app.inject({method:'POST',url:'/api/memos',headers:headers(),payload:{title:'待转换卡片',contentMd:'转换内容',projectId,tagIds:[tagId],color:'#F2C66D',pinned:false}});
    expect(memo.statusCode).toBe(201);
    const converted=await app.inject({method:'POST',url:`/api/memos/${memo.json().id}/convert`,headers:headers(),payload:{weekYear:2026,weekNumber:33,type:'next_plan',projectId}});
    expect(converted.statusCode).toBe(201);
    const duplicate=await app.inject({method:'POST',url:`/api/memos/${memo.json().id}/convert`,headers:headers(),payload:{weekYear:2026,weekNumber:33,type:'next_plan',projectId}});
    expect(duplicate.statusCode).toBe(409);
  });
});

describe('production web assets',()=>{
  it('serves the built JavaScript bundle with a JavaScript content type',async()=>{
    const index=await app.inject({method:'GET',url:'/'});
    expect(index.statusCode).toBe(200);
    const assetPath=index.body.match(/src="([^"]+\.js)"/)?.[1];
    expect(assetPath).toBeTruthy();

    const asset=await app.inject({method:'GET',url:assetPath!});
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    expect(asset.body).not.toContain('<!doctype html>');
  });
});
