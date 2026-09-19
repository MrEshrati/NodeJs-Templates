const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const normalizePageSize = (value) => {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    return DEFAULT_PAGE_SIZE;
  }

  const pageSize = Number(value);

  if (pageSize < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(pageSize, MAX_PAGE_SIZE);
};

const validateNotificationList = (query = {}) => {
  const requestQuery =
    query !== null && typeof query === "object" && !Array.isArray(query)
      ? query
      : {};

  return {
    data: {
      unread:
        requestQuery.unread === "true" || requestQuery.unread === "1",
      pageSize: normalizePageSize(requestQuery.page_size),
      cursor:
        typeof requestQuery.cursor === "string" && requestQuery.cursor !== ""
          ? requestQuery.cursor
          : null,
    },
    fields: {},
  };
};

module.exports = validateNotificationList;
