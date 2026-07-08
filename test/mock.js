import nock from "nock";

const custom_uptime_ranges = [
  ...Array(10).fill("0.000"),
  ...Array(10).fill("80.000"),
  ...Array(10).fill("99.999"),
  ...Array(61).fill("100.000")
].join("-");

const response_times = [
  {
    datetime: 1640995200,
    value: 120
  }
];

const logs = [
  {
    id: 1,
    type: 1,
    datetime: 1640995200,
    duration: 60,
    reason: {
      code: "timeout",
      detail: "Timeout"
    }
  }
];

const successResponse = {
  stat: "ok",
  monitors: [
    {
      id: 1,
      friendly_name: "example1${类别:Web}",
      url: "https://example1.com",
      status: 1,
      custom_uptime_ranges,
      custom_uptime_ratio: "100.000",
      response_times,
      logs: []
    },
    {
      id: 2,
      friendly_name: "example2${分组:Web}",
      url: "https://example2.com",
      status: 2,
      custom_uptime_ranges,
      custom_uptime_ratio: "90.000",
      response_times,
      logs: []
    },
    {
      id: 3,
      friendly_name: "example1${类别:Server}",
      url: "https://server1.com",
      status: 8,
      custom_uptime_ranges,
      custom_uptime_ratio: "0.000",
      response_times,
      logs
    },
    {
      id: 4,
      friendly_name: "example2${分组:Server}",
      url: "https://server2.com",
      status: 9,
      custom_uptime_ranges,
      custom_uptime_ratio: "0.000",
      response_times,
      logs
    },
    {
      id: 5,
      friendly_name: "HiddenMonitor",
      url: "https://hidden.com",
      status: 2,
      custom_uptime_ranges,
      custom_uptime_ratio: "96.000",
      response_times,
      logs: []
    }
  ]
};

export function mockSucc(options = {}) {
  const request = nock("https://api.uptimerobot.com").post("/v2/getMonitors");
  if (options.delay) {
    request.delay(options.delay);
  }
  return request.reply(200, successResponse);
}

export function mockPaginatedSucc() {
  return nock("https://api.uptimerobot.com")
    .post("/v2/getMonitors", body => hasParams(body, { offset: "0", limit: "25" }))
    .reply(200, {
      stat: "ok",
      pagination: {
        offset: 0,
        limit: 25,
        total: successResponse.monitors.length
      },
      monitors: successResponse.monitors.slice(0, 3)
    })
    .post("/v2/getMonitors", body => hasParams(body, { offset: "3", limit: "25" }))
    .reply(200, {
      stat: "ok",
      pagination: {
        offset: 3,
        limit: 25,
        total: successResponse.monitors.length
      },
      monitors: successResponse.monitors.slice(3)
    });
}

export function mockTimeoutThenPaginatedSucc() {
  return nock("https://api.uptimerobot.com")
    .post("/v2/getMonitors", body => hasParams(body, { offset: "0", limit: "25" }))
    .replyWithError({
      code: "ECONNABORTED",
      message: "timeout of 30000ms exceeded"
    })
    .post("/v2/getMonitors", body => hasParams(body, { offset: "0", limit: "12" }))
    .reply(200, {
      stat: "ok",
      pagination: {
        offset: 0,
        limit: 12,
        total: successResponse.monitors.length
      },
      monitors: successResponse.monitors
    });
}

export function mockResponseTimesWindowSucc() {
  return nock("https://api.uptimerobot.com")
    .post("/v2/getMonitors", body => {
      const start = Number(bodyParam(body, "response_times_start_date"));
      const end = Number(bodyParam(body, "response_times_end_date"));

      return (
        bodyParam(body, "response_times") === "1" &&
        bodyParam(body, "response_times_average") === "30" &&
        bodyParam(body, "response_times_limit") === "50" &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end - start === 24 * 60 * 60
      );
    })
    .reply(200, successResponse);
}

export function mockFail() {
  return nock("https://api.uptimerobot.com")
    .persist()
    .post("/v2/getMonitors")
    .reply(502);
}

function hasParams(body, expected) {
  return Object.entries(expected).every(([key, value]) => String(bodyParam(body, key)) === value);
}

function bodyParam(body, key) {
  if (typeof body === "string") {
    return new URLSearchParams(body).get(key);
  }

  return body && body[key];
}
