const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization";
const PREFLIGHT_MAX_AGE_SECONDS = "600";

const cors = (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
};

module.exports = cors;
