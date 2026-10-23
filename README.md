# Train Together

A mobile-first React workout tracker for Mike, Jason, and invited friends. Charcoal and orange, personal checkoffs, group accountability, and “Iron sharpens iron.” — Proverbs 27:17.

## Run locally

Requires Node 22.13 or newer (Node 22 reports its built-in SQLite module as experimental).

```sh
npm install
npm run dev
```

Open http://localhost:5173/workout-plan/. An unsigned visitor sees an explicitly labeled, temporary interactive preview. Sign in creates Mike’s local owner account on first run. Development email codes appear in the sign-in dialog; no email is sent. Invite Jason through Group, then schedule the first eight-week block through Plan. Each invited member verifies their own email and receives a 30-day HTTP-only session.

The server listens only on loopback in development. Do not expose development mode through a public tunnel. Production refuses to start with development email delivery or without an owner address and HTTPS origin.

```sh
npm test
npm run build
```

## Email delivery without a paid SMS service

Resend's free transactional plan supports a small invite-only group. Keep the account on Free and leave paid overages disabled. The app limits outgoing email to 90 requests per UTC day, below the listed 100/day limit and 3,000/month allowance. Other apps sharing that Resend account also consume its quota.

1. Create a free Resend account and verify a sending domain you control (for example, a subdomain of mikesabo.dev) using its DNS records.
2. Set EMAIL_MODE=resend, RESEND_API_KEY, EMAIL_FROM, OWNER_EMAIL, and APP_ORIGIN on the server. Never expose the API key to React.
3. Build the app and run npm start. The start command accepts a local .env file if present; hosting environment variables take precedence.
4. Mike signs in, enters Jason’s name and email, and sends the invitation. The email links to the app. Jason accepts by requesting and entering an email verification code. Uninvited addresses cannot sign in.

Email codes expire after 10 minutes, allow at most five guesses, and are consumed after successful use. Requests are rate limited in SQLite, so restarting the server does not reset the limits. Member emails are not included in shared group responses. Only the owner can invite members, import plans, and schedule training blocks. Every write derives its member ID from the session.

Sources: https://resend.com/pricing and https://resend.com/blog/new-free-tier (checked October 22, 2026). Sending has not been tested against a live Resend account; credentials and DNS are required.

## Plans and history

`plans/foundation-v1.json` contains the exact Monday/Wednesday/Friday routine recovered from the original chat, including the optional Friday landmine squat. `plans/foundation-v2.json` is the current routine: Friday uses leg press (3 × 8–12) because the YMCA has no hack squat machine, with landmine squat still available. Version 1 remains available for existing history. Import/export uses schema version 1. `plans/plan.schema.json` documents the JSON shape; `server/schema.js` adds validation for unique day and exercise IDs.

To change routines, export a plan, edit it, increment its version, import it, and schedule a non-overlapping block. A new routine can have a new plan ID and start at version 1. Existing plan versions cannot be overwritten. Blocks point to immutable versions, and logs point to blocks. Past logs retain exercises, selected substitutions, and per-set weights and reps. New blocks can start after an existing block; shortening an active block is not implemented.

Demonstrations prefer Jeff Nippard and Albert Dorner (Bertl_lifts). Exercise-specific alternatives remain where a matching preferred tutorial was not verified. Source URLs and verification notes are included in each exercise. Verification means matching title, exercise and creator metadata, plus the noted visual check; it does not guarantee future availability or certify exercise safety. The incline demonstration discusses multiple movements, including incline dumbbell pressing.

## Hosting and mikesabo.dev/workout-plan

This is a Node server with a SQLite database, not a static-only site. Deploy one server instance with a persistent disk, set DB_PATH to that disk, terminate HTTPS, and route both `/workout-plan/` and `/api/` to it. Confirm `/api/` does not conflict with another application on the domain. The domain and a GitHub remote are not required for local development.

SQLite holds accounts, invitations, sessions, challenges, rate limits, plans, blocks, and workouts in `data/train-together.sqlite`. Keep that directory private and out of Git. Back up using SQLite's backup facility, or stop the app before copying the database; a live WAL database must not be backed up by copying only its main file. Hosting costs are separate from Resend's email allowance. Multiple server instances require a shared database design.

No real member accounts or emails are seeded. The preview names Mike and Jason are illustrative until you sign in and invite members. There is no public registration, automated marketing email, password, or paid SMS dependency.

## Verification

Integration tests cover invitation-only sign-in, code expiration and reuse, failed-attempt limits, cross-origin writes, owner-only actions, sign-out, per-member logs, stale-write conflicts, future/recovery-day rejection, overlapping blocks, immutable plan versions, and persistence across database connections.
