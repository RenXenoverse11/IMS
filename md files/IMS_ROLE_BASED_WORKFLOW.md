# IMS Navigation Workflow (Role-Based)

## Summary
This workflow defines the user journey after account actions:

`Create Account -> Log In -> Route by Role -> Use Role-Specific Pages`

The goal is to ensure users land only on pages that match their account role.

## Core Flow
1. User creates an account.
2. User logs in.
3. System checks the account role.
4. If role is `Intern`, route to intern experience pages.
5. If role is `Supervisor`, route to supervisor experience pages.

## Role Page Groups
### Intern Pages
- Dashboard
- Time Log
- Projects
- Requests
- Activity Log
- Documents
- Settings

### Supervisor Pages
- Supervisor Dashboard
- Intern Management
- Supervisor Time Log
- Supervisor Projects
- Requests Review
- Activity
- Settings

## Mermaid Flowchart
```mermaid
flowchart TD
  A[Start] --> B[Create Account]
  B --> C[Log In]
  C --> D{Role Decision}

  D -->|Intern| I0[Intern Home]
  D -->|Supervisor| S0[Supervisor Home]

  subgraph Intern_Pages [Intern Pages]
    I1[Dashboard]
    I2[Time Log]
    I3[Projects]
    I4[Requests]
    I5[Activity Log]
    I6[Documents]
    I7[Settings]
  end

  subgraph Supervisor_Pages [Supervisor Pages]
    S1[Supervisor Dashboard]
    S2[Intern Management]
    S3[Supervisor Time Log]
    S4[Supervisor Projects]
    S5[Requests Review]
    S6[Activity]
    S7[Settings]
  end

  I0 --> I1
  I0 --> I2
  I0 --> I3
  I0 --> I4
  I0 --> I5
  I0 --> I6
  I0 --> I7

  S0 --> S1
  S0 --> S2
  S0 --> S3
  S0 --> S4
  S0 --> S5
  S0 --> S6
  S0 --> S7

  I1 --> G[Ongoing Daily Use]
  S1 --> G
```

## SOP (Short)
### Step 1: Create Account
- Expected User Action: User submits registration details and selects a valid role.
- Expected System Response: System creates account record and confirms successful registration.

### Step 2: Log In
- Expected User Action: User enters credentials and signs in.
- Expected System Response: System authenticates credentials and loads user profile, including role.

### Step 3: Role Decision
- Expected User Action: User waits for post-login routing.
- Expected System Response: System evaluates role and routes user to role-specific landing page.

### Step 4A: Intern Route
- Expected User Action: Intern uses intern modules.
- Expected System Response: System shows only intern page group and intern navigation paths.

### Step 4B: Supervisor Route
- Expected User Action: Supervisor uses supervisor modules.
- Expected System Response: System shows only supervisor page group and supervisor navigation paths.

### Fallback: Invalid Role or No Role Mapping
- Expected User Action: User acknowledges access issue and follows prompt.
- Expected System Response:
  - Show access error message (e.g., role not mapped).
  - Perform safe redirect to a default route (login or role-safe dashboard).
  - Prevent access to mixed or unauthorized page groups.

## Test Plan
Validate routing behavior for the following scenarios:
1. Newly created Intern account.
2. Newly created Supervisor account.
3. Existing Intern login.
4. Existing Supervisor login.
5. Non-matching role/page access attempt.

## Acceptance Criteria
- Role decision is explicit after login.
- Each role lands on the correct page set.
- No mixed intern/supervisor navigation paths are accessible.

## Assumptions and Defaults
- This workflow is documentation-only; no code changes are included.
- Roles are only `Intern` and `Supervisor`.
- Page names follow current IMS module naming.

