export const Index = async ctx => {
  await ctx.render("index", {
    config: ctx.config.get("website"),
    data: await ctx.services.uptimerobot.list()
  });
};

const REFRESH_TOKEN_ENV_KEYS = ["CACHE_REFRESH_TOKEN", "CRON_SECRET", "REFRESH_TOKEN"];

export const Status = async ctx => {
  const days = Number(ctx.query.days || 90);
  ctx.set("Cache-Control", "public, max-age=15, s-maxage=60, stale-while-revalidate=604800");

  if (isRefreshAuthorized(ctx, false)) {
    ctx.body = await ctx.services.uptimerobot.refreshStatusPageCache(days);
    return;
  }

  ctx.body = await ctx.services.uptimerobot.statusPage(days);
};

export const Refresh = async ctx => {
  const days = Number(ctx.query.days || 90);
  ctx.set("Cache-Control", "no-store");

  if (!isRefreshAuthorized(ctx, false)) {
    ctx.status = 401;
    ctx.body = { message: "Unauthorized cache refresh." };
    return;
  }

  const [status] = await Promise.all([
    ctx.services.uptimerobot.refreshStatusPageCache(days),
    ctx.services.uptimerobot.prefetchList()
  ]);

  ctx.body = {
    ok: true,
    days,
    savedAt: Date.now(),
    status
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
