const express = require("express");
const mongoose = require("mongoose");
const app = express();
const authRouter = require("./routes/auth.route");
const profileRouter = require("./routes/profile.route");
const accountRouter = require("./routes/account.route");
const passwordRouter = require("./routes/password.route");
const emailRouter = require("./routes/email.route");
const googleRouter = require("./routes/google.route");
const errorHandler = require("./middlewares/errorHandler.middleware");
require("dotenv").config();

const PORT = process.env.PORT;
const DB_URL = process.env.DB_URL;

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

mongoose
  .connect(DB_URL)
  .then((result) => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.log(err);
  });
