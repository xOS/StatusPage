export const Index = async ctx => {
  await ctx.render("index", {
    config: ctx.config.get("website"),
    data: await ctx.services.uptimerobot.list()
  });
};

export const Status = async ctx => {
  const days = Number(ctx.query.days || 90);
  ctx.body = await ctx.services.uptimerobot.statusPage(days);
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
