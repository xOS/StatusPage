require("dotenv").config();

const { createAPP } = require("../build/bootstrap/app");

const app = createAPP({ cron: false });
const handler = app.callback();

module.exports = (req, res) => handler(req, res);
