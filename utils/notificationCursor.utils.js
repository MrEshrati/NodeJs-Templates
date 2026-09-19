const MAX_CURSOR_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const CURSOR_DIRECTIONS = new Set(["next", "previous"]);

const normalizeDate = (value) => {
  if (!(value instanceof Date) && typeof value !== "string") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeId = (value) => {
  let id;

  try {
    id = String(value);
  } catch {
    return null;
  }

  return OBJECT_ID_PATTERN.test(id) ? id.toLowerCase() : null;
};

const encodeNotificationCursor = ({ createdAt, id, direction } = {}) => {
  const normalizedCreatedAt = normalizeDate(createdAt);
  const normalizedId = normalizeId(id);

  if (!normalizedCreatedAt || !normalizedId) {
    throw new TypeError("Cursor position is invalid.");
  }

  if (!CURSOR_DIRECTIONS.has(direction)) {
    throw new TypeError('Cursor direction must be "next" or "previous".');
  }

  const payload = JSON.stringify({
    createdAt: normalizedCreatedAt.toISOString(),
    id: normalizedId,
    direction,
  });

  return Buffer.from(payload, "utf8").toString("base64url");
};

const decodeNotificationCursor = (cursor) => {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(cursor)
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(cursor, "base64url");

    if (decoded.toString("base64url") !== cursor) {
      return null;
    }

    const payload = JSON.parse(decoded.toString("utf8"));

    if (
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.createdAt !== "string" ||
      typeof payload.id !== "string" ||
      !CURSOR_DIRECTIONS.has(payload.direction)
    ) {
      return null;
    }

    const createdAt = normalizeDate(payload.createdAt);
    const id = normalizeId(payload.id);

    if (!createdAt || createdAt.toISOString() !== payload.createdAt || !id) {
      return null;
    }

    return {
      createdAt,
      id,
      direction: payload.direction,
    };
  } catch {
    return null;
  }
};

module.exports = {
  decodeNotificationCursor,
  encodeNotificationCursor,
};
