const log = require("book")

const io = require('socket.io-client')
const socket = io('http://localhost:3100')
socket.on("/livestatus", ({ userId, status, timestamp }) => {
  log.info(`User ${userId} is now ${status}`)
})