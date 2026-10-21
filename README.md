# 周笺

一个面向个人与小团队的周报 Web 应用。支持多项目周报、团队邀请与空间切换、标签搜索、Markdown、汇报复制、OIDC/OAuth 登录、中国法定节假日调休和包含附件的自动备份等。

## 技术栈

- React 19、TypeScript、Vite、React Router、TanStack Query、Tailwind CSS、Radix UI
- Node.js 24、Fastify、Drizzle ORM、better-sqlite3、Zod
- Google / Microsoft OIDC，GitHub OAuth 2.0
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
```

- Google：创建 Web OAuth Client，只请求 `openid profile email`。
- Microsoft：应用账号类型选择“任意组织目录和个人 Microsoft 账号”，服务端使用 `common`。如需按邮箱自动接受团队邀请，请在应用的 ID Token 可选声明中配置 `email`、`verified_primary_email` 和 `xms_edov`；普通 `preferred_username` 不作为邀请授权依据。
- GitHub：创建 OAuth App，只请求 `read:user user:email`。

不要提交 `.env`、Client Secret、SQLite 数据库或备份文件。

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
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

`TRUST_PROXY=true` 仅信任紧邻应用的一层反向代理。应用端口应仅由该代理访问；代理必须覆盖客户端传入的 `X-Forwarded-For`。多层代理需另行配置明确的信任边界。

数据和备份分别挂载到 `runtime/data`、`runtime/backups`。每天北京时间 03:00 创建包含 SQLite 与上传图片的完整备份包，保留 30 天。

手动备份：

```bash
docker compose exec -T app node apps/server/dist/scripts/backup.js
```

恢复时先停止服务，确认容器已退出，再将整个当前数据目录（包括可能存在的 WAL/SHM 文件）保留到独立目录。不要将备份主库覆盖到带有旧 WAL 的目录，也不要直接删除旧 WAL：

```bash
docker compose stop app
mv runtime/data "runtime/data.before-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p runtime/data
cp runtime/backups/zhoubao-<timestamp>/zhoubao.sqlite runtime/data/zhoubao.sqlite
cp -r runtime/backups/zhoubao-<timestamp>/uploads runtime/data/uploads
docker compose start app
```

启动前检查备份的 `manifest.json`、数据库与附件是否齐全，并确认新目录权限允许容器用户读写。原数据目录在验证恢复成功前应完整保留。若修改过 Compose 的数据路径，以上路径也需对应调整。

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

## 邮箱注册与密码登录（mailx）

邮箱注册需要验证码，验证通过后自动登录；之后使用邮箱和密码登录。密码至少 12 个字符，使用带随机盐的 scrypt 存储；验证码仅保存 HMAC，10 分钟有效、60 秒重发间隔、最多 5 次校验。发送按邮箱每小时 5 次、IP 每小时 10 次限流，密码登录按来源 IP 每 15 分钟 30 次限流，同一 IP 与邮箱组合最多允许 10 次失败，并对失败请求施加渐进延迟；成功后清除此组合的失败计数，其他 IP 的失败不会锁定该邮箱。限流与验证码保存在 SQLite，重启不会清空。第三方同邮箱账号不会自动合并，验证后的邮箱账号可以接受有效空间邀请。本次不包含忘记密码或邮箱账号绑定入口。

在 `.env` 中配置：

```dotenv
EMAIL_AUTH_ENABLED=true
EMAIL_CODE_SECRET=<独立随机密钥，至少32个字符>
MAILX_PATH=mailx
```

可用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成密钥。不要提交密钥或 SMTP 密码。更换验证码密钥会使尚未使用的验证码失效，不影响已有密码。

支持带 `-S sendwait` 的 s-nail/mailx；生产 Dockerfile 已安装 s-nail 并提供 `mailx` 别名。SMTP 配置由运行服务的用户的 mailrc 管理，应用不接收 SMTP 凭证。示例配置（s-nail 14.9，按邮件服务商修改）：

```text
set v15-compat
set mta=smtp://smtp.example.com:587
set smtp-use-starttls
set smtp-auth=login
set smtp-auth-user=mailer@example.com
set smtp-auth-password="REPLACE_WITH_SMTP_APP_PASSWORD"
set from="mailer@example.com"
set ssl-verify=strict
set sendwait
```

将配置保存在部署机受限权限文件（例如 `chmod 600 runtime/mailrc`），在 Compose 的 app volumes 中增加 `./runtime/mailrc:/root/.mailrc:ro`。若容器改为非 root 用户，挂载到该用户的 HOME 下。主机原生运行则配置服务用户的 `~/.mailrc`。配置方法参考 [s-nail 官方手册](https://www.sdaoden.eu/code-nail.html)。Windows 开发机未安装 mailx 时保持关闭；测试使用隔离数据库和模拟邮件，不发送真实验证码。

启用前在同一容器或服务用户下用测试邮箱验证 SMTP 投递；mailx 成功退出仅表示 SMTP/MTA 接受，并不能保证邮件最终到达收件箱。冷却期拒绝不扣发送额度；发送额度与验证码状态在同一事务内预留。进程失败或 15 秒超时返回发送失败且使本次验证码失效，并退还原限流窗口的本次额度，不扣减新窗口计数。应用不会记录密码或验证码，也不会在 API 响应中回传验证码。数据库迁移在服务启动时自动执行，部署前按现有流程备份数据库。
