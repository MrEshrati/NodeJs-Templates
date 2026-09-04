const AppError = require("../errors/AppError");
const {
  updateProfile: updateProfileService,
} = require("../services/profile.service");

const serializeProfile = (user) => ({
  email: user.email,
  first_name: user.firstName,
  last_name: user.lastName,
});

exports.getProfile = (req, res, next) => {
  try {
    const user = req.user;
    return res.status(200).json(serializeProfile(user));
  } catch (error) {
    return next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const result = await updateProfileService(req.user._id, req.validatedBody);

    if (result.status === "user_inactive") {
      throw new AppError("User is inactive", 401, "user_inactive");
    }

    if (result.status !== "updated") {
      throw new Error("Unexpected profile update service status.");
    }

    return res.status(200).json(serializeProfile(result.user));
  } catch (error) {
    next(error);
  }
};