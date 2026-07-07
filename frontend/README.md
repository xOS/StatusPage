# Frontend

这里是从 `/Users/Me/GitHub/status` 合并进来的 Vue/Vite 前端，已作为主项目的内嵌 UI 使用。

## 当前约定

* 构建产物输出到 `frontend/dist`。
* 运行时数据来自主项目后端的 `/api/status`。
* UptimeRobot API key 只放在主项目后端或部署平台环境变量中。
* 旧前端自带的 Cloudflare Worker、KV、backup 回调和个人资料卡逻辑已移除。
* 新版 UI 不使用侧栏，页脚在 `src/layouts/default.vue` 中维护。

## 开发

```bash
npx pnpm@8.15.8 install --frozen-lockfile
npx pnpm@8.15.8 run dev
```

开发环境默认通过 `frontend/.env.development` 请求 `http://localhost:3000`，因此需要在项目根目录启动后端。

## 构建

从项目根目录执行：

```bash
npm run build:frontend
```

或在本目录执行：

```bash
npx pnpm@8.15.8 run build
```

部署时以根项目的 `README.md` 为准。
