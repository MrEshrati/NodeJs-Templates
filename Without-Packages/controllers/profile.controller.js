exports.getProfile = (req, res, next) => {
  try {
    const user = req.user;
    return res.status(200).json({
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
    });
  } catch (error) {
    return next(error);
  }
};
