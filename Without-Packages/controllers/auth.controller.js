const User = require("../models/user.model");
const bcrypt = require("bcrypt");

exports.SignUp = async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;

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
