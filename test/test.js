import test from "ava";
import superkoa from "superkoa";
import nock from "nock";
import { mockSucc, mockFail } from "./mock";
import { createAPP } from "../src/bootstrap/app";

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
  const res = await superkoa(t.context.app).get("/api/status");
  t.is(res.status, 200);
  t.truthy(res.body.monitors.Web);
  t.truthy(res.body.monitors.Server);
  t.is(res.body.monitors.Web.length, 2);
  t.true(res.body.logs.length >= 1);
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

  const fail = mockFail();
  const res = await superkoa(t.context.app).get("/api/status?days=88");
  t.is(res.status, 200);
  t.truthy(res.body.monitors.Web);
  t.is(res.body.monitors.Web.length, 2);
  fail.persist(false);
});

test.serial("GET /api/refresh requires token", async t => {
  const res = await superkoa(t.context.app).get("/api/refresh");
  t.is(res.status, 401);
});

test.serial("GET /api/refresh returns summary only", async t => {
  const scope = mockSucc();
  process.env.CACHE_REFRESH_TOKEN = "test-refresh-token";
  const res = await superkoa(t.context.app)
    .get("/api/refresh?token=test-refresh-token");
  delete process.env.CACHE_REFRESH_TOKEN;

  t.is(res.status, 200);
  t.true(res.body.ok);
  t.is(res.body.days, 90);
  t.is(res.body.groups, 3);
  t.is(res.body.monitors, 5);
  t.false(Object.prototype.hasOwnProperty.call(res.body, "status"));
  scope.persist(false);
});

test.serial("GET /api/refresh supports async response", async t => {
  const scope = mockSucc();
  process.env.CACHE_REFRESH_TOKEN = "test-refresh-token";
  const res = await superkoa(t.context.app)
    .get("/api/refresh?async=1&token=test-refresh-token");
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

test.serial("GET /api/status with error", async t => {
  const scope = mockFail();
  const res = await superkoa(t.context.app).get("/api/status?days=89");
  t.is(res.status, 500);
  scope.persist(false);
});
