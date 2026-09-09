require("dotenv").config({ quiet: true });

const express = require("express");
const mongoose = require("mongoose");
const authRouter = require("./routes/auth.route");
const profileRouter = require("./routes/profile.route");
const accountRouter = require("./routes/account.route");
const passwordRouter = require("./routes/password.route");
const emailRouter = require("./routes/email.route");
const googleRouter = require("./routes/google.route");
const securityHeaders = require("./middlewares/securityHeaders.middleware");
const notFound = require("./middlewares/notFound.middleware");
const errorHandler = require("./middlewares/errorHandler.middleware");
const { validateEnvironment } = require("./config/environment");

const app = express();
const REQUEST_BODY_LIMIT = "16kb";

app.use(securityHeaders);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  next();
});

app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(
  express.urlencoded({
    extended: true,
    limit: REQUEST_BODY_LIMIT,
  }),
);

app.use("/auth", authRouter);
app.use("/profile", profileRouter);
app.use("/", accountRouter);
app.use("/password", passwordRouter);
app.use("/email", emailRouter);
app.use("/google", googleRouter);

app.use(notFound);
app.use(errorHandler);

const startServer = async () => {
  const { port, databaseUrl } = validateEnvironment();

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
