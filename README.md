# OpenClaw Contributor Pulse

A static app that uses GitHub's public REST API to rank external contributors by OpenClaw PRs merged this week. It shows P0–P3 priority labels, PR ratings, likely issue type, and project area. No API key or paid plan is required.

Live app: https://harjothkhara.github.io/openclaw-contributor-pulse/

Support: [harjoth.khara@gmail.com](mailto:harjoth.khara@gmail.com).

## Run locally

Serve this folder with `python3 -m http.server 8765` and visit `http://localhost:8765`. There is no build step or package installation.

Locally there is no `data.json`, so the page searches GitHub directly for each day. To preview with a snapshot, run `GITHUB_TOKEN=$(gh auth token) node scripts/build-data.mjs data.json` first (do not commit the result).

## Deployment and snapshot

`.github/workflows/pages.yml` deploys the site to GitHub Pages on every push to `main` and every 30 minutes. Each run uses the workflow's built-in token to build `data.json`: every PR merged in the last 8 days, in the slim shape the page caches. The page loads that snapshot first and searches GitHub only for merges after it, so a first visit takes about one search instead of one per 100 PRs. If the snapshot build fails on a scheduled run, the previous deployment stays live; if it fails on a push, the site deploys without `data.json` and the page searches GitHub directly.

The repository's Pages source must be set to **GitHub Actions**. GitHub pauses scheduled workflows after 60 days without repository activity and emails the owner; re-enable the workflow from the Actions tab. Until then the page keeps working from direct searches.

The week begins Monday at midnight in the viewer's local time zone. The app searches OpenClaw PRs merged in each local day, follows every results page, deduplicates PRs, and splits a time interval if GitHub's 1,000-result search cap would omit data. It spaces search requests by 6.5 seconds to respect the stricter unauthenticated search rate limit. Results (from the snapshot, then from search) are cached per day in the browser, keeping only the fields the page shows: earlier days load once per week, and today refreshes after 20 minutes. The Refresh button reloads every day. If GitHub reports a rate limit with a reset under 90 seconds away, the app waits for it and retries once; otherwise it stops, keeps the days already loaded, and shows when to try again.

PRs with GitHub author association `OWNER`, `MEMBER`, or `COLLABORATOR`, and bot accounts (including automation accounts such as `roboclaw-bot` that are registered as regular users), are omitted from the external contributor leaderboard. The app also excludes a snapshot (2026-11-10) of the [OpenClaw Foundation team and core maintainer roster](https://www.openclaw.org/people), plus project steward `steipete`. The roster must be updated as OpenClaw changes its people page. Some team members without verified GitHub handles may still appear, so this is a best-effort exclusion. Counts are based on all matching public PRs returned by GitHub.

Priority and rating use the PR's actual GitHub labels. Type uses a type label when present, then a clearly marked inference from conventional title prefixes such as `fix:` and `feat:`. Area tags use OpenClaw's `app:`, `channel:`, `plugin:`, and `extensions:` labels, plus estimates from titles and other labels. No PR file paths or linked issue metadata are fetched, so these classifications should be checked against the linked PR before making decisions based on them.

## GitHub Developer Program

This is a GitHub API integration. [Program registration](https://github.com/developer/register) also requires a support email address where GitHub users can contact you. GitHub manages membership and the profile highlight.

## Cost and security

The app reads public API data without authentication, so it requires no paid GitHub API plan. GitHub's general unauthenticated REST limit is 60 requests per hour per IP; search has a more restrictive limit. A busy week can take a few minutes to load. Do not add a token or client secret to browser code.
