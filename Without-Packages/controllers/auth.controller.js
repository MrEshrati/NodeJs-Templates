const User = require("../models/user.model");
const bcrypt = require("bcrypt");
const AppError = require("../errors/AppError");
const {
  issueEmailVerificationToken,
  confirmEmailAddress,
  resendEmailVerification,
} = require("../services/emailVerification.service");
const {
  sendVerificationEmail,
  sendAccountExistsEmail,
} = require("../services/email.service");
const { authenticateUser } = require("../services/login.service");
const { rotateRefreshToken } = require("../services/refreshToken.service");

const LOGIN_ERROR_MESSAGES = {
  invalid_credentials: "Unable to log in with provided credentials.",
  account_disabled: "User account is disabled.",
  email_not_verified: "E-mail is not verified.",
};
const REFRESH_TOKEN_ERROR_MESSAGES = {
  token_not_valid: "Token is blacklisted",
  no_active_account: "No active account found for the given token.",
};

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

exports.resendVerification = async (req, res, next) => {
  try {
    const { email } = req.validatedBody;
    const emailResult = await resendEmailVerification(email);

    if (emailResult.previewUrl) {
      console.log(`Email preview: ${emailResult.previewUrl}`);
    }

    res.status(200).json({
      detail: "ok",
    });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;
    const result = await authenticateUser(email, password);

    if (result.status === "login_throttled") {
      throw new AppError(
        "Too many failed login attempts. Try again later.",
        429,
        "throttled",
      );
    }

    const errorMessage = LOGIN_ERROR_MESSAGES[result.status];

    if (errorMessage) {
      throw new AppError("Validation failed.", 400, "validation_error", {
        non_field_errors: [
          {
            code: "invalid",
            message: errorMessage,
          },
        ],
      });
    }

    if (result.status !== "authenticated") {
      throw new Error("Unexpected login service status.");
    }

    return res.status(200).json(result.tokens);
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refresh } = req.validatedBody;
    const result = await rotateRefreshToken(refresh);
    const errorMessage = REFRESH_TOKEN_ERROR_MESSAGES[result.status];

    if (errorMessage) {
      throw new AppError(errorMessage, 401, result.status);
    }

    if (result.status !== "refreshed") {
      throw new Error("Unexpected refresh token service status.");
    }

    return res.status(200).json(result.tokens);
  } catch (error) {
    next(error);
  }
};
