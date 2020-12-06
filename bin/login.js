const cuid = require("cuid")
const log = require("book")

const io = require('socket.io-client')
const socket = io('http://localhost:3100')

const userId = process.argv[2] || cuid.slug()

log.info(`==> User ${userId} logs in.....`)
setInterval(() => {
  socket.emit("/heartbeat", { userId })
}, 5 * 1000)
