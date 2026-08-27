# Daymark

A personal school planner with assignment tracking, editable classes, calendar and planner views, a Pomodoro timer, focus history, browser-session imports, duplicate protection, PWA support, and JSON backups.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
npm start
```

Open [http://localhost:4173](http://localhost:4173). Assignments, classes, focus history, and scraper login sessions stay on this Mac. Use **Sync & import → Export data** before clearing browser data.

## Import from Google Classroom

1. Open **Sync & import** in Daymark.
2. Under Google Classroom, select **Open sign-in browser**.
3. Sign in on Google's page using the dedicated Chromium window. Daymark never sees the email, password, MFA code, or SSO exchange.
4. Return to Daymark and select **Import now**.

Daymark visits Classroom's Assigned, Missing, and Done views, reads the assignments rendered for the signed-in student, and updates the local planner.

## Import from My Oak Grove

1. Under My Oak Grove, select **Open sign-in browser**.
2. Sign in on the official Blackbaud/Oak Grove pages.
3. Return to Daymark and select **Import now**.

The scraper reuses one dedicated browser window; sign in and import one service at a time. Its session is stored locally at `.data/scraper-profile`, so your Google and Blackbaud sessions remain available when you switch services. Closing the browser does not erase them. Delete that folder only when you intentionally want to sign out and forget the scraper session.

## Duplicate rules

Daymark first matches a stable assignment ID found in the page link. If Google Classroom and Blackbaud expose the same work under different IDs, it falls back to normalized title + matched class + due date. Repeated imports update one task. The same title in another class or on another due date stays separate.

## Limits of scraping

This is a local assisted importer, not an official API integration:

- Google or Blackbaud can change their page markup and require an extractor update.
- Google imports only assignments rendered in Classroom's To-do views. Blackbaud imports the complete signed-in Assignment Center response.
- The visible browser must run on the same Mac as Daymark, so this scraper is not suitable for a headless cloud deployment.
- Passwords must only be entered on the official provider pages. They never belong in `.env`, source files, logs, or chat.

## Vercel is not the sync computer

Deploying the current files to Vercel can host the interface, but it will not make the existing data or scraper portable. Planner data currently lives in one browser's `localStorage`, while the signed-in Playwright profile lives on this Mac.

The safe production design is:

1. Keep the signed-in Google and Blackbaud scraper on a trusted computer.
2. Upload only normalized classes, assignments, and sync timestamps to an authenticated cloud database.
3. Let the Vercel app read that data after you sign into Daymark.

School passwords and provider session cookies must not be uploaded to Vercel. Until the cloud database and Daymark login are added, use **Export data** on one device and **Import backup** on another.

## Optional protection

For localhost, `.env` is optional. If Daymark is exposed beyond this Mac, copy `.env.example` to `.env`, use HTTPS, and set a unique `DAYMARK_PASSWORD`. Do not reuse a school password.

## Verify

```bash
npm test
```
