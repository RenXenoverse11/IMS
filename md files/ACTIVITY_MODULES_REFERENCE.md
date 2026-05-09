# Activity Modules Reference

This document summarizes the four activity-related files in the project:

- `appscript/ActivityIntern.js`
- `appscript/ActivitySupervisor.js`
- `src/app/pages/ActivityIntern.svelte`
- `src/app/pages/SupervisorActivity.svelte`

Note: the request mentioned `supervisoractiivty.svelte`, but the actual file name in the project is `SupervisorActivity.svelte`.

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

## Database Columns

### `activity_worklogs`

- `task_id`: unique worklog ID for the activity entry.
- `user_id`: user ID of the intern who owns the worklog.
- `task`: title or short description of the work being logged.
- `notes`: progress notes entered by the intern.
- `learnings`: lessons learned or summary notes.
- `date`: date associated with the worklog entry.
- `status`: current worklog status such as Pending or Completed.
- `created_at`: timestamp when the worklog was created.
- `created_by`: user ID of the creator.
- `updated_by`: user ID of the last editor.

### `worklogs_attachment`

- `attachment_id`: unique attachment ID.
- `task_id`: worklog ID the attachment belongs to.
- `user_id`: user ID of the uploader.
- `file_type`: file extension or type label.
- `file_size`: file size string saved for display.
- `file_name`: original file name stored for reference.
- `link`: Drive URL or stored file link.
- `uploaded_at`: timestamp when the attachment was uploaded.
- `uploaded_by`: user ID of the uploader.

### `recent_activities`

- `id`: unique activity log ID.
- `user`: display name or user label associated with the event.
- `message`: activity message shown in the recent activity feed.
- `timestamp`: timestamp for when the activity happened.

### `supervisor_task`

- `sup_taskid`: unique supervisor task ID.
- `task`: task title shown on the supervisor dashboard.
- `description`: task details or instructions.
- `due_date`: target due date for the task.
- `status`: task state such as Pending or Completed.
- `assigned_to`: JSON or comma-separated list of assigned student IDs.
- `daily_checklist`: optional JSON checklist for task sub-items.
- `created_at`: timestamp when the task was created.
- `created_by`: user ID of the creator.
- `updated_by`: user ID of the last editor.

### `supervisor_attch`

- `supattch_id`: unique supervisor attachment ID.
- `suptask_id`: supervisor task ID the attachment belongs to.
- `user_id`: user ID of the uploader.
- `file_type`: file extension or type label.
- `file_size`: file size string saved for display.
- `file_name`: original file name stored for reference.
- `link`: Drive URL or stored file link.
- `uploaded_at`: timestamp when the attachment was uploaded.
- `uploaded_by`: user ID of the uploader.
