# UptimeRobot 状态监测页

> 一款基于 [UptimeRobot](https://uptimerobot.com/) 中文状态监测页

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/xos/StatusPage/push.yml?logo=github&style=flat-square)
[![GitHub](https://img.shields.io/github/license/xOS/StatusPage?style=flat-square)](https://github.com/XOS/StatusPage/blob/master/LICENSE)

## 修改说明
* 前端改为中文显示；
* 改变页面显示宽度；
* 修改显示数据为最近 60 天（原版 45 天）；
* 增加显示当前日期数据（原版只显示到前一天）；
* Docker 环境时修改时区为东八区；
* 其它布局微调

## 效果展示

![](https://i.qste.com/views/2022/05/25/e3c6f3.png)

## 常规环境下部署使用

```bash
git clone https://github.com/XOS/StatusPage.git && cd StatusPage
yarn install && yarn cache clean
yarn build
```

修改 config/default.yml，然后

```bash
node build/bootstrap
```

## Requirements

* Node.js >= 16
* Uptime Robot API key
* Docker and docker-compose (optional)

## Docker 环境下部署使用

```bash
wget https://raw.githubusercontent.com/XOS/StatusPage/master/docker-compose.yml
docker-compose up -d
```

## Vercel 部署

项目已内置 [Vercel](https://vercel.com/) 配置：

* 配置文件：`vercel.json`
* 构建命令：`npm run build`
* 运行入口：`api/index.js`

在 Vercel 项目环境变量中至少配置：

```bash
UPTIME_ROBOT_API=你的 UptimeRobot API Key
UPTIME_ROBOT_NAME_PATTERN=%group/%index/%name
WEBSITE_TITLE=服务状态
WEBSITE_COPYRIGHT=楠格
```

Vercel 会通过 Serverless Function 动态渲染首页。函数环境不会启动本项目的 cron 任务；数据会在函数实例内按请求缓存。

## Cloudflare Pages 部署

项目已内置 [Cloudflare Pages](https://pages.cloudflare.com/) 动态函数配置：

* 配置文件：`wrangler.toml`
* 构建命令：`npm run build:cloudflare`
* 输出目录：`build/public`
* 动态入口：`functions/[[path]].js`

在 Cloudflare Pages 项目环境变量中至少配置：

```bash
YARN_VERSION=1.22.22
UPTIME_ROBOT_API=你的 UptimeRobot API Key
UPTIME_ROBOT_NAME_PATTERN=%group/%index/%name
WEBSITE_TITLE=服务状态
WEBSITE_COPYRIGHT=楠格
```

`YARN_VERSION=1.22.22` 用于让 Cloudflare Pages 使用 Yarn Classic 安装依赖。Cloudflare Pages v3 构建镜像默认使用 Yarn 4，直接安装本项目的 Yarn 1 锁文件会触发锁文件迁移并导致构建失败。

Cloudflare Pages 会通过 Pages Function 动态请求 UptimeRobot 并渲染首页。函数内默认缓存 60 秒，可通过 `CACHE_TTL_MS` 调整；页脚链接可用 `WEBSITE_LINKS` 配置为 JSON 数组。

## 节点命名格式
如：组名/索引序号/真实节点名（就是要显示的节点名），索引序列号建议用三位数字表示，前前一位数字表示组的序号，最后两位数字表示组内节点的序号。如：

```
境内节点/000/北京，
境内节点/001/上海，
境外节点/100/洛杉矶，
境外节点/101/香港
```

## 节点隐藏与显示
* 显示：直接按照上述格式命名节点名即可显示
* 隐藏：将要隐藏的节点名直接命名为 XXX 等不包含分组名，数字和分隔符等即只要不满足上述节点命名规则即可。

## Docker 环境下部署时自定义主页页脚信息
* 取消注释 docker-compose.yml 第 17 和 18 行：

```bash
    # volumes: 
    #   - ./config:/app/config
```

* 下载项目中的 config 文件夹，修改 default.yml 相关配置。
* docker 环境时自定义配置文件加载有优先级，如：custom-environment-variables.yaml > production.yml > default.yml。
* 注意，docker-compose.yml 和 config 文件夹要在同一目录下。

## Configure

There are two ways to configure:
* config files in `config/*.yml`
* environment variables (map: [config/custom-environment-variables.yaml](config/custom-environment-variables.yaml))

The file loading order is **default.yml < ${NODE_ENV}.yml < environment variables**.
It's recommend to set secrets (e.g. API key) via environment variables and something complex (e.g. array and object) via files.

## Parser Usage

We use the parser to analyze groups name, monitors name and group index (optional) which included in your original monitor's name. 
Default Parser is `%group/%name`, there are 3 variables now: 
  - %group
  - %name
  - %index 

You can change the backslash / to any separator you like, as long as it won't used in your group & monitor name (and index). 
To put index into your parser, you will able to sort your group in page manually. Easily write index for each group once (also for all if you like), and leave the blank of the index for other monitors in the same group.

> There is example:
> **Group Name**/**Index**/**Monitor Name**
> ```
> %group/%index/%name
> ```
> For this format, you should write index in original name at Uptimerobots Control Panel for each group once:
> ```
> GroupA/1/MonitorA
> ```
> And leave the blank of the index for other monitors in the same group.
> ```
> GroupA//MonitorB
> ```
