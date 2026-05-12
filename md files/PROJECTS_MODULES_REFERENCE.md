# Projects Modules Reference

This document summarizes the project-related files in the repo:

- `appscript/ProjectsIntern.js`
- `appscript/ProjectsSubmissions.js`
- `appscript/ProjectsSupervisor.js`
- `src/app/pages/ProjectsIntern.svelte`
- `src/app/pages/SupervisorProjects.svelte`

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
