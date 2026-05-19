// ProjectsIntern.js - handles project management for interns (CRUD operations)
var PROJ_INTERN_SHEET_  = 'proj_intern';
var PROJ_INTERN_HEADERS_ = [
  'proj_id', 'proj_name', 'priority', 'status', 'members', 'supervisor',
  'start_date', 'end_date', 'description',
  'created_at', 'created_by', 'updated_by'
];

var MILESTONE_SHEET_ = 'milestone_intern';
// Columns: milestone_id, proj_id, milestone, status, date, done, created_at, created_by, updated_by
var MILESTONE_HEADERS_ = [
  'milestone_id', 'proj_id', 'milestone', 'status', 'date', 'done',
  'created_at', 'created_by', 'updated_by', 'linked_files'
];
var PROJ_ACTIVITY_SHEET_ = 'proj_activity';
var PROJ_ACTIVITY_HEADERS_ = [
  'activity_id', 'proj_id', 'proj_name', 'type', 'activity_text',
  'created_at', 'created_by'
];

// Utility functions for managing sheets and data transformations
function projInternSheet_() {
  return getOrCreateSheetWithHeaders_(PROJ_INTERN_SHEET_, PROJ_INTERN_HEADERS_);
}

function projInternNextId_() {
  var sheet = projInternSheet_();
  var data  = sheet.getDataRange().getValues();
  var lastId = 0;
  for (var i = 1; i < data.length; i++) {
    var val = String(data[i][0] || '');
    if (/^PROJ_\d+$/.test(val)) {
      var n = parseInt(val.replace('PROJ_', ''), 10);
      if (!isNaN(n) && n > lastId) lastId = n;
    }
  }
  return 'PROJ_' + String(lastId + 1).padStart(4, '0');
}

function projAssignmentNormalizeText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function projAssignmentSameDepartment_(userDepartment, targetDepartment) {
  var userDept = projAssignmentNormalizeText_(userDepartment);
  var targetDept = projAssignmentNormalizeText_(targetDepartment);
  return Boolean(userDept && targetDept && userDept === targetDept);
}

function projAssignmentUserId_(user) {
  return String(user && (user.user_id || user.id || user.UserId || user.userId) || '').trim();
}

function projAssignmentRole_(user) {
  return String(user && (user.role || user.Role || user.user_role || user.userrole || user.userRole) || '').trim();
}

function projAssignmentDepartment_(user) {
  return String(user && (
    user.department ||
    user.Department ||
    user.dept ||
    user.Dept ||
    user.department_name ||
    user.departmentname ||
    user.departmentName ||
    user.DepartmentName
  ) || '').trim();
}

function projAssignmentIsInternUser_(user) {
  var role = projAssignmentNormalizeText_(projAssignmentRole_(user));
  return role.indexOf('intern') !== -1 || role.indexOf('student') !== -1 || role === 'ojt';
}

function projAssignmentIsSupervisorUser_(user) {
  var role = projAssignmentNormalizeText_(projAssignmentRole_(user));
  return role.indexOf('supervisor') !== -1 || role.indexOf('mentor') !== -1;
}

function projAssignmentIdsFromValue_(value) {
  if (Array.isArray(value)) {
    return value.map(function(item) { return String(item || '').trim(); }).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map(function(item) { return String(item || '').trim(); })
    .filter(Boolean);
}

function projAssignmentIdsToString_(value) {
  return projAssignmentIdsFromValue_(value).join(',');
}

function projAssignmentUsersById_() {
  var rows = readSheetObjects_(getUsersSheet_());
  var usersById = {};
  for (var i = 0; i < rows.length; i++) {
    var userId = projAssignmentUserId_(rows[i]);
    if (userId) {
      usersById[userId] = rows[i];
    }
  }
  return usersById;
}

function projAssignmentDepartmentContext_(payload, creatorUser) {
  return String(
    payload.department ||
    payload.Department ||
    payload.dept ||
    payload.Dept ||
    payload.departmentName ||
    payload.DepartmentName ||
    projAssignmentDepartment_(creatorUser) ||
    ''
  ).trim();
}

function validateProjectAssignments_(payload, membersValue, supervisorsValue) {
  var creatorId = String(payload.user_id || '').trim();
  var creatorRecord = creatorId ? findUserRecordByUserId_(creatorId) : null;
  if (!creatorRecord) {
    return { ok: false, error: 'User not found.' };
  }

  var targetDepartment = projAssignmentDepartmentContext_(payload, creatorRecord.user);
  var memberIds = projAssignmentIdsFromValue_(membersValue);
  var supervisorIds = projAssignmentIdsFromValue_(supervisorsValue);

  if ((memberIds.length || supervisorIds.length) && !targetDepartment) {
    return { ok: false, error: 'Your department is required before assigning project users.' };
  }

  var usersById = projAssignmentUsersById_();
  for (var i = 0; i < memberIds.length; i++) {
    var member = usersById[memberIds[i]];
    if (!member) {
      return { ok: false, error: 'Selected intern was not found: ' + memberIds[i] };
    }
    if (!projAssignmentIsInternUser_(member)) {
      return { ok: false, error: 'Selected member is not an intern: ' + memberIds[i] };
    }
    if (!projAssignmentSameDepartment_(projAssignmentDepartment_(member), targetDepartment)) {
      return { ok: false, error: 'Selected intern is outside your department: ' + memberIds[i] };
    }
  }

  for (var j = 0; j < supervisorIds.length; j++) {
    var supervisor = usersById[supervisorIds[j]];
    if (!supervisor) {
      return { ok: false, error: 'Selected supervisor was not found: ' + supervisorIds[j] };
    }
    if (!projAssignmentIsSupervisorUser_(supervisor)) {
      return { ok: false, error: 'Selected supervisor is not a supervisor: ' + supervisorIds[j] };
    }
    if (!projAssignmentSameDepartment_(projAssignmentDepartment_(supervisor), targetDepartment)) {
      return { ok: false, error: 'Selected supervisor is outside your department: ' + supervisorIds[j] };
    }
  }

  return {
    ok: true,
    members: memberIds,
    supervisors: supervisorIds,
    department: targetDepartment
  };
}

// Transforms a row from the proj_intern sheet into a project object
function projRowToObj_(row) {
  return {
    proj_id:     String(row[0]  || ''),
    proj_name:   String(row[1]  || ''),
    priority:    String(row[2]  || ''),
    status:      String(row[3]  || ''),
    members:     String(row[4]  || ''),   // stored as comma-separated user_ids
    supervisor:  String(row[5]  || ''),
    start_date:  row[6]  ? Utilities.formatDate(new Date(row[6]),  Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
    end_date:    row[7]  ? Utilities.formatDate(new Date(row[7]),  Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
    description: String(row[8]  || ''),
    created_at:  row[9]  ? String(row[9])  : '',
    created_by:  String(row[10] || ''),
    updated_by:  String(row[11] || '')
  };
}

function projCreatorRole_(userId, cache) {
  var key = String(userId || '').trim();
  if (!key) return '';
  var memo = cache || {};
  if (Object.prototype.hasOwnProperty.call(memo, key)) {
    return memo[key];
  }

  var role = '';
  try {
    var record = findUserRecordByUserId_(key);
    if (record && record.user) {
      role = String(
        (typeof getEffectiveUserRole_ === 'function' ? getEffectiveUserRole_(record.user) : record.user.role) || ''
      ).trim();
    }
  } catch (e) {
    role = '';
  }

  memo[key] = role;
  return role;
}

function projIsStatusOnlyUpdatePayload_(payload) {
  return Boolean(payload) &&
    payload.status !== undefined &&
    payload.proj_name === undefined &&
    payload.priority === undefined &&
    payload.members === undefined &&
    payload.supervisor === undefined &&
    payload.start_date === undefined &&
    payload.end_date === undefined &&
    payload.description === undefined;
}

function projActivitySheet_() {
  return getOrCreateSheetWithHeaders_(PROJ_ACTIVITY_SHEET_, PROJ_ACTIVITY_HEADERS_);
}

function projActivityNextId_() {
  var sheet = projActivitySheet_();
  var data = sheet.getDataRange().getValues();
  var lastId = 0;
  for (var i = 1; i < data.length; i++) {
    var val = String(data[i][0] || '');
    if (/^PACT_\d+$/.test(val)) {
      var n = parseInt(val.replace('PACT_', ''), 10);
      if (!isNaN(n) && n > lastId) lastId = n;
    }
  }
  return 'PACT_' + String(lastId + 1).padStart(4, '0');
}

function projActivityProjectName_(projId, fallbackName) {
  var explicitName = String(fallbackName || '').trim();
  if (explicitName) return explicitName;

  var targetProjId = String(projId || '').trim();
  if (!targetProjId) return '';

  var rows = getSheetValues_(projInternSheet_());
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === targetProjId) {
      return String(rows[i][1] || '').trim();
    }
  }

  return '';
}

function recordProjActivity_(entry) {
  if (!entry) return;

  var projId = String(entry.proj_id || '').trim();
  var text = String(entry.text || '').trim();
  if (!projId || !text) return;

  var sheet = projActivitySheet_();
  var now = String(entry.created_at || '').trim() || formatTimestamp_(new Date());
  var row = [
    projActivityNextId_(),
    projId,
    projActivityProjectName_(projId, entry.proj_name),
    String(entry.type || 'project').trim() || 'project',
    text,
    now,
    String(entry.created_by || entry.user_id || '').trim()
  ];
  sheet.appendRow(row);
}

function projActivityComparableCsv_(value) {
  return projAssignmentIdsFromValue_(value)
    .map(function(item) { return String(item || '').trim(); })
    .filter(Boolean)
    .sort()
    .join(',');
}

function projActivityBuildProjectUpdate_(previousProject, nextProject) {
  var beforeProject = previousProject || {};
  var afterProject = nextProject || {};
  var nextStatus = String(afterProject.status || '').trim() || 'Not Started';
  var statusChanged = String(beforeProject.status || '').trim() !== nextStatus;
  var detailsChanged =
    String(beforeProject.proj_name || '').trim() !== String(afterProject.proj_name || '').trim() ||
    String(beforeProject.priority || '').trim() !== String(afterProject.priority || '').trim() ||
    String(beforeProject.description || '').trim() !== String(afterProject.description || '').trim() ||
    String(beforeProject.start_date || '').trim() !== String(afterProject.start_date || '').trim() ||
    String(beforeProject.end_date || '').trim() !== String(afterProject.end_date || '').trim() ||
    projActivityComparableCsv_(beforeProject.members) !== projActivityComparableCsv_(afterProject.members) ||
    projActivityComparableCsv_(beforeProject.supervisor) !== projActivityComparableCsv_(afterProject.supervisor);

  if (statusChanged && detailsChanged) {
    return { type: 'project', text: 'Updated project details and changed status to ' + nextStatus + '.' };
  }
  if (statusChanged) {
    return { type: 'project', text: 'Changed project status to ' + nextStatus + '.' };
  }
  if (detailsChanged) {
    return { type: 'project', text: 'Updated project details.' };
  }

  return null;
}

function projActivityLegacyKey_(type, projId, text, createdAt) {
  return [
    String(type || '').trim().toLowerCase(),
    String(projId || '').trim(),
    String(text || '').trim(),
    String(createdAt || '').trim()
  ].join('||');
}

function projActivityComparableTime_(value) {
  var raw = String(value || '').trim();
  if (!raw) return 0;
  var parsed = parseDateLike_(raw);
  return parsed ? parsed.getTime() : 0;
}

// Similar utility functions for milestones
function milestoneSheet_() {
  return getOrCreateSheetWithHeaders_(MILESTONE_SHEET_, MILESTONE_HEADERS_);
}

function milestoneNextId_() {
  var sheet = milestoneSheet_();
  var data  = sheet.getDataRange().getValues();
  var lastId = 0;
  for (var i = 1; i < data.length; i++) {
    var val = String(data[i][0] || '');
    if (/^Miles_\d+$/.test(val)) {
      var n = parseInt(val.replace('Miles_', ''), 10);
      if (!isNaN(n) && n > lastId) lastId = n;
    }
  }
  return 'Miles_' + String(lastId + 1).padStart(4, '0');
}

function milestoneRowToObj_(row) {
  return {
    milestone_id: String(row[0] || ''),
    proj_id:      String(row[1] || ''),
    milestone:    String(row[2] || ''),
    status:       String(row[3] || '') || 'Not Started',
    date:         row[4] ? Utilities.formatDate(new Date(row[4]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
    done:         (function(v){ v = String(v || '').toLowerCase(); return v === 'true' || v === '1' || v === 'yes'; })(row[5]),
    created_at:   String(row[6] || ''),
    created_by:   String(row[7] || ''),
    updated_by:   String(row[8] || ''),
    linked_files: String(row[9] || '')
  };
}

// ── List projects for an intern (created_by = user_id) ──────────────────────

function handleListProjIntern_(payload) {
  var userId = String(payload.user_id || '').trim();
  if (!userId) return { ok: false, error: 'user_id is required.' };

  var sheet = projInternSheet_();
  var data  = sheet.getDataRange().getValues();
  var projects = [];
  var creatorRoleCache = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!String(row[0] || '').trim()) continue;   // skip blank rows
    var obj = projRowToObj_(row);
    var creatorRole = projCreatorRole_(obj.created_by, creatorRoleCache);
    obj.created_by_role = creatorRole;
    obj.creator_is_supervisor = projAssignmentNormalizeText_(creatorRole) === 'supervisor';
    // Return projects where this user is the creator OR a member
    var memberIds = obj.members.split(',').map(function(s){ return s.trim(); });
    if (obj.created_by === userId || memberIds.indexOf(userId) !== -1) {
      projects.push(obj);
    }
  }

  return { ok: true, projects: projects };
}

// ── Create a new project ─────────────────────────────────────────────────────

function handleCreateProjIntern_(payload) {
  var userId = String(payload.user_id || '').trim();
  if (!userId) return { ok: false, error: 'user_id is required.' };

  var projName = String(payload.proj_name || '').trim();
  if (!projName) return { ok: false, error: 'proj_name is required.' };

  var startDate = String(payload.start_date || '').trim();
  var endDate   = String(payload.end_date   || '').trim();
  if (!startDate || !endDate) return { ok: false, error: 'start_date and end_date are required.' };

  var sheet  = projInternSheet_();
  var projId = projInternNextId_();
  var now    = new Date();

  var validation = validateProjectAssignments_(payload, payload.members, payload.supervisor);
  if (!validation.ok) return validation;

  // members/supervisors are arrays from frontend, stored as comma-separated user_ids
  var membersStr = validation.members.join(',');
  var supervisorsStr = validation.supervisors.join(',');

  var row = [
    projId,
    projName,
    String(payload.priority    || 'Medium').trim(),
    String(payload.status      || 'Not Started').trim(),
    membersStr,
    supervisorsStr,
    startDate,
    endDate,
    String(payload.description || '').trim(),
    formatTimestamp_(now),
    userId,
    userId
  ];

  sheet.appendRow(row);
  var appendedRowIndex = sheet.getLastRow();
  try {
    var mirrorResult = syncSupervisorProjectMirror_({
      proj_id: projId,
      proj_name: projName,
      priority: String(payload.priority || 'Medium').trim(),
      status: String(payload.status || 'Not Started').trim(),
      members: membersStr,
      supervisor: String(payload.supervisor || '').trim(),
      start_date: startDate,
      end_date: endDate,
      description: String(payload.description || '').trim(),
      created_at: formatTimestamp_(now),
      created_by: userId,
      updated_by: userId
    });
    if (!mirrorResult || mirrorResult.ok !== true) {
      throw new Error((mirrorResult && mirrorResult.error) || 'Failed to sync supervisor project.');
    }
  } catch (mirrorErr) {
    try {
      sheet.deleteRow(appendedRowIndex);
    } catch (rollbackErr) {
      // If rollback fails, return the sync error so the caller can retry.
    }
    return { ok: false, error: mirrorErr && mirrorErr.message ? mirrorErr.message : String(mirrorErr) };
  }

  recordProjActivity_({
    proj_id: projId,
    proj_name: projName,
    type: 'project',
    text: 'Created a new project.',
    created_at: formatTimestamp_(now),
    created_by: userId
  });

  return { ok: true, proj_id: projId };
}

// ── Update an existing project ───────────────────────────────────────────────

function handleUpdateProjIntern_(payload) {
  var projId = String(payload.proj_id || '').trim();
  var userId = String(payload.user_id || '').trim();
  if (!projId) return { ok: false, error: 'proj_id is required.' };
  if (!userId) return { ok: false, error: 'user_id is required.' };

  var sheet = projInternSheet_();
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === projId) {
      var rowIndex = i + 1;
      var originalRow = data[i].slice();
      var existingProject = projRowToObj_(data[i]);
      var creatorRole = projCreatorRole_(existingProject.created_by, {});
      var isSupervisorCreated = projAssignmentNormalizeText_(creatorRole) === 'supervisor';
      var isAssignedMember = projAssignmentIdsFromValue_(existingProject.members).indexOf(userId) !== -1;
      var isCreator = String(existingProject.created_by || '').trim() === userId;
      var statusOnlyUpdate = projIsStatusOnlyUpdatePayload_(payload);

      if (!isCreator && isSupervisorCreated) {
        if (!isAssignedMember) {
          return { ok: false, error: 'You do not have permission to edit this project.' };
        }
        if (!statusOnlyUpdate) {
          return { ok: false, error: 'This project was created by a supervisor. Interns can only update the project status.' };
        }
      }

      var membersRaw = payload.members;
      var membersStr = data[i][4]; // keep existing if not provided
      if (membersRaw !== undefined) {
        membersStr = projAssignmentIdsToString_(membersRaw);
      }
      var supervisorsStr = payload.supervisor !== undefined
        ? projAssignmentIdsToString_(payload.supervisor)
        : String(data[i][5] || '').trim();
      if (payload.members !== undefined || payload.supervisor !== undefined) {
        var validation = validateProjectAssignments_(payload, membersStr, supervisorsStr);
        if (!validation.ok) return validation;
        membersStr = validation.members.join(',');
        supervisorsStr = validation.supervisors.join(',');
      }

      var nextProject = {
        proj_id: projId,
        proj_name: String(payload.proj_name !== undefined ? payload.proj_name : existingProject.proj_name).trim(),
        priority: String(payload.priority !== undefined ? payload.priority : existingProject.priority).trim(),
        status: String(payload.status !== undefined ? payload.status : existingProject.status).trim() || 'Not Started',
        members: membersStr,
        supervisor: supervisorsStr,
        start_date: String(payload.start_date !== undefined ? payload.start_date : existingProject.start_date).trim(),
        end_date: String(payload.end_date !== undefined ? payload.end_date : existingProject.end_date).trim(),
        description: String(payload.description !== undefined ? payload.description : existingProject.description).trim(),
        created_at: String(existingProject.created_at || '').trim(),
        created_by: String(existingProject.created_by || '').trim()
      };

      sheet.getRange(i + 1, 2).setValue(nextProject.proj_name);
      sheet.getRange(i + 1, 3).setValue(nextProject.priority);
      sheet.getRange(i + 1, 4).setValue(nextProject.status);
      sheet.getRange(i + 1, 5).setValue(membersStr);
      sheet.getRange(i + 1, 6).setValue(supervisorsStr);
      sheet.getRange(i + 1, 7).setValue(nextProject.start_date);
      sheet.getRange(i + 1, 8).setValue(nextProject.end_date);
      sheet.getRange(i + 1, 9).setValue(nextProject.description);
      sheet.getRange(i + 1, 12).setValue(userId);
      try {
        var mirrorResult = syncSupervisorProjectMirror_({
          proj_id: projId,
          proj_name: nextProject.proj_name,
          priority: nextProject.priority,
          status: nextProject.status,
          members: membersStr,
          supervisor: supervisorsStr,
          start_date: nextProject.start_date,
          end_date: nextProject.end_date,
          description: nextProject.description,
          created_at: nextProject.created_at,
          created_by: nextProject.created_by,
          updated_by: userId
        });
        if (!mirrorResult || mirrorResult.ok !== true) {
          throw new Error((mirrorResult && mirrorResult.error) || 'Failed to sync supervisor project.');
        }
      } catch (mirrorErr) {
        try {
          sheet.getRange(rowIndex, 1, 1, originalRow.length).setValues([originalRow]);
        } catch (rollbackErr) {
          // Keep reporting the sync error so the caller can retry.
        }
        return { ok: false, error: mirrorErr && mirrorErr.message ? mirrorErr.message : String(mirrorErr) };
      }

      var updateActivity = projActivityBuildProjectUpdate_(existingProject, nextProject);
      if (updateActivity) {
        recordProjActivity_({
          proj_id: projId,
          proj_name: nextProject.proj_name,
          type: updateActivity.type,
          text: updateActivity.text,
          created_by: userId
        });
      }

      return { ok: true, proj_id: projId };
    }
  }

  return { ok: false, error: 'Project not found: ' + projId };
}

// ── Restore an archived project (set status back to Not Started) ─────────────

function handleRestoreProjIntern_(payload) {
  var projId = String(payload.proj_id || '').trim();
  var userId = String(payload.user_id || '').trim();
  if (!projId) return { ok: false, error: 'proj_id is required.' };
  if (!userId) return { ok: false, error: 'user_id is required.' };

  var sheet = projInternSheet_();
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === projId) {
      var rowIndex = i + 1;
      var originalRow = data[i].slice();
      var restoredStatus = 'Not Started';
      sheet.getRange(i + 1, 4).setValue(restoredStatus);
      sheet.getRange(i + 1, 12).setValue(userId);
      try {
        var mirrorResult = syncSupervisorProjectMirror_({
          proj_id: projId,
          proj_name: String(data[i][1] || '').trim(),
          priority: String(data[i][2] || '').trim(),
          status: restoredStatus,
          members: String(data[i][4] || '').trim(),
          supervisor: String(data[i][5] || '').trim(),
          start_date: String(data[i][6] || '').trim(),
          end_date: String(data[i][7] || '').trim(),
          description: String(data[i][8] || '').trim(),
          created_at: String(data[i][9] || '').trim(),
          created_by: String(data[i][10] || '').trim(),
          updated_by: userId
        });
        if (!mirrorResult || mirrorResult.ok !== true) {
          throw new Error((mirrorResult && mirrorResult.error) || 'Failed to sync supervisor project.');
        }
      } catch (mirrorErr) {
        try {
          sheet.getRange(rowIndex, 1, 1, originalRow.length).setValues([originalRow]);
        } catch (rollbackErr) {
          // Keep reporting the sync error so the caller can retry.
        }
        return { ok: false, error: mirrorErr && mirrorErr.message ? mirrorErr.message : String(mirrorErr) };
      }

      recordProjActivity_({
        proj_id: projId,
        proj_name: String(data[i][1] || '').trim(),
        type: 'project',
        text: 'Restored the project.',
        created_by: userId
      });

      return { ok: true, proj_id: projId, status: restoredStatus };
    }
  }

  return { ok: false, error: 'Project not found: ' + projId };
}

// ── Delete a project ─────────────────────────────────────────────────────────

function handleDeleteProjIntern_(payload) {
  var projId = String(payload.proj_id || '').trim();
  if (!projId) return { ok: false, error: 'proj_id is required.' };

  var sheet = projInternSheet_();
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === projId) {
      var rowIndex = i + 1;
      var originalRow = data[i].slice();
      sheet.deleteRow(rowIndex);
      try {
        var mirrorResult = deleteSupervisorProjectMirror_(projId);
        if (!mirrorResult || mirrorResult.ok !== true) {
          throw new Error((mirrorResult && mirrorResult.error) || 'Failed to remove supervisor project.');
        }
      } catch (mirrorErr) {
        try {
          sheet.insertRowBefore(rowIndex);
          sheet.getRange(rowIndex, 1, 1, originalRow.length).setValues([originalRow]);
        } catch (rollbackErr) {
          // Keep reporting the sync error so the caller can retry.
        }
        return { ok: false, error: mirrorErr && mirrorErr.message ? mirrorErr.message : String(mirrorErr) };
      }

      return { ok: true, proj_id: projId };
    }
  }

  return { ok: false, error: 'Project not found: ' + projId };
}

// (Supervisor-specific bootstrap moved to ProjectsSupervisor.js)

// ── Milestones (CRUD) ─────────────────────────────────────────────────────
function handleListMilestones_(payload) {
  var projId = String(payload.proj_id || '').trim();
  if (!projId) return { ok: false, error: 'proj_id is required.' };
  var sheet = milestoneSheet_();
  var data  = sheet.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    if (!String(data[i][0] || '').trim()) continue;
    var obj = milestoneRowToObj_(data[i]);
    if (obj.proj_id === projId) items.push(obj);
  }
  return { ok: true, milestones: items };
}

function handleCreateMilestone_(payload) {
  var projId = String(payload.proj_id || '').trim();
  var text   = String(payload.milestone || '').trim();
  var date   = String(payload.date || '').trim();
  var status = String(payload.status || '').trim() || 'Not Started';
  var userId = String(payload.user_id || '').trim();
  if (!projId) return { ok: false, error: 'proj_id is required.' };
  if (!text) return { ok: false, error: 'milestone is required.' };
  if (!userId) return { ok: false, error: 'user_id is required.' };

  var sheet = milestoneSheet_();
  var id    = milestoneNextId_();
  var now   = formatTimestamp_(new Date());

  var doneVal = payload.done ? 'TRUE' : 'FALSE';
  var linkedFiles = String(payload.linked_files || '').trim();
  var row = [ id, projId, text, status, date || '', doneVal, now, userId, userId, linkedFiles ];
  sheet.appendRow(row);
  recordProjActivity_({
    proj_id: projId,
    type: 'milestone',
    text: 'Added milestone: ' + text + '.',
    created_at: now,
    created_by: userId
  });
  return { ok: true, milestone_id: id, created_at: now };
}

function handleDeleteMilestone_(payload) {
  var id = String(payload.milestone_id || '').trim();
  if (!id) return { ok: false, error: 'milestone_id is required.' };
  var sheet = milestoneSheet_();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === id) {
      var projId = String(data[i][1] || '').trim();
      var milestoneText = String(data[i][2] || '').trim();
      var deletedBy = String(payload.user_id || data[i][8] || '').trim();
      sheet.deleteRow(i + 1);
      recordProjActivity_({
        proj_id: projId,
        type: 'milestone',
        text: 'Deleted milestone: ' + milestoneText + '.',
        created_by: deletedBy
      });
      return { ok: true, milestone_id: id };
    }
  }
  return { ok: false, error: 'Milestone not found: ' + id };
}

function handleUpdateMilestone_(payload) {
  var id = String(payload.milestone_id || '').trim();
  var text = payload.milestone !== undefined ? String(payload.milestone || '').trim() : undefined;
  var date = payload.date !== undefined ? String(payload.date || '').trim() : undefined;
  var userId = String(payload.user_id || '').trim();
  if (!id) return { ok: false, error: 'milestone_id is required.' };
  if (!userId) return { ok: false, error: 'user_id is required.' };

  var sheet = milestoneSheet_();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === id) {
      var prevMilestoneText = String(data[i][2] || '').trim();
      var nextMilestoneText = text !== undefined ? text : prevMilestoneText;
      var prevMilestoneStatus = String(data[i][3] || '').trim() || 'Not Started';
      var nextMilestoneStatus = payload.status !== undefined ? String(payload.status || '').trim() || 'Not Started' : prevMilestoneStatus;
      var prevMilestoneDate = String(data[i][4] || '').trim();
      var nextMilestoneDate = date !== undefined ? date : prevMilestoneDate;
      var nextLinkedFiles = payload.linked_files !== undefined ? String(payload.linked_files || '') : String(data[i][9] || '');
      if (text !== undefined) sheet.getRange(i + 1, 3).setValue(text);
      if (payload.status !== undefined) sheet.getRange(i + 1, 4).setValue(String(payload.status));
      if (date !== undefined) sheet.getRange(i + 1, 5).setValue(date);
      if (payload.done !== undefined) sheet.getRange(i + 1, 6).setValue(payload.done ? 'TRUE' : 'FALSE');
      if (payload.linked_files !== undefined) sheet.getRange(i + 1, 10).setValue(String(payload.linked_files || ''));
      sheet.getRange(i + 1, 9).setValue(userId);

      var milestoneTextChanged = prevMilestoneText !== nextMilestoneText;
      var milestoneStatusChanged = prevMilestoneStatus !== nextMilestoneStatus;
      var milestoneDateChanged = prevMilestoneDate !== nextMilestoneDate;
      var milestoneFilesChanged = String(data[i][9] || '') !== nextLinkedFiles;
      var milestoneActivityText = '';

      if (milestoneStatusChanged && (milestoneTextChanged || milestoneDateChanged || milestoneFilesChanged)) {
        milestoneActivityText = 'Updated milestone and changed status to ' + nextMilestoneStatus + ': ' + nextMilestoneText + '.';
      } else if (milestoneStatusChanged) {
        milestoneActivityText = 'Changed milestone status to ' + nextMilestoneStatus + ': ' + nextMilestoneText + '.';
      } else if (milestoneTextChanged || milestoneDateChanged || milestoneFilesChanged) {
        milestoneActivityText = 'Updated milestone: ' + nextMilestoneText + '.';
      }

      if (milestoneActivityText) {
        recordProjActivity_({
          proj_id: String(data[i][1] || '').trim(),
          type: 'milestone',
          text: milestoneActivityText,
          created_by: userId
        });
      }

      return { ok: true, milestone_id: id };
    }
  }
  return { ok: false, error: 'Milestone not found: ' + id };
}

// ── Feedback (CRUD) ──────────────────────────────────────────────────────────
var FEEDBACK_SHEET_ = 'feedback_intern';
var FEEDBACK_HEADERS_ = [
  'feedback_id', 'proj_id', 'parent_id',
  'commenter_id', 'commenter_role', 'comment_text',
  'created_at', 'created_by', 'updated_by'
];

function feedbackSheet_() {
  return getOrCreateSheetWithHeaders_(FEEDBACK_SHEET_, FEEDBACK_HEADERS_);
}

function feedbackNextId_() {
  var sheet = feedbackSheet_();
  var data  = sheet.getDataRange().getValues();
  var lastId = 0;
  for (var i = 1; i < data.length; i++) {
    var val = String(data[i][0] || '');
    if (/^FEED_\d+$/.test(val)) {
      var n = parseInt(val.replace('FEED_', ''), 10);
      if (!isNaN(n) && n > lastId) lastId = n;
    }
  }
  return 'FEED_' + String(lastId + 1).padStart(4, '0');
}

function feedbackRowToObj_(row) {
  return {
    feedback_id:    String(row[0]  || ''),
    proj_id:        String(row[1]  || ''),
    parent_id:      String(row[2]  || ''),
    commenter_id:   String(row[3]  || ''),
    commenter_role: String(row[4]  || ''),
    comment_text:   String(row[5]  || ''),
    created_at:     String(row[6] || ''),
    created_by:     String(row[7] || ''),
    updated_by:     String(row[8] || '')
  };
}

function feedbackCommenterName_(commenterId, cache) {
  var key = String(commenterId || '').trim();
  if (!key) return '';

  var memo = cache || {};
  if (Object.prototype.hasOwnProperty.call(memo, key)) {
    return memo[key];
  }

  var name = '';
  try {
    var record = findUserRecordByUserId_(key);
    if (record && record.user) {
      name = String(record.user.full_name || record.user.email || key).trim();
    }
  } catch (e) {
    name = '';
  }

  memo[key] = name;
  return name;
}
// For feedback, we can have root comments (parent_id = '') and replies (parent_id = feedback_id of the parent comment).
function handleListFeedback_(payload) {
  var projId = String(payload.proj_id || '').trim();
  if (!projId) return { ok: false, error: 'proj_id is required.' };
  var sheet = feedbackSheet_();
  var data  = sheet.getDataRange().getValues();
  var items = [];
  var commenterNameCache = {};
  for (var i = 1; i < data.length; i++) {
    if (!String(data[i][0] || '').trim()) continue;
    var obj = feedbackRowToObj_(data[i]);
    if (obj.proj_id === projId) {
      obj.commenter_name = feedbackCommenterName_(obj.commenter_id, commenterNameCache);
      items.push(obj);
    }
  }
  return { ok: true, feedback: items };
}

function handleCreateFeedback_(payload) {
  var projId  = String(payload.proj_id       || '').trim();
  var userId  = String(payload.user_id       || '').trim();
  var text    = String(payload.comment_text  || '').trim();
  var role    = String(payload.commenter_role|| '').trim();
  if (!projId)  return { ok: false, error: 'proj_id is required.' };
  if (!userId)  return { ok: false, error: 'user_id is required.' };
  if (!text)    return { ok: false, error: 'comment_text is required.' };

  var sheet = feedbackSheet_();
  var id    = feedbackNextId_();
  var now   = formatTimestamp_(new Date());

  var row = [
    id,
    projId,
    String(payload.parent_id     || '').trim(),
    userId,
    role,
    text,
    now,         // created_at
    userId,      // created_by
    userId       // updated_by
  ];
  sheet.appendRow(row);
  if (!String(payload.parent_id || '').trim()) {
    recordProjActivity_({
      proj_id: projId,
      type: 'feedback',
      text: text,
      created_at: now,
      created_by: userId
    });
  }
  return { ok: true, feedback_id: id, created_at: now };
}

function handleDeleteFeedback_(payload) {
  var id = String(payload.feedback_id || '').trim();
  if (!id) return { ok: false, error: 'feedback_id is required.' };
  var sheet = feedbackSheet_();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === id) { sheet.deleteRow(i + 1); return { ok: true, feedback_id: id }; }
  }
  return { ok: false, error: 'Feedback not found: ' + id };
}

// ── Overview: Recent Activity aggregation ─────────────────────────────────────
// Returns recent feedback comments, project activity events, and milestone
// creation rows for all of the user's projects, sorted by created_at
// descending (max 15 items).
function handleGetProjRecentActivity_(payload) {
  var userId = String(payload.user_id || '').trim();
  if (!userId) return { ok: false, error: 'user_id is required.' };

  // 1. Gather all project IDs belonging to this user
  var projResult = handleListProjIntern_({ user_id: userId });
  if (!projResult.ok || !projResult.projects || !projResult.projects.length) {
    return { ok: true, activities: [] };
  }

  var projIdSet = {};
  var projNameMap = {};
  (projResult.projects || []).forEach(function(p) {
    var pid = String(p.proj_id || '');
    if (pid) {
      projIdSet[pid]   = true;
      projNameMap[pid] = String(p.proj_name || '');
    }
  });

  var activities = [];
  var activityKeySet = {};

  // 2. Collect project activity events across those projects.
  // New feedback and milestone-create events are logged here too, which keeps
  // future items in one append-ordered stream.
  try {
    var paSheet = projActivitySheet_();
    var paData = paSheet.getDataRange().getValues();
    for (var j = 1; j < paData.length; j++) {
      var paRow = paData[j];
      if (!String(paRow[0] || '').trim()) continue;
      var paProjId = String(paRow[1] || '').trim();
      if (!projIdSet[paProjId]) continue;
      var paType = String(paRow[3] || '').trim() || 'project';
      var paText = String(paRow[4] || '').trim();
      var paCreatedAt = String(paRow[5] || '');
      activityKeySet[projActivityLegacyKey_(paType, paProjId, paText, paCreatedAt)] = true;
      activities.push({
        type: paType,
        proj_id: paProjId,
        proj_name: String(paRow[2] || '').trim() || projNameMap[paProjId] || '',
        text: paText,
        created_at: paCreatedAt,
        _sort_time: projActivityComparableTime_(paCreatedAt),
        _sort_row: j,
        _sort_source: 3
      });
    }
  } catch (paErr) { /* ignore read errors gracefully */ }

  // 3. Collect recent root feedback comments across those projects as legacy
  // fallback for rows created before feedback was mirrored into proj_activity.
  try {
    var fbSheet = feedbackSheet_();
    var fbData  = fbSheet.getDataRange().getValues();
    for (var i = 1; i < fbData.length; i++) {
      var row = fbData[i];
      if (!String(row[0] || '').trim()) continue;
      var rowProjId = String(row[1] || '').trim();
      if (!projIdSet[rowProjId]) continue;
      // row[2] = parent_id — skip replies to keep feed concise
      if (String(row[2] || '').trim()) continue;
      var fbText = String(row[5] || '');
      var fbCreatedAt = String(row[6] || '');
      if (activityKeySet[projActivityLegacyKey_('feedback', rowProjId, fbText, fbCreatedAt)]) continue;
      activities.push({
        type:       'feedback',
        proj_id:    rowProjId,
        proj_name:  projNameMap[rowProjId] || '',
        text:       fbText,
        role:       String(row[4] || ''),
        created_at: fbCreatedAt,
        _sort_time: projActivityComparableTime_(fbCreatedAt),
        _sort_row: i,
        _sort_source: 2
      });
    }
  } catch (fbErr) { /* ignore read errors gracefully */ }

  // 4. Collect recently created milestones across those projects as legacy
  // fallback for rows created before milestone-create events were mirrored into
  // proj_activity.
  try {
    var msSheet = milestoneSheet_();
    var msData  = msSheet.getDataRange().getValues();
    for (var k = 1; k < msData.length; k++) {
      var msRow = msData[k];
      if (!String(msRow[0] || '').trim()) continue;
      var msProjId = String(msRow[1] || '').trim();
      if (!projIdSet[msProjId]) continue;
      var milestoneText = 'Added milestone: ' + String(msRow[2] || '') + '.';
      var milestoneCreatedAt = String(msRow[6] || '');
      if (activityKeySet[projActivityLegacyKey_('milestone', msProjId, milestoneText, milestoneCreatedAt)]) continue;
      activities.push({
        type:       'milestone',
        proj_id:    msProjId,
        proj_name:  projNameMap[msProjId] || '',
        text:       milestoneText,
        status:     String(msRow[3] || 'Not Started'),
        created_at: milestoneCreatedAt,
        _sort_time: projActivityComparableTime_(milestoneCreatedAt),
        _sort_row: k,
        _sort_source: 1
      });
    }
  } catch (msErr) { /* ignore read errors gracefully */ }

  // 5. Sort newest-first, cap at 15
  activities.sort(function(a, b) {
    var timeDiff = Number(b._sort_time || 0) - Number(a._sort_time || 0);
    if (timeDiff !== 0) return timeDiff;

    var sourceDiff = Number(b._sort_source || 0) - Number(a._sort_source || 0);
    if (sourceDiff !== 0) return sourceDiff;

    return Number(b._sort_row || 0) - Number(a._sort_row || 0);
  });

  return {
    ok: true,
    activities: activities.slice(0, 15).map(function(activity) {
      delete activity._sort_time;
      delete activity._sort_row;
      delete activity._sort_source;
      return activity;
    })
  };
}
