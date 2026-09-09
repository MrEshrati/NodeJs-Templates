const { OAuth2Client } = require("google-auth-library");
const User = require("../models/user.model");

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

const inspectGoogleIdentity = async (identity) => {
  const subject = identity?.subject;
  const email = identity?.email;

  if (
    typeof subject !== "string" ||
    subject.trim() === "" ||
    typeof email !== "string" ||
    email.trim() === ""
  ) {
    throw new TypeError("A verified Google identity is required.");
  }

  const normalizedSubject = subject.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const subjectLinkedUser = await User.findOne({
    googleSubject: normalizedSubject,
  })
    .select("_id email googleSubject isActive")
    .lean();

  if (subjectLinkedUser) {
    if (!subjectLinkedUser.isActive) {
      return { status: "user_inactive" };
    }

    return {
      status: "existing",
      user: subjectLinkedUser,
    };
  }

  const emailMatchedUser = await User.findOne({ email: normalizedEmail })
    .select("_id email googleSubject isActive")
    .lean();

  if (!emailMatchedUser) {
    return { status: "create_candidate" };
  }

  if (!emailMatchedUser.isActive) {
    return { status: "user_inactive" };
  }

  const existingGoogleSubject =
    typeof emailMatchedUser.googleSubject === "string" &&
    emailMatchedUser.googleSubject.trim() !== ""
      ? emailMatchedUser.googleSubject.trim()
      : null;

  if (
    existingGoogleSubject &&
    existingGoogleSubject !== normalizedSubject
  ) {
    return { status: "identity_conflict" };
  }

  if (existingGoogleSubject) {
    return {
      status: "existing",
      user: emailMatchedUser,
    };
  }

  return {
    status: "link_candidate",
    user: emailMatchedUser,
  };
};

module.exports = {
  verifyGoogleIdToken,
  inspectGoogleIdentity,
};
