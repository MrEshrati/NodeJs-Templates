const User = require("../models/user.model");
const bcrypt = require("bcrypt");
const AppError = require("../errors/AppError");
const {
  issueEmailVerificationToken,
  confirmEmailAddress,
} = require("../services/emailVerification.service");
const {
  sendVerificationEmail,
  sendAccountExistsEmail,
} = require("../services/email.service");

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

    let emailResult;

    if (!existingUser.emailVerified) {
      const { token } = await issueEmailVerificationToken(existingUser._id);
      emailResult = await sendVerificationEmail(existingUser.email, token);
    } else {
      emailResult = await sendAccountExistsEmail(existingUser.email);
    }

    if (emailResult.previewUrl) {
      console.log(`Email preview: ${emailResult.previewUrl}`);
    }

    res.status(201).json({
      detail: "Verification e-mail sent.",
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { key } = req.validatedBody;
    const { status } = await confirmEmailAddress(key);

    if (status === "invalid") {
      throw new AppError("Validation failed.", 400, "validation_error", {
        key: [
          {
            code: "invalid",
            message: "Invalid or expired confirmation key.",
          },
        ],
      });
    } else if (status === "unable") {
      throw new AppError(
        "Unable to confirm this email address.",
        400,
        "validation_error",
      );
    }

    res.status(200).json({
      detail: "ok",
    });
  } catch (error) {
    next(error);
  }
};
