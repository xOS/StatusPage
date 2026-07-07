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

test.serial("GET /api/status with error", async t => {
  const scope = mockFail();
  const res = await superkoa(t.context.app).get("/api/status?days=89");
  t.is(res.status, 500);
  scope.persist(false);
});
