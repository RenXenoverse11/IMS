# Internship Management System (IMS) — User Manual

**Version 1.2**

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
   - [Creating an Account](#creating-an-account)
   - [Logging In](#logging-in)
   - [Forgot Password](#forgot-password)
3. [Intern Guide](#intern-guide)
   - [Dashboard](#intern-dashboard)
   - [Time Log](#time-log)
   - [Activity Log](#activity-log)
   - [Requests](#requests)
   - [Documents](#documents)
   - [Settings](#settings)
4. [Supervisor Guide](#supervisor-guide)
   - [Dashboard](#supervisor-dashboard)
   - [Intern Management](#intern-management)
   - [Projects](#projects)
   - [Time Log Review](#time-log-review)
   - [Activity Log Management](#activity-log-management)
   - [Requests Review](#requests-review)
5. [Roles & Permissions](#roles--permissions)
6. [Frequently Asked Questions](#frequently-asked-questions)

---

## Overview

The **Internship Management System (IMS)** is a web-based platform for tracking and managing On-the-Job Training (OJT) programs. It provides interns a place to log attendance, monitor OJT progress, submit requests, and manage documents — while giving supervisors tools to oversee and approve intern activities.

**Supported roles:**
- **Intern** — tracks personal OJT hours, submits requests, uploads documents
- **Supervisor** — oversees assigned interns, approves requests, assigns tasks

---

## Getting Started

### Creating an Account

1. On the login page, click **Create Account**.
2. Fill in the **Account** step:
   - **Name** — your full name
   - **Email** — a valid email address you can access
   - **Password** — minimum 8 characters
   - **Confirm Password** — must match the password above
   - **Role** — select **Intern** or **Supervisor**
   - **Department** (Supervisor only) — select your assigned department (ISOC, RSC, or CNFM)
3. **Intern only — OJT Setup step:**
   - **Total OJT Hours** — required hours set by your school (e.g., 480)
   - **Start Date** — your official OJT start date
   - **Department** — the department where you are assigned
   - **Course** — your degree program (type to search)
   - **School** — your university (type to search)
4. Click **Complete Signup**. A 6-digit OTP is sent to your email.
5. Enter the OTP in the **Verify Email** step and click **Verify OTP**.
   - If the code expires, click **Resend OTP**.
6. Once verified, click **Go to Login** to access your account.

> Passwords must be at least 8 characters long. The OTP is valid for a limited time — verify promptly.

---

### Logging In

1. Go to the IMS login page.
2. Enter your registered **Email** and **Password**.
3. Click **Log In**.
4. You are redirected to your role-specific dashboard automatically.

---

### Forgot Password

On the login page, click **Forgot Password?** and enter your email address. If an account exists for that email, recovery instructions will be sent.

---

## Intern Guide

### Intern Dashboard

The dashboard gives you a real-time overview of your OJT progress.

**Banner**
- Displays your name, role badge, department, course, and school.
- **Rendered / Projected toggle** — switch between two progress views:
  - **Rendered** — hours based on submitted time logs plus any active session currently running
  - **Projected** — rendered hours plus future approved and pending overtime/absence requests

**Stat Cards**
| Card | Description |
|------|-------------|
| Hours Needed | Your total required OJT hours |
| Hours Completed | Hours logged so far (updates with active session in real time) |
| Hours Remaining | Hours left to finish your OJT |
| Working Days Needed | Estimated working days to complete your OJT |

**Progress Bar**
Shows your completion percentage and the hours remaining versus total required.

**Estimated End Date**
Displays a projected OJT completion date calculated from your start date and remaining hours.

**Recent Activity**
A feed of your latest log-in, log-out, and request decision events. Click **View** on a request update to jump to the Requests page.

**Assigned Tasks**
Lists tasks assigned to you by your supervisor. Click **View** on any task to open it in the Activity Log.

---

### Time Log

The Time Log is where you record daily attendance.

#### Logging In / Out

1. Navigate to **Time Log** in the sidebar.
2. Select the **Date** for your entry.
3. Set your **Time In** (the time you arrived).
4. Click **Log In**. Your session starts.
5. At the end of the day, set your **Time Out** and click **Log Out**.

> If you close the browser mid-session, your session is preserved. The dashboard will continue counting elapsed hours until you log out.

**Lunch break toggle** — enable this to automatically deduct a lunch period from your logged hours.

#### Time Log History

Below the clock-in controls you will find a list of all past time log entries showing:
- Date, time in, time out, total hours for that entry, and status (**Recorded**)

Use the filter tabs to switch between **Entries** and **Override Requests**.

#### Override Request

If you need to correct a missed or incorrect time log entry:

1. Click **Request Override** (or the override button in the log area).
2. Fill in the **Date**, **Time In**, **Time Out**, and **Reason** for the correction.
3. Submit the request. It will be reviewed by your supervisor.

#### Exporting Attendance

Click **Export Attendance** to download a PDF copy of your time log for a selected month.

---

### Activity Log

The Activity Log tracks your daily work tasks and activities assigned by your supervisor.

- View a list of **work logs** submitted by you or assigned by your supervisor.
- Expand a work log entry to see full details.
- Tasks assigned to you appear here with their status and due date.
- Deep-link navigation: opening a task from the Dashboard will scroll directly to that task in the Activity Log.

---

### Requests

Submit formal requests for absences or overtime through this page.

#### Request Types

| Type | Purpose |
|------|---------|
| **Absence** | Notify your supervisor of a planned or past absence |
| **Overtime** | Request credit for hours worked beyond your regular schedule |

#### Submitting a Request

1. Navigate to **Requests**.
2. Click **New Request** (or the compose button).
3. Select the **Request Type** (Absence or Overtime).
4. Set the **Date** and any supporting details.
5. Click **Submit**.

#### Request Statuses

| Status | Meaning |
|--------|---------|
| **Pending** | Awaiting supervisor review |
| **Approved** | Accepted by supervisor — hours are factored into your progress |
| **Rejected** | Declined by supervisor |
| **Expired** | Request date has passed without a decision |
| **Archived** | Manually archived by you |

#### Managing Requests

- **Archive** — move a resolved request out of the active list.
- **Delete** — permanently remove an archived request.
- **Bulk archive** — select multiple requests and archive them at once.

A notification appears in your Recent Activity on the Dashboard whenever a supervisor approves or rejects a request.

---

### Documents

Upload and organize files related to your OJT.

#### Uploading a File

1. Navigate to **Documents**.
2. Click **Upload** and select a file from your device, or choose **Add Link** to attach a URL.
3. The file is saved under **My Documents** (root) or a subfolder you choose.

#### Folder Management

- Click **New Folder** to create a subfolder.
- Navigate folders by clicking their names in the file browser.
- Rename or delete folders using the context actions next to each folder name.

#### Sharing

Click the **Share** icon on any document to control who can view it:
- **Private** — only you
- **Everyone** — all users in the system
- **Specific users** — search and select individuals
- **Everyone except** — visible to all except selected users

Copy a direct share link from the share dialog to send to others.

#### Searching

Use the **Search** bar at the top of the Documents page to filter files by name across all folders.

---

### Settings

Access **Settings** from the sidebar to manage your account.

**Profile tab**
- Update your **Full Name**, **Email**, **Phone**, and **Department**.
- Upload a **Profile Photo** (JPEG, PNG, WebP, or GIF; max 5 MB).
- Click **Save Changes** to apply updates.

**Security tab**
- Change your **Password** by entering your current password and a new one.

**Notifications tab**
- Toggle notification preferences for:
  - Status updates on your requests
  - Document uploads
  - Time log reminders
  - Inactive student alerts (supervisor only)

**Supervisors tab** (Intern only)
- View the list of supervisors assigned to you.

---

## Supervisor Guide

### Supervisor Dashboard

The supervisor dashboard gives an overview of all assigned interns and pending actions.

**Pending Requests panel** — shows all unreviewed absence and overtime requests from your interns.

**Intern Status table** — lists each assigned intern with:
- Their OJT progress (hours completed vs. required)
- Today's time-in and time-out (if they logged in today)
- Estimated end date

Use the **Status filter** to show all interns, active ones, or inactive ones.

---

### Intern Management

Navigate to **Intern Management** to manage your assigned interns.

- View the full list of assigned interns with their profile details (course, school, department).
- Assign or remove interns from your supervision.
- Set an intern's **schedule** (shift start/end time and days off), which affects their time log defaults and OJT progress calculations.

---

### Projects

The **Projects** page lets you create and manage projects that interns can be assigned to.

- Create a new project with a name, description, and deadline.
- Assign interns to a project.
- Track project progress and associated tasks.

---

### Time Log Review

Navigate to **Time Log** in the supervisor sidebar to review intern attendance records.

- Select an intern to view their full time log history.
- Review and approve or reject **Override Requests** submitted by interns.

---

### Activity Log Management

The **Activity Log** page lets supervisors create and manage work tasks for interns.

- Create a **work log / task** and assign it to one or more interns.
- Set task title, description, due date, and priority.
- Monitor task progress and update status (Pending → In Progress → Completed).

---

### Requests Review

Navigate to **Requests** in the supervisor sidebar to review all pending intern requests.

- See each request's type (Absence or Overtime), date, and submitting intern.
- Click **Approve** or **Reject** for each pending request.
- Approved absence requests reduce the intern's projected remaining hours; approved overtime requests increase them.
- Rejected requests notify the intern via the Recent Activity feed on their dashboard.

---

## Roles & Permissions

| Feature | Intern | Supervisor |
|---------|--------|------------|
| View own dashboard | Yes | — |
| View intern overview dashboard | — | Yes |
| Log time in / out | Yes | — |
| Review intern time logs | — | Yes |
| Submit absence / overtime requests | Yes | — |
| Approve / reject requests | — | Yes |
| Upload and manage documents | Yes | Yes |
| Create and assign tasks | — | Yes |
| View assigned tasks | Yes | — |
| Manage intern schedules | — | Yes |
| Update own profile / password | Yes | Yes |

---

## Frequently Asked Questions

**Q: My OJT hours look incorrect on the dashboard. What should I check?**
A: Make sure you have logged out of your active session. The dashboard adds elapsed hours from an ongoing session in real time but does not save them until you log out. Also verify your start date and total OJT hours are set correctly under Settings.

**Q: I forgot to log out yesterday. What do I do?**
A: Submit an **Override Request** from the Time Log page with the correct time in and time out for that day, along with a reason. Your supervisor will review and approve it.

**Q: The Projected view shows different hours than Rendered. Why?**
A: Projected mode adds pending and approved future absence and overtime requests to your rendered hours. It gives an estimate of where you will stand once those requests are resolved.

**Q: My OTP expired before I could verify. What do I do?**
A: On the Verify Email step, click **Resend OTP** to receive a new code.

**Q: I cannot see my supervisor in the Settings Supervisors tab.**
A: Your supervisor must assign you to their supervision from the Intern Management page. Contact your supervisor to complete the assignment.

**Q: Can I delete a document I uploaded?**
A: Yes. In the Documents page, locate the file and use the delete action next to it. Deleted files cannot be recovered.

**Q: What file types can I upload to Documents?**
A: Most common file types are supported (PDF, images, Office documents, etc.). Profile photos specifically accept JPEG, PNG, WebP, and GIF up to 5 MB.

---

*IMS v1.2 — For support or feedback, contact your system administrator.*
