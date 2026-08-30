const User = require("../models/user.model");
const bcrypt = require("bcrypt");
const {
  issueEmailVerificationToken,
} = require("../services/emailVerification.service");

const { sendVerificationEmail } = require("../services/email.service");

exports.SignUp = async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;

    let existingUser = await User.findOne({ email: email });

    if (!existingUser) {
      const hashedPassword = await bcrypt.hash(password, 12);
      const user = new User({
        email: email,
        password: hashedPassword,
        emailVerified: false,
      });

      try {
        existingUser = await user.save();
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }

        existingUser = await User.findOne({ email });

        if (!existingUser) {
          throw error;
        }

      }
    }

    if (!existingUser.emailVerified) {
      const { token } = await issueEmailVerificationToken(existingUser._id);
      const { previewUrl } = await sendVerificationEmail(
        existingUser.email,
        token,
      );
      if (previewUrl) {
        console.log(`Verification email preview: ${previewUrl}`);
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
