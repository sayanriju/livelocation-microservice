const Faye = require("faye")
const faye = new Faye.Client(process.env.BASE_URL || "http://localhost:3000/")
const log = require("book")

faye.subscribe("/livestatus", async ({ userId, status, timestamp }) => {
  log.info(`User ${userId} is now ${status}`)
})
