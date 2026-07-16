const User = require("../models/user.model");
const AppError = require("../errors/AppError");
const validateEmail = require("../validators/emailValidator");
const validatePassword = require("../validators/passwordValidator");
const bcrypt = require("bcrypt");

exports.SignUp = async (req, res, next) => {
  const email = req.body.email.trim().toLowerCase();
  const password1 = req.body.password1;
  const password2 = req.body.password2;

  try {
    if (!email || !password1 || !password2) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        email: ["This field is required."],
        password1: ["This field is required."],
        password2: ["This field is required."],
      });
    }

    if (!validateEmail(email)) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        email: ["Enter a valid email address."],
      });
    }

    const user = await User.findOne({ email: email });
    if (user && user.EmailVerified) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        email: ["User is already registered with this e-mail address."],
      });
    }

    if (!validatePassword(password1)) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        password1: ["Enter a valid password."],
      });
    }

    if (password1 !== password2) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        non_field_errors: ["The two password fields didn't match."],
      });
    }

    const hashedPassword = await bcrypt.hash(password1, 12);
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
