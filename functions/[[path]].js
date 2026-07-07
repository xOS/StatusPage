const DISTANCE = 59;
const DEFAULT_PATTERN = "%group/%index/%name";
const DEFAULT_STATUSES = "2-9";
const CACHE_TTL_MS = 60 * 1000;

let cached;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.pathname !== "/") {
    return env.ASSETS.fetch(request);
  }

  try {
    const now = Date.now();
    if (!cached || cached.expiresAt <= now) {
      cached = {
        expiresAt: now + Number(env.CACHE_TTL_MS || CACHE_TTL_MS),
        data: await fetchMonitorData(env)
      };
    }

    return new Response(renderPage(env, cached.data), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: err.message }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    });
  }
}

async function fetchMonitorData(env) {
  const apiKey = env.UPTIME_ROBOT_API;
  if (!apiKey) {
    throw new Error("UptimeRobot API key must be provided.");
  }

  const { dates, ranges } = lastDays(DISTANCE);
  const body = new URLSearchParams({
    api_key: apiKey,
    format: "json",
    custom_uptime_ratios: String(DISTANCE),
    custom_uptime_ranges: ranges,
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

  return parseMonitors(
    result.monitors || [],
    env.UPTIME_ROBOT_NAME_PATTERN || DEFAULT_PATTERN,
    dates
  );
}

function parseMonitors(monitors, pattern, dates) {
  const parser = createParser(pattern);
  const data = {
    sum: {
      down: 0,
      checktime: formatDateTime(new Date())
    },
    groups: []
  };
  let isIndexed = false;

  for (const monitor of monitors) {
    const friendlyName = monitor.friendly_name || "";
    const result = parser.parse(friendlyName);
    if (!result) continue;

    let group = data.groups.find(item => item.name === result.group);
    if (!group) {
      group = {
        name: result.group,
        down: 0,
        monitors: []
      };
      data.groups.push(group);
    }

    if (result.index !== undefined) {
      isIndexed = true;
      group.index = result.index;
    }

    const status = Number(monitor.status);
    if (status > 2) {
      data.sum.down++;
      group.down++;
    }

    const ranges = String(monitor.custom_uptime_ranges || "").split("-");
    const uptime = ranges.map((value, index) => ({
      date: dates[index],
      uptime: value
    }));

    group.monitors.push({
      name: result.name,
      status,
      totalUptime: monitor.custom_uptime_ratio,
      uptime
    });
  }

  if (isIndexed) {
    data.groups.sort((a, b) => (a.index || 0) - (b.index || 0));
  }

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

function lastDays(distance) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dates = [];
  const ranges = [];

  for (let i = -distance; i <= 0; i++) {
    const day0 = addDays(today, i);
    const day1 = new Date(addDays(day0, 1).getTime() - 1000);
    dates.push(formatDate(day0));
    ranges.push(`${toUnix(day0)}_${toUnix(day1)}`);
  }

  return { dates, ranges: ranges.join("-") };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

function formatDate(date) {
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`;
}

function formatDateTime(date) {
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function renderPage(env, data) {
  const title = env.WEBSITE_TITLE || "服务状态";
  const copyright = env.WEBSITE_COPYRIGHT || "楠格";
  const links = parseLinks(env.WEBSITE_LINKS);

  return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta http-equiv="Cache-Control" content="no-transform">
  <meta http-equiv="X-UA-Compatible" content="IE=Edge,chrome=1">
  <meta name="viewport" content="width=device-width,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover">
  <meta name="renderer" content="webkit">
  <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
  <meta name="theme-color" content="#0F7D00">
  <meta property="og:image" content="https://static.nange.cn/image/others/bingo.jpeg">
  <meta name="msapplication-TileColor" content="#0F7D00">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/css/app.css">
  <link rel="shortcut icon" href="https://static.nange.cn/images/others/favicon.ico" type="image/x-icon">
</head>
<body>
  <div id="app">
    <section class="header">
      <div class="container">
        <h1 class="header-title">${escapeHtml(title)}</h1>
        <div class="card">
          <div class="summary">
            <div class="icon icon-status-sum ${data.sum.down > 0 ? "down" : "up"}"></div>
            <div style="letter-spacing:-0.5px;">
              <div class="summary-detail">${data.sum.down > 0 ? `有 ${data.sum.down} 个服务异常！` : "所有服务正常。"}</div>
              <div class="summary-checktime">${escapeHtml(data.sum.checktime)} GMT+08:00</div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section class="content">
      <div class="container">${data.groups.map(renderGroup).join("")}</div>
    </section>
    <section class="footer">
      <div class="container">
        <div class="footer-content">
          <nav class="links">${links.map(renderLink).join("")}</nav>
          <div class="copyright">&copy; ${escapeHtml(copyright)}</div>
        </div>
      </div>
    </section>
    <script src="https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/tippy.js/2.2.0/tippy.all.min.js"></script>
    <script src="/js/open.js"></script>
    <script src="/js/tippy.js"></script>
  </div>
</body>
</html>`;
}

function renderGroup(group) {
  return `<div class="card monitors has-children">
  <div class="monitors-header">
    <div class="monitors-header-title">${escapeHtml(group.name)}</div>
    <div class="icon icon-status ${group.down > 0 ? "down" : "up"}"></div>
  </div>
  <div class="monitors-content-wrap">
    <div class="monitors-content">${group.monitors.map(renderMonitor).join("")}</div>
  </div>
</div>`;
}

function renderMonitor(monitor) {
  return `<div class="monitor">
  <div class="monitor-header">
    <div class="monitor-name">${escapeHtml(monitor.name)}</div>
    ${renderStatus(monitor.status)}
  </div>
  <div class="monitor-content">
    <div class="monitor-uptime-range">
      <span>最近 ${monitor.uptime.length} 天可用率 <strong>${escapeHtml(monitor.totalUptime || "")}% </strong></span>
      <strong>当前</strong>
    </div>
    <div class="monitor-uptimes">${monitor.uptime.map(renderUptime).join("")}</div>
  </div>
</div>`;
}

function renderStatus(status) {
  if (status === 2) return '<div class="icon icon-status up" title="正常"></div>';
  if (status === 8) return '<div class="icon icon-status seem-down" title="波动"></div>';
  if (status === 9) return '<div class="icon icon-status down" title="异常"></div>';
  return '<div class="icon icon-status pause" title="无数据"></div>';
}

function renderUptime(item) {
  const value = Number(item.uptime);
  const status = value === 0 ? "pause" : value < 95 ? "down" : value < 100 ? "seem-down" : "up";
  const title = `<small>${escapeHtml(item.date || "")}<br>可用率 ${escapeHtml(item.uptime || "")}%</small>`;
  return `<div class="icon-uptime ${status}" title="${escapeHtml(title)}"></div>`;
}

function renderLink(link) {
  return `<a href="${escapeAttribute(link.href)}" target="_blank">${escapeHtml(link.name)}</a>`;
}

function parseLinks(value) {
  if (!value) {
    return [
      { name: "主页", href: "http://about.nange.cn" },
      { name: "楠格", href: "http://www.nange.cn" },
      { name: "探针", href: "http://server.nange.cn" },
      { name: "GitHub", href: "http://github.com/xOS" }
    ];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    return value
      .split(",")
      .map(item => {
        const [name, href] = item.split("|");
        return { name: name?.trim(), href: href?.trim() };
      })
      .filter(link => link.name && link.href);
  }

  return [];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
