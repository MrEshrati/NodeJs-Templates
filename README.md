# Node.js Account, Notification, and Payment API Template

[![API CI](https://github.com/MrEshrati/NodeJs-Templates/actions/workflows/ci.yml/badge.svg)](https://github.com/MrEshrati/NodeJs-Templates/actions/workflows/ci.yml)

This repository is a complete account-management, notification, and payment
API template built with Node.js, Express, and MongoDB. It favors Node.js
platform APIs for security-sensitive building blocks such as request
validation, JWT signing and verification, OTP hashing, cursor handling,
throttling, and payment HTTP adapters.

Focused dependencies provide the required platform integrations:

- Express for HTTP routing
- Mongoose for MongoDB access and transactions
- bcrypt for password hashing
- Nodemailer for development email delivery
- Google Auth Library for official Google ID-token verification
- dotenv for local environment loading

## Features

- Password, OTP, and Google authentication with rotating refresh sessions
- Email verification, password recovery, email change, and account deactivation
- User-scoped notification feeds, preferences, and device registration
- Stripe and ZarinPal integrations with fake development providers
- Layered throttling, consistent errors, CORS, security headers, and health checks
- Unit, integration, and MongoDB-backed end-to-end tests with coverage gates

## Requirements

- Node.js 24 or newer
- npm
- MongoDB configured as a replica set
- Network access when testing Google authentication or Ethereal email previews
- A Google OAuth web client ID for Google sign-in

MongoDB transactions are used for password reset, password change, email
change, and device-token registration operations. The example connection
string assumes a local replica set named `rs0`.

## Quick start

Install the locked dependencies:

```powershell
npm ci
```

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

Replace `GOOGLE_CLIENT_ID` and the four account-secret placeholders. Generate a
different value for each account secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run that command separately for each secret. Do not reuse one value across
multiple variables. Payment-provider credentials may remain as placeholders in
fake mode, but must be replaced before enabling live payments.

Start the API:

```powershell
npm start
```

For automatic restarts during development:

```powershell
npm run dev
```

The default example listens at `http://localhost:3000`.

When the directly executed server receives `SIGINT` or `SIGTERM`, it stops the
HTTP server before disconnecting MongoDB. Repeated shutdown signals share the
same cleanup operation. A 10-second shutdown deadline force-closes lingering
HTTP connections, and any cleanup failure sets a failing process exit code.

The HTTP server allows 10 seconds for headers, 30 seconds for a complete
request or inactive socket, and 5 seconds for an idle keep-alive connection.

## Environment configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port from 1 through 65535. |
| `NODE_ENV` | Runtime mode: `development`, `test`, or `production`. Production startup is rejected while email uses Ethereal. |
| `DB_URL` | MongoDB connection URL. The example uses the `rs0` replica set. |
| `TEST_DB_URL` | Dedicated MongoDB URL for database-backed tests; its database name must end with `_test`. |
| `FRONTEND_URL` | Frontend base URL used in email links and as the allowed browser CORS origin. |
| `GOOGLE_CLIENT_ID` | Audience expected in Google ID tokens. |
| `JWT_SECRET` | HMAC secret for access and refresh JWTs; at least 32 UTF-8 bytes. |
| `OTP_SECRET` | HMAC secret for OTP codes; at least 32 UTF-8 bytes. |
| `LOGIN_THROTTLE_SECRET` | HMAC secret used to protect login-throttle identifiers; at least 32 UTF-8 bytes. |
| `REQUEST_THROTTLE_SECRET` | HMAC secret used to protect request-throttle identifiers; at least 32 UTF-8 bytes. |
| `PAYMENT_IDEMPOTENCY_SECRET` | HMAC secret used to derive user-scoped provider idempotency keys; at least 32 UTF-8 bytes. |
| `PAYMENT_PROVIDER` | Active payment integration: `stripe` or `zarinpal`. |
| `PAYMENT_FAKE_MODE` | Strict `true` or `false`; enables development payment simulation when true. |
| `STRIPE_SECRET_KEY` | Stripe server credential required for live Stripe payments. |
| `STRIPE_PUBLISHABLE_KEY` | Stripe client key returned when creating live Stripe payments. |
| `STRIPE_WEBHOOK_SECRET` | Stripe signature secret required for live webhook verification. |
| `ZARINPAL_MERCHANT_ID` | Merchant identifier required for live ZarinPal payments. |
| `ZARINPAL_CALLBACK_URL` | HTTP or HTTPS callback URL required for live ZarinPal payments. |

The server validates all configuration before connecting to MongoDB. Live
credentials are required only for the selected provider when fake mode is
disabled. Secret values are never included in configuration error messages.
The real `.env` file is ignored by Git; only `.env.example` should be committed.

The test database helper refuses to connect to or clear a database whose name
does not end with `_test`. It deletes documents between tests without dropping
collections or indexes.

For Google sign-in, create a web client in Google Cloud and place its client ID
in `GOOGLE_CLIENT_ID`. The frontend obtains the Google ID token; the API
verifies its signature, audience, subject, email, and verified-email state.

## Project structure

```text
config/       Startup configuration validation
controllers/  HTTP response contracts and service-status mapping
errors/       Structured application error type
middlewares/  Authentication, validation, throttling, CORS, and security headers
models/       Mongoose account, notification, device, and security records
routes/       Endpoint paths and middleware order
services/     Account workflows and database operations
utils/        JWT, token, and OTP cryptographic helpers
validators/   Request validation and normalization
workers/      Durable account-email queue processing
tests/        Unit, schema, route-contract, and HTTP integration tests
app.js        Express construction and explicit server startup
```

Controllers stay small: validators normalize request data, services own
business and database behavior, and controllers translate service outcomes to
the documented HTTP responses.

## Request conventions

- Send request bodies as `application/json`.
- Request bodies are limited to 16 KB.
- Protected endpoints require `Authorization: Bearer <access-token>`.
- Browser requests are allowed only from the origin in `FRONTEND_URL`.
- Clients without an `Origin` header, including Postman and server-to-server
  clients, remain supported.
- Browser preflight requests return `204` before routing or throttling.
- Token-bearing and account responses use `Cache-Control: no-store`.
- Responses omit the `X-Powered-By` header so the Express implementation is not
  advertised to clients.
- Every response includes a server-generated `X-Request-Id`. Browser clients
  can read this header and use it to correlate unexpected server-error logs.

## API endpoints

### Health

- `GET /health/live` — returns `200` with `{"status":"ok"}` while the Node.js
  process is running.
- `GET /health/ready` — returns `200` with `{"status":"ready"}` when MongoDB is
  connected, or `503` with `{"status":"unavailable"}` otherwise.

Health endpoints require no authentication. They use the same security and
CORS headers as the rest of the API and are never cached.

### Authentication

| Endpoint | Authentication | Body | Result |
| --- | --- | --- | --- |
| `POST /auth/register` | Public | `email`, `password` | Creates an account when needed and sends a verification email. |
| `POST /auth/verify-email` | Public | `key` | Verifies the email confirmation token. |
| `POST /auth/resend-verification` | Public | `email` | Privacy-safe verification resend request. |
| `POST /auth/login` | Public | `email`, `password` | Returns an access and refresh token pair. |
| `POST /auth/token/refresh` | Refresh token | `refresh` | Rotates the refresh session and returns a new token pair. |
| `POST /auth/logout` | Refresh token | `refresh` | Revokes the submitted refresh session. |
| `POST /auth/otp/request` | Public | `email` | Privacy-safe request for a six-digit sign-in code. |
| `POST /auth/otp/verify` | Public | `email`, `code` | Consumes the code and returns a token pair. |
| `POST /google` | Public | `id_token` | Verifies Google identity, links or creates the user, and returns tokens. |

### Profile and account

| Endpoint | Authentication | Body | Result |
| --- | --- | --- | --- |
| `GET /profile` | Access token | None | Returns email, first name, and last name. |
| `PATCH /profile` | Access token | Optional `first_name`, `last_name` | Partially updates supported profile fields. |
| `POST /delete` | Access token plus password or OTP | `password` or `code` | Deactivates the account and revokes active refresh sessions. |

`PUT /profile` is intentionally rejected with `405 Method Not Allowed`; profile
modification is partial and uses `PATCH`.

### Password management

| Endpoint | Authentication | Body | Result |
| --- | --- | --- | --- |
| `POST /password/reset` | Public | `email` | Privacy-safe password-reset email request. |
| `POST /password/reset/confirm` | Public | `uid`, `token`, `new_password` | Consumes the reset token, changes the password, and revokes refresh sessions. |
| `POST /password/change` | Access token plus old password | `old_password`, `new_password` | Changes the password and revokes refresh sessions. |

### Email change

| Endpoint | Authentication | Body | Result |
| --- | --- | --- | --- |
| `POST /email/change` | Access token plus password or OTP | `new_email` and either `password` or `code` | Privacy-safe request that emails the new address. |
| `POST /email/change/confirm` | Public | `key` | Changes the login email and revokes refresh sessions. |

### Notifications

Every notification endpoint requires an access token. Notification records are
always scoped to the authenticated user. Attempts to read, modify, or delete a
notification belonging to another user return `404 not_found` without exposing
the record's owner.

| Endpoint | Body or query | Result |
| --- | --- | --- |
| `GET /notifications` | Optional `unread`, `page_size`, and `cursor` query parameters | Returns the authenticated user's cursor-paginated notification feed. |
| `GET /notifications/unread-count` | None | Returns `{"count": <number>}`. |
| `POST /notifications/read-all` | None | Marks every unread notification as read and returns `marked_read`. |
| `POST /notifications/:notificationId/read` | None | Marks one owned notification as read and returns it. |
| `DELETE /notifications/:notificationId` | None | Deletes one owned notification and returns `204`. |
| `GET /notifications/preferences` | None | Returns the user's push and email settings, creating their defaults when needed. |
| `PATCH /notifications/preferences` | Optional `push_enabled` and `email_enabled` booleans | Partially updates notification channel settings. |
| `POST /notifications/devices` | `token`, `platform` | Registers or updates a push-notification device token. |
| `DELETE /notifications/devices` | `token` | Unregisters an owned device token and returns `204`. |

The feed is ordered newest first. `unread=true` or `unread=1` filters it to
unread records. `page_size` defaults to 20 and is limited to 100. The `cursor`
value is opaque: clients must copy it from a returned pagination URL instead of
constructing or modifying it. An invalid cursor returns `404 not_found`.

A feed response contains absolute `next` and `previous` URLs, or `null` when a
direction is unavailable, plus the current `results` array:

```json
{
  "next": "http://localhost:3000/notifications?page_size=2&cursor=opaque-value",
  "previous": null,
  "results": [
    {
      "id": "notification-id",
      "type": "account.updated",
      "title": "Account updated",
      "body": "Your account was updated.",
      "data": {},
      "read": false,
      "read_at": null,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

New notification preferences default to both `push_enabled: true` and
`email_enabled: true`. Preference updates are partial and preserve explicit
`false` values.

Device platforms are `ios` and `android`. A device token is globally unique;
registering it again updates its owning user and platform. Each user keeps at
most 20 device tokens, with the least recently updated excess tokens removed
inside the registration transaction. Unregistering an absent owned token is
idempotent and still returns `204`.

### Payments

Payment endpoints require an access token. Every stored payment and every
idempotency key is scoped to the authenticated user, so one user cannot retrieve
or simulate another user's payment. The active provider is selected once at
startup with `PAYMENT_PROVIDER`; changing the provider or fake-mode setting
requires a server restart.

| Endpoint | Availability | Body | Result |
| --- | --- | --- | --- |
| `POST /create-payment` | Fake and live modes | `amount`, `currency`, `idempotency_key`, optional `description` | Creates a provider checkout with `201 Created`, or returns the existing checkout with `200 OK` when the idempotency key was already used. |
| `POST /dev/simulate` | Only when `PAYMENT_FAKE_MODE=true` | `payment_id`, `outcome` | Applies a fake provider outcome and returns the serialized payment. |

`amount` is always a positive safe integer. Stripe accepts `USD`, with the
amount expressed in USD cents: `1099` means `$10.99`. ZarinPal accepts `IRR`,
with the amount expressed as whole IRR: `50000` means `50000` IRR.
`description` is limited to 500 characters. The required `idempotency_key` is
limited to 255 URL-safe characters. Use one idempotency key for one logical
payment and never reuse it for different payment details. The API atomically
claims the user-scoped key before contacting the provider. A matching replay
returns the stored checkout, a changed request returns
`409 idempotency_conflict`, and an unfinished request returns
`409 payment_in_progress` without making another provider request.

A Stripe checkout response contains only the internal payment identifier and
the browser-safe Stripe values:

```json
{
  "payment_id": "payment-id",
  "client_secret": "provider-client-secret",
  "publishable_key": "pk_test_or_live_value"
}
```

A ZarinPal checkout response contains the internal payment identifier and the
URL to which the browser should be redirected:

```json
{
  "payment_id": "payment-id",
  "redirect_url": "https://payment.zarinpal.com/pg/StartPay/authority"
}
```

In fake mode, Stripe accepts the simulation outcomes `succeeded`, `failed`, and
`refunded`; a refund covers the full stored amount. Fake ZarinPal accepts
`succeeded` and `failed`. Repeating an already-applied outcome is idempotent.
`PAYMENT_FAKE_MODE=true` never creates real charges or calls Stripe or
ZarinPal. The `/dev/simulate` route does not exist in live mode.

With `PAYMENT_FAKE_MODE=false`, payment creation calls only the provider selected
by `PAYMENT_PROVIDER`. Live Stripe requires its secret and publishable keys;
live ZarinPal requires its merchant ID and callback URL. Provider credentials,
raw responses, and raw provider error messages are never returned to clients.
A safely classified upstream failure returns `502 payment_provider_error`.

To test Stripe locally, set `PAYMENT_PROVIDER=stripe` and
`PAYMENT_FAKE_MODE=true`, restart the server, sign in, and send an access-token
authenticated `POST /create-payment` request with a USD-cent amount. Copy the
returned `payment_id` into `POST /dev/simulate`. To test ZarinPal, change
`PAYMENT_PROVIDER` to `zarinpal`, restart, create an IRR payment, and simulate a
supported outcome. Because the provider choice is fixed at startup, restarting
between the two provider tests is required.

## Token and code lifetimes

| Item | Lifetime or policy |
| --- | --- |
| Access JWT | 10 minutes |
| Refresh JWT and session | 7 days |
| Email-verification link | 1 hour; resend cooldown is 3 minutes |
| OTP sign-in code | 10 minutes; single use; maximum 5 verification attempts |
| OTP resend | 1-minute cooldown |
| Password-reset link | 1 hour; resend cooldown is 3 minutes |
| Email-change link | 1 hour; resend cooldown is 3 minutes |
| Password login failures | 5 failures within 15 minutes block further failed credentials for 15 minutes; a correct password clears the failure state |

Refresh JWT IDs are stored only as SHA-256 hashes. OTP codes are protected with
HMAC-SHA256 and bound to the user ID. Passwords are hashed with bcrypt using a
cost factor of 12.

## Request throttling

Account endpoints allow 10 requests in their configured window for one client
identifier:

- One-minute window: login, token refresh, logout, Google sign-in, profile
  retrieval, profile modification, password change, and account deactivation.
- One-hour window: registration, email verification, verification resend, OTP
  request and verification, password-reset request and confirmation, and
  email-change request and confirmation.

Notification endpoints allow 120 requests per minute for one client
identifier. This shared notification limit covers feed reads, actions,
preference operations, and device registration or removal.

Payment creation allows 20 requests per minute for one client identifier. The
fake-only payment simulation endpoint allows 60 requests per minute. Both
limits are applied before authentication and request validation.

Throttled responses include `Retry-After`. Request and login identifiers are
stored as keyed HMACs rather than raw email or client values.

## Email links in development

When `NODE_ENV=development`, Nodemailer creates an Ethereal test account
automatically. Messages are not delivered to real inboxes. When Ethereal
returns a preview URL, the account-email worker prints it to the server terminal for
manual testing. Preview URLs are suppressed in test mode.

Password-reset, OTP, and verification-resend requests always insert the same
short-lived MongoDB queue document and return without looking up the account or
waiting for SMTP. The worker atomically leases each job, silently discards
unknown or ineligible accounts, and performs eligible token and email work in
the background. Failed deliveries use bounded retries; expired and completed
jobs are removed. This keeps the public response path materially uniform for
known and unknown addresses.

The frontend must own the pages referenced by email links:

- `/confirm-email/<token>`
- `/reset-password?uid=<user-id>&token=<token>`
- `/confirm-email-change?key=<token>`

Opening one of those frontend pages is not the API confirmation itself. The
frontend extracts the value and submits it to the corresponding POST endpoint.

Production startup is rejected while this project uses Ethereal. Replace it
with a production mail provider and update the startup validation before
deploying this project for real users.

## Errors and privacy behavior

Application errors use a consistent JSON envelope:

```json
{
  "error": true,
  "code": "not_found",
  "message": "The requested resource was not found."
}
```

Validation failures also include a `fields` object containing field-specific
codes and messages. Malformed JSON returns `400 invalid_json`, oversized bodies
return `413 payload_too_large`, and unknown routes return `404 not_found`.
Unexpected server errors return a generic `500 internal_error`; their original
details are logged server-side and are not sent to clients.

Payment-provider rejections and connectivity failures are normalized to
`502 payment_provider_error`. Provider credentials, raw response bodies, raw
diagnostic messages, and internal request objects are not included in the
client response.

Registration, OTP request, password-reset request, verification resend, and
email-change availability responses avoid revealing whether an address exists.
OTP failures use one generic response for wrong, expired, consumed,
over-attempt, and unknown-account cases.

## Session invalidation

- Logout revokes the submitted refresh session.
- Password reset and password change revoke all active refresh sessions.
- Email change revokes all active refresh sessions.
- Account deactivation revokes all active refresh sessions.

Existing access JWTs remain cryptographically valid until their short expiry,
but protected requests also require an active user record.

## Tests and continuous integration

Run the complete suite with:

```powershell
npm test
```

Audit production dependencies for high- and critical-severity advisories with:

```powershell
npm run audit:prod
```

The package is marked `private` so npm refuses accidental publication.

Run the database-backed workflow tests with a dedicated `TEST_DB_URL`:

```powershell
npm run test:e2e
```

With the same dedicated `TEST_DB_URL`, run the regular and database-backed
tests together with coverage thresholds:

```powershell
npm run test:coverage:all
```

The E2E tests run sequentially against the shared test database and skip
safely when `TEST_DB_URL` is absent. Email delivery and Google token
verification are mocked, but the HTTP routes, services, password hashing,
throttles, token creation, notification ownership and pagination, and MongoDB
records are real. Payment E2E coverage uses both fake providers and verifies
authentication, idempotent creation, ownership isolation, supported outcomes,
refunds, and the absence of the simulation route in live mode. The regular
`npm test` command does not discover the `.e2e.js` files.

The tests use Node.js's built-in test runner. They cover validators,
cryptographic utilities, middleware, Mongoose schemas, route registration,
service boundaries, startup configuration, notification workflows, and real
HTTP error and validation paths. Fake payment workflows run locally, while
live Stripe and ZarinPal requests and responses are tested with injected mock
HTTP functions. Unit and HTTP tests do not require MongoDB, Google, email, or
payment-provider access.

The repository workflow at `.github/workflows/ci.yml` runs two independent
Node.js 24 jobs for pushes and pull requests. Both jobs install the locked
dependencies with `npm ci`:

- The regular job audits production dependencies, then runs the main test suite
  with `npm test`. It does not require a database or external credentials.
- The E2E job starts an ephemeral MongoDB 8 single-node replica set, supplies a
  guarded `TEST_DB_URL` whose database name ends in `_test`, and runs the
  regular and database-backed suites with `npm run test:coverage:all`. The job
  requires at least 90% line, 80% branch, and 95% function coverage.

Because email delivery and Google verification are mocked, the E2E job does
not require email-provider or Google credentials.

## License

This project is available under the [ISC License](LICENSE).
