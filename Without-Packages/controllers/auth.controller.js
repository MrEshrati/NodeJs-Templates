const User = require("../models/user.model");
const AppError = require("../errors/AppError");
const validateEmail = require("../validators/emailValidator");
const validatePassword = require("../validators/passwordValidator");
const bcrypt = require("bcrypt");

exports.SignUp = async (req, res, next) => {
  try {
    const fields = {};
    const rawEmail = req.body.email;
    const password = req.body.password;

    if (!rawEmail) {
      fields.email = [
        {
          code: "required",
          message: "This field is required.",
        },
      ];
      throw new AppError("Validation failed.", 400, "validation_error", {
        fields,
      });
    } else if (!password) {
      fields.password = [
        {
          code: "required",
          message: "This field is required.",
        },
      ];
      throw new AppError("Validation failed.", 400, "validation_error", {
        fields,
      });
    }

    if (typeof rawEmail !== "string") {
      fields.email = [
        {
          code: "invalid",
          message: "Enter a valid email address.",
        },
      ];
      throw new AppError("Validation failed.", 400, "validation_error", {
        fields,
      });
    }

    const email = rawEmail.trim().toLowerCase();
    if (!validateEmail(email)) {
      fields.email = [
        {
          code: "invalid",
          message: "Enter a valid email address.",
        },
      ];
      throw new AppError("Validation failed.", 400, "validation_error", {
        fields,
      });
    }

    const user_query = await User.findOne({ email: email });
    if (user_query) {
      fields.email = [
        {
          code: "duplicate",
          message: "User is already registered with this e-mail address.",
        },
      ];
      throw new AppError("Validation failed.", 400, "validation_error", {
        fields,
      });
    }

    if (!validatePassword(password)) {
      fields.password = [
        {
          code: "invalid",
          message: "Enter a valid password.",
        },
      ];
      throw new AppError("Validation failed.", 400, "validation_error", {
        fields,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({
      email: email,
      password: hashedPassword,
      EmailVerified: false,
    });

    await user.save();

    res.status(201).json({
      detail: "Verification e-mail sent.",
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {};
