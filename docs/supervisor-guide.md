# Supervisor Guide

[← Back to Docs](README.md)

---

## Table of Contents

- [Dashboard](#dashboard)
- [Intern Management](#intern-management)
- [Projects](#projects)
- [Time Log Review](#time-log-review)
- [Activity Log Management](#activity-log-management)
- [Requests Review](#requests-review)
- [Settings](#settings)

---

## Dashboard

The Supervisor Dashboard gives you a consolidated view of all interns you supervise and any pending actions requiring your attention.

### Pending Requests Panel

Displays all unreviewed **Absence** and **Overtime** requests from your assigned interns. Use this as your primary action queue — new requests appear here immediately when submitted.

### Intern Status Table

Lists every intern assigned to you with:

| Column | Description |
|--------|-------------|
| Name | Intern's full name |
| Course / School | Academic background |
| Hours Completed | OJT hours logged so far |
| Hours Required | Total OJT hours required |
| Progress | Percentage toward completion |
| Today's Time In | Clock-in time for today (if logged) |
| Today's Time Out | Clock-out time for today (if logged) |
| Estimated End Date | Projected OJT completion date |

**Status filter** — use the dropdown to narrow the list to:
- **All** — every assigned intern
- **Active** — interns who have logged in recently
- **Inactive** — interns with no recent activity

---

## Intern Management

Navigate to **Intern Management** to control which interns are under your supervision and configure their schedules.

### Assigning Interns

Interns are linked to your account when you assign them from this page. An intern not assigned to any supervisor will not appear on any supervisor's dashboard.

### Setting an Intern's Schedule

Each intern can have a custom schedule that affects:
- Default time-in and time-out values in their Time Log
- Working day calculations for their estimated end date
- Absence and overtime hour calculations on their Dashboard

| Schedule Field | Description |
|---------------|-------------|
| **Shift Start** | The intern's expected daily start time (e.g., 09:00) |
| **Shift End** | The intern's expected daily end time (e.g., 17:00) |
| **Days Off** | Days of the week when the intern does not work (default: Sunday and Saturday) |

Update the schedule and save. Changes take effect immediately on the intern's dashboard.

---

## Projects

The Projects page lets you organize internship work into named projects.

### Creating a Project

1. Navigate to **Projects**.
2. Click **New Project**.
3. Enter a project name, description, and optional deadline.
4. Save the project.

### Assigning Interns to Projects

Open a project and use the assign controls to add interns. Assigned interns can view and contribute to the project's tasks and activity.

### Tracking Progress

Each project shows the associated tasks, their statuses, and which interns are working on them.

---

## Time Log Review

Navigate to **Time Log** in the supervisor sidebar to review intern attendance records.

### Viewing a Time Log

Select an intern from the list to see their full attendance history:
- All recorded log-in and log-out entries
- Total hours per day
- Override requests they have submitted

### Reviewing Override Requests

Override requests are corrections an intern submits when they missed a clock-in or clock-out.

1. Open an intern's Time Log.
2. Switch to the **Override Requests** tab.
3. Review the submitted date, times, and reason.
4. Click **Approve** or **Reject**.
   - **Approved** — the corrected entry is added to the intern's time log and hours.
   - **Rejected** — the original record stands; the intern is notified.

---

## Activity Log Management

The Activity Log lets you create tasks and work logs and assign them to interns.

### Creating a Task

1. Navigate to **Activity Log**.
2. Click **New Task** (or the add button).
3. Fill in:
   - **Title** — a short name for the task
   - **Description** — details about what needs to be done
   - **Assigned To** — select one or more interns
   - **Due Date** — when the task should be completed
   - **Priority** — High, Medium, or Low
4. Save. The task appears on the intern's Dashboard under **Assigned Tasks** and in their Activity Log.

### Updating Task Status

Open any task and change its status:

| Status | Meaning |
|--------|---------|
| **Pending** | Not yet started |
| **In Progress** | Actively being worked on |
| **Completed** | Finished |
| **Overdue** | Past due date and not completed |

---

## Requests Review

Navigate to **Requests** to review all pending intern requests across your assigned interns.

### Reviewing a Request

Each request card shows:
- Intern name
- Request type (Absence or Overtime)
- Date of the request
- Current status

Click **Approve** or **Reject** directly on the card.

### Effect on OJT Progress

| Decision | Effect on intern's hours |
|----------|------------------------|
| **Approve Overtime** | Adds hours to the intern's completed/projected total |
| **Approve Absence** | Deducts equivalent hours from the intern's projected total |
| **Reject** | No change to hours; intern is notified via their activity feed |

---

## Settings

Supervisor settings work identically to intern settings with one difference — the **Notifications** tab includes an **Inactive Student** alert option that triggers when an assigned intern has not logged activity for an extended period.

See [Intern Guide → Settings](intern-guide.md#settings) for shared settings documentation (Profile, Security, Notifications).

---

*Next: [Roles & Permissions →](roles-permissions.md)*
