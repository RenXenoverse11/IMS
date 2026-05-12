# Activity Modules Reference

This document summarizes the four activity-related files in the project:

- `appscript/ActivityIntern.js`
- `appscript/ActivitySupervisor.js`
- `src/app/pages/ActivityIntern.svelte`
- `src/app/pages/SupervisorActivity.svelte`



## `appscript/ActivityIntern.js`

This Apps Script file powers the intern activity and worklog features.

Main responsibilities:

- Saves intern worklogs into the `activity_worklogs` sheet.
- Generates task IDs automatically when one is not provided.
- Saves worklog attachments into the `worklogs_attachment` sheet and uploads files to Drive.
- Rebuilds or backfills missing attachment links when needed.
- Returns worklogs with their attachments attached to each record.
- Logs recent activity events for the activity feed.
- Cleans up old activity items when the feed grows too large.
- Updates worklog status for supervisor review actions.
- Returns supervisor activity overviews and CSV exports.
- Provides activity task helpers used by the UI.
- Looks up student-supervisor relationships.

In short, this file is the backend data layer for intern worklogs, attachments, activity feeds, and activity-task support.

## `appscript/ActivitySupervisor.js`

This Apps Script file contains supervisor-side helpers for creating and assigning activity tasks.

Main responsibilities:

- Returns a list of all non-supervisor users for assignment.
- Creates supervisor tasks for one or more students.
- Stores a supervisor-level task record in `supervisor_task`.
- Mirrors those tasks into per-student activity tasks so interns can see them.
- Sends notifications to assigned students after task creation.
- Returns supervisor task lists for the UI.

In short, this file is the supervisor task creation and assignment bridge between the supervisor dashboard and the intern activity records.

## `src/app/pages/ActivityIntern.svelte`

This Svelte page is the intern-facing activity workspace.

Main responsibilities:

- Displays the intern worklog list with expandable rows.
- Shows attachments, notes, learnings, dates, and status information.
- Loads recent activity updates from Apps Script.
- Refreshes relative times like `Updated X minutes ago`.
- Fetches the current user, all users, and assigned supervisors.
- Submits new worklogs and attachments through `google.script.run`.
- Tracks loading, error, hover, and expansion state for the worklog UI.

In short, this is the intern UI for activity logging and progress tracking.

## `src/app/pages/SupervisorActivity.svelte`

This Svelte page is the supervisor-facing activity dashboard.

Main responsibilities:

- Shows KPI cards such as today's logs, pending approvals, active interns, and overdue tasks.
- Displays recent activities, progress items, alerts, and worklogs.
- Filters worklogs by student, status, search term, and date.
- Approves or updates worklog status.
- Exports worklogs to CSV.
- Manages supervisor-created tasks through add, view, and edit modals.
- Supports assignee selection, attachment handling, and checklist editing for tasks.
- Fetches supervisor overviews and task data from Apps Script.

In short, this is the supervisor UI for monitoring intern activity and managing tasks.

## Data Flow Summary

- `ActivityIntern.svelte` and `SupervisorActivity.svelte` are the frontend entry points.
- Both pages call Apps Script functions through `google.script.run`.
- `ActivityIntern.js` provides the core worklog, attachment, and activity-feed backend behavior.
- `ActivitySupervisor.js` provides supervisor task creation and assignment behavior.

## Quick Map

- Worklogs and attachments: `ActivityIntern.js`
- Supervisor task creation: `ActivitySupervisor.js`
- Intern activity page: `ActivityIntern.svelte`
- Supervisor activity page: `SupervisorActivity.svelte`
