# Branching & deployments

```
feature/x ──PR──▶ staging ──PR──▶ main
    │               │              │
 preview URL    staging preview  production
 (per PR)       (stable URL)     deal-finder-il.vercel.app
```

| Branch | Vercel environment | URL |
|---|---|---|
| `main` | Production | https://deal-finder-il.vercel.app (public) |
| `staging` | Preview (stable) | https://deal-finder-il-git-staging-barackv95-9177s-projects.vercel.app |
| anything else | Preview (per branch/PR) | posted by Vercel on the PR |

**Previews sit behind Vercel Deployment Protection.** Every preview URL — the
stable staging one and the per-deployment ones — answers `302` to
`vercel.com/sso-api` for anyone who isn't signed in to the Vercel account. That
is fine for reviewing your own work in a logged-in browser, but a preview link
cannot be handed to someone outside the account as-is. To share one, either turn
Deployment Protection off for Preview (Vercel → Settings → Deployment
Protection) or generate a Protection Bypass token and append it to the URL.
Note that turning it off makes staging publicly readable.

## The flow

```bash
git switch staging && git pull
git switch -c feature/whatever
# …work…
git push -u origin feature/whatever
gh pr create --base staging          # CI runs, Vercel comments a preview URL
# verify on the preview URL, then merge
gh pr create --base main --head staging   # promote when staging looks right
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, `npm run build`
on every pull request and on pushes to `main` and `staging`. It needs no
secrets — see the comment in that file for why.

## ⚠️ Preview needs its own environment variables

Vercel scopes environment variables per environment. Variables set only for
**Production** do not exist in **Preview**, and the app degrades quietly rather
than failing loudly:

| Missing in Preview | Symptom on the preview URL |
|---|---|
| `DATABASE_URL` | mock tenders instead of the real ~335 (`src/lib/repository.ts`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | no sign-in button, `/api/user/sync` returns 501 |

Set all three for **Preview** as well (Vercel → Settings → Environment
Variables → tick Preview). Use Clerk's **development** keys (`pk_test_` /
`sk_test_`) for Preview and the live keys for Production.

Because of Deployment Protection this could not be verified from outside the
account. To check it yourself, open the staging URL in a browser signed in to
Vercel and look for two things:

- the feed header says **335 עסקאות פעילות** — a much smaller number means
  `DATABASE_URL` is missing and it is serving mock data;
- the header shows a **התחברות** button — an inert grey avatar instead means the
  Clerk keys are missing.

Preview deployments share the production Supabase database. That is fine for
reading tenders, but anything written from a preview (alerts, saved deals)
lands in the same tables as production — worth a separate database if that
stops being acceptable.

## Enforcing it

Requiring a passing PR before `main` can be pushed needs branch protection,
which GitHub does not offer for **private repositories on the Free plan**
(the API answers `403 Upgrade to GitHub Pro`). Until the repo is public or the
account is on Pro, the flow above is a convention, not a rule — direct pushes
to `main` still work.

To turn on enforcement once either is true:

```bash
gh api -X PUT repos/barakWork95/deal-finder-il/branches/main/protection \
  -F required_status_checks[strict]=true \
  -F 'required_status_checks[contexts][]=build' \
  -F enforce_admins=false \
  -F required_pull_request_reviews[required_approving_review_count]=0 \
  -F restrictions=
```
