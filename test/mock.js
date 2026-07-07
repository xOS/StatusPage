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

export function mockSucc() {
  return nock("https://api.uptimerobot.com")
    .post("/v2/getMonitors")
    .reply(200, {
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
    });
}

export function mockFail() {
  return nock("https://api.uptimerobot.com")
    .persist()
    .post("/v2/getMonitors")
    .reply(502);
}
