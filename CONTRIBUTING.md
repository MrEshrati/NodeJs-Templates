# Contributing

## Local setup

Use Node.js 24 or newer and install the locked dependencies with `npm ci`.
Follow the [README quick start](README.md#quick-start) to configure the API.
Never commit `.env`, credentials, access tokens, or real user data.

## Making a change

1. Create a branch from the latest `main`.
2. Keep each pull request focused on one fix or improvement.
3. Add or update tests when behavior changes. Update the README when API
   contracts, environment variables, or setup instructions change.
4. Run `npm test` before opening the pull request. The regular suite does not
   require MongoDB or external provider credentials.
5. Describe the problem, the resulting behavior, and the checks you ran in the
   pull request. Link any related issue and mention checks you could not run.

Use the existing CommonJS modules and Node.js built-in test runner. Keep request
validation in validators, workflow logic in services, and HTTP response mapping
in controllers, following the surrounding code.

## Database workflows and coverage

Database-backed tests require a running MongoDB replica set and a dedicated
`TEST_DB_URL` whose database name ends in `_test`. Test helpers delete documents
between tests, so use a disposable database containing no valuable data.

In PowerShell, set the test URL before running these commands:

```powershell
$env:TEST_DB_URL = 'mongodb://127.0.0.1:27017/account_api_test?replicaSet=rs0'
npm run test:e2e
npm run test:coverage:all
```

The E2E suite skips when `TEST_DB_URL` is absent. CI runs the regular suite and
the database workflows, enforces coverage thresholds, and audits production
dependencies. Run `npm run audit:prod` locally when changing dependencies and
commit the updated lockfile with any dependency changes.

## Reporting bugs

Open an [issue](https://github.com/MrEshrati/NodeJs-Templates/issues) with the
Node.js version, reproduction steps, expected behavior, and actual behavior.
Remove credentials, tokens, email addresses, and other personal data from logs
and examples before posting them.
