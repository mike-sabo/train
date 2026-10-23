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

Email codes expire after 10 minutes, allow at most five guesses, and are consumed after successful use. Requests are rate limited in SQLite, so restarting the server does not reset the limits. Every workout write derives its member ID from the session.

Sources: https://resend.com/pricing and https://resend.com/blog/new-free-tier (checked October 22, 2026). Sending has not been tested against a live Resend account; credentials and DNS are required.

## Admin and member access

Mike is the only admin. A database constraint prevents a second admin account, and changing OWNER_EMAIL cannot promote someone else or replace Mike. Use the same owner email on subsequent starts. Invitations always create ordinary members; there is no role-promotion endpoint.

| Capability                                    | Mike (admin) | Invited member |
| --------------------------------------------- | ------------ | -------------- |
| View plans and group completion               | Yes          | Yes            |
| Save workouts                                 | Own workouts | Own workouts   |
| Receive detailed weights and reps             | All members  | Own workouts   |
| View member email addresses                   | Yes          | No             |
| Invite, revoke invitations, or remove members | Yes          | No             |
| Import plan versions and schedule blocks      | Yes          | No             |
| Choose a personal color theme                 | Own account  | Own account    |

The Group tab shows **Revoke invitation** for pending invitations and **Remove member** for accepted accounts. Confirmation immediately invalidates that person's sessions and unused codes. Removed people cannot request new codes or read or write private app data. Their existing workout history remains in the database, visible only to the admin while their access is revoked. **Invite again** restores the same account and history after a fresh email sign-in; old codes and sessions stay invalid. Mike's admin account cannot be removed through the app.

Authorization is enforced by the server, including direct API calls. Member responses contain only their own detailed logs plus other active members' completion status. The local preview uses illustrative accounts and does not grant real account access.

## Plans and history

`plans/foundation-v1.json` contains the exact Monday/Wednesday/Friday routine recovered from the original chat, including the optional Friday landmine squat. Version 2 replaced Friday's hack squat with leg press (3 × 8–12), keeping landmine squat available. `plans/foundation-v3.json` is the current routine: it adds dumbbell lateral raises (2 × 12–15) and leg-press calf raises (2 × 12–20) on Monday and Friday. Earlier versions remain available for existing history. Import/export uses schema version 1. `plans/plan.schema.json` documents the JSON shape; `server/schema.js` adds validation for unique day and exercise IDs.

To change routines, export a plan, edit it, increment its version, import it, and schedule a non-overlapping block. A new routine can have a new plan ID and start at version 1. Existing plan versions cannot be overwritten. Blocks point to immutable versions, and logs point to blocks. Past logs retain exercises, selected substitutions, and per-set weights and reps. New blocks can start after an existing block; shortening an active block is not implemented.

Demonstrations prefer Jeff Nippard and Albert Dorner (Bertl_lifts). Exercise-specific alternatives remain where a matching preferred tutorial was not verified. Source URLs and verification notes are included in each exercise. Verification means matching title, exercise and creator metadata, plus the noted visual check; it does not guarantee future availability or certify exercise safety. The incline demonstration discusses multiple movements, including incline dumbbell pressing.

Version 3 uses Jeff Nippard for both new exercises. The lateral-raise short compares dumbbell variations. The calf-raise link starts at 11:23 in his leg workout and is explicitly labeled as a single-leg demonstration. Optional demo fields `startSeconds` and `caption` preserve the base YouTube URL while opening the relevant segment.

## Faster logging and personal themes

Open **Log sets** to enter weight and reps. **Same for all sets** starts on for blank or matching sets: changing set 1 fills the untouched later rows automatically. Editing either field in a later row makes that entire set independent and labels it **Custom**. Turning the switch off keeps all current values and lets you enter each set separately; turning it back on fills only rows you have not customized. The switch and custom-row choices are saved with the workout and survive a reload. Automatic fill never adds sets or marks an exercise complete.

Last-workout values still load before editing. If they differ across sets, the switch starts off to preserve that progression. **Use last time** or changing the exercise variation resets the set links from the newly loaded values. Older saved workouts remain compatible without requiring a database migration.

For a new exercise entry, the app prefills values from that member's latest earlier completed occurrence of the same exercise and variation. The lookup matches the exercise ID and name across plan versions. Leg presses, calf raises, and landmine squats retain separate histories. **Last completed** shows the source date and values, and **Use last time** restores them explicitly. Existing saved entries and edits already in progress take precedence. Prefills do not mark exercises or workouts complete, and uncompleted suggestions are excluded from subsequent history lookups. If a later plan adds sets, unmatched extra rows start blank.

The palette button in the header opens ten themes, including two light options. A signed-in user's selection is saved in SQLite and restored on other devices when they load their account. Changing themes does not alter workout edits or anyone else's preferences. The unsigned preview remembers a separate device-local choice. Theme changes and previous-set lookups require an active invitation and are scoped to the signed-in member.

## Add to your phone

The **Add to Home Screen** button below the workout schedule explains installation for iPhone/iPad and Android. Supporting browsers also offer a native **Install on this device** button when their install prompt is available. The guide stays available when a browser does not provide that prompt, and the install trigger is hidden when running as an installed app. The manifest opens the configured application path (`/workout-plan/` locally and `/` on the custom subdomain) in a standalone window with Train Together's charcoal, orange, and blue dumbbell icon. Apple touch icons and Android maskable icons are included. Browser/status-bar colors follow the member's selected theme.

- **iPhone/iPad:** Open the deployed address in Safari, use Share → Add to Home Screen, keep Open as Web App on if shown, and tap Add.
- **Android:** Open the deployed address in Chrome, use the ⋮ menu → Install and create shortcut (or Add to Home screen) → Install. Some versions show Install app directly.

Installation is free and requires a reachable HTTPS deployment for phone use. The computer's `localhost` preview is not a phone-accessible deployment; the local guide makes this clear. The installed app needs an internet connection to load and save workouts. There is no offline cache or offline write queue, and installing does not change invitation or account permissions. Members may need to sign in once in the installed app.

Install guidance: [Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios), [Google Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en), and [MDN installability requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Hosting

See [DEPLOYMENT.md](DEPLOYMENT.md) for the prepared GitHub Pages + Supabase Free + Resend Free deployment, with `train.mikesabo.dev` as the proposed address. The hosted backend preserves invitation-only access, Mike's sole admin role, personal logs, all plan versions, and immediate revocation. Repository variables select the API URL and website base path. The deployment workflow does not publish until the real backend is configured and passes its access check.

Local development still uses Node and SQLite at `/workout-plan/`. The SQLite database contains local accounts, invitations, sessions, challenges, rate limits, plans, blocks, and workouts in `data/train-together.sqlite`. Keep that directory private and out of Git. No preview data is automatically copied to Supabase.

For the original single-server deployment, run one Node instance with a persistent SQLite disk, HTTPS, and routes for both `/workout-plan/` and `/api/`. Back up SQLite using its backup facility or stop the app before copying the database; copying only a live WAL database's main file is not a safe backup.

No real member accounts or emails are seeded in the repository. Preview names Mike and Jason are illustrative until you sign in and invite members. There is no public registration, marketing email, password, or SMS dependency.

## Verification

Integration tests cover invitation-only sign-in, code expiration and reuse, failed-attempt limits, cross-origin writes, owner-only actions, sign-out, per-member logs, stale-write conflicts, future/recovery-day rejection, overlapping blocks, immutable plan versions, and persistence across database connections. Permission tests cover pending and accepted account revocation, session and code invalidation, re-invitation with retained history, member response privacy, database upgrades, delayed email delivery, and the single-admin constraint.

Logging tests cover earlier dates, completed exercises, independent members and variations, renamed exercises, changed set counts, zero values, automatic fill, custom sets, switch behavior, and saved set links. Theme tests cover persistence, invalid choices, cross-account writes, revoked access, and cross-origin requests. Mobile checks exercise automatic fill, individual overrides, saving and reloading, separate calf history, and theme changes without losing edits.

Hosted tests additionally exercise PostgreSQL migrations, denied direct database access, CORS, bearer sessions, persisted failed-code limits, delayed-email revocation races, simultaneous writes, member privacy, and client session storage.
