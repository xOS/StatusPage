# Changelog

## 当前集成版

* 将 `/Users/Me/GitHub/status` 的 Vue/Vite UI 合并为主项目 `frontend/` 子目录。
* 前端数据源改为主项目后端 `/api/status`，浏览器端不再保存 UptimeRobot API key。
* 移除旧 UI 的侧栏、个人资料卡、Cloudflare Worker、KV 和 backup 回调说明。
* 保留状态分组、响应时间图、90 天可用率、宕机日志和页脚。
* 构建产物统一输出到 `frontend/dist`，由 Koa、Vercel 或 Cloudflare Pages 托管。
