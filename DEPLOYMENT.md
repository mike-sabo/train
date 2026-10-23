# GitHub Pages and the free backend

The React website runs on GitHub Pages at the proposed address `https://train.mikesabo.dev/`. Supabase Free provides PostgreSQL and an Edge Function. Resend Free delivers invitations and six-digit sign-in codes. Your existing `mikesabo.dev` website remains in its current repository.

The source can be public without exposing accounts or workout records. The frontend contains only the public API URL. Database credentials, the service-role key, the admin email, and the email API key are never bundled into the website or committed to Git.

## Costs and limits

As checked October 23, 2026:

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) is available for public repositories on GitHub Free. Publishing from a private repository requires an eligible paid GitHub plan.
- [Supabase Free](https://supabase.com/pricing) includes a 500 MB database and two active projects. Free projects pause after a week of inactivity and must be resumed through Supabase. Stay on Free; this setup does not purchase an upgrade or run artificial keepalive requests.
- [Resend Free](https://resend.com/pricing) includes 3,000 emails per month and 100 per day. The app reserves at most 90 sends per UTC day, including failed attempts, which stays below both allowances when this project has its own email budget. Other applications using the same Resend account share its quota.
- The existing domain's renewal remains separate. Adding a DNS subdomain does not register another domain.

## 1. Create the backend

Create a dedicated Supabase project in a **Free organization**, preferably in a US East region. Use the Supabase connector, or sign in with the Supabase CLI. Keep the database password in your password manager. Do not paste keys in chat or add them to Vite variables.

The repo includes migrations for private backend tables and API functions, all three immutable workout plan versions, and indexes for member revocation and foreign-key checks. It does not import local preview data, send invitations, or schedule a training block automatically.

```sh
npm ci
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref YOUR_PROJECT_REF
npx supabase@2.122.0 db push --dry-run
npx supabase@2.122.0 db push
```

Use a fresh dedicated project. Do not apply the initial migration to an unrelated or previously configured database, and do not reset a live database to fix migration errors. The CLI records migration history. With the connector, apply these files as named migrations and match the local filename timestamps to the recorded remote versions so later CLI deployments recognize them.

The `train` project (`swlunkwtghtbbaxigbez`) has these migrations applied. Its single owner is configured privately in the database; no training block has been scheduled. The private tables intentionally have RLS enabled without browser policies: their only caller is the server role. Supabase's informational [RLS without policies notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is expected for this design. Newly created indexes can also show [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) until real traffic uses them.

## 2. Configure email and the admin

Create a Resend Free account, add a sending domain such as `mail.mikesabo.dev`, and add the exact verification DNS records Resend provides at Porkbun. Preserve any existing mail records; use the sending subdomain to keep this configuration separate. Wait for verification, then create a sending API key restricted to that domain.

Copy `.env.cloud.example` to `.env.cloud` and fill it in locally:

| Secret           | Value                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `APP_ORIGIN`     | `https://train.mikesabo.dev`                                             |
| `APP_PATH`       | `/`                                                                      |
| `OWNER_EMAIL`    | Mike's approved admin email                                              |
| `RESEND_API_KEY` | The domain's sending API key                                             |
| `EMAIL_FROM`     | `Train Together <train@mail.mikesabo.dev>` after that domain is verified |

`.env.cloud` is ignored by Git. Supabase automatically supplies `SUPABASE_URL` and the server-side `SUPABASE_SECRET_KEYS` (with a legacy `SUPABASE_SERVICE_ROLE_KEY` fallback); do not copy these into the browser configuration. The app uses its own invite-only email-code authentication, so Supabase Auth SMTP configuration and Supabase Auth user invitations are not used.

```sh
npx supabase@2.122.0 secrets set --env-file .env.cloud
npm run build:edge
npx supabase@2.122.0 functions deploy train-together
```

The function URL is `https://YOUR_PROJECT_REF.supabase.co/functions/v1/train-together`. The deployment config sets `verify_jwt=false` because the function checks its own hashed session tokens in PostgreSQL. Only this server-side service role may execute `tt_rpc`, which runs with the caller’s permissions; anonymous and authenticated Supabase roles have no access to it or the private tables. There is no public first-run admin signup. Changing `OWNER_EMAIL` cannot promote a member or replace the existing owner.

Cross-site cookies are avoided so sign-in works on iPhone. Hosted sessions use opaque bearer tokens stored in that browser's local storage; only their SHA-256 hashes are stored in PostgreSQL. Tokens expire after 30 days. Signing out or removing a member invalidates their session immediately on the server. Browser code renders user text through React and does not load third-party scripts. The local Node/SQLite app continues using HTTP-only cookies.

## 3. Connect GitHub Pages and DNS

In the Train Together repository, enable Pages with **GitHub Actions**. Set the custom domain to `train.mikesabo.dev` **before** changing DNS. At Porkbun, add or replace only this exact host record:

| Type  | Host    | Answer                |
| ----- | ------- | --------------------- |
| CNAME | `train` | `mike-sabo.github.io` |

Do not change the apex `mikesabo.dev` records, the existing site's Pages settings, or a wildcard record. Do not add `/train-together` to the CNAME target. Wait for DNS verification and the GitHub certificate, then enable **Enforce HTTPS**. The `.dev` domain requires HTTPS. GitHub Actions publishing uses the Pages domain setting; a `CNAME` file in the build is not required.

Set these **Actions repository variables**, not secrets:

| Variable         | Value                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| `APP_ORIGIN`     | `https://train.mikesabo.dev`                                            |
| `VITE_BASE_PATH` | `/`                                                                     |
| `VITE_API_URL`   | The complete function URL above, with no trailing slash                 |
| `PAGES_ENABLED`  | Set to `true` only when the backend, email, domain, and HTTPS are ready |

The workflow tests both backends, builds the website and function, checks that the live API accepts the website origin and requires authentication, and then publishes the static website. Until `PAGES_ENABLED=true`, pushes run checks without publishing. The public Pages job has no database or email credentials.

Run **Check and publish Train Together** manually after configuring the variables, or push a reviewed change to `develop`. Future frontend changes publish from `develop`. Backend changes require the migration and function deployment commands above before publishing a frontend that depends on them.

## 4. Verify the real deployment

1. Open the HTTPS domain. Verify the manifest, icons, theme picker, and exercise videos.
2. Sign in with the configured owner email and its delivered code. Confirm the account is Mike with admin controls.
3. Schedule the approved v3 plan and the desired start date in the app. Invite Jason through the Group screen using his email. Invitations send real email only when you submit them.
4. Have a member accept the invitation. Confirm they cannot manage members, publish plans, schedule blocks, or see another member's weights and reps.
5. Save a workout, reload, and reopen from a phone. Verify previous sets, independent set edits, and personal themes survive.
6. Test revoke and re-invite with a test account. Access should stop immediately and its history should be preserved.
7. Add the website to the phone's Home Screen. It still needs internet access to load and save workouts.

No real email is sent by automated tests. Completing a successful email-code login is still necessary to confirm the production sender works; the deployment health check does not send mail.

## Tests and backups

```sh
npm test
npm run test:cloud:local
npm run build:edge
VITE_BASE_PATH=/ npm run build
```

`test:cloud:local` requires local PostgreSQL tools and starts an isolated temporary database on a random loopback port, then removes it. It never uses your regular PostgreSQL databases. CI uses a disposable PostgreSQL service. For another disposable server, `npm run test:cloud` requires `TT_TEST_DATABASE_URL` and a database name beginning `tt_test_`; it replaces the app schema inside that test database.

Free Supabase is not a substitute for a backup plan. Before changing live database structure, export the application schema and data with a trusted PostgreSQL backup tool and keep the backup private. Never publish database dumps as GitHub Pages artifacts. Plans may be exported in the app; exporting a plan is not a backup of member progress.

References: [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [GitHub custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
