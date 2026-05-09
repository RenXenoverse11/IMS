# Projects Modules Reference

This document summarizes the project-related files in the repo:

- `appscript/ProjectsIntern.js`
- `appscript/ProjectsSubmissions.js`
- `appscript/ProjectsSupervisor.js`
- `src/app/pages/ProjectsIntern.svelte`
- `src/app/pages/SupervisorProjects.svelte`

Note: the request mentioned `projectssubmissions.js`, `projectssupervisor.js`, and `projectsintern.svelte`, but the actual file names in the repo are `ProjectsSubmissions.js`, `ProjectsSupervisor.js`, and `ProjectsIntern.svelte`.

## `appscript/ProjectsIntern.js`

This Apps Script file handles the intern-side project data layer.

Main responsibilities:

- Creates, lists, updates, restores, and deletes projects for intern users.
- Generates project IDs and milestone IDs.
- Stores project data in the `proj_intern` sheet.
- Stores milestone data in the `milestone_intern` sheet.
- Stores feedback in the project feedback sheet.
- Validates project assignments for interns and supervisors by department.
- Keeps the supervisor project mirror in sync when intern-side projects change.
- Returns recent project activity for the UI.

In short, this file is the main backend for intern project CRUD, milestone CRUD, feedback, and project activity tracking.

## `appscript/ProjectsSubmissions.js`

This Apps Script file manages project submission folders and uploaded submissions.

Main responsibilities:

- Creates and manages project folders in Drive.
- Lists folders and submissions for a given project.
- Saves file submissions and link submissions in the `submission_intern` sheet.
- Stores folder metadata in the `proj_folders` sheet.
- Resolves Drive file URLs for uploaded submissions when needed.
- Updates and deletes folder records.
- Deletes submissions from both the sheet and associated Drive content when needed.

In short, this file is the backend for folder-based project submissions and their Drive links.

## `appscript/ProjectsSupervisor.js`

This Apps Script file provides the supervisor-side project listing and bootstrap helpers.

Main responsibilities:

- Reads supervisor-visible projects from the supervisor project sheet.
- Falls back to intern project data when needed and mirrors it into the supervisor view.
- Normalizes project rows and dates for supervisor display.
- Matches projects to the current supervisor by user ID, email, or supervisor tags.
- Deletes mirrored supervisor project rows when a project is removed.
- Returns supervisor bootstrap data for users and assignment context.

In short, this file powers the supervisor-side project mirror and project lookup logic.

## `src/app/pages/ProjectsIntern.svelte`

This Svelte page is the intern-facing project workspace.

Main responsibilities:

- Shows the intern project dashboard with tabs for details, submissions, milestones, and feedback.
- Loads project lists, folder submissions, milestones, and recent activity from Apps Script.
- Supports creating, editing, archiving, restoring, and deleting projects.
- Supports adding folders and file/link submissions inside a project.
- Supports milestone creation, editing, status updates, and linked files.
- Shows feedback threads and reply handling.
- Tracks loading, saving, and inline editing state in the UI.

In short, this is the intern project management screen for submitting work and tracking milestones.

## `src/app/pages/SupervisorProjects.svelte`

This Svelte page is the supervisor-facing project dashboard.

Main responsibilities:

- Shows supervisor-visible projects with overview filters and archive handling.
- Loads project folders, submissions, milestones, and feedback.
- Supports folder creation, rename, deletion, and submission uploads.
- Supports link submissions and file submissions.
- Supports milestone creation and editing, including linked-file selection.
- Supports project archive and restore actions.
- Tracks loading, saving, and inline editing state for the project UI.

In short, this is the supervisor project screen for monitoring intern work and managing project structure.

## Data Flow Summary

- `ProjectsIntern.svelte` is the intern UI.
- `SupervisorProjects.svelte` is the supervisor UI.
- `ProjectsIntern.js` is the main backend for intern project data, milestones, and feedback.
- `ProjectsSubmissions.js` handles folders, submissions, and Drive links.
- `ProjectsSupervisor.js` handles the supervisor-facing project mirror and bootstrap data.

## Quick Map

- Project CRUD and milestones: `ProjectsIntern.js`
- Folders and submissions: `ProjectsSubmissions.js`
- Supervisor project mirror: `ProjectsSupervisor.js`
- Intern project page: `ProjectsIntern.svelte`
- Supervisor project page: `SupervisorProjects.svelte`

## Database Columns

### `proj_intern`

- `proj_id`: unique project ID used across the project module.
- `proj_name`: project title shown in the UI.
- `priority`: priority label such as Low, Medium, or High.
- `status`: project state such as Not Started, In Progress, Review, Completed, or Archived.
- `members`: comma-separated intern user IDs assigned to the project.
- `supervisor`: comma-separated supervisor user IDs assigned to the project.
- `start_date`: project start date.
- `end_date`: project due date or end date.
- `description`: full project description.
- `created_at`: timestamp when the project was created.
- `created_by`: user ID of the creator.
- `updated_by`: user ID of the last editor.

### `milestone_intern`

- `milestone_id`: unique milestone ID.
- `proj_id`: parent project ID that the milestone belongs to.
- `milestone`: milestone title or label.
- `status`: milestone status shown in the UI.
- `date`: milestone target date.
- `done`: boolean-like flag indicating whether the milestone is completed.
- `created_at`: timestamp when the milestone was created.
- `created_by`: user ID of the creator.
- `updated_by`: user ID of the last editor.
- `linked_files`: JSON string of linked submissions/files attached to the milestone.

### `feedback_intern`

- `feedback_id`: unique feedback row ID.
- `proj_id`: project ID that the comment belongs to.
- `parent_id`: parent feedback ID for replies; blank for top-level comments.
- `commenter_id`: user ID of the person who posted the feedback.
- `commenter_role`: role label for the commenter, such as Intern or Supervisor.
- `comment_text`: feedback message body.
- `created_at`: timestamp when the feedback was created.
- `created_by`: user ID of the creator.
- `updated_by`: user ID of the last editor.

### `proj_folders`

- `folder_id`: unique folder ID for the project submission folder.
- `proj_id`: project ID that owns the folder.
- `folder_name`: display name of the folder.
- `gdrive_link`: Drive folder URL for the folder.
- `created_at`: timestamp when the folder was created.
- `created_by`: user ID of the creator.
- `updated_by`: user ID of the last editor.

### `submission_intern`

- `submission_id`: unique submission ID.
- `proj_id`: project ID that the submission belongs to.
- `folder_id`: folder ID where the submission is stored.
- `gdrive`: Drive folder or storage reference used for file submissions.
- `kind`: submission type, usually `file` or `link`.
- `file_name`: uploaded file name or display name.
- `file_type`: file extension or type label.
- `file_size`: file size string saved for display.
- `link_label`: user-facing label for a link submission.
- `link_url`: actual URL for a link submission.
- `uploaded_at`: timestamp when the submission was uploaded.
- `uploaded_by`: user ID of the uploader.

### `proj_supervisor`

- `projsupervisor_id`: unique ID for the supervisor project mirror row.
- `proj_id`: project ID copied from the intern project sheet.
- `proj_name`: mirrored project title.
- `priority`: mirrored priority label.
- `status`: mirrored project status.
- `members`: mirrored comma-separated intern user IDs.
- `supervisor`: mirrored comma-separated supervisor user IDs.
- `start_date`: mirrored project start date.
- `end_date`: mirrored project end date.
- `description`: mirrored project description.
- `created_at`: timestamp from the original project row.
- `created_by`: user ID of the original creator.
- `updated_by`: user ID of the last updater.
