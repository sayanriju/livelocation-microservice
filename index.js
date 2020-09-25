/* eslint-disable no-unused-vars */
const http = require("http")
const Faye = require("faye")
const Redis = require("ioredis")

const {
  BASE_URL = "http://localhost:3000/",
  REDIS_CONN_STRING = "",
  KEEP_ALIVE_FOR = 5, // seconds
  LEEWAY_TIME = 1, // seconds
} = process.env

const bayeux = new Faye.NodeAdapter({ mount: "/" })
const faye = new Faye.Client(BASE_URL)
const store = new Redis(REDIS_CONN_STRING)
const pubsub = new Redis(REDIS_CONN_STRING)

const server = http.createServer()
bayeux.attach(server)


/** Send live status of all currently alive users in the beginning, when someone subscribes */
bayeux.on("subscribe", async (clientId, channel) => {
  try {
    console.log("==> subscribed to channel........", channel, clientId)
    if (channel !== "/livestatus") return
    const timestamp = Date.now()
    const alives = await store.keys("user::*")
    alives.forEach((userId) => faye.publish("/livestatus", { userId, status: "online", timestamp }))
  } catch (e) {
    console.log("==> ERR (1): ", e);
  }
})

/** Handle heartbeats to keep users alive */
faye.subscribe("/heartbeat/*").withChannel(async (channel, message) => {
  try {
    const timestamp = Date.now()
    const userId = channel.replace("/heartbeat/", "")
    console.log("==> heartbeat rcvd from userid ", userId)
    const key = `user::${userId}`
    const keyExists = await store.get(key)
    if (keyExists === null) { // new Key
      await store.set(key, 1, "EX", KEEP_ALIVE_FOR + LEEWAY_TIME)
      faye.publish("/livestatus", { userId, status: "online", timestamp })
    } else { // existing Key
      await store.expire(key, KEEP_ALIVE_FOR) // live for some more!
    }
  } catch (e) {
    console.log("==> ERR (2): ", e);
  }
})

/** Tell when an user goes offline */
pubsub.subscribe("__keyevent@0__:expired")
pubsub.on("message", (channel, message) => {
  console.log("==> redis key deleted........")
  const timestamp = Date.now()
  const userId = message.replace("user::", "")
  faye.publish("/livestatus", { userId, status: "offline", timestamp })
})


server.listen(process.env.PORT || 3000)
