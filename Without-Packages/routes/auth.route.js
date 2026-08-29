const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const validateRequest = require("../middlewares/validation.middleware");
const validateRegistration = require("../validators/register.validator");

router.post(
  "/register",
  validateRequest(validateRegistration),
  authController.SignUp,
);

module.exports = router;
