const createResponse = () => ({
  statusCode: null,
  body: undefined,
  ended: false,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  end() {
    this.ended = true;
    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = String(value);
  },
});

const captureNext = () => {
  const calls = [];
  const next = (error) => calls.push(error);
  next.calls = calls;
  return next;
};

module.exports = {
  createResponse,
  captureNext,
};
