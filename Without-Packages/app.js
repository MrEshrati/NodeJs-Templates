require("dotenv").config({ quiet: true });

const express = require("express");
const mongoose = require("mongoose");
const authRouter = require("./routes/auth.route");
const profileRouter = require("./routes/profile.route");
const accountRouter = require("./routes/account.route");
const passwordRouter = require("./routes/password.route");
const emailRouter = require("./routes/email.route");
const googleRouter = require("./routes/google.route");
const errorHandler = require("./middlewares/errorHandler.middleware");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  next();
});

app.use("/auth", authRouter);
app.use("/profile", profileRouter);
app.use("/", accountRouter);
app.use("/password", passwordRouter);
app.use("/email", emailRouter);
app.use("/google", googleRouter);

app.use(errorHandler);

const getRequiredEnvironmentVariable = (name) => {
  const value = process.env[name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} environment variable is required.`);
  }

  return value.trim();
};

const startServer = async () => {
  const port = getRequiredEnvironmentVariable("PORT");
  const databaseUrl = getRequiredEnvironmentVariable("DB_URL");

  await mongoose.connect(databaseUrl);

  return app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  startServer,
};
