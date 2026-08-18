# 周笺

一个面向个人与小团队的周报 Web 应用。支持多项目周报、团队邀请与空间切换、标签搜索、Markdown、汇报复制、OIDC/OAuth 登录、中国法定节假日调休和包含附件的自动备份。

## 技术栈

- React 19、TypeScript、Vite、React Router、TanStack Query、Tailwind CSS、Radix UI
- Node.js 24、Fastify、Drizzle ORM、better-sqlite3、Zod
- Google / Microsoft / Apple OIDC，GitHub OAuth 2.0
- Docker Compose；由已有 Nginx/Caddy 终止 HTTPS

## 本地运行

要求 Node.js 24 和 pnpm 11。

```bash
pnpm install
pnpm holiday:import <year>
pnpm dev
```

打开 `http://localhost:5173`。开发模式默认显示“进入本地开发环境”，它会创建隔离的本地所有者；生产模式强制禁止该入口。

也可以验证生产构建：

```bash
pnpm build
pnpm start
```

应用进程监听容器内的 `0.0.0.0:3000`。

## 生产配置

复制 `.env.example` 为 `.env`，至少修改：

```dotenv
NODE_ENV=production
APP_ORIGIN=https://weekly.example.com
TRUST_PROXY=true
DEV_AUTH_BYPASS=false
```

`APP_ORIGIN` 必须和身份平台登记的 HTTPS Origin 完全一致。任意已启用身份平台返回的有效账号都可以首次登录；系统会为没有团队邀请的新账号自动创建独立的个人周报空间。团队邀请只用于加入共享空间，不再作为登录前置条件。

### 回调地址

```text
https://weekly.example.com/auth/google/callback
https://weekly.example.com/auth/microsoft/callback
https://weekly.example.com/auth/github/callback
https://weekly.example.com/auth/apple/callback
```

- Google：创建 Web OAuth Client，只请求 `openid profile email`。
- Microsoft：应用账号类型选择“任意组织目录和个人 Microsoft 账号”，服务端使用 `common`。如需按邮箱自动接受团队邀请，请在应用的 ID Token 可选声明中配置 `email`、`verified_primary_email` 和 `xms_edov`；普通 `preferred_username` 不作为邀请授权依据。
- GitHub：创建 OAuth App，只请求 `read:user user:email`。
- Apple：当前默认关闭。获得 Apple Developer Program 后配置 Services ID、域名、Return URL、Team ID、Key ID 和 ES256 私钥，再设置 `APPLE_ENABLED=true`。

不要提交 `.env`、Apple 私钥、Client Secret、SQLite 数据库或备份文件。

## Docker 与反向代理

```bash
docker build -t weekly-notes:latest .
docker compose up -d
docker compose exec -T app node apps/server/dist/scripts/import-holidays.js <year>
```

Compose 只将端口发布到宿主机的 `127.0.0.1:3000`，生产流量应通过 Nginx 或 Caddy 终止 HTTPS 后转发。Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

数据和备份分别挂载到 `runtime/data`、`runtime/backups`。每天北京时间 03:00 创建包含 SQLite 与上传图片的完整备份包，保留 30 天。

手动备份：

```bash
docker compose exec -T app node apps/server/dist/scripts/backup.js
```

恢复时先停止服务，并保留当前数据目录：

```bash
docker compose stop app
cp runtime/data/zhoubao.sqlite runtime/data/zhoubao.before-restore.sqlite
cp runtime/backups/zhoubao-<timestamp>/zhoubao.sqlite runtime/data/zhoubao.sqlite
rm -rf runtime/data/uploads.before-restore
mv runtime/data/uploads runtime/data/uploads.before-restore
cp -r runtime/backups/zhoubao-<timestamp>/uploads runtime/data/uploads
docker compose start app
```

## 节假日数据

源码中的年度文件位于 `data/holidays/cn/<year>.json`，生产镜像会将其复制到不受持久化数据卷影响的只读资源目录。文件只保存法定节假日和调休上班覆盖项；普通周末由应用推导。

```bash
pnpm holiday:import <year>
```

新增年度文件时必须附国务院通知的 `sourceUrl`，导入脚本会验证年份、日期和类型。2026 年数据来源为国务院办公厅国办发明电〔2025〕7号。

## 质量检查

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

健康检查：

- `GET /health/live`：进程存活
- `GET /health/ready`：数据库可以访问

核心接口的集成测试使用独立临时 SQLite 数据库，不读写开发或生产数据。
