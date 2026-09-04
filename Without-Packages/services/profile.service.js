const User = require("../models/user.model");
const PROFILE_FIELDS = ["firstName", "lastName"];

const updateProfile = async (userId, changes = {}) => {
  const update = {};

  const changesValidate =
    changes !== null && typeof changes === "object" && !Array.isArray(changes)
      ? changes
      : {};

  for (const field of PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(changesValidate, field)) {
      continue;
    }

    update[field] = changesValidate[field];
  }

  let user;

  if (Object.keys(update).length === 0) {
    user = await User.findOne({
      _id: userId,
      isActive: true,
    })
      .select("_id email firstName lastName")
      .lean();
  } else {
    user = await User.findOneAndUpdate(
      { _id: userId, isActive: true },
      { $set: update },
      {
        returnDocument: "after",
        runValidators: true,
      },
    )
      .select("_id email firstName lastName")
      .lean();
  }

  if (!user) {
    return { status: "user_inactive"};
  }

  return {
    status: "updated",
    user,
  };
};

module.exports = {
  updateProfile,
};
