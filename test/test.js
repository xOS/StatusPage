import test from "ava";
import superkoa from "superkoa";
import nock from "nock";
import { mockPaginatedSucc, mockSucc, mockTimeoutThenPaginatedSucc } from "./mock";
import { createAPP } from "../src/bootstrap/app";
import { normalizeDays } from "../src/services/uptimerobot";

test.beforeEach(({ context }) => {
  context.app = createAPP({ cron: false });
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.serial("GET /", async t => {
  const scope = mockSucc();
  const res = await superkoa(t.context.app).get("/");
  // test status
  t.is(res.status, 200);
  t.true(res.text.includes("<!DOCTYPE html>"));
  scope.persist(false);
});

test.serial("GET /api/status", async t => {
  const scope = mockSucc();
  await t.context.app.context.services.uptimerobot.refreshStatusPageCache(90);
  const res = await superkoa(t.context.app).get("/api/status");
  t.is(res.status, 200);
  t.truthy(res.body.monitors.Web);
  t.truthy(res.body.monitors.Server);
  t.is(res.body.monitors.Web.length, 2);
  t.true(res.body.logs.length >= 1);
  t.false(res.body.meta.partial);
  scope.persist(false);
});

test.serial("GET /api/status clamps large days queries", async t => {
  const scope = mockSucc();
  await t.context.app.context.services.uptimerobot.refreshStatusPageCache(90);
  const res = await superkoa(t.context.app).get("/api/status?days=999");
  t.is(res.status, 200);
  t.is(res.headers["x-status-days"], "90");
  t.truthy(res.body.monitors.Web);
  scope.persist(false);
});

test.serial("GET /api/status returns stale snapshot before background refresh", async t => {
  const ok = mockSucc();
  await t.context.app.context.services.uptimerobot.refreshStatusPageCache(88);
  ok.persist(false);

  const key = t.context.app.context.services.uptimerobot.statusPageCacheKey(88);
  const cached = t.context.app.context.services.uptimerobot.cache.get(key);
  cached.expiresAt = Date.now() - 1;
  t.context.app.context.services.uptimerobot.cache.put(key, cached);

  const res = await superkoa(t.context.app).get("/api/status?days=88");
  t.is(res.status, 200);
  t.truthy(res.body.monitors.Web);
  t.is(res.body.monitors.Web.length, 2);
});

test.serial("statusPage returns warming state when no full snapshot exists", async t => {
  const data = await t.context.app.context.services.uptimerobot.statusPage(87);

  t.true(data.meta.warming);
  t.false(data.meta.partial);
  t.deepEqual(data.monitors, {});
  t.is(data.logs.length, 0);
});

test.serial("GET /api/refresh requires token", async t => {
  const res = await superkoa(t.context.app).get("/api/refresh");
  t.is(res.status, 401);
});

test.serial("GET /api/refresh returns summary only", async t => {
  const scope = mockSucc();
  process.env.CACHE_REFRESH_TOKEN = "test-refresh-token";
  const res = await superkoa(t.context.app)
    .get("/api/refresh?wait=1&token=test-refresh-token");
  delete process.env.CACHE_REFRESH_TOKEN;

  t.is(res.status, 200);
  t.true(res.body.ok);
  t.is(res.body.days, 90);
  t.is(res.body.groups, 3);
  t.is(res.body.monitors, 5);
  t.false(Object.prototype.hasOwnProperty.call(res.body, "status"));
  scope.persist(false);
});

test.serial("GET /api/refresh fetches all UptimeRobot pages", async t => {
  const scope = mockPaginatedSucc();
  process.env.CACHE_REFRESH_TOKEN = "test-refresh-token";
  const res = await superkoa(t.context.app)
    .get("/api/refresh?wait=1&token=test-refresh-token");
  delete process.env.CACHE_REFRESH_TOKEN;

  t.is(res.status, 200);
  t.true(scope.isDone());
  t.is(res.body.groups, 3);
  t.is(res.body.monitors, 5);
});

test.serial("GET /api/refresh retries timed out UptimeRobot pages with smaller page size", async t => {
  const scope = mockTimeoutThenPaginatedSucc();
  process.env.CACHE_REFRESH_TOKEN = "test-refresh-token";
  const res = await superkoa(t.context.app)
    .get("/api/refresh?wait=1&token=test-refresh-token");
  delete process.env.CACHE_REFRESH_TOKEN;

  t.is(res.status, 200);
  t.true(scope.isDone());
  t.is(res.body.groups, 3);
  t.is(res.body.monitors, 5);
});

test.serial("GET /api/refresh supports async response", async t => {
  const scope = mockSucc();
  process.env.CACHE_REFRESH_TOKEN = "test-refresh-token";
  const res = await superkoa(t.context.app)
    .get("/api/refresh?token=test-refresh-token");
  delete process.env.CACHE_REFRESH_TOKEN;

  t.is(res.status, 202);
  t.true(res.body.ok);
  t.true(res.body.accepted);
  t.false(Object.prototype.hasOwnProperty.call(res.body, "status"));
  scope.persist(false);
});

test.serial("GET /api/info", async t => {
  const res = await superkoa(t.context.app).get("/api/info");
  t.is(res.status, 200);
  t.is(res.body.name, "服务状态");
  t.is(res.body.site.home.label, "主页");
  t.is(res.body.site.home.href, "/");
  t.is(res.body.site.github.href, "https://github.com/xOS");
  t.is(res.body.site.footer.owner, "楠格");
});

test.serial("GET /api/status without snapshot returns warming response", async t => {
  const res = await superkoa(t.context.app).get("/api/status?days=89");
  t.is(res.status, 202);
  t.true(res.body.meta.warming);
  t.false(res.body.meta.partial);
  t.deepEqual(res.body.monitors, {});
});

test("normalizes status page days and configures API timeout", t => {
  t.is(normalizeDays(999), 90);
  t.is(normalizeDays("0"), 90);
  t.is(t.context.app.context.services.uptimerobot.api.__client.axios.defaults.timeout, 30000);
});
