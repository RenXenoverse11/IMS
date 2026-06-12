# IMS v1.2 — Database Diagram

> Backend: Google Sheets (via Google Apps Script) — 25 sheets  
> Schema sourced from `Internship Management System Official DB.xlsx`

---

## Entity Relationship Diagram

```mermaid
erDiagram

    %% ── AUTH ──────────────────────────────────────────────
    users {
        string user_id PK
        string full_name
        string email
        string password_hash
        string department
        string status "active | inactive"
        string role "Student | Supervisor"
        datetime created_at
        boolean email_verified
        string otp_hash
        datetime otp_expires_at
        int otp_attempts
        datetime otp_last_sent_at
        string profile_photo_url
        string profile_photo_file_id
        datetime profile_photo_updated_at
        string phone
        datetime updated_at
        datetime first_login_date
    }

    user_settings {
        string user_id PK_FK
        json settings_json
        datetime updated_at
    }

    %% ── OJT ──────────────────────────────────────────────
    student_ojt_profile {
        string user_id PK_FK
        int total_ojt_hours
        date start_date
        date estimated_end_date
        string course
        string school
        datetime completed_at
    }

    supervisor_assignments {
        string assignment_id PK
        string supervisor_user_id FK
        string student_user_id FK
        string company
        string department
        string status "active | inactive"
        datetime created_at
    }

    intern_schedules {
        string schedule_id PK
        string intern_id FK
        string supervisor_id FK
        json days_off "int[] e.g. [0,6]"
        string shift_start "HH:MM"
        string shift_end "HH:MM"
        datetime created_at
        datetime updated_at
    }

    %% ── TIME TRACKING ────────────────────────────────────
    active_sessions {
        string session_id PK
        string user_id FK
        date log_date
        string time_in
        string time_out
        float hours_rendered
        float actual_rendered_hours
        datetime created_at
        string notes
    }

    %% ── REQUESTS ─────────────────────────────────────────
    requests {
        string request_id PK
        string user_id FK
        string requester_name
        string request_type "Absence | Overtime | Time Log Override | Absence Retraction"
        date request_date
        string request_time
        string start_time
        string end_time
        float total_hours
        string reason
        string status "Pending | Approved | Rejected | Expired | Archived"
        string rejection_remarks
        datetime created_at
        boolean archived
        string archived_previous_status
    }

    %% ── NOTIFICATIONS ────────────────────────────────────
    notifications {
        string notification_id PK
        string user_id FK
        string title
        string description
        string type "request | doc_upload | time_log…"
        string related_id "request_id etc."
        boolean is_read
        datetime created_at
    }

    %% ── INTERN TASKS (Activity Logs) ─────────────────────
    activity_logs {
        string id PK
        string user_id FK
        string task_name
        date due_date
        string status "Pending | In Progress | Completed | Overdue"
        string description
        string assigned_by FK
        datetime created_at
        string created_by FK
        string updated_by FK
        json checklist
        string archived_previous_status
    }

    act_attachments {
        string id PK
        string task_id FK
        string user_id FK
        string file_type
        string file_size
        string file_name
        string link "Google Drive URL"
        datetime uploaded_at
        string uploaded_by FK
    }

    activity_worklogs {
        string task_id PK_FK
        string user_id FK
        string task "worklog title"
        string notes
        string learnings
        date date
        string status
        datetime created_at
        string created_by FK
        string updated_by FK
    }

    worklogs_attachment {
        string attachment_id PK
        string task_id FK
        string user_id FK
        string file_type
        string file_size
        string file_name
        string link "Google Drive URL"
        datetime uploaded_at
        string uploaded_by FK
    }

    recent_activities {
        string id PK
        string user "email address"
        string message
        datetime timestamp
    }

    %% ── SUPERVISOR TASKS ─────────────────────────────────
    supervisor_task {
        string sup_taskid PK
        string task
        string description
        date due_date
        string status "Pending | In Progress | Completed | Overdue"
        json assigned_to "user_id[]"
        datetime created_at
        string created_by FK
        string updated_by FK
        json daily_checklist
        boolean supervisor_archived
        string supervisor_archived_previous_status
        string source_type "intern | supervisor"
        string source_activity_id FK
        string source_owner_user_id FK
        string source_owner_email
    }

    supervisor_attch {
        string supattch_id PK
        string suptask_id FK
        string user_id FK
        string file_type
        string file_size
        string file_name
        string link "Google Drive URL"
        datetime uploaded_at
        string uploaded_by FK
    }

    %% ── PROJECTS ─────────────────────────────────────────
    proj_intern {
        string proj_id PK
        string proj_name
        string priority "High | Medium | Low"
        string status "Not Started | In Progress | Completed"
        string members "csv of user_id"
        string supervisor "csv of user_id"
        date start_date
        date end_date
        string description
        datetime created_at
        string created_by FK
        string updated_by FK
        string archived_previous_status
    }

    proj_supervisor {
        string projsupervisor_id PK
        string proj_id FK
        string proj_name
        string priority
        string status
        string members "csv of user_id"
        string supervisor "csv of user_id"
        date start_date
        date end_date
        string description
        datetime created_at
        string created_by FK
        string updated_by FK
        boolean supervisor_archived
    }

    proj_activity {
        string activity_id PK
        string proj_id FK
        string proj_name
        string type "project | member | file…"
        string activity_text
        datetime created_at
        string created_by FK
    }

    proj_folders {
        string folder_id PK
        string proj_id FK
        string folder_name
        string gdrive_link
        datetime created_at
        string created_by FK
        string updated_by FK
    }

    milestone_intern {
        string milestone_id PK
        string proj_id FK
        string milestone
        string status "Not Started | In Progress | Done"
        date date
        boolean done
        datetime created_at
        string created_by FK
        string updated_by FK
        json linked_files
    }

    submission_intern {
        string submission_id PK
        string proj_id FK
        string folder_id FK
        string gdrive "Google Drive URL"
        string kind "file | link"
        string file_name
        string file_type
        float file_size
        string link_label
        string link_url
        datetime uploaded_at
        string uploaded_by FK
    }

    feedback_intern {
        string feedback_id PK
        string proj_id FK
        string parent_id FK "nullable self-ref"
        string commenter_id FK
        string commenter_role "Student | Supervisor"
        string comment_text
        datetime created_at
        string created_by FK
        string updated_by FK
    }

    %% ── DOCUMENTS ────────────────────────────────────────
    documents {
        string id PK
        string user_id FK
        string name
        string folder "path"
        string type "pdf | png | docx…"
        string size
        string url "Google Drive URL"
        boolean is_link
        date uploaded_date
        string access_level "private | everyone | specific | everyone_except"
        json shared_with
        string created_by FK
        date created_date
        string file_id
        date updated_date
        string category
    }

    document_folders {
        string folder_id PK
        string user_id FK
        string folder_name
        string path
        boolean is_default
        date created_date
        date updated_date
        string created_by FK
        string created_by_name
    }

    %% ── RELATIONSHIPS ────────────────────────────────────

    users ||--o| user_settings : "configures"
    users ||--o| student_ojt_profile : "has OJT profile"
    users }o--o{ supervisor_assignments : "supervisor_user_id"
    users }o--o{ supervisor_assignments : "student_user_id"
    users ||--o{ intern_schedules : "intern_id"
    users ||--o{ active_sessions : "logs time"
    users ||--o{ requests : "submits"
    users ||--o{ notifications : "receives"
    users ||--o{ activity_logs : "assigned_to"
    users ||--o{ activity_logs : "assigned_by"
    users ||--o{ activity_worklogs : "logs work"
    users ||--o{ act_attachments : "uploads"
    users ||--o{ worklogs_attachment : "uploads"
    users ||--o{ supervisor_task : "created_by"
    users ||--o{ supervisor_attch : "uploads"
    users ||--o{ proj_intern : "creates"
    users ||--o{ proj_folders : "creates"
    users ||--o{ submission_intern : "uploads"
    users ||--o{ milestone_intern : "creates"
    users ||--o{ feedback_intern : "posts"
    users ||--o{ proj_activity : "triggers"
    users ||--o{ documents : "owns"
    users ||--o{ document_folders : "creates"

    activity_logs ||--o{ act_attachments : "has"
    activity_logs ||--o{ activity_worklogs : "has"
    activity_worklogs ||--o{ worklogs_attachment : "has"
    supervisor_task ||--o{ supervisor_attch : "has"
    activity_logs ||--o| supervisor_task : "source_activity"

    proj_intern ||--o{ proj_supervisor : "mirrored as"
    proj_intern ||--o{ proj_activity : "logged in"
    proj_intern ||--o{ proj_folders : "has"
    proj_intern ||--o{ milestone_intern : "tracks"
    proj_intern ||--o{ feedback_intern : "receives"
    proj_folders ||--o{ submission_intern : "stores"
    proj_intern ||--o{ submission_intern : "contains"
    feedback_intern ||--o{ feedback_intern : "replies"
```

---

## All 25 Tables

| Sheet Name | Domain | PK | Description |
|---|---|---|---|
| `users` | Auth | `user_id` | All accounts — interns and supervisors; OTP stored inline |
| `user_settings` | Auth | `user_id` | Notification preferences as JSON |
| `student_ojt_profile` | OJT | `user_id` | Required hours, dates, school per intern |
| `supervisor_assignments` | OJT | `assignment_id` | Supervisor ↔ student many-to-many |
| `intern_schedules` | OJT | `schedule_id` | Shift times and days off per intern |
| `active_sessions` | Time | `session_id` | Clock-in / clock-out records |
| `requests` | Requests | `request_id` | Absence, Overtime, Override, Retraction requests |
| `notifications` | Notify | `notification_id` | In-app alerts linked to events |
| `recent_activities` | Activity | `id` | Quick activity feed (email-keyed) |
| `activity_logs` | Tasks | `id` | Intern task list (assigned by supervisor) |
| `act_attachments` | Tasks | `id` | File/link attachments on intern tasks |
| `activity_worklogs` | Tasks | `task_id` | Daily work log entries per task |
| `worklogs_attachment` | Tasks | `attachment_id` | Attachments on work log entries |
| `supervisor_task` | Tasks | `sup_taskid` | Supervisor-side task management (mirrors intern tasks) |
| `supervisor_attch` | Tasks | `supattch_id` | Attachments on supervisor tasks |
| `proj_intern` | Projects | `proj_id` | Intern-facing project records |
| `proj_supervisor` | Projects | `projsupervisor_id` | Supervisor-facing mirror of projects |
| `poj_supervisor` | Projects | `projsupervisor_id` | Supervisor-created project view (legacy sheet) |
| `proj_activity` | Projects | `activity_id` | Project event/activity feed |
| `proj_folders` | Projects | `folder_id` | Google Drive folders per project |
| `milestone_intern` | Projects | `milestone_id` | Project milestones with done flag |
| `submission_intern` | Projects | `submission_id` | File / link submissions per folder |
| `feedback_intern` | Projects | `feedback_id` | Threaded comments per project |
| `documents` | Docs | `id` | User documents with access control |
| `document_folders` | Docs | `folder_id` | User-created document folders |

---

## Key Relationships

| From | Column | To | Type |
|---|---|---|---|
| `student_ojt_profile` | `user_id` | `users` | 1–1 |
| `user_settings` | `user_id` | `users` | 1–1 |
| `supervisor_assignments` | `supervisor_user_id` | `users` | many–many |
| `supervisor_assignments` | `student_user_id` | `users` | many–many |
| `intern_schedules` | `intern_id` | `users` | 1–1 |
| `intern_schedules` | `supervisor_id` | `users` | many–1 |
| `active_sessions` | `user_id` | `users` | many–1 |
| `requests` | `user_id` | `users` | many–1 |
| `notifications` | `user_id` | `users` | many–1 |
| `activity_logs` | `user_id` | `users` | many–1 |
| `activity_logs` | `assigned_by` | `users` | many–1 |
| `act_attachments` | `task_id` | `activity_logs` | many–1 |
| `activity_worklogs` | `task_id` | `activity_logs` | many–1 |
| `worklogs_attachment` | `task_id` | `activity_worklogs` | many–1 |
| `supervisor_task` | `source_activity_id` | `activity_logs` | 1–1 |
| `supervisor_attch` | `suptask_id` | `supervisor_task` | many–1 |
| `proj_supervisor` | `proj_id` | `proj_intern` | 1–1 mirror |
| `proj_activity` | `proj_id` | `proj_intern` | many–1 |
| `proj_folders` | `proj_id` | `proj_intern` | many–1 |
| `milestone_intern` | `proj_id` | `proj_intern` | many–1 |
| `submission_intern` | `proj_id` | `proj_intern` | many–1 |
| `submission_intern` | `folder_id` | `proj_folders` | many–1 |
| `feedback_intern` | `proj_id` | `proj_intern` | many–1 |
| `feedback_intern` | `parent_id` | `feedback_intern` | self-ref |
| `documents` | `user_id` | `users` | many–1 |
| `document_folders` | `user_id` | `users` | many–1 |

---

## Notes

- **OTP is stored inline in `users`** — no separate email_otp table. Fields: `otp_hash`, `otp_expires_at`, `otp_attempts`, `otp_last_sent_at`, `email_verified`.
- **`proj_intern` vs `proj_supervisor`** — the same project data exists in both sheets; `proj_supervisor` adds a `supervisor_archived` flag and its own `projsupervisor_id`. `poj_supervisor` (typo sheet) appears to be a legacy copy.
- **`activity_logs` vs `supervisor_task`** — two task stores linked via `source_activity_id`. Intern sees `activity_logs`; supervisor sees `supervisor_task`. A task created by a supervisor from an intern activity gets `source_type = "intern"`.
- **Members/supervisor in projects** stored as comma-separated `user_id` strings (not a join table).
- **`intern_schedules`** first column header is `is` (appears to be a typo/alias for the schedule ID) alongside a separate `schedule_id` column at the end.
- **`document_folders.is_default`** stores the creation date (data type mismatch in the sheet — likely a GAS bug).

[← Back to Docs](README.md)
