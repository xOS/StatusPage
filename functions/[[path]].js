const DAYS = 90;
const DEFAULT_STATUSES = "2-9";
const CACHE_TTL_MS = 60 * 1000;
const CACHE_STALE_TTL_MS = 10 * 60 * 1000;
const RESPONSE_TIMES_LIMIT = 48;
const PROJECT_URL = "https://github.com/xOS/StatusPage";

let cached;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/status") {
      const days = Number(url.searchParams.get("days") || DAYS);
      const now = Date.now();
      const cacheKey = `status:${days}`;

      if (!cached || cached.key !== cacheKey || cached.staleAt <= now) {
        cached = {
          key: cacheKey,
          expiresAt: now + Number(env.CACHE_TTL_MS || CACHE_TTL_MS),
          staleAt: now + Number(env.CACHE_STALE_TTL_MS || CACHE_STALE_TTL_MS),
          data: await fetchStatus(env, days)
        };
      } else if (cached.expiresAt <= now && !cached.refreshing) {
        cached.refreshing = true;
        const refresh = fetchStatus(env, days)
          .then(data => {
            const refreshedAt = Date.now();
            cached = {
              key: cacheKey,
              expiresAt: refreshedAt + Number(env.CACHE_TTL_MS || CACHE_TTL_MS),
              staleAt: refreshedAt + Number(env.CACHE_STALE_TTL_MS || CACHE_STALE_TTL_MS),
              data
            };
          })
          .catch(() => {
            cached.refreshing = false;
          });

        context.waitUntil(refresh);
      }

      return json(cached.data, {
        "cache-control": "no-store"
      });
    }

    if (url.pathname === "/api/info") {
      return json(siteInfoFromEnv(env));
    }

    return env.ASSETS.fetch(request);
  } catch (err) {
    return json({ message: err.message }, {}, 500);
  }
}

function siteInfoFromEnv(env) {
  const title = env.WEBSITE_TITLE || "服务状态";
  const owner = env.WEBSITE_FOOTER_OWNER || env.WEBSITE_COPYRIGHT || "楠格";
  const site = {
    title,
    avatar: env.WEBSITE_AVATAR || "",
    rtl: env.WEBSITE_RTL === "true",
    home: {
      label: env.WEBSITE_HOME_LABEL || "主页",
      href: env.WEBSITE_HOME_URL || "/"
    },
    github: {
      href: env.WEBSITE_GITHUB_URL || "https://github.com/xOS"
    },
    footer: {
      title: env.WEBSITE_FOOTER_TITLE || title,
      description: env.WEBSITE_FOOTER_DESCRIPTION || "由 UptimeRobot 数据驱动，自动缓存并动态更新。",
      owner,
      ownerUrl: env.WEBSITE_FOOTER_OWNER_URL || "https://www.nange.cn",
      projectUrl: PROJECT_URL
    }
  };

  return {
    name: site.title,
    avatar: site.avatar,
    desc: site.footer.owner,
    rtl: site.rtl,
    site
  };
}

async function fetchStatus(env, days) {
  const apiKey = env.UPTIME_ROBOT_API;
  if (!apiKey) {
    throw new Error("UptimeRobot API key must be provided.");
  }

  const { dates, ranges, start, end } = uptimeRanges(days);
  ranges.push(`${start}_${end}`);

  const body = new URLSearchParams({
    api_key: apiKey,
    format: "json",
    logs: "1",
    log_types: "1-2",
    response_times: "1",
    response_times_limit: String(env.UPTIME_ROBOT_RESPONSE_TIMES_LIMIT || RESPONSE_TIMES_LIMIT),
    logs_start_date: String(start),
    logs_end_date: String(end),
    custom_uptime_ranges: ranges.join("-"),
    statuses: env.UPTIME_ROBOT_STATUSES || DEFAULT_STATUSES
  });

  const response = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`UptimeRobot request failed with ${response.status}.`);
  }

  const result = await response.json();
  if (result.stat !== "ok") {
    throw new Error(result.error?.message || "UptimeRobot request failed.");
  }

  return transformMonitors(result.monitors || [], dates, env.UPTIME_ROBOT_NAME_PATTERN);
}

function transformMonitors(monitors, dates, pattern) {
  const data = {
    monitors: {},
    logs: []
  };
  const parser = pattern ? createParser(pattern) : null;

  for (const monitor of monitors) {
    const ranges = String(monitor.custom_uptime_ranges || "").split("-");
    const average = formatNumber(ranges.pop());
    const dailyMap = {};
    const daily = dates.map((date, index) => {
      dailyMap[dateKey(date)] = index;
      return {
        date: formatIsoDate(date),
        uptime: formatNumber(ranges[index]),
        down: {
          times: 0,
          duration: 0
        }
      };
    });
    const total = {
      times: 0,
      duration: 0
    };
    const parsed = parseOptions(monitor.friendly_name || "");
    const parsedName = parseMonitorName(parser, parsed.name);

    for (const log of monitor.logs || []) {
      if (log.type !== 1) continue;

      const logDate = fromUnix(log.datetime);
      const index = dailyMap[dateKey(logDate)];
      total.times++;
      total.duration += log.duration || 0;

      if (index !== undefined) {
        daily[index].down.times++;
        daily[index].down.duration += log.duration || 0;
      }

      data.logs.push({
        name: parsedName.name,
        datetime: formatDateTime(logDate),
        duration: log.duration,
        reason: {
          code: log.reason && log.reason.code,
          detail: log.reason && log.reason.detail
        }
      });
    }

    const item = {
      id: monitor.id,
      name: parsedName.name,
      url: monitor.url,
      average,
      daily,
      total,
      status: monitor.status === 2 ? "ok" : monitor.status === 9 ? "down" : "unknow",
      opts: parsed.opts,
      response_times: monitor.response_times || []
    };
    const groupName = item.opts["类别"] || item.opts["分组"] || parsedName.group || "未分类";

    if (!data.monitors[groupName]) {
      data.monitors[groupName] = [];
    }
    data.monitors[groupName].push(item);
  }

  data.logs.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

  return data;
}

function createParser(rule) {
  const names = [];
  const escaped = rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replace(/%group|%index|%name/g, token => {
    const name = token.slice(1);
    names.push(name);
    if (name === "index") return "(\\d+)?";
    return "(.+)";
  });
  const regex = new RegExp(`^${source}$`);

  return {
    parse(value) {
      const matches = value.match(regex);
      if (!matches) return null;

      const result = {};
      names.forEach((name, index) => {
        const matched = matches[index + 1];
        if (name === "index") {
          if (matched !== undefined && matched !== "") {
            result.index = Number(matched);
          }
        } else {
          result[name] = matched;
        }
      });
      return result.group && result.name ? result : null;
    }
  };
}

function parseMonitorName(parser, name) {
  if (!parser) {
    return { group: undefined, name };
  }

  const result = parser.parse(name);
  if (!result) {
    return { group: undefined, name };
  }

  return {
    group: result.group,
    name: result.name
  };
}

function uptimeRanges(days) {
  const today = startOfDay(new Date());
  const dates = [];

  for (let d = 0; d < days; d++) {
    dates.push(addDays(today, -d));
  }

  const ranges = dates.map(date => {
    const end = new Date(addDays(date, 1).getTime() - 1000);
    return `${toUnix(date)}_${toUnix(end)}`;
  });

  return {
    dates,
    ranges,
    start: toUnix(dates[dates.length - 1]),
    end: toUnix(addDays(dates[0], 1))
  };
}

function parseOptions(name) {
  const opts = {};
  const reg = /\$\{(.+?):(.+?)\}/gm;
  let match;

  while ((match = reg.exec(name)) !== null) {
    opts[match[1]] = match[2];
  }

  return {
    name: name.replace(reg, ""),
    opts
  };
}

function json(body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function formatNumber(value) {
  return (Math.floor(Number(value || 0) * 100) / 100).toString();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function fromUnix(value) {
  return new Date(Number(value) * 1000);
}

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

function dateKey(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(date) {
  return `${formatIsoDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
