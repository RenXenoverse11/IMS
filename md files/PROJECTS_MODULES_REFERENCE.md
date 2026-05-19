# Projects Modules Reference

This document reflects the current project modules in:

- `appscript/ProjectsIntern.js`
- `appscript/ProjectsSubmissions.js`
- `appscript/ProjectsSupervisor.js`
- `src/app/pages/ProjectsIntern.svelte`
- `src/app/pages/SupervisorProjects.svelte`

## Overview

The projects feature is split into three Apps Script backends and two Svelte pages:

- `ProjectsIntern.js` is the main project data layer.
- `ProjectsSubmissions.js` manages folders, file uploads, link submissions, and Drive URL repair.
- `ProjectsSupervisor.js` manages the supervisor mirror, supervisor access checks, and bootstrap data.
- `ProjectsIntern.svelte` is the intern project workspace.
- `SupervisorProjects.svelte` is the supervisor project dashboard.

## `appscript/ProjectsIntern.js`

Current purpose:

- Owns the intern-side project sheet: `proj_intern`.
- Owns the milestone sheet: `milestone_intern`.
- Owns the feedback sheet: `feedback_intern`.
- Validates project member and supervisor assignments against the current user's department.
- Keeps the supervisor mirror in sync on project create, update, restore, and delete.

Current project behavior:

- `handleListProjIntern_` returns projects the current user created or is listed on as a member.
- The project list now includes `created_by_role` and `creator_is_supervisor`.
- `handleCreateProjIntern_` creates the row, then mirrors it to the supervisor project sheet.
- `handleUpdateProjIntern_` updates the project row and mirror with rollback on mirror-sync failure.
- `handleRestoreProjIntern_` restores a project by setting status back to `Not Started`.
- `handleDeleteProjIntern_` deletes the intern project and removes its supervisor mirror row.

Current edit restrictions:

- If a project was created by a supervisor, interns who are only assigned members cannot fully edit it.
- Assigned interns may only send a status-only update for supervisor-created projects.
- Non-assigned interns are blocked from editing supervisor-created projects.

Current milestone behavior:

- `handleListMilestones_`, `handleCreateMilestone_`, `handleUpdateMilestone_`, and `handleDeleteMilestone_` provide milestone CRUD.
- Milestones support `linked_files`, which the UI stores as a serialized string payload.
- Milestone status and `done` can be updated independently.

Current feedback behavior:

- `handleListFeedback_` returns project feedback threads and now enriches each item with `commenter_name`.
- `handleCreateFeedback_` stores root comments and replies in `feedback_intern`.
- `handleDeleteFeedback_` removes a feedback row by `feedback_id`.

Current activity behavior:

- `handleGetProjRecentActivity_` builds the intern overview feed.
- It combines recent root feedback comments and recently created milestones.
- Replies are intentionally excluded from the overview activity feed.

## `appscript/ProjectsSubmissions.js`

Current purpose:

- Owns the folder sheet: `proj_folders`.
- Owns the submission sheet: `submission_intern`.
- Creates and uses the Drive root folder named `IMS Project Submissions`.
- Supports both intern endpoints and supervisor wrapper endpoints.

Current folder behavior:

- `handleCreateProjFolder_` creates a folder record and attempts to create a matching Google Drive folder.
- `handleUpdateProjFolder_` renames the folder record in the sheet.
- `handleDeleteProjFolder_` deletes the folder row and cascade-deletes submission rows linked to that folder.
- Supervisor folder handlers (`handleCreateProjFolderSupervisor_`, `handleUpdateProjFolderSupervisor_`, `handleDeleteProjFolderSupervisor_`) enforce supervisor ownership before delegating to the base handlers.

Important note:

- Folder rename and delete operate on sheet metadata and linked submission rows.
- The current code does not rename or delete the actual Google Drive folder itself.

Current submission behavior:

- `handleListProjSubmissions_` returns folders with nested submissions for a project.
- For file submissions with a missing `link_url`, it tries to repair the Drive file URL by scanning the linked Drive folder.
- `handleCreateProjSubmission_` supports two submission kinds:
- `file`: decodes `base64_data`, uploads to Drive, and stores the file viewer URL in `link_url`
- `link`: stores a label and external URL without uploading a file
- `handleDeleteProjSubmission_` deletes the submission row by `submission_id`.
- `handleGetSubmissionDriveUrl_` repairs or returns a stored Drive file URL for a single submission.

Supervisor submission wrappers:

- `handleCreateProjSubmissionSupervisor_` and `handleDeleteProjSubmissionSupervisor_` require the supervisor to own the project before delegating to the base handlers.

Important note:

- Deleting a submission currently deletes the sheet row only.
- The current code does not delete the uploaded Drive file.

## `appscript/ProjectsSupervisor.js`

Current purpose:

- Owns the supervisor mirror sheet: `proj_supervisor`.
- Migrates the legacy sheet name `poj_supervisor` when needed.
- Mirrors intern project data into a supervisor-facing view with a separate archive flag.
- Provides supervisor access checks and department-filtered user bootstrap data.

Current mirror behavior:

- `readSupervisorProjectRows_` reads mirror rows visible to the current supervisor.
- Visibility matches by supervisor user ID, full name, email, or creator identity.
- `readSupervisorProjectsFromInternSheet_` provides fallback rows for legacy or unsynced projects.
- `syncSupervisorProjectMirror_` upserts a mirror row from intern project data.
- `deleteSupervisorProjectMirror_` removes the mirror row when a project is deleted.

Current access rules:

- `assertSupervisorCanAccessProject_` allows access to projects assigned to the supervisor or created by the supervisor.
- `assertSupervisorOwnsProject_` narrows that to projects created by the current supervisor.
- Ownership is required for full project management actions like update, delete, folder management, and submission management through supervisor wrappers.

Current supervisor project behavior:

- `handleCreateProjSupervisor_` delegates to `handleCreateProjIntern_` and ensures the creator is included in the supervisor assignment list.
- `handleUpdateProjSupervisor_` delegates to `handleUpdateProjIntern_` after ownership checks.
- `handleDeleteProjSupervisor_` delegates to `handleDeleteProjIntern_` after ownership checks.
- `handleRestoreProjSupervisor_` restores the supervisor archive state without requiring ownership, only access.
- Archive-only updates are handled separately through `setSupervisorProjectArchiveState_`.

Current archive model:

- The supervisor archive state is stored in `supervisor_archived`.
- Intern archive status is not treated as the same thing as supervisor archive state.
- Fallback reads from `proj_intern` intentionally suppress intern-side `Archived` status unless the mirror row says the supervisor archived it.

Current milestone behavior:

- `handleCreateMilestoneSupervisor_`, `handleUpdateMilestoneSupervisor_`, and `handleDeleteMilestoneSupervisor_` all return errors.
- Current policy is that milestones are managed by interns, not supervisors.

Current bootstrap behavior:

- `handleGetProjUsersBootstrap_` returns department-aware user data for assignment pickers.
- It filters interns and supervisors to the current user's assignment department when available.

## `src/app/pages/ProjectsIntern.svelte`

Current purpose:

- Provides the intern-facing project workspace.
- Combines overview, project list, archive view, inline detail tabs, submissions, milestones, and feedback.

Current page structure:

- Top stat cards show `Total Projects`, `In Progress`, and `Completed`.
- View controls switch between `Overview`, `Projects`, and `Archive`.
- The overview now shows `Your Projects` before `Recent Activity` and `Upcoming Deadlines`.

Current project management behavior:

- Loads bootstrap users and project data together.
- Uses department-filtered member and supervisor selectors in the add/edit modal.
- Supports create, update, archive, restore, and delete flows.
- Uses an inline detail panel with tabs for `Details`, `Submissions`, `Milestones`, and `Feedback`.

Current Details-tab behavior:

- Inline editing is available directly inside the expanded project row.
- If the project was created by a supervisor and the current intern is not the creator, the page switches into status-only edit mode.
- In status-only mode, title, description, assignments, priority, and timeline fields are disabled.
- The save action changes from full edit to `Save Status`.

Current submissions behavior:

- Supports folder creation, rename, delete, expansion, and file/link submission management.
- File uploads are staged locally, then posted to Apps Script with base64 payload data.
- Submissions can be opened or downloaded through Drive URL resolution.

Current milestone behavior:

- Supports milestone create, edit, delete, status updates, and linked-file selection.
- Linked files are chosen from project file submissions.
- Milestone data is cached in local storage and refreshed from Apps Script when needed.

Current feedback behavior:

- Supports nested root comments and replies rendered inline in the page.
- Feedback badges now display the commenter's actual full name instead of only `Student` or `Supervisor`.
- Supervisor/intern badge coloring still comes from `commenter_role`.

Current overview behavior:

- Loads recent project activity with `get_proj_recent_activity`.
- Shows paginated `Your Projects` snippet cards.
- Shows `Recent Activity` and `Upcoming Deadlines` as overview support panels.

## `src/app/pages/SupervisorProjects.svelte`

Current purpose:

- Provides the supervisor-facing project dashboard for tagged projects.
- Combines overview cards, project list, archive view, detail tabs, feedback, and submission management.

Current page structure:

- Top stat cards show `Total Projects`, `In Progress`, `Review`, and `Interns`.
- View controls switch between `Overview`, `Projects`, and `Archive`.
- The overview now shows `Tagged Projects` before `Workload Snapshot` and `Upcoming Deadlines`.

Current project management behavior:

- Loads supervisor project data and project-user bootstrap data in parallel.
- Supports add, edit, and delete only for projects created by the current supervisor.
- Supports archive and restore for supervisor-accessible projects through the supervisor mirror archive state.
- Uses modal-based project create and edit, not the intern inline editor pattern.

Current submissions behavior:

- Supports folder creation, rename, deletion, expansion, and file/link submissions through supervisor wrapper endpoints.
- Submission actions are limited by supervisor ownership rules enforced in Apps Script.
- Uses the same Drive URL resolution pattern as the intern page for view/download.

Current milestone behavior:

- The page renders milestone lists, status chips, linked files, and milestone editing controls.
- The page calls supervisor milestone endpoints for create, update, and delete.
- Those endpoints currently reject mutation requests because milestones are managed by interns in `ProjectsSupervisor.js`.
- In practice, the milestone area is currently useful for viewing data, but mutation actions are blocked server-side.

Current feedback behavior:

- Uses `FeedbackThread.svelte` for nested feedback rendering instead of manually rendering each reply level in the page.
- Supports posting root comments, posting replies, and deleting comments.
- The root feedback composer now uses the blue primary `Post Comment` button style used elsewhere in the project UI.

Current overview behavior:

- `Tagged Projects` cards show status, priority, progress, deadlines, and quick actions.
- `Workload Snapshot` summarizes active project distribution by intern.
- `Upcoming Deadlines` highlights the nearest tagged-project due dates.

## Current Action Map

Intern page to backend:

- Project CRUD: `create_proj_intern`, `update_proj_intern`, `restore_proj_intern`, `delete_proj_intern`
- Milestones: `list_milestones`, `create_milestone`, `update_milestone`, `delete_milestone`
- Feedback: `list_feedback`, `create_feedback`, `delete_feedback`
- Submissions: `list_proj_submissions`, `create_proj_folder`, `update_proj_folder`, `delete_proj_folder`, `create_proj_submission`, `delete_proj_submission`, `get_submission_drive_url`
- Overview feed: `get_proj_recent_activity`

Supervisor page to backend:

- Project CRUD: `list_proj_supervisor`, `create_proj_supervisor`, `update_proj_supervisor`, `restore_proj_supervisor`, `delete_proj_supervisor`
- Bootstrap: `get_proj_users_bootstrap`
- Submissions: `create_proj_folder_supervisor`, `update_proj_folder_supervisor`, `delete_proj_folder_supervisor`, `create_proj_submission_supervisor`, `delete_proj_submission_supervisor`, `list_proj_submissions`, `get_submission_drive_url`
- Feedback: `list_feedback`, `create_feedback`, `delete_feedback`
- Milestones: `list_milestones`, plus supervisor milestone mutation endpoints that currently reject writes

## Maintenance Notes

- The supervisor mirror is not optional. Intern project mutations depend on successful mirror sync and roll back on sync failure.
- `ProjectsSubmissions.js` currently does not remove Drive files or Drive folders during delete flows.
- Supervisor milestone write endpoints are intentionally blocked even though the supervisor page still exposes milestone mutation controls.
- Intern feedback items now carry `commenter_name`, so UI code should prefer that over role labels when showing author badges.
