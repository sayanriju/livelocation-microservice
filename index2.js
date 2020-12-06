const SocketIo = require("socket.io")
const Redis = require("ioredis")
const log = require("book")

const {
  PORT = 3100,
  BASE_URL = "http://localhost:3100/",
  REDIS_CONN_STRING = "",
  KEEP_ALIVE_FOR = 5, // seconds
  LEEWAY_TIME = 1, // seconds
  LIVESTATUS_CHANNEL = "/livestatus",
  HEARTBEAT_CHANNEL = "/heartbeat",
  KEY_NAMESPACE = "user:"
} = process.env

const io = SocketIo(PORT, {})
const store = new Redis(REDIS_CONN_STRING)
const pubsub = new Redis(REDIS_CONN_STRING)

/** Ensure Redis config is set to enable keyspace notifs */
store.on("ready", async () => {
  await store.config("SET", "notify-keyspace-events", "Ex")
})

function getUserId(needle, haystack) {
  const regex = new RegExp(`^${needle}`)
  return haystack.replace(regex, "")
}


/** Send live status of all currently alive users in the beginning, when someone subscribes */
io.on("connection", async (socket) => {
  log.debug("==> socket id %s has connected...", socket.id)
  try {
    const timestamp = Date.now()
    const alives = await store.keys(`${KEY_NAMESPACE}*`)
    alives.forEach((key) => socket.emit(LIVESTATUS_CHANNEL, { userId: getUserId(KEY_NAMESPACE, key), status: "online", timestamp }))

    socket.on(HEARTBEAT_CHANNEL, async ({ userId }) => {
      try {
        const timestamp = Date.now()
        log.info("==> heartbeat rcvd from userid %s", userId)
        const key = `${KEY_NAMESPACE}${userId}`
        const keyExists = await store.get(key)
        if (keyExists === null) { // new Key
          console.log("*******************************************");
          await store.set(key, 1, "EX", KEEP_ALIVE_FOR + LEEWAY_TIME)
          io.emit(LIVESTATUS_CHANNEL, { userId, status: "online", timestamp }) //Question: why does this need broadcast. i.e. socket.emit() doesn't work! why?
        } else { // existing Key
          await store.expire(key, KEEP_ALIVE_FOR + LEEWAY_TIME) // live for some more!
        }
      } catch (e) {
        log.error(e, "[[Hearbeat ERR]]")
      }
    })
    
    
    /** Tell when an user goes offline */
    pubsub.subscribe("__keyevent@0__:expired")
    pubsub.on("message", (channel, message) => {
      const timestamp = Date.now()
      const userId = getUserId(KEY_NAMESPACE, message)
      socket.emit(LIVESTATUS_CHANNEL, { userId, status: "offline", timestamp })
      log.info("==> redis key deleted for userId %s", userId)
    })

  } catch (e) {
    log.error(e, "[[Subscription ERR]] ")
  }
})

