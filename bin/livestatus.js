const Faye = require("faye")
const faye = new Faye.Client(process.env.BASE_URL || "http://localhost:3000/faye")

faye.subscribe("/livestatus", async ({ userId, status, timestamp }) => {
  console.log(`User ${userId} is now ${status}`);
})
