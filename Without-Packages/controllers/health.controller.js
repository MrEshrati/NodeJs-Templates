const mongoose = require("mongoose");

const getLiveness = (_req, res) =>
  res.status(200).json({
    status: "ok",
  });

const getReadiness = (_req, res) => {
  const databaseConnected =
    mongoose.connection.readyState === mongoose.Connection.STATES.connected;

  return res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "ready" : "unavailable",
  });
};

module.exports = {
  getLiveness,
  getReadiness,
};
