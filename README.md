# 周笺

一个面向个人与小团队的周报 Web 应用。支持多项目周报、团队邀请与空间切换、标签搜索、Markdown、素材转换、汇报复制/打印、OIDC/OAuth 登录、中国法定节假日调休和包含附件的自动备份。

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

生产构建默认监听 `http://127.0.0.1:3000`。

## 生产配置

复制 `.env.example` 为 `.env`，至少修改：

```dotenv
NODE_ENV=production
APP_ORIGIN=https://weekly.example.com
TRUST_PROXY=true
OWNER_BOOTSTRAP_EMAIL=owner@example.com
DEV_AUTH_BYPASS=false
```

`APP_ORIGIN` 必须和身份平台登记的 HTTPS Origin 完全一致。首次登录只允许 `OWNER_BOOTSTRAP_EMAIL` 对应、且邮箱已验证的 Google 身份创建所有者；初始化以后，新身份只能在设置页绑定。

### 回调地址

```text
https://weekly.example.com/auth/google/callback
https://weekly.example.com/auth/microsoft/callback
https://weekly.example.com/auth/github/callback
https://weekly.example.com/auth/apple/callback
```

- Google：创建 Web OAuth Client，只请求 `openid profile email`。
- Microsoft：应用账号类型选择“任意组织目录和个人 Microsoft 账号”，服务端使用 `common`。
- GitHub：创建 OAuth App，只请求 `read:user user:email`。
- Apple：当前默认关闭。获得 Apple Developer Program 后配置 Services ID、域名、Return URL、Team ID、Key ID 和 ES256 私钥，再设置 `APPLE_ENABLED=true`。

不要提交 `.env`、Apple 私钥、Client Secret、SQLite 数据库或备份文件。

## Docker 与反向代理

```bash
docker compose up -d --build
docker compose exec app pnpm holiday:import <year>
```

Compose 只绑定 `127.0.0.1:3000`。Nginx 示例：

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
docker compose exec app pnpm db:backup
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

年度文件位于 `data/holidays/cn/<year>.json`，只保存法定节假日和调休上班覆盖项；普通周末由应用推导。

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
