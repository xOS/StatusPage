require("dotenv").config();

const { createAPP } = require("../build/bootstrap/app");

const app = createAPP({ cron: false });
const handler = app.callback();

module.exports = async (req, res) => {
  const pending = [];
  req.waitUntil = promise => {
    pending.push(Promise.resolve(promise));
  };

  await handler(req, res);
  await Promise.allSettled(pending);
};
