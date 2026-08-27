# Daymark

A private school planner with rich assignment details, rotating school-day schedules, a points-based grade tracker, calendar and planner views, a Pomodoro timer, focus history, duplicate-safe Google Classroom and Blackbaud imports, cross-device cloud state, PWA support, and JSON backups.

## Planner features

- Open an assignment title to see teacher instructions, personal notes, subtasks, and secure `https://` attachment links. Google Classroom imports also collect descriptions and linked materials from the official assignment page; synced school-page links remain available beside the title.
- Open **Classes → Configure A/B cycle** to name the two rotation days and choose a known first-day date. Edit each class to add its teacher, room, period, meeting days, times, and rotation. Weekends are skipped when the cycle is calculated.
- Open **Grades** to record earned and possible points. Each class shows its running points percentage and a **What do I need next?** calculator. Weighted-category classes must still use the official school gradebook as the final result.

## Use Daymark at school

Production: [https://daymark-dynamicdigital.vercel.app](https://daymark-dynamicdigital.vercel.app)

On a new device:

1. Open the production URL.
2. On the trusted Mac, open Terminal in this project and run:

   ```bash
   grep '^DAYMARK_SYNC_KEY=' .env.local
   ```

3. Copy only the value after `=` into Daymark’s **Connect this device** window.
4. Keep that key in a password manager. It is the Daymark key, not a Google, Blackbaud, or school password.

The key is stored in that browser until **Sync & import → Change sync key** is selected or site data is cleared. Do not save it on a shared school computer.

## How production sync works

- Vercel hosts the interface and an authenticated state API.
- A private Vercel Blob stores normalized planner data.
- The trusted Mac keeps Google and Blackbaud sessions under `.data/scraper-profile` and sends only classes, assignments, URLs, completion state, and sync timestamps.
- The Mac helper starts at login and imports every 15 minutes while the Mac is awake and online.
- The hosted app refreshes cloud state every minute while open.
- If the Mac is off, the hosted planner still works with the last successful cloud state; new school imports resume after the Mac comes back online.

The helper is already installed on this Mac. Useful commands:

```bash
npm run helper:install
npm run helper:uninstall
tail -f .data/helper.log .data/helper-error.log
```

## School sign-ins

Passwords must only be entered on the official provider pages opened by the local Daymark helper.

1. Run `npm start` if the helper is not running.
2. Open [http://localhost:4173/#sync](http://localhost:4173/#sync).
3. Select **Open sign-in browser** for Google Classroom or My Oak Grove.
4. Finish sign-in in the dedicated Chromium window.
5. Select **Import now**.

The saved sessions are reused by automatic imports. Delete `.data/scraper-profile` only when intentionally signing the helper out of both services.

## Duplicate and deletion rules

Daymark first matches each provider’s stable assignment ID. If Google and Blackbaud expose the same work under different IDs, it falls back to normalized title + matched class + due date. Repeated imports update one task. A different class or due date remains separate.

Deleting imported work creates a deletion marker, so the next automatic import does not recreate it. Cloud writes use revision checks; if two devices change state at once, Daymark merges the fresh import and the user edit instead of silently overwriting either one.

## Local development

Requires Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
npm start
```

Open [http://localhost:4173](http://localhost:4173). Local planner state stays in that browser, while signed-in scraper sessions stay in `.data/scraper-profile`.

## Vercel configuration

The private `dynamicdigital/daymark` Vercel project is connected to the private GitHub repository. It uses:

- `DAYMARK_SYNC_KEY`: sensitive random bearer key for the state API.
- `BLOB_READ_WRITE_TOKEN`: Vercel-managed private Blob credential.
- `DAYMARK_CLOUD_URL`: development-only URL used by the Mac bridge.

Deploy manually when needed:

```bash
npx vercel@latest build --prod
npx vercel@latest deploy --prebuilt --prod --yes
```

Never commit `.env`, `.env.local`, `.data`, or `.vercel`. Never place school passwords, MFA codes, or provider cookies in Vercel.

## Verify

```bash
npm test
npm run build
```

The tests cover duplicate protection, provider ID stability, deleted-import behavior, conflicting device writes, rich assignment and grade state, A/B rotation logic, grade calculations, current-class filtering, due-date parsing, and the future Band syllabus assignment.
