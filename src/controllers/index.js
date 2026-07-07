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
  const website = ctx.config.get("website");
  ctx.body = {
    name: website.title,
    avatar: "",
    desc: website.copyright,
    rtl: false
  };
};
