const http = require("http")
const Faye = require("faye")
const Redis = require("ioredis")
const log = require("book")
const { addSeconds } = require("date-fns")

const {
  BASE_URL = "http://localhost:3000/",
  REDIS_CONN_STRING = "",
  KEEP_ALIVE_FOR = 3, // seconds
  LIVESTATUS_CHANNEL = "/livestatus",
  HEARTBEAT_CHANNEL = "/heartbeat",
  KEY_NAMESPACE = "user:"
} = process.env

const bayeux = new Faye.NodeAdapter({ mount: "/" })
const faye = bayeux.getClient()
const store = new Redis(REDIS_CONN_STRING)

const server = http.createServer()
bayeux.attach(server)

/** Lib/Helper functions */
function getUserId(needle, haystack) {
  const regex = new RegExp(`^${needle}`)
  return haystack.replace(regex, "")
}
const isNewId = async (userId) => await store.zrank("online-until", `${KEY_NAMESPACE}${userId}`) === null
const upsertOnline = async (userId, onlineUntilTimestamp) => store.zadd("online-until", onlineUntilTimestamp, `${KEY_NAMESPACE}${userId}`)
const getOnlines = async () => {
  const keys = await store.zrangebyscore("online-until", Date.now(), "+inf")
  return keys.map((key) => getUserId(KEY_NAMESPACE, key))
}
const getOfflines = async () => {
  const keys = await store.zrangebyscore("online-until", "-inf", Date.now())
  return keys.map((key) => getUserId(KEY_NAMESPACE, key))
}


/** Send live status of all currently alive users in the beginning, whenever someone subscribes */
bayeux.on("subscribe", async (clientId, channel) => {
  try {
    log.debug("==> client id %s subscribed to channel %s", clientId, channel)
    if (channel !== LIVESTATUS_CHANNEL) return
    const timestamp = Date.now()
    const onlines = await getOnlines()
    onlines.forEach((userId) => faye.publish(LIVESTATUS_CHANNEL, { userId, status: "online", timestamp }))
  } catch (e) {
    log.error(e, "[[Subscription ERR]] ")
  }
})

/** Handle heartbeats to keep users alive (and also tell when a user comes online) */
faye.subscribe(`${HEARTBEAT_CHANNEL}/*`).withChannel(async (channel, message) => {
  try {
    const timestamp = Date.now()
    const userId = getUserId(`${HEARTBEAT_CHANNEL}/`, channel)
    log.info("==> heartbeat rcvd from userid %s", userId)
    if (await isNewId(userId) === true) { // userId just came online
      faye.publish(LIVESTATUS_CHANNEL, { userId, status: "online", timestamp })
    }
    // heartbeat came, keep the userId alive at least until next heartbeat is expected:
    await upsertOnline(userId, addSeconds(
      Date.now(),
      KEEP_ALIVE_FOR
    ).valueOf())
  } catch (e) {
    log.error(e, "[[Hearbeat ERR]]")
  }
})

/** Tell if one or more users went offline (keep polling) */
setInterval(async () => {
  try {
    const timestamp = Date.now()
    const offlines = await getOfflines()
    offlines.forEach((userId) => faye.publish(LIVESTATUS_CHANNEL, { userId, status: "offline", timestamp }))
    // Purge all those who have just been sent as "offline":
    if (offlines.length > 0) await store.zrem("online-until", offlines.map((userId) => `${KEY_NAMESPACE}${userId}`))
  } catch (e) {
    log.error(e, "[[Offline loop ERR]]")
  }
}, (KEEP_ALIVE_FOR) * 1000)


server.listen(process.env.PORT || 3000)
