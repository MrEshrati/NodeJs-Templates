const User = require("../models/user.model");
const AppError = require("../errors/AppError");
const validateEmail = require("../validators/emailValidator");
const validatePassword = require("../validators/passwordValidator");
const bcrypt = require("bcrypt");

exports.SignUp = async (req, res, next) => {
  try {
    const fields = {};
    const body = req.body || {};
    const rawEmail = body.email;
    const password = body.password;
    let email;

    const emailMissing =
      rawEmail === undefined || rawEmail === null || rawEmail === "";

    if (emailMissing) {
      fields.email = [
        {
          code: "required",
          message: "This field is required.",
        },
      ];
    } else if (typeof rawEmail !== "string") {
      fields.email = [
        {
          code: "invalid",
          message: "Enter a valid email address.",
        },
      ];
    } else {
      email = rawEmail.trim().toLowerCase();

      if (!validateEmail(email)) {
        fields.email = [
          {
            code: "invalid",
            message: "Enter a valid email address.",
          },
        ];
      }
    }

    const passwordMissing =
      password === undefined || password === null || password === "";

    if (passwordMissing) {
      fields.password = [
        {
          code: "required",
          message: "This field is required.",
        },
      ];
    } else if (typeof password !== "string") {
      fields.password = [
        {
          code: "invalid",
          message: "Enter a valid password.",
        },
      ];
    } else {
      const passwordErrors = validatePassword(password);

      if (passwordErrors.length > 0) {
        fields.password = passwordErrors;
      }
    }

    if (Object.keys(fields).length > 0) {
      throw new AppError("Validation failed.", 400, "validation_error", fields);
    }

    const existingUser = await User.findOne({ email: email });

    if (!existingUser) {
      const hashedPassword = await bcrypt.hash(password, 12);
      const user = new User({
        email: email,
        password: hashedPassword,
        emailVerified: false,
      });

      try {
        await user.save();
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }
      }
    }

    res.status(201).json({
      detail: "Verification e-mail sent.",
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {};
