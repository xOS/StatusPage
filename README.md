# UptimeRobot 状态监测页

基于 UptimeRobot 的中文状态页。项目已合并 `/Users/Me/GitHub/status` 的 Vue UI，前端展示以新版 UI 为主，后端继续使用当前项目的 Koa 服务负责动态拉取、整理和缓存监控数据。

## 当前特性

* Vue + Vite 前端，展示状态分组、响应时间图、90 天可用率和宕机日志。
* 新版 UI 已移除侧栏和个人资料卡，并新增页脚。
* UptimeRobot API key 只保存在后端或平台环境变量中，不暴露给浏览器。
* Koa 常驻部署会通过 cron 预取刷新缓存。
* Vercel 和 Cloudflare Pages 通过函数动态提供 `/api/status`，不是纯静态页面。
* 兼容旧 Pug 页面和 `/api/info`，但新版前端默认只调用 `/api/status`。

## 项目结构

```text
.
├── api/index.js              # Vercel Serverless 入口
├── config/                   # Koa 配置和环境变量映射
├── functions/[[path]].js     # Cloudflare Pages Function
├── frontend/                 # Vue/Vite 前端
├── src/                      # Koa 后端、UptimeRobot 服务、旧 Pug 页面
├── vercel.json               # Vercel 部署配置
└── wrangler.toml             # Cloudflare Pages 部署配置
```

## 环境要求

* Node.js >= 20.13.1 推荐。旧后端可运行在 Node.js >= 16，但前端依赖要求较新的 Node。
* Yarn Classic 1.22.x 用于根项目依赖。
* pnpm 8.15.8 用于前端依赖，构建脚本会通过 `npx pnpm@8.15.8` 自动调用。
* UptimeRobot Read-Only API key。

## 本地构建运行

```bash
yarn install
npm run build
node build/bootstrap
```

默认监听端口来自 `config/default.yml` 的 `app.port`，默认是 `3000`。构建后 Koa 会优先托管 `frontend/dist`，如果前端产物不存在，则回退到旧 Pug 页面。

只开发前端时可单独运行：

```bash
cd frontend
npx pnpm@8.15.8 install --frozen-lockfile
npx pnpm@8.15.8 run dev
```

前端开发环境的 API 地址来自 `frontend/.env.development`，默认请求 `http://localhost:3000`，因此需要同时启动后端。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `UPTIME_ROBOT_API` | 是 | UptimeRobot API key |
| `UPTIME_ROBOT_NAME_PATTERN` | 否 | 旧命名格式兼容解析规则；不设置时默认使用新版 UI 的 `${类别}` / `${分组}` |
| `WEBSITE_TITLE` | 否 | 页面标题，默认 `服务状态` |
| `WEBSITE_COPYRIGHT` | 否 | 兼容旧接口的版权字段 |
| `CACHE_TTL_MS` | 否 | `/api/status` 请求缓存时间，默认 `60000` |
| `CACHE_STALE_TTL_MS` | 否 | 过期缓存可继续返回的时间，默认 `600000` |
| `UPTIME_ROBOT_RESPONSE_TIMES_LIMIT` | 否 | 每个节点响应时间采样点数量，默认 `48` |
| `PORT` | 否 | Koa 监听端口 |
| `LOG_LEVEL` | 否 | 日志级别 |
| `CRON_TIME` | 否 | Koa cron 刷新周期 |

配置加载顺序为：

```text
config/default.yml < config/${NODE_ENV}.yml < 环境变量
```

## API

### `GET /api/status`

新版前端使用的数据接口。默认返回最近 90 天数据，可通过查询参数覆盖：

```http
GET /api/status?days=90
```

返回内容包含：

* `monitors`：按分组整理后的节点状态。
* `logs`：宕机日志，按时间倒序。
* 每个节点的 `daily`、`response_times`、`total`、`average` 和 `status`。

### `GET /api/info`

兼容旧前端的信息接口。新版 UI 不再需要侧栏或个人资料卡，因此默认不调用该接口。

## 节点命名

默认推荐直接在 UptimeRobot 监控名称中使用新版 UI 选项：

```text
监控站${国家:us}${标签:info|Cloudflare}${类别:应用}
```

常用选项：

* `${类别:应用}` 或 `${分组:应用}`：指定前端展示分组。
* `${国家:us}`：显示国家旗帜，值使用 flag-icons 的国家代码。
* `${标签:info|Cloudflare,success|正常}`：显示标签，格式是 `类型|文本`，多个标签用英文逗号分隔。

如果不设置 `${类别}` 或 `${分组}`，节点会进入 `未分类` 分组。

需要兼容旧项目命名时，再设置 `UPTIME_ROBOT_NAME_PATTERN`，例如：

```text
%group/%index/%name
```

对应节点名称：

```text
境内节点/000/北京
境内节点/001/上海
境外节点/100/洛杉矶
境外节点/101/香港
```

当同时存在 `${类别}` / `${分组}` 和旧命名解析结果时，新版 UI 优先使用 `${类别}` / `${分组}`。

## Vercel 部署

项目已内置 Vercel 配置：

* 配置文件：`vercel.json`
* 构建命令：`npm run build`
* 输出目录：`frontend/dist`
* 函数入口：`api/index.js`

至少配置：

```bash
UPTIME_ROBOT_API=你的 UptimeRobot API Key
WEBSITE_TITLE=服务状态
```

Vercel 会托管 `frontend/dist`，并通过 Serverless Function 动态提供 `/api/status`。函数环境没有常驻 cron，数据会在函数实例内按请求缓存，默认 60 秒。

## Cloudflare Pages 部署

项目已内置 Cloudflare Pages 配置：

* 配置文件：`wrangler.toml`
* 构建命令：`npm run build:cloudflare`
* 输出目录：`frontend/dist`
* 动态入口：`functions/[[path]].js`

至少配置：

```bash
YARN_VERSION=1.22.22
UPTIME_ROBOT_API=你的 UptimeRobot API Key
WEBSITE_TITLE=服务状态
```

`YARN_VERSION=1.22.22` 用于让 Cloudflare Pages 使用 Yarn Classic 安装根项目依赖。Cloudflare Pages v3 构建镜像默认使用 Yarn 4，直接安装本项目的 Yarn 1 锁文件会尝试迁移锁文件并导致构建失败。

Cloudflare Pages 会托管 `frontend/dist`，并通过 Pages Function 动态提供 `/api/status`。项目不再使用从旧前端带来的 Worker/KV/backup 接口。

为了避免 UptimeRobot 慢请求阻塞页面，`/api/status` 命中已过期但仍可用的缓存时会先返回旧数据，并在后台刷新。首次冷启动仍需要等待 UptimeRobot 返回数据；监控数量很多时可降低 `UPTIME_ROBOT_RESPONSE_TIMES_LIMIT` 或缩短前端请求的 `days` 参数。

## Docker 部署

```bash
wget https://raw.githubusercontent.com/XOS/StatusPage/master/docker-compose.yml
docker-compose up -d
```

需要自定义配置时，将 `config/` 挂载到容器中，并修改 `config/default.yml` 或通过环境变量覆盖。

## 常用命令

```bash
npm test                 # 后端测试
npm run build:frontend   # 仅构建 Vue 前端
npm run build            # 构建前端、后端和旧静态资源
npm run clean            # 清理 build/
```
