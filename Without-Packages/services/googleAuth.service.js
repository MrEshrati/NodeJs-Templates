const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client();

const getGoogleClientId = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (typeof clientId !== "string" || clientId.trim() === "") {
    throw new Error("GOOGLE_CLIENT_ID environment variable is required.");
  }

  return clientId.trim();
};

const verifyGoogleIdToken = async (idToken) => {
  const clientId = getGoogleClientId();

  if (typeof idToken !== "string" || idToken.trim() === "") {
    return { status: "authentication_failed" };
  }

  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: idToken.trim(),
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    return { status: "authentication_failed" };
  }

  const validPayload = payload !== null && typeof payload === "object";
  const validSubject =
    validPayload &&
    typeof payload.sub === "string" &&
    payload.sub.trim() !== "";
  const validEmail =
    validPayload &&
    typeof payload.email === "string" &&
    payload.email.trim() !== "";

  if (!validSubject || !validEmail) {
    return { status: "authentication_failed" };
  }

  if (payload.email_verified !== true) {
    return { status: "social_email_unverified" };
  }

  return {
    status: "verified",
    identity: {
      subject: payload.sub.trim(),
      email: payload.email.trim().toLowerCase(),
    },
  };
};

module.exports = { verifyGoogleIdToken };
