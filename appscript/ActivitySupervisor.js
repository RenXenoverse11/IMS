// Apps Script: Supervisor helper endpoints

// Return a list of all non-supervisor users (students) with minimal fields
function getAllStudents() {
  try {
    var usersSheet = getSheet_('users');
    var users = readSheetObjects_(usersSheet);
    var students = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i] || {};
      var role = String(u.role || '').trim().toLowerCase();
      if (role === 'supervisor') continue;
      students.push({
        user_id: String(u.user_id || '').trim(),
        full_name: String(u.full_name || '').trim(),
        email: String(u.email || '').trim()
      });
    }
    students.sort(function(a, b) {
      return String(a.full_name || '').localeCompare(String(b.full_name || ''));
    });
    return { ok: true, students: students };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : String(err) };
  }
}

// Create tasks assigned to one or more students by supervisor
function createSupervisorTasks(payload) {
  try {
    var title = String(payload.title || '').trim();
    var description = String(payload.description || '').trim();
    var dueDate = String(payload.due_date || '').trim();
    var supervisorId = String(payload.supervisor_user_id || '').trim();
    var assignees = Array.isArray(payload.assigned_student_ids) ? payload.assigned_student_ids : [];

    if (!supervisorId) return { ok: false, error: 'supervisor_user_id is required.' };
    if (!title) return { ok: false, error: 'title is required.' };
    if (!assignees.length) return { ok: false, error: 'At least one assigned_student_id is required.' };

    var now = isoNow_();
    var created = 0;
    // Also record a supervisor-level task record in 'supervisor_task' sheet
    var supRow = null;
    try {
      var supSheet = getOrCreateSheetWithHeaders_('supervisor_task', ['sup_taskid','task','description','due_date','assigned_to','created_at','created_by','updated_by']);
      supRow = {
        sup_taskid: createId_('SUP'),
        task: title,
        description: description,
        due_date: dueDate,
        assigned_to: JSON.stringify(assignees || []),
        created_at: now,
        created_by: supervisorId,
        updated_by: supervisorId
      };
      appendObjectRow_(supSheet, supRow);
    } catch (e) {
      // If creation fails, clear supRow and continue with per-user tasks
      supRow = null;
    }

    // For each assignee, create an activity task (so it appears in the intern's activity logs)
    for (var j = 0; j < assignees.length; j++) {
      var uid = String(assignees[j] || '').trim();
      if (!uid) continue;

      // find user email by user_id
      var users = readSheetObjects_(getSheet_('users')) || [];
      var userEmail = '';
      for (var k = 0; k < users.length; k++) {
        if (String(users[k].user_id || '').trim() === uid) {
          userEmail = String(users[k].email || '').trim();
          break;
        }
      }

      // prepare payload for activity task
      var activityPayload = {
        title: title,
        description: description,
        due_date: dueDate,
        owner_email: userEmail,
        assigned_by: supervisorId,
        created_at: now
      };

      // create activity task (use internal handler)
      try {
        handleCreateActivityTask_(activityPayload);
      } catch (errCreate) {
        // continue on error
      }

      // create notification for the user
      try {
        createNotification_(uid, 'New task assigned', 'A new task "' + title + '" was assigned to you.', 'task', supRow ? supRow.sup_taskid : '');
      } catch (errNotif) {
        // ignore notification failures
      }

      created += 1;
    }

    var response = { ok: true, created_count: created };
    // If initial attempt to create the supervisor-level row failed, try once more now
    if ((!supRow || !supRow.sup_taskid) && Array.isArray(assignees) && assignees.length) {
      try {
        var retrySupSheet = getOrCreateSheetWithHeaders_('supervisor_task', ['sup_taskid','task','description','due_date','assigned_to','created_at','created_by','updated_by']);
        var retryRow = {
          sup_taskid: createId_('SUP'),
          task: title,
          description: description,
          due_date: dueDate,
          assigned_to: JSON.stringify(assignees || []),
          created_at: now,
          created_by: supervisorId,
          updated_by: supervisorId
        };
        appendObjectRow_(retrySupSheet, retryRow);
        supRow = retryRow;
      } catch (e) {
        // ignore retry failures
        supRow = supRow || null;
      }
    }

    if (supRow && supRow.sup_taskid) {
      response.sup_taskid = String(supRow.sup_taskid || '').trim();
      response.task = {
        id: response.sup_taskid,
        title: supRow.task,
        description: supRow.description,
        due_date: supRow.due_date,
        assigned_student_ids: (function(){ try { return JSON.parse(String(supRow.assigned_to||'[]')) } catch(e){ return []; } })()
      };
    }
    return response;
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : String(err) };
  }
}

// Return supervisor-created tasks for a supervisor
function getSupervisorTasks(payload) {
  try {
    var supervisorId = String(payload.supervisor_user_id || '').trim();
    if (!supervisorId) return { ok: false, error: 'supervisor_user_id is required.' };
    var supervisorRecord = null;
    var supervisorEmail = '';
    try {
      supervisorRecord = findUserRecordByUserId_(supervisorId);
      supervisorEmail = supervisorRecord && supervisorRecord.user ? String(supervisorRecord.user.email || '').trim() : '';
    } catch (e) {
      supervisorRecord = null;
      supervisorEmail = '';
    }
    var sheet = getOrCreateSheetWithHeaders_('supervisor_task', ['sup_taskid','task','description','due_date','assigned_to','created_at','created_by','updated_by']);
    var rows = readSheetObjects_(sheet) || [];
    var tasks = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var createdBy = String(r.created_by || '').trim();
      if (createdBy && createdBy !== supervisorId && (!supervisorEmail || createdBy !== supervisorEmail)) {
        continue;
      }
      var assigned = [];
      try { assigned = JSON.parse(String(r.assigned_to || '[]')) || []; } catch (e) { assigned = []; }
      tasks.push({
        id: String(r.sup_taskid || '').trim(),
        title: String(r.task || '').trim(),
        description: String(r.description || '').trim(),
        due_date: String(r.due_date || '').trim(),
        assigned_student_ids: Array.isArray(assigned) ? assigned : []
      });
    }
    return { ok: true, tasks: tasks };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : String(err) };
  }
}
