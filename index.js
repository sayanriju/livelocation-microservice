const http = require("http")
const Faye = require("faye")
const Redis = require("ioredis")
const log = require("book")

const {
  BASE_URL = "http://localhost:3000/",
  REDIS_CONN_STRING = "",
  KEEP_ALIVE_FOR = 5, // seconds
  LEEWAY_TIME = 1, // seconds
  LIVESTATUS_CHANNEL = "/livestatus",
  HEARTBEAT_CHANNEL = "/heartbeat",
  KEY_NAMESPACE = "user:"
} = process.env

const bayeux = new Faye.NodeAdapter({ mount: "/" })
const faye = bayeux.getClient()
const store = new Redis(REDIS_CONN_STRING)
const pubsub = new Redis(REDIS_CONN_STRING)

const server = http.createServer()
bayeux.attach(server)

/** Ensure Redis config is set to enable keyspace notifs */
store.on("ready", async () => {
  await store.config("SET", "notify-keyspace-events", "Ex")
})


/** Send live status of all currently alive users in the beginning, when someone subscribes */
bayeux.on("subscribe", async (clientId, channel) => {
  try {
    log.debug("==> client id %s subscribed to channel %s", clientId, channel)
    if (channel !== LIVESTATUS_CHANNEL) return
    const timestamp = Date.now()
    const alives = await store.keys(`${KEY_NAMESPACE}*`)
    alives.forEach((key) => faye.publish(LIVESTATUS_CHANNEL, { userId: key.replace(KEY_NAMESPACE, ""), status: "online", timestamp }))
  } catch (e) {
    log.error(e, "[[Subscription ERR]] ")
  }
})

/** Handle heartbeats to keep users alive */
faye.subscribe(`${HEARTBEAT_CHANNEL}/*`).withChannel(async (channel, message) => {
  try {
    const timestamp = Date.now()
    const userId = channel.replace(`${HEARTBEAT_CHANNEL}/`, "")
    log.info("==> heartbeat rcvd from userid %s", userId)
    const key = `${KEY_NAMESPACE}${userId}`
    const keyExists = await store.get(key)
    if (keyExists === null) { // new Key
      await store.set(key, 1, "EX", KEEP_ALIVE_FOR + LEEWAY_TIME)
      faye.publish(LIVESTATUS_CHANNEL, { userId, status: "online", timestamp })
    } else { // existing Key
      await store.expire(key, KEEP_ALIVE_FOR + LEEWAY_TIME) // live for some more!
    }
  } catch (e) {
    log.err(e, "[[Hearbeat ERR]]")
  }
})

/** Tell when an user goes offline */
pubsub.subscribe("__keyevent@0__:expired")
pubsub.on("message", (channel, message) => {
  const timestamp = Date.now()
  const userId = message.replace(KEY_NAMESPACE, "")
  faye.publish(LIVESTATUS_CHANNEL, { userId, status: "offline", timestamp })
  log.info("==> redis key deleted for userId %s", userId)
})


server.listen(process.env.PORT || 3000)
