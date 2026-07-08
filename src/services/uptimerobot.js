import UptimeRobot from "uptimerobot-apiv2";
import { Cache } from "memory-cache";
import { logger } from "../lib/logger";
import { Parser } from "../lib/parser";
import { format, addDays, addSeconds, startOfDay, fromUnixTime } from "date-fns";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const distance = 59;
const statusPageDistance = 90;
const statusPageCacheTTL = positiveNumber(process.env.CACHE_TTL_MS, 60 * 1000);
const statusPageStaleTTL = positiveNumber(process.env.CACHE_STALE_TTL_MS, 0);
const statusPageDiskTTL = positiveNumber(process.env.CACHE_DISK_TTL_MS, statusPageStaleTTL);
const statusPageMaxDays = positiveNumber(process.env.STATUS_PAGE_MAX_DAYS, statusPageDistance);
const uptimeRobotTimeoutMs = positiveNumber(process.env.UPTIME_ROBOT_TIMEOUT_MS, 30 * 1000);
const uptimeRobotPageSize = Math.min(50, Math.max(1, positiveNumber(process.env.UPTIME_ROBOT_PAGE_SIZE, 25)));
const statusPageDiskCacheEnabled =
  process.env.CACHE_DISK === "false" ? false : process.env.NODE_ENV !== "test";
const statusPageCacheDir =
  process.env.CACHE_DIR || (process.env.VERCEL ? "/tmp/status-page-cache" : join(process.cwd(), ".cache"));
const responseTimesLimit = Number(process.env.UPTIME_ROBOT_RESPONSE_TIMES_LIMIT || 48);

function lastDays(distance) {
  const now = startOfDay(new Date());
  const dates = [];
  const ranges = [];
  const getTime = date => Math.floor(date.getTime() / 1000);

  for (let i = -distance; i <= 0; i++) {
    const day0 = addDays(now, i);
    const day1 = addSeconds(addDays(day0, 1), -1);
    dates.push(format(day0, "yyyy年MM月dd日"));
    ranges.push(`${getTime(day0)}_${getTime(day1)}`);
  }
  return { dates, ranges: ranges.join("-") };
}

function findArrayIndex(groups, groupName) {
  return groups.findIndex(({ name }) => name === groupName);
}

function formatNumber(value) {
  return (Math.floor(Number(value || 0) * 100) / 100).toString();
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

export default class UptimeRobotService {
  constructor(key) {
    this.api = new UptimeRobot(key);
    if (this.api.__client && this.api.__client.axios) {
      this.api.__client.axios.defaults.timeout = uptimeRobotTimeoutMs;
    }
    this.cache = new Cache();
    this.statusPageRefreshes = {};
    const pattern = require("config").get("uptimerobot.pattern");
    this.parser = pattern ? new Parser(pattern) : null;
    this.getStatusPageCache(statusPageDistance);
  }

  async prefetchList() {
    let data = {
      sum: {
        // total: 0,
        down: 0,
        checktime: format(Date.now(), "yyyy年MM月dd日 HH:mm")
      },
      groups: [
        /**
         * [
         *    name: groupName,
         *    index: undefined,
         *    down: 0,
         *    monitors: [{
         *      name,
         *      status
         *    }]
         * ]
         *
         */
      ]
    };
    const { dates, ranges } = lastDays(distance);
    const monitors = await this.fetchAllMonitors({
      custom_uptime_ratios: distance,
      custom_uptime_ranges: ranges,
      statuses: require("config").get("uptimerobot.statuses")
    });
    var isIndexed = false;
    for (let monitor of monitors) {
      const parsed = parseOptions(monitor["friendly_name"]);
      const result = this.parseMonitorName(parsed.name);
      const groupName = parsed.opts["类别"] || parsed.opts["分组"] || result.group || "未分类";
      const monitorName = result.name;
      // init group
      let arrayIndex = findArrayIndex(data.groups, groupName);
      if (arrayIndex < 0) {
        arrayIndex =
          data.groups.push({
            name: groupName,
            down: 0,
            monitors: []
          }) - 1;
      }

      // Check manual index
      if (result.index !== undefined) {
        isIndexed = true;
        data.groups[arrayIndex].index = result.index;
      }

      /**
       * monitor status
       * 0,1 -> pause     -> black
       * 2   -> up        -> green
       * 8   -> seem down -> yellow
       * 9   -> down      -> red
       */
      const { status } = monitor;
      // calc down instances
      // data.sum.total++;
      if (status > 2) {
        data.sum.down++;
        data.groups[arrayIndex].down++;
      }
      // last 30 days uptime
      const range = monitor["custom_uptime_ranges"].split("-");
      const uptime = [];
      for (let i = 0; i < range.length; i++) {
        uptime.push({ date: dates[i], uptime: range[i] });
      }
      // push monitor
      data.groups[arrayIndex].monitors.push({
        name: monitorName,
        status,
        totalUptime: monitor["custom_uptime_ratio"],
        uptime
      });
    }

    // Sort if indexed
    if (isIndexed) {
      data.groups.sort((a, b) => a.index - b.index);
    }
    // cache monitors (update pre 5m)
    return this.cache.put("monitors", data);
  }

  async prefetchStatusPage(days = statusPageDistance) {
    days = normalizeDays(days);
    const { dates, ranges, start, end } = this.statusPageRanges(days);

    const monitors = await this.fetchAllMonitors({
      logs: 1,
      log_types: "1-2",
      response_times: 1,
      response_times_limit: responseTimesLimit,
      logs_start_date: start,
      logs_end_date: end,
      custom_uptime_ranges: ranges.join("-"),
      statuses: require("config").get("uptimerobot.statuses")
    });

    return this.putStatusPageCache(days, this.buildStatusPageData(monitors, dates));
  }

  async fetchAllMonitors(params = {}) {
    const monitors = [];
    let offset = 0;
    let pageSize = uptimeRobotPageSize;

    while (true) {
      let result;
      try {
        result = await this.api.getMonitors({
          ...params,
          offset,
          limit: pageSize
        });
      } catch (err) {
        if (isTimeoutError(err) && pageSize > 1) {
          pageSize = Math.max(1, Math.floor(pageSize / 2));
          logger.warn(`UptimeRobot request timed out; retrying with page size ${pageSize}.`);
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

  statusPageRanges(days) {
    const today = startOfDay(new Date());
    const dates = [];

    for (let d = 0; d < days; d++) {
      dates.push(addDays(today, -d));
    }

    const getTime = date => Math.floor(date.getTime() / 1000);
    const ranges = dates.map(date => {
      const day1 = addSeconds(addDays(date, 1), -1);
      return `${getTime(date)}_${getTime(day1)}`;
    });
    const start = getTime(dates[dates.length - 1]);
    const end = getTime(addDays(dates[0], 1));

    ranges.push(`${start}_${end}`);

    return { dates, ranges, start, end };
  }

  buildStatusPageData(monitors, dates) {
    const data = {
      monitors: {},
      logs: [],
      meta: {
        partial: false,
        generatedAt: new Date().toISOString()
      }
    };

    for (const monitor of monitors) {
      const uptimeRanges = String(monitor["custom_uptime_ranges"] || "").split("-");
      const average = formatNumber(uptimeRanges.pop());
      const parsed = parseOptions(monitor["friendly_name"]);
      const parsedName = this.parseMonitorName(parsed.name);
      const dailyMap = {};
      const daily = dates.map((date, index) => {
        dailyMap[format(date, "yyyyMMdd")] = index;
        return {
          date: format(date, "yyyy-MM-dd"),
          uptime: formatNumber(uptimeRanges[index]),
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

      for (const log of monitor.logs || []) {
        if (log.type !== 1) continue;

        const dateKey = format(fromUnixTime(log.datetime), "yyyyMMdd");
        const index = dailyMap[dateKey];
        total.times++;
        total.duration += log.duration || 0;

        if (index !== undefined) {
          daily[index].down.times++;
          daily[index].down.duration += log.duration || 0;
        }

        data.logs.push({
          name: parsedName.name,
          datetime: format(fromUnixTime(log.datetime), "yyyy-MM-dd HH:mm:ss"),
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

  warmingStatusPageData(days) {
    return {
      monitors: {},
      logs: [],
      meta: {
        partial: false,
        warming: true,
        days,
        generatedAt: new Date().toISOString(),
        message: "Status snapshot has not been generated yet. Trigger /api/refresh or wait for the scheduled refresh."
      }
    };
  }

  async list() {
    let data = this.cache.get("monitors");
    if (!data) {
      data = await this.prefetchList();
    } else {
      logger.debug("Hit Cache");
    }
    return data;
  }

  async statusPage(days = statusPageDistance) {
    days = normalizeDays(days);
    const cached = this.getStatusPageCache(days);

    if (!cached) {
      return this.warmingStatusPageData(days);
    }

    if (cached.expiresAt > Date.now()) {
      logger.debug("Hit Status Page Cache");
      return cached.data;
    }

    logger.debug("Hit Stale Status Page Cache");
    return cached.data;
  }

  statusPageCacheKey(days) {
    days = normalizeDays(days);
    return `status-page:${days}`;
  }

  statusPageCacheFile(days) {
    days = normalizeDays(days);
    return join(statusPageCacheDir, `status-page-${days}.json`);
  }

  getStatusPageCache(days) {
    const key = this.statusPageCacheKey(days);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const diskCached = this.readStatusPageDiskCache(days);
    if (!diskCached) return null;

    this.putMemoryStatusPageCache(key, diskCached);
    return diskCached;
  }

  putStatusPageCache(days, data, options = {}) {
    days = normalizeDays(days);
    const now = Date.now();
    const ttlMs = positiveNumber(options.ttlMs, statusPageCacheTTL);
    const entry = {
      data,
      expiresAt: now + ttlMs,
      savedAt: now
    };

    this.putMemoryStatusPageCache(this.statusPageCacheKey(days), entry);
    this.writeStatusPageDiskCache(days, entry);
    return data;
  }

  putMemoryStatusPageCache(key, entry) {
    const ttl = Math.max(statusPageStaleTTL, statusPageDiskTTL);
    if (ttl > 0) {
      this.cache.put(key, entry, ttl);
      return;
    }

    this.cache.put(key, entry);
  }

  warmupStatusPageCache(days = statusPageDistance) {
    days = normalizeDays(days);
    this.getStatusPageCache(days);
    return this.refreshStatusPageCache(days).catch(err => {
      logger.error(err);
    });
  }

  refreshStatusPageCache(days) {
    days = normalizeDays(days);
    const key = this.statusPageCacheKey(days);
    if (this.statusPageRefreshes[key]) return this.statusPageRefreshes[key];

    this.statusPageRefreshes[key] = this.prefetchStatusPage(days).finally(() => {
      delete this.statusPageRefreshes[key];
    });

    return this.statusPageRefreshes[key];
  }

  readStatusPageDiskCache(days) {
    days = normalizeDays(days);
    if (!statusPageDiskCacheEnabled) return null;

    try {
      const file = this.statusPageCacheFile(days);
      if (!existsSync(file)) return null;

      const entry = JSON.parse(readFileSync(file, "utf8"));
      if (!entry || !entry.data || !entry.savedAt) return null;
      if (statusPageDiskTTL > 0 && Date.now() - entry.savedAt > statusPageDiskTTL) return null;

      return {
        data: entry.data,
        expiresAt: Number(entry.expiresAt || 0),
        savedAt: Number(entry.savedAt)
      };
    } catch (err) {
      logger.warn("Failed to read status page disk cache.", err.message);
      return null;
    }
  }

  writeStatusPageDiskCache(days, entry) {
    days = normalizeDays(days);
    if (!statusPageDiskCacheEnabled) return;

    try {
      mkdirSync(statusPageCacheDir, { recursive: true });
      writeFileSync(this.statusPageCacheFile(days), JSON.stringify(entry));
    } catch (err) {
      logger.warn("Failed to write status page disk cache.", err.message);
    }
  }

  parseMonitorName(name) {
    const result = {
      group: undefined,
      index: undefined,
      name
    };

    if (!this.parser) return result;

    try {
      const matches = this.parser.parse(name);
      result.group = matches.group;
      result.index = matches.index;
      result.name = matches.name;
    } catch (err) {
      // Keep the original name when it does not follow the configured parser.
    }

    return result;
  }
}

export function normalizeDays(value) {
  const days = Number(value);
  const maxDays = Math.max(1, statusPageMaxDays);
  if (!Number.isFinite(days) || days <= 0) return Math.min(statusPageDistance, maxDays);
  return Math.min(Math.floor(days), maxDays);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function isTimeoutError(err) {
  return err && (err.code === "ECONNABORTED" || /timeout|timed out/i.test(err.message || ""));
}
