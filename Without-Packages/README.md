# Account API — Without Packages

This project is a complete account-management API built with Node.js, Express,
and MongoDB. The “without packages” approach means security-sensitive building
blocks such as request validation, JWT signing and verification, OTP hashing,
and throttling logic are implemented with Node.js platform APIs instead of
extra convenience libraries.

Packages are still used where they provide the required platform integration:

- Express for HTTP routing
- Mongoose for MongoDB access and transactions
- bcrypt for password hashing
- Nodemailer for development email delivery
- Google Auth Library for official Google ID-token verification
- dotenv for local environment loading

## Requirements

- Node.js 24
- npm
- MongoDB configured as a replica set
- Network access when testing Google authentication or Ethereal email previews
- A Google OAuth web client ID for Google sign-in

MongoDB transactions are used for password reset, password change, and email
change operations. The example connection string assumes a local replica set
named `rs0`.

## Quick start

Install the locked dependencies:

```powershell
npm ci
```

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

Replace every `replace-me` value. Generate a different secret for each of the
four secret variables:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run that command separately for each secret. Do not reuse one value across
multiple variables.

Start the API:

```powershell
npm start
```

For automatic restarts during development:

```powershell
npm run dev
```

The default example listens at `http://localhost:3000`.

## Environment configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port from 1 through 65535. |
| `DB_URL` | MongoDB connection URL. The example uses the `rs0` replica set. |
| `TEST_DB_URL` | Dedicated MongoDB URL for database-backed tests; its database name must end with `_test`. |
| `FRONTEND_URL` | Frontend base URL used in email links and as the allowed browser CORS origin. |
| `GOOGLE_CLIENT_ID` | Audience expected in Google ID tokens. |
| `JWT_SECRET` | HMAC secret for access and refresh JWTs; at least 32 UTF-8 bytes. |
| `OTP_SECRET` | HMAC secret for OTP codes; at least 32 UTF-8 bytes. |
| `LOGIN_THROTTLE_SECRET` | HMAC secret used to protect login-throttle identifiers; at least 32 UTF-8 bytes. |
| `REQUEST_THROTTLE_SECRET` | HMAC secret used to protect request-throttle identifiers; at least 32 UTF-8 bytes. |

The server validates all configuration before connecting to MongoDB. Secret
values are never included in configuration error messages. The real `.env`
file is ignored by Git; only `.env.example` should be committed.

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
models/       Mongoose account and temporary security records
routes/       Endpoint paths and middleware order
services/     Account workflows and database operations
utils/        JWT, token, and OTP cryptographic helpers
validators/   Package-free request validation and normalization
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

## API endpoints

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
| Password login failures | 5 failures within 15 minutes trigger a 15-minute block |

Refresh JWT IDs are stored only as SHA-256 hashes. OTP codes are protected with
HMAC-SHA256 and bound to the user ID. Passwords are hashed with bcrypt using a
cost factor of 12.

## Request throttling

Every documented endpoint allows 10 requests in its configured window for one
client identifier:

- One-minute window: login, token refresh, logout, Google sign-in, profile
  retrieval, profile modification, password change, and account deactivation.
- One-hour window: registration, email verification, verification resend, OTP
  request and verification, password-reset request and confirmation, and
  email-change request and confirmation.

Throttled responses include `Retry-After`. Request and login identifiers are
stored as keyed HMACs rather than raw email or client values.

## Email links in development

Nodemailer creates an Ethereal test account automatically. Messages are not
delivered to real inboxes. When Ethereal returns a preview URL, the controller
prints it to the server terminal for manual testing.

The frontend must own the pages referenced by email links:

- `/confirm-email/<token>`
- `/reset-password?uid=<user-id>&token=<token>`
- `/confirm-email-change?key=<token>`

Opening one of those frontend pages is not the API confirmation itself. The
frontend extracts the value and submits it to the corresponding POST endpoint.

Replace Ethereal with a production mail provider before deploying this project
for real users.

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
throttles, token creation, and MongoDB records are real. The regular `npm test`
command does not discover the `.e2e.js` files.

The tests use Node.js's built-in test runner. They cover validators,
cryptographic utilities, middleware, Mongoose schemas, route registration,
service boundaries, startup configuration, and real HTTP error and validation
paths. Unit and HTTP tests do not require MongoDB, Google, or email access.

The repository workflow at `.github/workflows/without-packages-tests.yml` runs
two independent Node.js 24 jobs whenever this project or its workflow changes
in a push or pull request. Both jobs install the locked dependencies with
`npm ci`:

- The regular job runs all 151 tests with `npm test` and does not require a
  database or external credentials.
- The E2E job starts an ephemeral MongoDB 8 single-node replica set, supplies a
  guarded `TEST_DB_URL` whose database name ends in `_test`, and runs all 163
  regular and database-backed tests with `npm run test:coverage:all`. The job
  requires at least 90% line, 80% branch, and 95% function coverage.

Because email delivery and Google verification are mocked, the E2E job does
not require email-provider or Google credentials.
