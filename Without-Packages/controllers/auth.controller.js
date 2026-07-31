const User = require("../models/user.model");
const AppError = require("../errors/AppError");
const validateEmail = require("../validators/emailValidator");
const validatePassword = require("../validators/passwordValidator");
const bcrypt = require("bcrypt");

exports.SignUp = async (req, res, next) => {
  try {
    if (!req.body.email || !req.body.password) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        email: ["This field is required."],
        password: ["This field is required."],
      });
    }

    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    if (!validateEmail(email)) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        email: ["Enter a valid email address."],
      });
    }

    const user_query = await User.findOne({ email: email });
    if (user_query) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        email: ["User is already registered with this e-mail address."],
      });
    }

    if (!validatePassword(password)) {
      throw new AppError("validation_error", 400, "Validation failed.", {
        password: ["Enter a valid password."],
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

exports.verifyEmail = async (req,res,next) => {

  
}
