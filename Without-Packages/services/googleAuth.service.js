const { OAuth2Client } = require("google-auth-library");
const User = require("../models/user.model");
const { issueTokenPair } = require("./token.service");

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

const resolveGoogleIdentity = async (identity) => {
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

  const normalizedIdentity = {
    subject: subject.trim(),
    email: email.trim().toLowerCase(),
  };

  await User.init();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inspection = await inspectGoogleIdentity(normalizedIdentity);

    if (
      inspection.status === "user_inactive" ||
      inspection.status === "identity_conflict"
    ) {
      return inspection;
    }

    if (inspection.status === "existing") {
      return {
        status: "resolved",
        userId: inspection.user._id,
        created: false,
      };
    }

    try {
      if (inspection.status === "link_candidate") {
        const linkedUser = await User.findOneAndUpdate(
          {
            _id: inspection.user._id,
            email: inspection.user.email,
            isActive: true,
            $or: [
              { googleSubject: { $exists: false } },
              { googleSubject: null },
              { googleSubject: "" },
            ],
          },
          {
            $set: {
              googleSubject: normalizedIdentity.subject,
              emailVerified: true,
            },
          },
          {
            new: true,
            upsert: false,
            runValidators: true,
          },
        )
          .select("_id")
          .lean();

        if (linkedUser) {
          return {
            status: "resolved",
            userId: linkedUser._id,
            created: false,
          };
        }

        continue;
      }

      if (inspection.status === "create_candidate") {
        const createdUser = await User.create({
          email: normalizedIdentity.email,
          googleSubject: normalizedIdentity.subject,
          password: null,
          emailVerified: true,
        });

        return {
          status: "resolved",
          userId: createdUser._id,
          created: true,
        };
      }

      throw new Error("Unexpected Google identity inspection status.");
    } catch (error) {
      const duplicateIdentity =
        error?.code === 11000 &&
        (error.keyPattern?.email === 1 ||
          error.keyPattern?.googleSubject === 1 ||
          Object.prototype.hasOwnProperty.call(error.keyValue ?? {}, "email") ||
          Object.prototype.hasOwnProperty.call(
            error.keyValue ?? {},
            "googleSubject",
          ) ||
          error.message?.includes("email_1") ||
          error.message?.includes("googleSubject_1"));

      if (!duplicateIdentity) {
        throw error;
      }
    }
  }

  return { status: "identity_conflict" };
};

const authenticateWithGoogle = async (idToken) => {
  const verification = await verifyGoogleIdToken(idToken);

  if (
    verification.status === "authentication_failed" ||
    verification.status === "social_email_unverified"
  ) {
    return verification;
  }

  if (verification.status !== "verified") {
    throw new Error("Unexpected Google ID-token verification status.");
  }

  const resolution = await resolveGoogleIdentity(verification.identity);

  if (resolution.status === "user_inactive") {
    return resolution;
  }

  if (resolution.status === "identity_conflict") {
    return { status: "authentication_failed" };
  }

  if (
    resolution.status !== "resolved" ||
    resolution.userId === undefined ||
    resolution.userId === null ||
    typeof resolution.created !== "boolean"
  ) {
    throw new Error("Unexpected Google identity resolution status.");
  }

  const tokens = await issueTokenPair(resolution.userId);

  return {
    status: "authenticated",
    tokens,
    created: resolution.created,
  };
};

module.exports = {
  verifyGoogleIdToken,
  inspectGoogleIdentity,
  resolveGoogleIdentity,
  authenticateWithGoogle,
};
