const express = require("express");
const accountDeletionController = require("../controllers/accountDeletion.controller");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateAccountDelete = require("../validators/accountDelete.validator");

const router = express.Router();

const accountDeletionThrottle = createRequestThrottle({
  scope: "account-delete:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

router.post(
  "/delete",
  accountDeletionThrottle,
  requireAccessToken,
  validateRequest(validateAccountDelete),
  accountDeletionController.deleteAccount,
);

module.exports = router;