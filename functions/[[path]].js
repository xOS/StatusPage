const DAYS = 90;
const DEFAULT_STATUSES = "2-9";
const CACHE_TTL_MS = 60 * 1000;
const CACHE_STALE_TTL_MS = 0;
const RESPONSE_TIMES_LIMIT = 48;
const UPTIME_ROBOT_TIMEOUT_MS = 30 * 1000;
const UPTIME_ROBOT_PAGE_SIZE = 25;
const REFRESH_BUDGET_MS = 18 * 1000;
const REFRESH_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;
const REFRESH_CONTINUE_INTERVAL_MS = 15 * 1000;
const REFRESH_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROJECT_URL = "https://github.com/xOS/StatusPage";

const memoryCache = new Map();
const refreshStateCache = new Map();
const refreshes = new Map();

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/status") {
      const days = normalizeDays(url.searchParams.get("days"), env);
      const now = Date.now();
      const cacheKey = `status:${days}`;

      const cached = await readStatusCache(context, cacheKey);

      if (cached) {
        return json(cached.data, statusCacheHeaders(cached, now));
      }

      const refreshState = await readRefreshState(env, days);
      if (shouldContinueRefreshState(refreshState, env)) {
        context.waitUntil(refreshStatusCache(context, env, days, cacheKey, { resume: true }).catch(() => {}));
      }
      return json(
        warmingStatus(days, refreshState, runtimeDiagnostics(env)),
        { "cache-control": "no-store", "x-status-cache": "MISS" },
        202
      );
    }

    if (url.pathname === "/api/refresh") {
      if (!isRefreshAuthorized(request, env, false)) {
        return json({ message: "Unauthorized cache refresh." }, { "cache-control": "no-store" }, 401);
      }

      const days = normalizeDays(url.searchParams.get("days"), env);
      if (url.searchParams.get("wait") === "1" || url.searchParams.get("wait") === "true") {
        const refreshed = await refreshStatusCache(context, env, days, `status:${days}`, {
          force: url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true"
        });
        if (refreshed.complete && refreshed.entry) {
          return json(refreshSummary(refreshed.entry.data, days), { "cache-control": "no-store" });
        }

        return json({
          ok: true,
          accepted: true,
          complete: false,
          days,
          refresh: refreshed.state,
          diagnostics: runtimeDiagnostics(env)
        }, { "cache-control": "no-store" }, 202);
      }

      const cacheKey = `status:${days}`;
      const alreadyRunning = refreshes.has(cacheKey);
      const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
      const refreshStateStorage = alreadyRunning
        ? null
        : await writeRefreshState(env, days, {
            status: "queued",
            queuedAt: new Date().toISOString(),
            diagnostics: runtimeDiagnostics(env)
          });

      context.waitUntil(refreshStatusCache(context, env, days, cacheKey, { force }).catch(() => {}));
      return json({
        ok: true,
        accepted: true,
        alreadyRunning,
        days,
        savedAt: Date.now(),
        refreshStateStorage,
        diagnostics: runtimeDiagnostics(env)
      }, { "cache-control": "no-store" }, 202);
    }

    if (url.pathname === "/api/refresh-status") {
      if (!isRefreshAuthorized(request, env, false)) {
        return json({ message: "Unauthorized refresh status." }, { "cache-control": "no-store" }, 401);
      }

      const days = normalizeDays(url.searchParams.get("days"), env);
      return json({
        ok: true,
        days,
        refresh: await readRefreshState(env, days),
        diagnostics: runtimeDiagnostics(env)
      }, { "cache-control": "no-store" });
    }

    if (url.pathname === "/api/info") {
      return json(siteInfoFromEnv(env));
    }

    return env.ASSETS.fetch(request);
  } catch (err) {
    return json({ message: err.message }, {}, 500);
  }
}

function statusCacheHeaders(entry, now, missed = false) {
  return {
    "cache-control": "public, max-age=15, s-maxage=60, stale-while-revalidate=604800",
    "x-status-cache": missed ? "MISS" : entry.expiresAt > now ? "HIT" : "STALE",
    "x-status-cache-saved-at": String(entry.savedAt)
  };
}

function normalizeDays(value, env = {}) {
  const days = Number(value || DAYS);
  const maxDays = Math.max(1, positiveNumber(env.STATUS_PAGE_MAX_DAYS, DAYS));
  if (!Number.isFinite(days) || days <= 0) return Math.min(DAYS, maxDays);
  return Math.min(Math.floor(days), maxDays);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function warmingStatus(days, refreshState = null, diagnostics = {}) {
  const message = warmingMessage(refreshState, diagnostics);

  return {
    monitors: {},
    logs: [],
    meta: {
      partial: false,
      warming: true,
      days,
      generatedAt: new Date().toISOString(),
      message,
      refresh: refreshState,
      diagnostics
    }
  };
}

function warmingMessage(refreshState, diagnostics) {
  if (!diagnostics.kvBound) {
    return "Cloudflare KV binding STATUS_CACHE is not available. Configure the KV namespace binding in Pages Settings, then redeploy.";
  }
  if (!diagnostics.hasUptimeRobotApiKey) {
    return "UPTIME_ROBOT_API is not configured. Add it to Cloudflare Pages environment variables, then redeploy.";
  }
  if (refreshState && refreshState.status === "failed") {
    return `Status snapshot refresh failed: ${refreshState.error}`;
  }
  if (refreshState && refreshState.status === "running") {
    return "Status snapshot refresh is still running. Progress is saved in KV and the next refresh/status request will continue it.";
  }
  if (refreshState && refreshState.status === "queued") {
    return "Status snapshot refresh is queued. The next refresh/status request will continue it.";
  }
  return "Status snapshot has not been generated yet. Trigger /api/refresh or wait for the scheduled refresh.";
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

async function readStatusCache(context, cacheKey) {
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  const kvCached = await readKvStatusCache(context.env, cacheKey);
  if (kvCached) {
    memoryCache.set(cacheKey, kvCached);
    return kvCached;
  }

  const cache = await edgeCache();
  if (!cache) return null;

  const response = await cache.match(statusCacheRequest(context, cacheKey));
  if (!response) return null;

  try {
    const entry = await response.json();
    if (!entry || !entry.data || !entry.savedAt) return null;
    memoryCache.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

async function refreshStatusCache(context, env, days, cacheKey, options = {}) {
  if (refreshes.has(cacheKey)) return refreshes.get(cacheKey);

  const refresh = runRefreshStatusCache(context, env, days, cacheKey, options)
    .finally(() => {
      refreshes.delete(cacheKey);
    });

  refreshes.set(cacheKey, refresh);
  return refresh;
}

async function runRefreshStatusCache(context, env, days, cacheKey, options = {}) {
  try {
    const result = await continueRefreshStatusCache(context, env, days, cacheKey, options);
    return result;
  } catch (err) {
    await writeRefreshState(env, days, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: safeErrorMessage(err),
      diagnostics: runtimeDiagnostics(env)
    });
    throw err;
  }
}

async function continueRefreshStatusCache(context, env, days, cacheKey, options = {}) {
  if (!env.UPTIME_ROBOT_API) {
    throw new Error("UptimeRobot API key must be provided.");
  }

  const previousState = options.force ? null : await readRefreshState(env, days);
  const canResume = isContinuableRefreshState(previousState, env);
  const startedAt = canResume && previousState.startedAt ? previousState.startedAt : new Date().toISOString();
  const progress = canResume && previousState.progress ? previousState.progress : {};
  let pageSize = Math.min(50, Math.max(1, positiveNumber(progress.pageSize || env.UPTIME_ROBOT_PAGE_SIZE, UPTIME_ROBOT_PAGE_SIZE)));
  let offset = Math.max(0, Number(progress.offset || 0));
  let total = Number(progress.total);
  if (!Number.isFinite(total)) total = null;

  let refreshData = canResume ? await readRefreshData(env, days) : null;
  if (!refreshData || !Array.isArray(refreshData.monitors)) {
    refreshData = {
      monitors: [],
      startedAt
    };
    offset = 0;
    total = null;
    await writeRefreshData(env, days, refreshData);
  }

  const { dates, ranges, start, end } = uptimeRanges(days);
  ranges.push(`${start}_${end}`);
  const baseParams = statusFetchParams(env, start, end, ranges);
  const timeoutMs = positiveNumber(env.UPTIME_ROBOT_TIMEOUT_MS, UPTIME_ROBOT_TIMEOUT_MS);
  const budgetMs = Math.max(1000, positiveNumber(env.UPTIME_ROBOT_REFRESH_BUDGET_MS, REFRESH_BUDGET_MS));
  const deadline = Date.now() + budgetMs;

  await writeRefreshState(env, days, {
    status: "running",
    startedAt,
    progress: refreshProgress(offset, total, refreshData.monitors.length, pageSize),
    diagnostics: runtimeDiagnostics(env)
  });

  while (Date.now() < deadline) {
    let result;
    try {
      result = await requestUptimeRobot(new URLSearchParams({
        ...baseParams,
        offset: String(offset),
        limit: String(pageSize)
      }), timeoutMs);
    } catch (err) {
      if (isTimeoutError(err) && pageSize > 1) {
        pageSize = Math.max(1, Math.floor(pageSize / 2));
        await writeRefreshState(env, days, {
          status: "running",
          startedAt,
          progress: refreshProgress(offset, total, refreshData.monitors.length, pageSize),
          note: `UptimeRobot page timed out; retrying with page size ${pageSize}.`,
          diagnostics: runtimeDiagnostics(env)
        });
        continue;
      }

      throw err;
    }

    const page = Array.isArray(result.monitors) ? result.monitors : [];
    refreshData.monitors.push(...page);

    const pagination = result.pagination || {};
    const currentOffset = Number.isFinite(Number(pagination.offset)) ? Number(pagination.offset) : offset;
    const parsedTotal = Number(pagination.total);
    if (Number.isFinite(parsedTotal)) {
      total = parsedTotal;
    }

    offset = currentOffset + page.length;
    await writeRefreshData(env, days, refreshData);

    const isComplete =
      page.length === 0 ||
      (Number.isFinite(total) && refreshData.monitors.length >= total) ||
      (!Number.isFinite(total) && page.length < pageSize);

    if (isComplete) {
      const data = transformMonitors(refreshData.monitors, dates, env.UPTIME_ROBOT_NAME_PATTERN);
      const refreshedAt = Date.now();
      const entry = {
        key: cacheKey,
        data,
        expiresAt: refreshedAt + Number(env.CACHE_TTL_MS || CACHE_TTL_MS),
        savedAt: refreshedAt
      };

      memoryCache.set(cacheKey, entry);
      const storage = await writeStatusCache(context, env, cacheKey, entry);
      await deleteRefreshData(env, days);
      const state = await writeAndReturnRefreshState(env, days, {
        status: "success",
        startedAt,
        finishedAt: new Date().toISOString(),
        progress: refreshProgress(offset, total, refreshData.monitors.length, pageSize),
        summary: refreshSummary(data, days),
        storage,
        diagnostics: runtimeDiagnostics(env)
      });

      return { complete: true, entry, state };
    }

    await writeRefreshState(env, days, {
      status: "running",
      startedAt,
      progress: refreshProgress(offset, total, refreshData.monitors.length, pageSize),
      diagnostics: runtimeDiagnostics(env)
    });
  }

  const state = await writeAndReturnRefreshState(env, days, {
    status: "running",
    startedAt,
    progress: refreshProgress(offset, total, refreshData.monitors.length, pageSize),
    note: "Refresh paused before the platform time budget. Call /api/refresh again or let /api/status continue it in the background.",
    diagnostics: runtimeDiagnostics(env)
  });

  return { complete: false, state };
}

async function writeStatusCache(context, env, cacheKey, entry) {
  const kv = await writeKvStatusCache(env, cacheKey, entry);

  const cache = await edgeCache();
  if (!cache) {
    return {
      kv,
      edgeCache: { ok: false, reason: "Cache API is not available." }
    };
  }

  const retentionMs = Number(env.CACHE_STALE_TTL_MS || env.CACHE_DISK_TTL_MS || CACHE_STALE_TTL_MS);
  const maxAge = retentionMs > 0 ? Math.ceil(retentionMs / 1000) : 365 * 24 * 60 * 60;
  const response = new Response(JSON.stringify(entry), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`
    }
  });

  context.waitUntil(cache.put(statusCacheRequest(context, cacheKey), response));
  return {
    kv,
    edgeCache: { ok: true }
  };
}

function statusCacheRequest(context, cacheKey) {
  const url = new URL(context.request.url);
  url.pathname = `/__status-cache/${cacheKey}`;
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

async function edgeCache() {
  if (typeof caches === "undefined" || !caches.default) return null;
  return caches.default;
}

async function readKvStatusCache(env, cacheKey) {
  if (!env.STATUS_CACHE || typeof env.STATUS_CACHE.get !== "function") return null;

  try {
    const value = await env.STATUS_CACHE.get(cacheKey);
    if (!value) return null;

    const entry = JSON.parse(value);
    if (!entry || !entry.data || !entry.savedAt) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeKvStatusCache(env, cacheKey, entry) {
  if (!hasKvBinding(env)) {
    return { ok: false, reason: "STATUS_CACHE binding is not available." };
  }

  const retentionMs = Number(env.CACHE_STALE_TTL_MS || env.CACHE_DISK_TTL_MS || CACHE_STALE_TTL_MS);
  const expirationTtl = retentionMs > 0 ? Math.ceil(retentionMs / 1000) : undefined;
  const options = expirationTtl ? { expirationTtl } : undefined;

  try {
    await env.STATUS_CACHE.put(cacheKey, JSON.stringify(entry), options);
    return { ok: true, key: cacheKey };
  } catch (err) {
    return { ok: false, reason: safeErrorMessage(err) };
  }
}

function refreshStateKey(days) {
  return `refresh:${days}`;
}

function refreshDataKey(days) {
  return `refresh-data:${days}`;
}

async function readRefreshState(env, days) {
  const key = refreshStateKey(days);
  const entry = await readKvJson(env, key) || refreshStateCache.get(key);
  if (!entry) return null;

  const normalized = normalizeRefreshState(entry, env);
  refreshStateCache.set(key, normalized);
  if (normalized !== entry) {
    await writeRefreshState(env, days, normalized);
  }

  return normalized;
}

async function writeRefreshState(env, days, state) {
  const entry = refreshStateEntry(days, state);
  refreshStateCache.set(refreshStateKey(days), entry);

  if (!hasKvBinding(env)) return { ok: false, reason: "STATUS_CACHE binding is not available." };

  try {
    await env.STATUS_CACHE.put(refreshStateKey(days), JSON.stringify(entry), { expirationTtl: REFRESH_STATE_TTL_SECONDS });
    return { ok: true, key: refreshStateKey(days) };
  } catch {
    return { ok: false, reason: "Failed to write refresh state to KV." };
  }
}

async function writeAndReturnRefreshState(env, days, state) {
  const entry = refreshStateEntry(days, state);
  refreshStateCache.set(refreshStateKey(days), entry);

  if (hasKvBinding(env)) {
    try {
      await env.STATUS_CACHE.put(refreshStateKey(days), JSON.stringify(entry), { expirationTtl: REFRESH_STATE_TTL_SECONDS });
    } catch {
      // The response still carries the state for diagnostics.
    }
  }

  return entry;
}

function refreshStateEntry(days, state) {
  const key = refreshStateKey(days);
  return {
    days,
    updatedAt: new Date().toISOString(),
    ...state
  };
}

async function readRefreshData(env, days) {
  return readKvJson(env, refreshDataKey(days));
}

async function writeRefreshData(env, days, data) {
  if (!hasKvBinding(env)) return { ok: false, reason: "STATUS_CACHE binding is not available." };

  try {
    await env.STATUS_CACHE.put(refreshDataKey(days), JSON.stringify(data), { expirationTtl: REFRESH_STATE_TTL_SECONDS });
    return { ok: true, key: refreshDataKey(days) };
  } catch {
    return { ok: false, reason: "Failed to write refresh data to KV." };
  }
}

async function deleteRefreshData(env, days) {
  if (!hasKvBinding(env) || typeof env.STATUS_CACHE.delete !== "function") return;

  try {
    await env.STATUS_CACHE.delete(refreshDataKey(days));
  } catch {
    // Leaving temporary data in KV is harmless; it expires automatically.
  }
}

async function readKvJson(env, key) {
  if (!hasKvBinding(env)) return null;

  try {
    const value = await env.STATUS_CACHE.get(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function hasKvBinding(env) {
  return !!env.STATUS_CACHE && typeof env.STATUS_CACHE.get === "function" && typeof env.STATUS_CACHE.put === "function";
}

function runtimeDiagnostics(env) {
  return {
    kvBound: hasKvBinding(env),
    hasUptimeRobotApiKey: !!env.UPTIME_ROBOT_API,
    hasRefreshToken: !!(env.CACHE_REFRESH_TOKEN || env.CRON_SECRET || env.REFRESH_TOKEN)
  };
}

function normalizeRefreshState(state, env) {
  const active = !!state && (state.status === "queued" || state.status === "running");
  if (!active || !isRefreshStateExpired(state, env)) return state;

  return {
    ...state,
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: `Refresh did not finish within ${refreshRunningTimeoutMs(env)}ms. It was likely interrupted by the platform; call /api/refresh?force=1 to restart.`
  };
}

function isContinuableRefreshState(state, env) {
  return !!state && (state.status === "queued" || state.status === "running") && !isRefreshStateExpired(state, env);
}

function shouldContinueRefreshState(state, env) {
  if (!isContinuableRefreshState(state, env)) return false;

  const timestamp = Date.parse(state.updatedAt || state.startedAt || state.queuedAt || "");
  if (!Number.isFinite(timestamp)) return true;

  const interval = Math.max(1000, positiveNumber(env.UPTIME_ROBOT_REFRESH_CONTINUE_INTERVAL_MS, REFRESH_CONTINUE_INTERVAL_MS));
  return Date.now() - timestamp > interval;
}

function isRefreshStateExpired(state, env) {
  const timestamp = Date.parse(state.updatedAt || state.startedAt || state.queuedAt || "");
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > refreshRunningTimeoutMs(env);
}

function refreshRunningTimeoutMs(env) {
  return Math.max(1000, positiveNumber(env.UPTIME_ROBOT_REFRESH_RUNNING_TIMEOUT_MS, REFRESH_RUNNING_TIMEOUT_MS));
}

function refreshProgress(offset, total, fetched, pageSize) {
  return {
    offset,
    total: Number.isFinite(total) ? total : null,
    fetched,
    pageSize
  };
}

function isRefreshAuthorized(request, env, allowWithoutToken) {
  if (request.headers.get("x-vercel-cron-schedule") || request.headers.get("user-agent") === "vercel-cron/1.0") {
    return true;
  }

  const token = env.CACHE_REFRESH_TOKEN || env.CRON_SECRET || env.REFRESH_TOKEN;
  if (!token) return allowWithoutToken;

  const url = new URL(request.url);
  return request.headers.get("authorization") === `Bearer ${token}` || url.searchParams.get("token") === token;
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

  const baseParams = statusFetchParams(env, start, end, ranges);

  const monitors = await fetchAllMonitors(
    baseParams,
    env,
    positiveNumber(env.UPTIME_ROBOT_TIMEOUT_MS, UPTIME_ROBOT_TIMEOUT_MS)
  );

  return transformMonitors(monitors, dates, env.UPTIME_ROBOT_NAME_PATTERN);
}

function statusFetchParams(env, start, end, ranges) {
  return {
    api_key: env.UPTIME_ROBOT_API,
    format: "json",
    logs: "1",
    log_types: "1-2",
    response_times: "1",
    response_times_limit: String(env.UPTIME_ROBOT_RESPONSE_TIMES_LIMIT || RESPONSE_TIMES_LIMIT),
    logs_start_date: String(start),
    logs_end_date: String(end),
    custom_uptime_ranges: ranges.join("-"),
    statuses: env.UPTIME_ROBOT_STATUSES || DEFAULT_STATUSES
  };
}

async function fetchAllMonitors(params, env, timeoutMs) {
  let pageSize = Math.min(50, Math.max(1, positiveNumber(env.UPTIME_ROBOT_PAGE_SIZE, UPTIME_ROBOT_PAGE_SIZE)));
  const monitors = [];
  let offset = 0;

  while (true) {
    let result;
    try {
      result = await requestUptimeRobot(new URLSearchParams({
        ...params,
        offset: String(offset),
        limit: String(pageSize)
      }), timeoutMs);
    } catch (err) {
      if (isTimeoutError(err) && pageSize > 1) {
        pageSize = Math.max(1, Math.floor(pageSize / 2));
        continue;
      }

      throw err;
    }

    const page = Array.isArray(result.monitors) ? result.monitors : [];
    monitors.push(...page);

    const pagination = result.pagination || {};
    const currentOffset = Number.isFinite(Number(pagination.offset)) ? Number(pagination.offset) : offset;
    const total = Number(pagination.total);

    if (!Number.isFinite(total) || page.length === 0 || monitors.length >= total) {
      break;
    }

    offset = currentOffset + page.length;
    if (offset <= currentOffset) break;
  }

  return monitors;
}

async function requestUptimeRobot(body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body,
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`UptimeRobot request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`UptimeRobot request failed with ${response.status}.`);
  }

  const result = await response.json();
  if (result.stat !== "ok") {
    throw new Error(result.error?.message || "UptimeRobot request failed.");
  }

  return result;
}

function transformMonitors(monitors, dates, pattern) {
  const data = {
    monitors: {},
    logs: [],
    meta: {
      partial: false,
      generatedAt: new Date().toISOString()
    }
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

function isTimeoutError(err) {
  return err && /timeout|timed out/i.test(err.message || "");
}

function safeErrorMessage(err) {
  return err && err.message ? err.message : String(err || "Unknown refresh error.");
}
