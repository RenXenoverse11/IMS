# Database Migration Guide - OJT Hour Cap Feature

## Overview
This guide provides step-by-step instructions for updating your Google Sheets database to support the new OJT hour cap and completion tracking features.

## Required Schema Changes

### 1. Update `active_sessions` Sheet

**Add New Column: `actual_rendered_hours`**

**Steps:**
1. Open your IMS Google Spreadsheet
2. Navigate to the `active_sessions` sheet
3. Locate the `hours_rendered` column (should be column F)
4. Insert a new column after `hours_rendered`
5. Name the new column header: `actual_rendered_hours`
6. Leave all existing rows empty for this column (will be populated for new sessions only)

**Final Column Order:**
```
A: session_id
B: user_id
C: log_date
D: time_in
E: time_out
F: hours_rendered
G: actual_rendered_hours  ← NEW COLUMN
H: notes
I: created_at
```

**Notes:**
- Existing sessions don't need this field populated
- Only new logout sessions will have both values
- For existing sessions, `hours_rendered` remains the official value

---

### 2. Update `student_ojt_profile` Sheet

**Add New Column: `completed_at`**

**Steps:**
1. Open your IMS Google Spreadsheet
2. Navigate to the `student_ojt_profile` sheet
3. Locate the last column (should be `school`)
4. Insert a new column after `school`
5. Name the new column header: `completed_at`
6. Leave all existing rows empty for this column

**Final Column Order:**
```
A: user_id
B: total_ojt_hours
C: start_date
D: estimated_end_date
E: course
F: school
G: completed_at  ← NEW COLUMN
```

**Notes:**
- Leave empty for all current interns
- System will auto-populate when an intern completes their hours
- Format: YYYY-MM-DD (e.g., "2026-05-26")

---

## Verification Steps

### 1. Verify Column Headers

**Check `active_sessions`:**
```
Expected headers (in order):
session_id | user_id | log_date | time_in | time_out | hours_rendered | actual_rendered_hours | notes | created_at
```

**Check `student_ojt_profile`:**
```
Expected headers (in order):
user_id | total_ojt_hours | start_date | estimated_end_date | course | school | completed_at
```

### 2. Test with Sample Data

**Create a test intern:**
1. Add a test student with 8 hours required
2. Log in and log out with 10 hours rendered
3. Verify:
   - `hours_rendered` = 8 (capped)
   - `actual_rendered_hours` = 10 (full amount)
   - `completed_at` is set in profile
   - `estimated_end_date` is updated to completion date

### 3. Verify Existing Data Integrity

**Run these checks:**
1. All existing time logs still display correctly
2. Total completed hours calculations are accurate
3. Dashboard progress bars show correct percentages
4. No errors in browser console

---

## Rollback Plan

If you need to rollback the changes:

### 1. Remove New Columns
1. Delete the `actual_rendered_hours` column from `active_sessions`
2. Delete the `completed_at` column from `student_ojt_profile`

### 2. Restore Code
1. Revert `appscript/Code.js` to previous version
2. Redeploy the AppScript project

### 3. Clear Frontend Cache
1. Clear browser cache
2. Hard refresh the application (Ctrl+Shift+R)

---

## Data Migration (Optional)

### For Existing Completed Interns

If you have interns who have already completed their hours but don't have the `completed_at` field set:

**Manual Migration:**
1. Identify completed interns (total hours >= required hours)
2. For each completed intern:
   - Find their last time log date
   - Set `completed_at` to that date
   - Verify `estimated_end_date` matches

**SQL-like Query (for reference):**
```
For each student in student_ojt_profile:
  total_completed = SUM(hours_rendered WHERE user_id = student.user_id AND time_out IS NOT NULL)
  IF total_completed >= student.total_ojt_hours AND student.completed_at IS EMPTY:
    last_log_date = MAX(log_date WHERE user_id = student.user_id AND time_out IS NOT NULL)
    SET student.completed_at = last_log_date
    SET student.estimated_end_date = last_log_date
```

**Note:** The system includes self-healing logic that will automatically set `completed_at` when a completed intern tries to log in, so manual migration is optional.

---

## Troubleshooting

### Issue: "Sheet not found" error
**Solution:** Ensure sheet names are exactly:
- `active_sessions` (lowercase, underscore)
- `student_ojt_profile` (lowercase, underscores)

### Issue: Column headers not recognized
**Solution:** 
1. Check for extra spaces in header names
2. Ensure headers are in row 1
3. Verify exact spelling and case

### Issue: Existing data shows errors
**Solution:**
1. Verify new columns are added in correct position
2. Check that existing data wasn't accidentally modified
3. Ensure formulas (if any) are updated to skip new columns

### Issue: Completion not triggering
**Solution:**
1. Verify `completed_at` column exists in `student_ojt_profile`
2. Check browser console for JavaScript errors
3. Ensure AppScript deployment is up to date
4. Test with a fresh logout session

### Issue: Login still allowed after completion
**Solution:**
1. Verify `completed_at` field is populated in the profile
2. Clear browser cache and reload
3. Check that frontend code is deployed
4. Verify user profile is being loaded correctly

---

## Post-Migration Checklist

- [ ] `actual_rendered_hours` column added to `active_sessions`
- [ ] `completed_at` column added to `student_ojt_profile`
- [ ] Column headers match exactly (case-sensitive)
- [ ] Existing data is intact and displays correctly
- [ ] Test intern can log in and out successfully
- [ ] Hour capping works correctly (test with overshoot scenario)
- [ ] Completion triggers and blocks future login
- [ ] Dashboard shows "Completed" status correctly
- [ ] TimeLog shows completion message
- [ ] Delete is blocked after completion
- [ ] No console errors in browser
- [ ] All existing interns' data is accurate

---

## Support

If you encounter issues during migration:

1. **Check the logs:**
   - AppScript: View > Logs (in Apps Script editor)
   - Browser: F12 > Console tab

2. **Verify deployment:**
   - AppScript: Deploy > Test deployments
   - Frontend: Check build timestamp

3. **Test in isolation:**
   - Create a test intern account
   - Test each feature individually
   - Verify before rolling out to all users

4. **Backup first:**
   - Make a copy of your spreadsheet before migration
   - Export current data as CSV
   - Document current state for comparison

---

## Migration Timeline

**Recommended approach:**

1. **Day 1 - Preparation:**
   - Backup spreadsheet
   - Review migration guide
   - Test in development environment

2. **Day 2 - Schema Update:**
   - Add new columns during low-usage period
   - Verify column headers
   - Test with sample data

3. **Day 3 - Code Deployment:**
   - Deploy AppScript changes
   - Deploy frontend changes
   - Monitor for errors

4. **Day 4 - Verification:**
   - Test all completion scenarios
   - Verify existing data integrity
   - Monitor user feedback

5. **Day 5 - Cleanup:**
   - Remove test data
   - Document any issues
   - Update user documentation

---

## Success Criteria

Migration is complete when:

✅ New columns exist in both sheets
✅ Existing data displays correctly
✅ New sessions save both hour values
✅ Completion triggers automatically
✅ Login is blocked after completion
✅ Delete is blocked after completion
✅ UI shows completion status
✅ No errors in logs or console
✅ All users can access their data
✅ Performance is not degraded

---

## Additional Resources

- **PLAN.md** - Original feature specification
- **IMPLEMENTATION_SUMMARY.md** - Detailed implementation notes
- **AppScript Documentation** - https://developers.google.com/apps-script
- **Svelte Documentation** - https://svelte.dev/docs

---

**Last Updated:** May 26, 2026
**Version:** 1.0
**Author:** IMS Development Team
