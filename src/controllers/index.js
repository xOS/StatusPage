import { normalizeDays } from "../services/uptimerobot";

export const Index = async ctx => {
  await ctx.render("index", {
    config: ctx.config.get("website"),
    data: await ctx.services.uptimerobot.list()
  });
};

const REFRESH_TOKEN_ENV_KEYS = ["CACHE_REFRESH_TOKEN", "CRON_SECRET", "REFRESH_TOKEN"];

export const Status = async ctx => {
  const days = normalizeDays(ctx.query.days || 90);
  ctx.set("X-Status-Days", String(days));

  const status = await ctx.services.uptimerobot.statusPage(days);
  if (status.meta && status.meta.warming) {
    ctx.status = 202;
    ctx.set("Cache-Control", "no-store");
  } else {
    ctx.set("Cache-Control", "public, max-age=15, s-maxage=60, stale-while-revalidate=604800");
  }

  ctx.body = status;
};

export const Refresh = async ctx => {
  const days = normalizeDays(ctx.query.days || 90);
  ctx.set("Cache-Control", "no-store");

  if (!isRefreshAuthorized(ctx, false)) {
    ctx.status = 401;
    ctx.body = { message: "Unauthorized cache refresh." };
    return;
  }

  if (ctx.query.wait === "1" || ctx.query.wait === "true") {
    const status = await ctx.services.uptimerobot.refreshStatusPageCache(days);

    ctx.body = refreshSummary(status, days);
    return;
  }

  scheduleRefresh(ctx, ctx.services.uptimerobot.refreshStatusPageCache(days));
  ctx.status = 202;
  ctx.body = {
    ok: true,
    accepted: true,
    days,
    savedAt: Date.now()
  };
};

export const Info = async ctx => {
  const site = normalizeSiteInfo(ctx.config.get("website"));

  ctx.body = {
    name: site.title,
    avatar: site.avatar,
    desc: site.footer.owner,
    rtl: site.rtl,
    site
  };
};

const PROJECT_URL = "https://github.com/xOS/StatusPage";

function normalizeSiteInfo(website = {}) {
  const home = website.home || {};
  const github = website.github || {};
  const footer = website.footer || {};
  const title = website.title || "服务状态";
  const owner = footer.owner || website.copyright || "楠格";

  return {
    title,
    avatar: website.avatar || "",
    rtl: website.rtl === true || website.rtl === "true",
    home: {
      label: home.label || "主页",
      href: home.href || "/"
    },
    github: {
      href: github.href || "https://github.com/xOS"
    },
    footer: {
      title: footer.title || title,
      description: footer.description || "由 UptimeRobot 数据驱动，自动缓存并动态更新。",
      owner,
      ownerUrl: footer.ownerUrl || footer.owner_url || "https://www.nange.cn",
      projectUrl: PROJECT_URL
    }
  };
}

function isRefreshAuthorized(ctx, allowWithoutToken) {
  if (ctx.get("x-vercel-cron-schedule") || ctx.get("user-agent") === "vercel-cron/1.0") {
    return true;
  }

  const token = REFRESH_TOKEN_ENV_KEYS.map(key => process.env[key]).find(Boolean);
  if (!token) return allowWithoutToken;

  const auth = ctx.get("authorization");
  return auth === `Bearer ${token}` || ctx.query.token === token;
}

function refreshSummary(status, days) {
  return {
    ok: true,
    days,
    savedAt: Date.now(),
    groups: Object.keys(status.monitors || {}).length,
    monitors: Object.values(status.monitors || {}).reduce((sum, monitors) => sum + monitors.length, 0),
    logs: (status.logs || []).length
  };
}

function scheduleRefresh(ctx, promise) {
  const guarded = promise.catch(() => {});
  if (ctx.req && typeof ctx.req.waitUntil === "function") {
    ctx.req.waitUntil(guarded);
    return;
  }

  guarded.catch(() => {});
}
