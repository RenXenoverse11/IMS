# OJT Completion Feature - Quick Reference

## At a Glance

### What Changed?
- ✅ Hours are capped when intern reaches target
- ✅ Internship marked "completed" automatically
- ✅ Login blocked after completion
- ✅ Delete blocked after completion
- ✅ UI shows completion status

### New Database Fields
- `active_sessions.actual_rendered_hours` - Full shift hours (audit)
- `student_ojt_profile.completed_at` - Completion timestamp

---

## Backend API Changes

### `start_session` (Login)
**Blocks login if completed:**
```javascript
// Request
{ user_id, log_date, time_in }

// Response (when completed)
{
  ok: false,
  error: "Your internship is already completed. Login is no longer allowed.",
  completion_reached: true
}
```

### `end_session` (Logout)
**Caps hours and triggers completion:**
```javascript
// Request
{ user_id, log_date, time_out, hours_rendered }

// Response (when completion reached)
{
  ok: true,
  message: "Session ended successfully.",
  session: {
    hours_rendered: 5,        // Capped to remaining
    actual_rendered_hours: 8  // Full shift
  },
  completion_reached: true
}
```

### `delete_time_log`
**Blocks deletion if completed:**
```javascript
// Response (when completed)
{
  ok: false,
  error: "Cannot delete time logs after internship completion.",
  completion_reached: true
}
```

---

## Frontend State Management

### Dashboard Component
```javascript
// Reactive state
$: isCompleted = profile?.completed_at ? true : false;
$: hoursRemaining = isCompleted ? 0 : Math.max(0, totalOjtHours - hoursCompleted);
$: progressPercent = isCompleted ? 100 : Math.min(100, ...);

// UI changes
- "Estimated End Date" → "Completed On"
- Progress shows 100%
- Remaining hours shows 0
```

### TimeLog Component
```javascript
// State
let isCompleted = false;
let completedAt = '';

// Login disabled
$: canLogin = Boolean(date && timeIn && !isLoggedIn && !isCompleted);

// Progress status
$: progressStatus = isCompleted
  ? { tone: 'success', label: 'Completed' }
  : ...
```

---

## Hour Capping Logic

### Example Calculation
```
Current completed: 475 hours
Required total: 480 hours
Logout shift: 8 hours

Calculation:
remaining = 480 - 475 = 5 hours
actual_rendered = 8 hours
credited = min(8, 5) = 5 hours

Result:
hours_rendered = 5 (official credit)
actual_rendered_hours = 8 (audit trail)
new_total = 475 + 5 = 480 hours
completed_at = logout_date
```

---

## Completion Trigger Points

### 1. During Logout
```javascript
if (new_total >= target && !completed_at) {
  SET completed_at = logout_date
  SET estimated_end_date = logout_date
  RETURN completion_reached = true
}
```

### 2. During Login (Self-Heal)
```javascript
if (current_total >= target && !completed_at) {
  SET completed_at = today
  SET estimated_end_date = today
  BLOCK login
}
```

---

## UI Indicators

### Completed State
| Component | Element | Change |
|-----------|---------|--------|
| Dashboard | Progress | 100% |
| Dashboard | Hours Remaining | 0h |
| Dashboard | Working Days | 0 days |
| Dashboard | Status Badge | "Completed" |
| Dashboard | Date Label | "Completed On" |
| TimeLog | Progress Badge | "Completed" |
| TimeLog | Login Button | Disabled |
| TimeLog | Status Message | "Internship completed - Login disabled" |
| TimeLog | Hours Remaining | 0h |

---

## Testing Scenarios

### Scenario 1: Exact Hit
```
Setup: 472/480 hours
Action: Logout with 8 hours
Expected:
  - credited = 8
  - actual = 8
  - completed_at set
  - login blocked
```

### Scenario 2: Overshoot
```
Setup: 475/480 hours
Action: Logout with 8 hours
Expected:
  - credited = 5
  - actual = 8
  - completed_at set
  - login blocked
```

### Scenario 3: Already Complete
```
Setup: 480/480 hours, no completed_at
Action: Try to login
Expected:
  - Self-heal: set completed_at
  - Block login
  - Show completion message
```

### Scenario 4: Delete After Complete
```
Setup: Completed intern
Action: Try to delete time log
Expected:
  - Deletion blocked
  - Error message shown
```

---

## Common Patterns

### Check Completion Status
```javascript
// Backend
var profile = getStudentProfileByUserId_(userId);
var isCompleted = profile && profile.completed_at ? true : false;

// Frontend
const isCompleted = profile?.completed_at ? true : false;
```

### Handle Completion Response
```javascript
const response = await callApiAction('end_session', payload);
if (response.completion_reached) {
  isCompleted = true;
  completedAt = date;
  showCompletionMessage();
  refreshUserProfile();
}
```

### Display Completion Date
```javascript
// Use estimated_end_date when completed
const displayDate = isCompleted 
  ? profile.estimated_end_date  // Now holds actual completion date
  : calculatedEstimatedDate;

const label = isCompleted ? 'Completed On' : 'Estimated End Date';
```

---

## Data Flow

### Logout → Completion
```
1. User clicks "Log Out"
2. Frontend sends end_session request
3. Backend:
   - Calculates remaining hours
   - Caps credited hours
   - Saves both values
   - Checks if target reached
   - Sets completed_at if done
4. Backend returns completion_reached flag
5. Frontend:
   - Updates local state
   - Shows completion message
   - Refreshes user profile
   - Disables login button
```

### Login → Block
```
1. User clicks "Log In"
2. Frontend checks isCompleted
3. If completed:
   - Show error immediately
   - Don't send request
4. If not completed:
   - Send start_session request
5. Backend:
   - Checks completed_at
   - Self-heals if needed
   - Blocks if completed
6. Backend returns error + completion_reached
7. Frontend:
   - Updates local state
   - Shows error message
```

---

## Debugging Tips

### Check Completion Status
```javascript
// In browser console
const user = getCurrentUser();
console.log('Completed:', user?.ojt?.completed_at);
console.log('Total hours:', user?.ojt?.total_ojt_hours);
```

### Verify Backend State
```javascript
// In Apps Script
function debugUserCompletion(userId) {
  var profile = getStudentProfileByUserId_(userId);
  var completed = getTotalCompletedHoursByUserId_(userId);
  Logger.log('Profile: ' + JSON.stringify(profile));
  Logger.log('Completed hours: ' + completed);
  Logger.log('Is completed: ' + (profile.completed_at ? 'YES' : 'NO'));
}
```

### Check Session Data
```javascript
// In Apps Script
function debugLastSession(userId) {
  var sheet = getActiveSessionsSheet_();
  var rows = readSheetObjects_(sheet);
  var userSessions = rows.filter(r => r.user_id === userId);
  var last = userSessions[userSessions.length - 1];
  Logger.log('Last session: ' + JSON.stringify(last));
}
```

---

## Edge Cases

### Active Session During Completion
- ✅ Allowed: User can complete logout even if overshooting
- ✅ Blocked: Future logins after completion

### Self-Healing
- ✅ Auto-sets completed_at if hours already met
- ✅ Prevents edge cases from incomplete data

### Deletion
- ✅ Blocked for intern after completion
- ⚠️ Supervisor can still delete (not changed)

### Reopening
- ❌ Not supported in this version
- ⚠️ Completion is permanent

---

## Performance Notes

- ✅ No additional queries for normal operations
- ✅ Completion check is lightweight (single field read)
- ✅ Self-healing only runs on login attempt
- ✅ No impact on existing time log queries

---

## Security Notes

- ✅ Completion status stored server-side
- ✅ Cannot be bypassed from frontend
- ✅ Self-healing prevents data inconsistencies
- ✅ Deletion protection enforced server-side

---

## Migration Checklist

- [ ] Add `actual_rendered_hours` column to `active_sessions`
- [ ] Add `completed_at` column to `student_ojt_profile`
- [ ] Deploy backend code
- [ ] Deploy frontend code
- [ ] Test completion scenario
- [ ] Test login blocking
- [ ] Test delete blocking
- [ ] Verify UI updates

---

## Quick Commands

### Reset Completion (Testing Only)
```javascript
// In Apps Script - DO NOT USE IN PRODUCTION
function resetCompletion(userId) {
  var sheet = getStudentOjtProfileSheet_();
  var headers = getHeaders_(sheet);
  var values = getSheetValues_(sheet);
  var userIdCol = findColumnIndex_(headers, 'user_id');
  var completedAtCol = findColumnIndex_(headers, 'completed_at');
  
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][userIdCol - 1]) === userId) {
      sheet.getRange(i + 1, completedAtCol).setValue('');
      Logger.log('Reset completion for ' + userId);
      return;
    }
  }
}
```

---

**Version:** 1.0  
**Last Updated:** May 26, 2026  
**For:** IMS v1.2 - OJT Hour Cap Feature
