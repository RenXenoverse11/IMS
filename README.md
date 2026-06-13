# Internship Management System v1.2

A web-based OJT (On-the-Job Training) management platform built with **Svelte 5** and deployed as a **Google Apps Script** web app backed by **Google Sheets**.

---

## Features

### Intern / Student
- **Dashboard** — OJT progress bar (Rendered vs. Projected), estimated end date, recent activity, assigned tasks
- **Time Log** — clock in / out, lunch break toggle, session history, attendance PDF export
- **Activity Log** — intern task list with checklist items, work log entries, and file attachments
- **Requests** — submit Absence, Overtime, Time Log Override, or Absence Retraction requests
- **Projects** — view assigned projects, submit files/links to folders, track milestones, leave feedback
- **Documents** — upload files, organize into folders, control access (private / everyone / specific users)
- **Settings** — profile, profile photo, password, notification preferences, supervisor list

### Supervisor
- **Dashboard** — pending request panel, intern status table with live filter
- **Intern Management** — assign interns, set shift schedules and days off
- **Activity Management** — create and assign tasks, monitor intern work logs
- **Time Log Review** — view all intern sessions, approve/reject time log override requests
- **Projects** — create projects, assign members, manage folders and submissions, approve milestones
- **Requests Review** — approve or reject intern requests with optional remarks

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Svelte 5, Vite 8, TailwindCSS 4 |
| UI icons | lucide-svelte |
| Charts | Chart.js |
| Backend | Google Apps Script (GAS) |
| Database | Google Sheets (25 sheets) |
| Deploy tool | clasp (`@google/clasp`) |
| PDF generation | puppeteer-core (system Chrome/Edge) |

---

## Project Structure

```
IMS v1.2/
├── src/
│   └── app/
│       ├── pages/               # All page components
│       │   ├── Dashboard.svelte
│       │   ├── TimeLog.svelte
│       │   ├── ActivityIntern.svelte
│       │   ├── Requests.svelte
│       │   ├── ProjectsIntern.svelte
│       │   ├── Documents.svelte
│       │   ├── Settings.svelte
│       │   ├── SupervisorDashboard.svelte
│       │   ├── SupervisorDashboardOverview.svelte
│       │   ├── SupervisorActivity.svelte
│       │   ├── SupervisorInternManagement.svelte
│       │   ├── SupervisorProjects.svelte
│       │   ├── SupervisorTimeLog.svelte
│       │   ├── LoginPage.svelte
│       │   └── SignUpPage.svelte
│       ├── components/          # Shared UI components
│       │   ├── Layout.svelte
│       │   ├── Sidebar.svelte
│       │   ├── Header.svelte
│       │   └── FeedbackThread.svelte
│       ├── lib/                 # Utilities and API layer
│       │   ├── auth.js          # All GAS API actions (postAction / callApiAction)
│       │   ├── sync.js          # Session sync helpers
│       │   └── getEstimatedCompletionDate.js
│       ├── context/
│       │   └── ThemeContext.js
│       └── routes.js            # Client-side routing
├── appscript/                   # GAS project files (generated + hand-written)
│   ├── Code.js                  # Serves the app as a GAS web app
│   ├── appsscript.json          # GAS manifest
│   └── .clasp.json              # clasp project config (gitignored)
├── scripts/
│   ├── prepare-gas.mjs          # Converts dist/ → appscript/Index.html
│   └── generate-pdf.mjs         # Renders docs HTML to PDF via puppeteer-core
├── docs/                        # User-facing documentation
│   ├── README.md
│   ├── getting-started.md
│   ├── intern-guide.md
│   ├── supervisor-guide.md
│   ├── roles-permissions.md
│   ├── faq.md
│   ├── database-diagram.md      # ERD — all 25 sheets
│   ├── database-diagram.html    # Styled visual ERD (open in browser)
│   └── IMS_User_Manual.pdf
├── .env                         # VITE_GAS_WEB_APP_URL (gitignored)
└── package.json
```

---

## Prerequisites

- **Node.js** 18+
- **npm** 9+
- A Google account with the [Apps Script API enabled](https://script.google.com/home/usersettings)
- Google Chrome or Microsoft Edge installed (for PDF generation)

---

## Local Development

```bash
npm install
npm run dev
```

The app talks to the live GAS backend via the URL in your `.env` file:

```env
VITE_GAS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

---

## Google Apps Script Setup (one-time)

### 1. Enable the Apps Script API

Visit <https://script.google.com/home/usersettings> and turn on the API.

### 2. Log in with clasp

```bash
npm run gas:login
```

### 3. Link a script project

**New project:**

```bash
npx clasp create --rootDir . --project ./appscript --title "Internship Management System"
```

**Existing project:**

```bash
npx clasp clone YOUR_SCRIPT_ID --rootDir . --project ./appscript
```

**Manual config:** copy `appscript/.clasp.json.example` to `appscript/.clasp.json` and fill in `YOUR_SCRIPT_ID`.

---

## Build & Deploy

### Full deploy (build + push + deploy)

```bash
npm run release:gas
```

### Just build and push

```bash
npm run deploy:gas
# equivalent: npm run gas:deploy
```

This will:
1. Run `vite build` → `dist/`
2. Run `scripts/prepare-gas.mjs` → bundles everything into `appscript/Index.html`
3. Run `clasp push` → uploads to your linked Apps Script project

### Individual steps

| Command | What it does |
|---|---|
| `npm run build` | Vite production build to `dist/` |
| `npm run build:gas` | Build + prepare GAS files |
| `npm run push:gas` | Push `appscript/` to GAS (no build) |
| `npm run gas:open` | Open linked script in the browser |
| `npm run gas:status` | Show clasp project status |

> **Note:** `clasp push` uploads whatever is currently checked out locally. Switch branches before pushing to deploy a different version.

---

## First Web App Deployment

After your first `npm run push:gas`, go to the Apps Script editor and deploy manually:

1. Click **Deploy → New deployment**
2. Type: **Web app**
3. Execute as: *your account* — Access: *Anyone*
4. Click **Deploy** and copy the `/exec` URL into your `.env`

Subsequent updates use `npm run release:gas` to create a new deployment version from the CLI.

---

## Generate PDF Documentation

```bash
npm run generate:pdf
```

Finds your local Chrome or Edge installation, renders `docs/IMS_User_Manual.html`, and outputs `docs/IMS_User_Manual.pdf`.

---

## Documentation

| File | Description |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | Sign up, OTP verification, login |
| [docs/intern-guide.md](docs/intern-guide.md) | Full intern feature walkthrough |
| [docs/supervisor-guide.md](docs/supervisor-guide.md) | Full supervisor feature walkthrough |
| [docs/roles-permissions.md](docs/roles-permissions.md) | Feature access table by role |
| [docs/faq.md](docs/faq.md) | Common questions and troubleshooting |
| [docs/database-diagram.md](docs/database-diagram.md) | ERD + all 25 table schemas |
| [docs/database-diagram.html](docs/database-diagram.html) | Visual database diagram (open in browser) |
| [docs/IMS_User_Manual.pdf](docs/IMS_User_Manual.pdf) | Compiled user manual PDF |

---

## Database

The backend is **Google Sheets** accessed through GAS API actions. There are **25 sheets** covering:

| Domain | Sheets |
|---|---|
| Auth | `users`, `user_settings` |
| OJT | `student_ojt_profile`, `supervisor_assignments`, `intern_schedules` |
| Time | `active_sessions` |
| Requests | `requests` |
| Notifications | `notifications` |
| Tasks (Intern) | `activity_logs`, `act_attachments`, `activity_worklogs`, `worklogs_attachment`, `recent_activities` |
| Tasks (Supervisor) | `supervisor_task`, `supervisor_attch` |
| Projects | `proj_intern`, `proj_supervisor`, `poj_supervisor`, `proj_activity`, `proj_folders`, `milestone_intern`, `submission_intern`, `feedback_intern` |
| Documents | `documents`, `document_folders` |

See [docs/database-diagram.md](docs/database-diagram.md) for the full ERD and column-level schema.
