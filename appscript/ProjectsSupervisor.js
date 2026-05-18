// ProjectsSupervisor.js - supervisor-specific helpers for projects

var PROJ_SUPERVISOR_SHEET_ = 'proj_supervisor';
var PROJ_SUPERVISOR_SHEET_LEGACY_ = 'poj_supervisor';
var PROJ_SUPERVISOR_HEADERS_ = [
  'projsupervisor_id', 'proj_id', 'proj_name', 'priority', 'status', 'members',
  'supervisor', 'start_date', 'end_date', 'description',
  'created_at', 'created_by', 'updated_by', 'supervisor_archived'
];

function normalizeProjectTagValue_(value) {
  return String(value || '').trim().toLowerCase();
}

function splitProjectCsvValues_(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return String(item || '').trim();
    }).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(function (item) {
      return String(item || '').trim();
    })
    .filter(Boolean);
}

function joinProjectCsvValues_(value) {
  return splitProjectCsvValues_(value).join(',');
}

function formatSupervisorSheetDate_(value) {
  var s = String(value || '').trim();
  if (!s) return '';

  var d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(s + 'T00:00:00');
  } else {
    d = new Date(s);
  }

  if (isNaN(d)) return s;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizeSupervisorArchiveFlag_(value) {
  var text = String(value || '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'y';
}

function supervisorArchiveCellValue_(value) {
  return normalizeSupervisorArchiveFlag_(value) ? 'TRUE' : 'FALSE';
}

function projSupervisorSheet_() {
  var spreadsheet = getSpreadsheet_();
  var primary = spreadsheet.getSheetByName(PROJ_SUPERVISOR_SHEET_);
  if (primary) {
    return getOrCreateSheetWithHeaders_(PROJ_SUPERVISOR_SHEET_, PROJ_SUPERVISOR_HEADERS_);
  }

  var legacy = spreadsheet.getSheetByName(PROJ_SUPERVISOR_SHEET_LEGACY_);
  if (legacy) {
    try {
      legacy.setName(PROJ_SUPERVISOR_SHEET_);
      return getOrCreateSheetWithHeaders_(PROJ_SUPERVISOR_SHEET_, PROJ_SUPERVISOR_HEADERS_);
    } catch (e) {
      // If rename fails (e.g., duplicate name conflict), keep using legacy sheet.
      ensureSheetColumns_(legacy, PROJ_SUPERVISOR_HEADERS_);
      return legacy;
    }
  }

  return getOrCreateSheetWithHeaders_(PROJ_SUPERVISOR_SHEET_, PROJ_SUPERVISOR_HEADERS_);
}

function connectSupervisorProjectsDb_() {
  return projSupervisorSheet_();
}

function projSupervisorRowToObj_(row) {
  return {
    projsupervisor_id: String(row[0] || ''),
    proj_id: String(row[1] || ''),
    proj_name: String(row[2] || ''),
    priority: String(row[3] || ''),
    status: String(row[4] || ''),
    members: String(row[5] || ''),
    supervisor: String(row[6] || ''),
    start_date: row[7] ? formatSupervisorSheetDate_(row[7]) : '',
    end_date: row[8] ? formatSupervisorSheetDate_(row[8]) : '',
    description: String(row[9] || ''),
    created_at: String(row[10] || ''),
    created_by: String(row[11] || ''),
    updated_by: String(row[12] || ''),
    supervisor_archived: String(row[13] || '')
  };
}

function findSupervisorProjectRecordByProjId_(projId) {
  var target = String(projId || '').trim();
  if (!target) return null;

  var sheet = connectSupervisorProjectsDb_();
  var rowIndex = findSupervisorProjectRowIndexByProjId_(sheet, target);
  if (!rowIndex) return null;

  var rows = getSheetValues_(sheet);
  return {
    sheet: sheet,
    rowIndex: rowIndex,
    row: rows[rowIndex - 1].slice(),
    project: projSupervisorRowToObj_(rows[rowIndex - 1])
  };
}

function readSupervisorProjectRows_(supervisorUserId) {
  var supervisorTokens = buildSupervisorLookupTokens_(supervisorUserId);
  var sheet = connectSupervisorProjectsDb_();
  var data = getSheetValues_(sheet);
  var projects = [];
  var ownerNameCache = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!String(row[1] || '').trim()) continue;

    var obj = projSupervisorRowToObj_(row);
    var supervisors = splitProjectCsvValues_(obj.supervisor);
    var createdBy = String(obj.created_by || '').trim();

    var supervisorMatch = matchesAnyToken_(supervisors, supervisorTokens);
    var creatorMatch = matchesAnyToken_([createdBy], supervisorTokens);

    // Show rows tagged to the current supervisor, plus supervisor-created rows.
    if (!supervisorMatch && !creatorMatch) continue;

    var ownerName = resolveProjectOwnerName_(createdBy, ownerNameCache);

    projects.push({
      id: obj.proj_id,
      proj_id: obj.proj_id,
      title: obj.proj_name,
      proj_name: obj.proj_name,
      description: obj.description,
      priority_level: String(obj.priority || '').trim() || 'Low',
      priority: String(obj.priority || '').trim() || 'Low',
      status: String(obj.status || '').trim() || 'Not Started',
      members: splitProjectCsvValues_(obj.members),
      supervisor: supervisors,
      supervisors: supervisors,
      timeline_start: obj.start_date,
      timeline_end: obj.end_date,
      deadline: obj.end_date,
      created_at: obj.created_at,
      created_by: createdBy,
      created_by_name: ownerName,
      owner_name: ownerName,
      archived: normalizeSupervisorArchiveFlag_(obj.supervisor_archived),
      supervisor_archived: normalizeSupervisorArchiveFlag_(obj.supervisor_archived)
    });
  }

  return projects;
}

function readSupervisorProjectsFromInternSheet_(supervisorUserId, existingProjIds) {
  var supervisorTokens = buildSupervisorLookupTokens_(supervisorUserId);
  var existing = existingProjIds || {};
  var ownerNameCache = {};
  var projects = [];

  var sheet = getOrCreateSheetWithHeaders_('proj_intern', [
    'proj_id', 'proj_name', 'priority', 'status', 'members', 'supervisor',
    'start_date', 'end_date', 'description',
    'created_at', 'created_by', 'updated_by'
  ]);
  var rows = getSheetValues_(sheet);

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var projId = String(row[0] || '').trim();
    if (!projId || existing[projId]) continue;

    var supervisors = splitProjectCsvValues_(row[5]);
    if (!matchesAnyToken_(supervisors, supervisorTokens)) continue;

    var createdBy = String(row[10] || '').trim();
    var ownerName = resolveProjectOwnerName_(createdBy, ownerNameCache);
    var startDate = row[6] ? formatSupervisorSheetDate_(row[6]) : '';
    var endDate = row[7] ? formatSupervisorSheetDate_(row[7]) : '';
    var status = String(row[3] || '').trim() || 'Not Started';
    // If an intern archived the project in the intern sheet, do not
    // propagate that 'Archived' status into the supervisor bootstrap
    // fallback. Supervisors should only see a project as archived when
    // the supervisor mirror row explicitly marks it so.
    if (String(status).trim().toLowerCase() === 'archived') {
      status = 'Not Started';
    }

    projects.push({
      id: projId,
      proj_id: projId,
      title: String(row[1] || '').trim(),
      proj_name: String(row[1] || '').trim(),
      description: String(row[8] || '').trim(),
      priority_level: String(row[2] || '').trim() || 'Low',
      priority: String(row[2] || '').trim() || 'Low',
      status: status,
      members: splitProjectCsvValues_(row[4]),
      supervisor: supervisors,
      supervisors: supervisors,
      timeline_start: startDate,
      timeline_end: endDate,
      deadline: endDate,
      created_at: String(row[9] || '').trim(),
      created_by: createdBy,
      created_by_name: ownerName,
      owner_name: ownerName,
      archived: false,
      supervisor_archived: false
    });
  }

  return projects;
}

function findSupervisorProjectRowIndexByProjId_(sheet, projId) {
  var target = String(projId || '').trim();
  if (!target) return 0;

  var headers = getHeaders_(sheet);
  var projIdCol = findColumnIndex_(headers, 'proj_id');
  if (!projIdCol) return 0;

  var values = getSheetValues_(sheet);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][projIdCol - 1] || '').trim() === target) {
      return i + 1;
    }
  }
  return 0;
}

function buildSupervisorLookupTokens_(supervisorUserId) {
  var tokenMap = {};

  function addToken(value) {
    var token = normalizeProjectTagValue_(value);
    if (token) tokenMap[token] = true;
  }

  addToken(supervisorUserId);

  try {
    var record = findUserRecordByUserId_(supervisorUserId);
    if (record && record.user) {
      addToken(record.user.full_name);
      addToken(record.user.email);
    }
  } catch (e) {
    // Best effort only. We still match by user id when the lookup fails.
  }

  return tokenMap;
}

function matchesAnyToken_(values, tokenMap) {
  var items = splitProjectCsvValues_(values);
  for (var i = 0; i < items.length; i++) {
    var token = normalizeProjectTagValue_(items[i]);
    if (token && tokenMap[token]) return true;
  }
  return false;
}

function resolveProjectOwnerName_(userId, cache) {
  var key = String(userId || '').trim();
  if (!key) return '';

  if (cache && Object.prototype.hasOwnProperty.call(cache, key)) {
    return cache[key];
  }

  var displayName = key;
  try {
    var record = findUserRecordByUserId_(key);
    if (record && record.user) {
      displayName = String(record.user.full_name || record.user.email || key).trim() || key;
    }
  } catch (e) {
    // Fall back to the raw user id.
  }

  if (cache) {
    cache[key] = displayName;
  }

  return displayName;
}

function syncSupervisorProjectMirror_(project) {
  var projId = String(project && (project.proj_id || project.id) || '').trim();
  if (!projId) {
    return { ok: false, error: 'proj_id is required.' };
  }

  var sheet = connectSupervisorProjectsDb_();
  var rowIndex = findSupervisorProjectRowIndexByProjId_(sheet, projId);
  var existing = rowIndex ? projSupervisorRowToObj_(getSheetValues_(sheet)[rowIndex - 1]) : null;
  var createdAt = String((existing && existing.created_at) || project.created_at || '').trim();
  var createdBy = String((existing && existing.created_by) || project.created_by || '').trim();
  var updatedBy = String(project.updated_by || project.created_by || createdBy || '').trim();
  var incomingStatus = String(project.status || 'Not Started').trim() || 'Not Started';
  var existingStatus = String((existing && existing.status) || '').trim() || 'Not Started';
  var resolvedStatus = incomingStatus;
  if (incomingStatus.toLowerCase() === 'archived' && !normalizeSupervisorArchiveFlag_(project.supervisor_archived)) {
    resolvedStatus = existingStatus;
  }
  var supervisorArchived = project.supervisor_archived !== undefined
    ? project.supervisor_archived
    : (existing && existing.supervisor_archived);
  var row = {
    projsupervisor_id: String((existing && existing.projsupervisor_id) || createId_('PSP')).trim(),
    proj_id: projId,
    proj_name: String(project.proj_name || project.title || '').trim(),
    priority: String(project.priority || project.priority_level || 'Medium').trim() || 'Medium',
    status: resolvedStatus,
    members: joinProjectCsvValues_(project.members),
    supervisor: joinProjectCsvValues_(project.supervisor !== undefined ? project.supervisor : project.supervisors),
    start_date: formatSupervisorSheetDate_(project.start_date || project.timeline_start || ''),
    end_date: formatSupervisorSheetDate_(project.end_date || project.timeline_end || project.deadline || ''),
    description: String(project.description || '').trim(),
    created_at: createdAt || formatTimestamp_(new Date()),
    created_by: createdBy,
    updated_by: updatedBy,
    supervisor_archived: supervisorArchiveCellValue_(supervisorArchived)
  };

  if (rowIndex) {
    updateObjectRow_(sheet, rowIndex, row);
  } else {
    appendObjectRow_(sheet, row);
  }

  return { ok: true, proj_id: projId, projsupervisor_id: row.projsupervisor_id };
}

function setSupervisorProjectArchiveState_(supervisorUserId, projId, archived) {
  var access = assertSupervisorCanAccessProject_(supervisorUserId, projId);
  if (!access.ok) return access;

  var mirrorRecord = findSupervisorProjectRecordByProjId_(projId);
  if (!mirrorRecord) {
    var syncResult = syncSupervisorProjectMirror_({
      proj_id: access.project.proj_id,
      proj_name: access.project.proj_name,
      priority: access.project.priority,
      status: access.project.status,
      members: access.project.members,
      supervisor: access.project.supervisor,
      start_date: access.project.start_date,
      end_date: access.project.end_date,
      description: access.project.description,
      created_at: access.project.created_at,
      created_by: access.project.created_by,
      updated_by: supervisorUserId,
      supervisor_archived: archived
    });
    if (!syncResult || syncResult.ok !== true) return syncResult;
    mirrorRecord = findSupervisorProjectRecordByProjId_(projId);
  }

  if (!mirrorRecord) {
    return { ok: false, error: 'Supervisor project mirror not found: ' + projId };
  }

  var row = mirrorRecord.project;
  row.supervisor_archived = supervisorArchiveCellValue_(archived);
  row.updated_by = supervisorUserId;
  updateObjectRow_(mirrorRecord.sheet, mirrorRecord.rowIndex, row);

  return {
    ok: true,
    proj_id: projId,
    archived: Boolean(archived),
    status: String(row.status || '').trim() || 'Not Started'
  };
}

function deleteSupervisorProjectMirror_(projId) {
  var target = String(projId || '').trim();
  if (!target) return { ok: false, error: 'proj_id is required.' };

  var sheet = connectSupervisorProjectsDb_();
  var rowIndex = findSupervisorProjectRowIndexByProjId_(sheet, target);
  if (!rowIndex) {
    return { ok: true, proj_id: target, deleted: false };
  }

  sheet.deleteRow(rowIndex);
  return { ok: true, proj_id: target, deleted: true };
}

function mergeSupervisorAssignmentWithCreator_(supervisorUserId, supervisorValue) {
  var supervisorIds = splitProjectCsvValues_(supervisorValue);
  if (supervisorIds.indexOf(supervisorUserId) === -1) {
    supervisorIds.push(supervisorUserId);
  }
  return supervisorIds;
}

function projectInternRowToObjForSupervisor_(row) {
  return {
    proj_id: String(row[0] || '').trim(),
    proj_name: String(row[1] || '').trim(),
    priority: String(row[2] || '').trim(),
    status: String(row[3] || '').trim(),
    members: String(row[4] || '').trim(),
    supervisor: String(row[5] || '').trim(),
    start_date: row[6] ? formatSupervisorSheetDate_(row[6]) : '',
    end_date: row[7] ? formatSupervisorSheetDate_(row[7]) : '',
    description: String(row[8] || '').trim(),
    created_at: String(row[9] || '').trim(),
    created_by: String(row[10] || '').trim(),
    updated_by: String(row[11] || '').trim()
  };
}

function projectInternSheetForSupervisor_() {
  return getOrCreateSheetWithHeaders_('proj_intern', [
    'proj_id', 'proj_name', 'priority', 'status', 'members', 'supervisor',
    'start_date', 'end_date', 'description',
    'created_at', 'created_by', 'updated_by'
  ]);
}

function findProjectInternRecordById_(projId) {
  var target = String(projId || '').trim();
  if (!target) return null;

  var sheet = projectInternSheetForSupervisor_();
  var rows = getSheetValues_(sheet);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === target) {
      return {
        sheet: sheet,
        rowIndex: i + 1,
        row: rows[i].slice(),
        project: projectInternRowToObjForSupervisor_(rows[i])
      };
    }
  }
  return null;
}

function assertSupervisorOwnsProject_(supervisorUserId, projId) {
  var access = assertSupervisorCanAccessProject_(supervisorUserId, projId);
  if (!access.ok) return access;

  if (String(access.project.created_by || '').trim() !== String(supervisorUserId || '').trim()) {
    return { ok: false, error: 'Supervisors can only manage projects they created.' };
  }

  return access;
}

function assertSupervisorCanAccessProject_(supervisorUserId, projId) {
  var userId = String(supervisorUserId || '').trim();
  var targetProjId = String(projId || '').trim();
  if (!userId) return { ok: false, error: 'user_id is required.' };
  if (!targetProjId) return { ok: false, error: 'proj_id is required.' };

  var record = findProjectInternRecordById_(targetProjId);
  if (!record || !record.project) {
    return { ok: false, error: 'Project not found: ' + targetProjId };
  }

  var supervisorTokens = buildSupervisorLookupTokens_(userId);
  var supervisors = splitProjectCsvValues_(record.project.supervisor);
  var createdBy = String(record.project.created_by || '').trim();
  var supervisorMatch = matchesAnyToken_(supervisors, supervisorTokens);
  var creatorMatch = matchesAnyToken_([createdBy], supervisorTokens);

  if (!supervisorMatch && !creatorMatch) {
    return { ok: false, error: 'This project is not assigned to the current supervisor.' };
  }

  return {
    ok: true,
    project: record.project,
    rowIndex: record.rowIndex,
    row: record.row,
    sheet: record.sheet
  };
}

function isSupervisorArchiveOnlyUpdate_(payload) {
  if (!payload || payload.status === undefined) return false;
  if (String(payload.status || '').trim().toLowerCase() !== 'archived') return false;
  return (
    payload.proj_name === undefined &&
    payload.priority === undefined &&
    payload.members === undefined &&
    payload.supervisor === undefined &&
    payload.start_date === undefined &&
    payload.end_date === undefined &&
    payload.description === undefined
  );
}

function findMilestoneRecordForSupervisor_(milestoneId) {
  var target = String(milestoneId || '').trim();
  if (!target || typeof milestoneSheet_ !== 'function') return null;

  var sheet = milestoneSheet_();
  var rows = getSheetValues_(sheet);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === target) {
      return {
        sheet: sheet,
        rowIndex: i + 1,
        row: rows[i].slice(),
        milestone_id: String(rows[i][0] || '').trim(),
        proj_id: String(rows[i][1] || '').trim(),
        milestone: String(rows[i][2] || '').trim(),
        status: String(rows[i][3] || '').trim(),
        date: String(rows[i][4] || '').trim(),
        created_at: String(rows[i][6] || '').trim(),
        created_by: String(rows[i][7] || '').trim(),
        updated_by: String(rows[i][8] || '').trim(),
        linked_files: String(rows[i][9] || '').trim()
      };
    }
  }
  return null;
}

function handleCreateProjSupervisor_(payload) {
  var supervisorUserId = String(
    payload.user_id ||
    payload.supervisor_user_id ||
    ''
  ).trim();
  if (!supervisorUserId) return { ok: false, error: 'user_id is required.' };
  if (typeof handleCreateProjIntern_ !== 'function') {
    return { ok: false, error: 'Supervisor project create handler is unavailable.' };
  }

  var nextPayload = {};
  for (var key in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      nextPayload[key] = payload[key];
    }
  }

  nextPayload.user_id = supervisorUserId;
  var supervisorIds = mergeSupervisorAssignmentWithCreator_(supervisorUserId, payload.supervisor);
  nextPayload.supervisor = supervisorIds;

  var result = handleCreateProjIntern_(nextPayload);
  if (!result || result.ok !== true) return result;

  return {
    ok: true,
    proj_id: result.proj_id,
    members: splitProjectCsvValues_(payload.members),
    supervisor: supervisorIds
  };
}

function handleUpdateProjSupervisor_(payload) {
  var projId = String(payload.proj_id || '').trim();
  var supervisorUserId = String(
    payload.user_id ||
    payload.supervisor_user_id ||
    ''
  ).trim();

  var archiveOnly = isSupervisorArchiveOnlyUpdate_(payload);
  var access = archiveOnly
    ? assertSupervisorCanAccessProject_(supervisorUserId, projId)
    : assertSupervisorOwnsProject_(supervisorUserId, projId);
  if (!access.ok) return access;
  if (archiveOnly) {
    return setSupervisorProjectArchiveState_(supervisorUserId, projId, true);
  }
  if (typeof handleUpdateProjIntern_ !== 'function') {
    return { ok: false, error: 'Supervisor project update handler is unavailable.' };
  }

  var nextPayload = {};
  for (var key in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      nextPayload[key] = payload[key];
    }
  }

  nextPayload.user_id = supervisorUserId;
  nextPayload.proj_id = projId;
  nextPayload.supervisor = mergeSupervisorAssignmentWithCreator_(
    supervisorUserId,
    payload.supervisor !== undefined ? payload.supervisor : access.project.supervisor
  );

  var result = handleUpdateProjIntern_(nextPayload);
  if (!result || result.ok !== true) return result;

  return {
    ok: true,
    proj_id: result.proj_id,
    members: projAssignmentIdsFromValue_(
      payload.members !== undefined ? payload.members : access.project.members
    ),
    supervisor: nextPayload.supervisor
  };
}

function handleRestoreProjSupervisor_(payload) {
  var projId = String(payload.proj_id || '').trim();
  var supervisorUserId = String(
    payload.user_id ||
    payload.supervisor_user_id ||
    ''
  ).trim();

  var access = assertSupervisorCanAccessProject_(supervisorUserId, projId);
  if (!access.ok) return access;
  return setSupervisorProjectArchiveState_(supervisorUserId, projId, false);
}

function handleDeleteProjSupervisor_(payload) {
  var projId = String(payload.proj_id || '').trim();
  var supervisorUserId = String(
    payload.user_id ||
    payload.supervisor_user_id ||
    ''
  ).trim();

  var access = assertSupervisorOwnsProject_(supervisorUserId, projId);
  if (!access.ok) return access;
  if (typeof handleDeleteProjIntern_ !== 'function') {
    return { ok: false, error: 'Supervisor project delete handler is unavailable.' };
  }

  return handleDeleteProjIntern_({
    proj_id: projId,
    user_id: supervisorUserId
  });
}

function handleCreateMilestoneSupervisor_(payload) {
  return {
    ok: false,
    error: 'Supervisors cannot add milestones. Milestones are managed by interns.'
  };
}

function handleUpdateMilestoneSupervisor_(payload) {
  return {
    ok: false,
    error: 'Supervisors cannot update milestones. Milestones are managed by interns.'
  };
}

function handleDeleteMilestoneSupervisor_(payload) {
  return {
    ok: false,
    error: 'Supervisors cannot delete milestones. Milestones are managed by interns.'
  };
}

function handleListProjSupervisor_(payload) {
  var supervisorUserId = String(payload.supervisor_user_id || '').trim();
  if (!supervisorUserId) return { ok: false, error: 'supervisor_user_id is required.' };
  var mirrorProjects = readSupervisorProjectRows_(supervisorUserId);
  var seenProjIds = {};
  for (var i = 0; i < mirrorProjects.length; i++) {
    var pid = String(mirrorProjects[i].proj_id || mirrorProjects[i].id || '').trim();
    if (pid) seenProjIds[pid] = true;
  }

  // Fallback for legacy or unsynced rows: read directly from proj_intern.
  var fallbackProjects = readSupervisorProjectsFromInternSheet_(supervisorUserId, seenProjIds);
  return { ok: true, projects: mirrorProjects.concat(fallbackProjects) };
}

function projBootstrapNormalizeText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function projBootstrapSameDepartment_(userDepartment, targetDepartment) {
  var userDept = projBootstrapNormalizeText_(userDepartment);
  var targetDept = projBootstrapNormalizeText_(targetDepartment);
  return Boolean(userDept && targetDept && userDept === targetDept);
}

function projBootstrapIsInternUser_(user) {
  var role = projBootstrapNormalizeText_(user && user.role);
  return role.indexOf('intern') !== -1 || role.indexOf('student') !== -1 || role === 'ojt';
}

function projBootstrapIsSupervisorUser_(user) {
  var role = projBootstrapNormalizeText_(user && user.role);
  return role.indexOf('supervisor') !== -1 || role.indexOf('mentor') !== -1;
}

function projBootstrapFindHeaderIndex_(normalizedHeaders, candidates) {
  for (var i = 0; i < normalizedHeaders.length; i++) {
    for (var j = 0; j < candidates.length; j++) {
      if (normalizedHeaders[i] === candidates[j]) return i;
    }
  }
  return -1;
}

function projBootstrapNormalizeUserForClient_(row, indexes) {
  var userId = indexes.userId >= 0 ? String(row[indexes.userId] || '').trim() : '';
  var fullName = indexes.name >= 0 ? String(row[indexes.name] || '').trim() : '';
  var email = indexes.email >= 0 ? String(row[indexes.email] || '').trim() : '';
  var role = indexes.role >= 0 ? String(row[indexes.role] || '').trim() : '';
  var department = indexes.department >= 0 ? String(row[indexes.department] || '').trim() : '';
  var profilePhotoUrl = indexes.profilePhotoUrl >= 0 ? String(row[indexes.profilePhotoUrl] || '').trim() : '';
  var profilePhotoFileId = indexes.profilePhotoFileId >= 0 ? String(row[indexes.profilePhotoFileId] || '').trim() : '';
  var displayName = fullName || email || userId;

  return {
    id: userId,
    user_id: userId,
    name: displayName,
    full_name: displayName,
    email: email,
    role: role,
    department: department,
    profile_photo_url: profilePhotoUrl,
    profile_photo_file_id: profilePhotoFileId
  };
}

function projBootstrapAssignmentDepartmentForUser_(userId) {
  var targetUserId = String(userId || '').trim();
  if (!targetUserId) return '';

  var assignSheet = getSupervisorAssignmentsSheet_();
  if (!assignSheet) return '';

  var assignData = assignSheet.getDataRange().getValues();
  if (!assignData || assignData.length < 2) return '';

  var headers = assignData[0].map(function(header) {
    return String(header || '').trim().toLowerCase();
  });
  var supervisorIdx = headers.indexOf('supervisor_user_id');
  var studentIdx = headers.indexOf('student_user_id');
  var departmentIdx = headers.indexOf('department');
  var statusIdx = headers.indexOf('status');

  if (departmentIdx === -1) return '';

  for (var i = 1; i < assignData.length; i++) {
    var row = assignData[i];
    var status = statusIdx >= 0 ? projBootstrapNormalizeText_(row[statusIdx]) : 'active';
    if (status === 'inactive' || status === 'removed' || status === 'archived') continue;

    var supervisorId = supervisorIdx >= 0 ? String(row[supervisorIdx] || '').trim() : '';
    var studentId = studentIdx >= 0 ? String(row[studentIdx] || '').trim() : '';
    if (targetUserId === supervisorId || targetUserId === studentId) {
      return String(row[departmentIdx] || '').trim();
    }
  }

  return '';
}

function handleGetProjUsersBootstrap_(payload) {
  var currentUserId = String(payload.user_id || '').trim();
  var usersSheet = getUsersSheet_();
  if (!usersSheet) {
    return { ok: false, error: 'users sheet not found.' };
  }

  var usersData = usersSheet.getDataRange().getValues();
  if (!usersData || usersData.length < 2) {
    return { ok: true, users: [], interns: [], supervisors: [] };
  }

  var normalizedHeaders = usersData[0].map(function(header) {
    return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  });
  var indexes = {
    userId: projBootstrapFindHeaderIndex_(normalizedHeaders, ['userid', 'id', 'user']),
    name: projBootstrapFindHeaderIndex_(normalizedHeaders, ['fullname', 'name']),
    email: projBootstrapFindHeaderIndex_(normalizedHeaders, ['email', 'emailaddress', 'mail']),
    role: projBootstrapFindHeaderIndex_(normalizedHeaders, ['role', 'userrole', 'type', 'position']),
    department: projBootstrapFindHeaderIndex_(normalizedHeaders, ['department', 'dept', 'departmentname', 'division']),
    profilePhotoUrl: projBootstrapFindHeaderIndex_(normalizedHeaders, ['profilephotourl', 'photo', 'photourl', 'avatar', 'avatarurl']),
    profilePhotoFileId: projBootstrapFindHeaderIndex_(normalizedHeaders, ['profilephotofileid', 'photofileid', 'avatarfileid'])
  };

  if (indexes.userId === -1) {
    return { ok: false, error: 'users sheet missing user id column.' };
  }

  var users = [];
  var usersById = {};
  for (var i = 1; i < usersData.length; i++) {
    var user = projBootstrapNormalizeUserForClient_(usersData[i], indexes);
    if (!user.user_id) continue;
    users.push(user);
    usersById[user.user_id] = user;
  }

  var currentUser = usersById[currentUserId] || null;
  var departmentContext = String(
    payload.department ||
    payload.Department ||
    payload.dept ||
    payload.Dept ||
    payload.departmentName ||
    payload.DepartmentName ||
    (currentUser && currentUser.department) ||
    projBootstrapAssignmentDepartmentForUser_(currentUserId) ||
    ''
  ).trim();

  var allInterns = users.filter(projBootstrapIsInternUser_);
  var allSupervisors = users.filter(projBootstrapIsSupervisorUser_);
  var interns = departmentContext
    ? allInterns.filter(function(user) { return projBootstrapSameDepartment_(user.department, departmentContext); })
    : [];
  var supervisors = departmentContext
    ? allSupervisors.filter(function(user) { return projBootstrapSameDepartment_(user.department, departmentContext); })
    : [];

  if (!departmentContext) {
    Logger.log('Project user bootstrap department context is empty for user_id=' + currentUserId);
  }

  return {
    ok: true,
    users: users,
    interns: interns,
    supervisors: supervisors,
    department: departmentContext
  };
}
