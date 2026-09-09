const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization";
const PREFLIGHT_MAX_AGE_SECONDS = "600";

const cors = (req, res, next) => {
  let frontendOrigin;

  try {
    frontendOrigin = new URL(process.env.FRONTEND_URL).origin;
  } catch {
    return next(new Error("FRONTEND_URL is not configured correctly."));
  }

  const requestOrigin =
    typeof req.get === "function"
      ? req.get("origin")
      : req.headers?.origin;

  res.setHeader("Vary", "Origin");

  if (requestOrigin === frontendOrigin) {
    res.setHeader("Access-Control-Allow-Origin", frontendOrigin);
  }

  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
};

module.exports = cors;
