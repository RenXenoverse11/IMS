<script>
// @ts-nocheck
  import { CheckCircle, AlertCircle, FileText, Users, Clock3 } from 'lucide-svelte';
  import { subscribeToCurrentUser, listSupervisorAssignedStudents, listSupervisorTimeLogs, listAssignedStudentRequests, listTasksByUser, getSupervisorDashboardOverview } from '../lib/auth.js';
  import { getEstimatedCompletionDate } from '../lib/getEstimatedCompletionDate.js';

  export let currentUser = null;

  let loading = true;
  let errorMessage = '';
  let pendingRequests = [];

  let assignedStudents = [];
  let assignedRequests = [];
  let today = '';
  let internStatusFilter = 'all';

  // keyed by student_user_id -> { time_in, time_out }
  let todayTimelogByStudent = {};
  let tasksSummaryByStudent = {};
  let loadRunId = 0;
  const AVG_DAILY_HOURS = 8;

  function normalizeDate(value) {
    // Handles Date objects, ISO strings, and legacy date-time strings.
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '-';
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(value);
    }

    const text = String(value || '').trim();
    if (!text) return '-';

    // If backend sends full Date.toString() values ("Thu Apr 16 2026 00:00:00 GMT+0800 ...")
    // parse directly.
    const parsedDirect = new Date(text);
    if (!Number.isNaN(parsedDirect.getTime())) {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsedDirect);
    }

    // Fallback: treat as date-only.
    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return text;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
  }

  function normalizeStatus(value) {
    return String(value || '').trim().toLowerCase();
  }

  function formatRequestTypeLabel(value) {
    const text = String(value || '').trim();
    if (!text) return 'Request';
    return text
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  function getRequestTypeRaw(req) {
    return String(req?.requestType || req?.request_type || req?.requester_type || '').trim();
  }

  function normalizeRequestTypeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[_\s-]+/g, ' ');
  }

  function isDashboardPendingRequest(req) {
    const type = normalizeRequestTypeKey(getRequestTypeRaw(req));
    return [
      'overtime',
      'ot',
      'absence',
      'absent',
      'time log override',
      'override',
      'override request',
    ].includes(type);
  }

  function getRequestDateRaw(req) {
    return String(req?.date || req?.request_date || req?.requester_date || req?.applied_date || '').trim();
  }

  function parseDateLoose(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function getPendingTaskCount(studentUserId) {
    const row = tasksSummaryByStudent[String(studentUserId || '').trim()] || null;
    return Number(row?.pendingCount || 0);
  }

  function getOverdueTaskCount(studentUserId) {
    const row = tasksSummaryByStudent[String(studentUserId || '').trim()] || null;
    return Number(row?.overdueCount || 0);
  }

  function getTaskSummaryLabel(studentUserId) {
    const pending = getPendingTaskCount(studentUserId);
    const overdue = getOverdueTaskCount(studentUserId);
    if (pending <= 0 && overdue <= 0) return 'No pending tasks';
    if (overdue > 0) return `${pending} pending • ${overdue} overdue`;
    return `${pending} pending`;
  }

  function shouldFetchTaskSummaryFallback(taskMap) {
    if (!taskMap || typeof taskMap !== 'object') return true;
    const rows = Object.values(taskMap);
    if (rows.length === 0) return true;
    return rows.every((row) => Number(row?.total || 0) === 0);
  }

  function hasClockInToday(studentUserId) {
    const row = todayTimelogByStudent[String(studentUserId || '').trim()] || null;
    return Boolean(String(row?.time_in || '').trim());
  }

  function getToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function isWeekend(dateOnly) {
    const parsed = new Date(`${dateOnly}T00:00:00`);
    const day = parsed.getDay();
    return day === 0 || day === 6;
  }

  function normalizeDaysOff(value) {
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {
        return [0, 6];
      }
    }
    return [0, 6];
  }

  function isDayOffForIntern(intern, dateOnly = today || getToday()) {
    const parsed = new Date(`${dateOnly}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return false;
    const day = parsed.getDay();
    return normalizeDaysOff(intern?.days_off).includes(day);
  }

  function toFiniteNumber(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getRemainingHours(intern) {
    const required = toFiniteNumber(intern?.required_hours);
    if (required <= 0) return null;
    const completed = toFiniteNumber(intern?.completed_hours);
    return Math.max(0, required - completed);
  }

  function getRemainingWorkingDays(intern) {
    const remainingHours = getRemainingHours(intern);
    if (remainingHours === null) return null;
    return Math.ceil(remainingHours / AVG_DAILY_HOURS);
  }

  function getProjectedEndDateDisplay(intern) {
    const remainingHours = getRemainingHours(intern);
    if (remainingHours === null) return 'Not available';
    if (remainingHours <= 0) return normalizeDate(getToday());
    const storedEstimatedEndDate = String(intern?.estimated_end_date || '').trim();
    const computedEstimatedEndDate = getEstimatedCompletionDate(remainingHours, AVG_DAILY_HOURS, normalizeDaysOff(intern?.days_off));
    const storedDateObj = parseDateLoose(storedEstimatedEndDate);
    const computedDateObj = parseDateLoose(computedEstimatedEndDate);
    if (storedEstimatedEndDate && (!computedDateObj || (storedDateObj && storedDateObj >= computedDateObj))) {
      return normalizeDate(storedEstimatedEndDate);
    }
    return computedEstimatedEndDate;
  }

  function requestMatchesToday(req) {
    const reqDateRaw = String(req?.request_date || req?.date || '').trim();
    if (!reqDateRaw) return false;

    const toIsoDate = (value) => {
      const text = String(value || '').trim();
      if (!text) return '';

      // Already date-only ISO
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

      // ISO datetime
      const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
      if (isoMatch) return isoMatch[1];

      // dd/mm/yyyy or mm/dd/yyyy (best-effort for dashboard display matching)
      const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slashMatch) {
        const a = Number(slashMatch[1]);
        const b = Number(slashMatch[2]);
        const y = Number(slashMatch[3]);
        // If first token cannot be month, treat as dd/mm/yyyy.
        const month = a > 12 ? b : a;
        const day = a > 12 ? a : b;
        return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }

      // "Apr 30, 2026" and other parseable values
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      }

      return '';
    };

    const dateOnly = toIsoDate(reqDateRaw);
    return !!dateOnly && dateOnly === today;
  }

  function normalizePersonName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function resolveRequestStudentId(req) {
    const directId = String(
      req?.user_id || req?.student_user_id || req?.requester_user_id || ''
    ).trim();
    if (directId) return directId;

    const requesterName = normalizePersonName(req?.requester_name);
    if (!requesterName) return '';

    const matchedStudent = assignedStudents.find(
      (student) => normalizePersonName(student?.full_name) === requesterName
    );
    return String(matchedStudent?.user_id || '').trim();
  }

  function getStudentRequestsToday(studentUserId) {
    const id = String(studentUserId || '').trim();
    if (!id) return [];
    return assignedRequests
      .filter((req) => resolveRequestStudentId(req) === id)
      .filter(requestMatchesToday);
  }

  function isApprovedAbsenceToday(studentUserId) {
    const todays = getStudentRequestsToday(studentUserId);
    return todays.some((req) => {
      const type = String(req?.request_type || req?.requestType || '').toLowerCase().trim();
      const status = String(req?.status || '').toLowerCase().trim();
      const archivedPrevious = String(req?.archived_previous_status || req?.archivedPreviousStatus || '').toLowerCase().trim();
      const approved = status === 'approved' || (status === 'archived' && archivedPrevious === 'approved');
      return type === 'absence' && approved;
    });
  }

  function hasApprovedOvertimeToday(studentUserId) {
    const todays = getStudentRequestsToday(studentUserId);
    return todays.some((req) => {
      const type = String(req?.request_type || req?.requestType || '').toLowerCase().trim();
      const status = String(req?.status || '').toLowerCase().trim();
      const archivedPrevious = String(req?.archived_previous_status || req?.archivedPreviousStatus || '').toLowerCase().trim();
      const approved = status === 'approved' || (status === 'archived' && archivedPrevious === 'approved');
      return type === 'overtime' && approved;
    });
  }

  function extractTimeFromDateString(dateString) {
    // Extract HH:MM from Date object strings like "Sat Dec 30 1899 09:00:00 GMT+0800..."
    const raw = String(dateString || '').trim();
    if (!raw) return '';
    
    // Try to match HH:MM:SS or HH:MM pattern
    const timeMatch = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, '0');
      const minute = timeMatch[2];
      return `${hour}:${minute}`;
    }
    
    return '';
  }

  function getScheduleDisplay(intern) {
    let shiftStart = String(intern?.shift_start || '').trim();
    let shiftEnd = String(intern?.shift_end || '').trim();
    
    // Extract time from Date object strings
    if (shiftStart) {
      shiftStart = extractTimeFromDateString(shiftStart);
    }
    if (shiftEnd) {
      shiftEnd = extractTimeFromDateString(shiftEnd);
    }
    
    if (!shiftStart || !shiftEnd) {
      return { label: 'No schedule set', tone: 'muted' };
    }
    
    // Check if approved overtime today
    if (hasApprovedOvertimeToday(intern?.user_id)) {
      return { label: `${shiftStart} - ${shiftEnd} + OT`, tone: 'warning' };
    }
    
    // Regular shift - no color tone
    return { label: `${shiftStart} - ${shiftEnd}`, tone: '' };
  }

  function getClockStatus(studentUserId, internData) {
    const row = todayTimelogByStudent[String(studentUserId || '').trim()] || null;
    const timeIn = String(row?.time_in || '').trim();
    const timeOut = String(row?.time_out || '').trim();

    const extractTime = (dateString) => {
      if (!dateString) return '';
      // Extract HH:MM from various date formats
      const timeMatch = dateString.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (timeMatch) {
        return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
      }
      return '';
    };

    const formattedTimeOut = extractTime(timeOut);
    const formattedTimeIn = extractTime(timeIn);

    // If clocked out, show clock-out time
    if (formattedTimeOut) {
      return { label: `Clocked out · ${formattedTimeOut}`, tone: 'success' };
    }

    // If only clocked in, show clock-in time with on-time/late status
    if (formattedTimeIn) {
      let status = '';
      
      // Check if on-time or late based on shift start time
      if (internData) {
        const shiftStart = String(internData?.shift_start || '').trim();
        if (shiftStart) {
          const scheduledStart = extractTime(shiftStart);
          
          // Compare times: convert to minutes for comparison
          const [inHour, inMin] = formattedTimeIn.split(':').map(Number);
          const [schHour, schMin] = scheduledStart.split(':').map(Number);
          
          const clockedInMinutes = inHour * 60 + inMin;
          const scheduledMinutes = schHour * 60 + schMin;
          
          status = clockedInMinutes <= scheduledMinutes ? '(On-time)' : '(Late)';
        }
      }
      
      return { label: `Clocked in · ${formattedTimeIn} ${status}`, tone: 'success' };
    }

    return { label: 'No clock-in yet', tone: 'muted' };
  }

  function getAttendanceStatus(student) {
    const studentId = String(student?.user_id || '').trim();

    if (isDayOffForIntern(student, today)) {
      return { label: 'Day off', tone: 'muted' };
    }

    if (isApprovedAbsenceToday(studentId)) {
      return { label: 'Approved absence', tone: 'warning' };
    }

    // Expected to be present on weekdays unless approved absence.
    const clock = getClockStatus(studentId);
    if (clock.label.startsWith('No clock')) {
      return { label: 'Should be present today', tone: 'info' };
    }

    return { label: 'Present today', tone: 'success' };
  }

  function matchesInternStatusFilter(intern) {
    const key = String(internStatusFilter || 'all').trim().toLowerCase();
    const studentId = String(intern?.user_id || '').trim();
    const attendanceLabel = String(getAttendanceStatus(intern)?.label || '').trim().toLowerCase();
    const hasClockIn = hasClockInToday(studentId);

    if (key === 'should_be_present') {
      return attendanceLabel === 'should be present today';
    }

    if (key === 'clocked_in') {
      return hasClockIn;
    }

    if (key === 'no_clock_in_yet') {
      return !hasClockIn;
    }

    if (key === 'approved_absence') {
      return isApprovedAbsenceToday(studentId);
    }

    return true;
  }

  function goToInternManagement() {
    window.location.hash = '/supervisor/interns';
  }

  async function loadData() {
    const runId = ++loadRunId;
    loading = true;
    errorMessage = '';
    const todayValue = getToday();
    today = todayValue;

    try {
      const supervisorId = String(currentUser?.user_id || '').trim();
      const roleNow = String(currentUser?.role || '').trim().toLowerCase();

      if (!supervisorId || roleNow !== 'supervisor') {
        assignedStudents = [];
        assignedRequests = [];
        pendingRequests = [];
        todayTimelogByStudent = {};
        tasksSummaryByStudent = {};
        return;
      }

      const [studentsResult, requestsResult] = await Promise.all([
        listSupervisorAssignedStudents(supervisorId),
        listAssignedStudentRequests(supervisorId),
      ]);

      if (runId !== loadRunId) {
        return;
      }

      assignedStudents = Array.isArray(studentsResult) ? studentsResult : [];
      assignedRequests = Array.isArray(requestsResult) ? requestsResult : [];

      const getRequestTimestamp = (req) => {
        const raw = String(
          req?.created_at ||
          req?.updated_at ||
          req?.date ||
          req?.request_date ||
          req?.requester_date ||
          req?.applied_date ||
          ''
        ).trim();

        if (!raw) return 0;

        const parsedDirect = new Date(raw);
        if (!Number.isNaN(parsedDirect.getTime())) return parsedDirect.getTime();

        const dateOnly = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
        const parsedDateOnly = new Date(`${dateOnly}T00:00:00`);
        return Number.isNaN(parsedDateOnly.getTime()) ? 0 : parsedDateOnly.getTime();
      };

      const pending = assignedRequests
        .filter((req) => normalizeStatus(req?.status) === 'pending')
        .filter(isDashboardPendingRequest)
        .sort((a, b) => getRequestTimestamp(b) - getRequestTimestamp(a));
      pendingRequests = pending.slice(0, 6).map((req) => ({
        id: String(req?.id || req?.request_id || `${resolveRequestStudentId(req)}-${getRequestTypeRaw(req)}-${getRequestDateRaw(req)}`),
        student_name: String(req?.requester_name || req?.student_name || req?.full_name || '').trim() || 'Student',
        type: formatRequestTypeLabel(getRequestTypeRaw(req)),
        date: getRequestDateRaw(req),
      }));

      const studentUserIds = assignedStudents
        .map((student) => String(student?.user_id || '').trim())
        .filter(Boolean);

      const defaultTaskSummary = Object.fromEntries(
        studentUserIds.map((studentUserId) => [studentUserId, { pendingCount: 0, overdueCount: 0, total: 0 }])
      );

      try {
        const overview = await getSupervisorDashboardOverview(supervisorId, {
          date: todayValue,
          student_user_ids: studentUserIds,
        });

        if (runId !== loadRunId) {
          return;
        }

        const timelogMap = overview?.today_timelog_by_student && typeof overview.today_timelog_by_student === 'object'
          ? overview.today_timelog_by_student
          : {};
        const taskMap = overview?.task_summary_by_student && typeof overview.task_summary_by_student === 'object'
          ? overview.task_summary_by_student
          : {};

        todayTimelogByStudent = Object.fromEntries(
          studentUserIds.map((studentUserId) => [studentUserId, timelogMap[studentUserId] || null])
        );
        
        // If overview has no visible task totals, double-check through the task list endpoint.
        if (shouldFetchTaskSummaryFallback(taskMap)) {
          const taskEntries = await Promise.all(
            assignedStudents.map(async (student) => {
              const studentUserId = String(student?.user_id || '').trim();
              if (!studentUserId) return [studentUserId, { pendingCount: 0, overdueCount: 0, total: 0 }];

              try {
                const tasks = await listTasksByUser(studentUserId, { limit: 200 });
                const list = Array.isArray(tasks) ? tasks : [];
                // Count tasks that are NOT completed (pending, in-progress, etc)
                const pendingCount = list.filter((task) => {
                  const status = String(task?.status || '').toLowerCase().trim();
                  return status !== 'completed' && status !== '';
                }).length;
                const overdueCount = list.filter((task) => String(task?.status || '').toLowerCase().trim() === 'overdue').length;
                return [studentUserId, { pendingCount, overdueCount, total: list.length }];
              } catch {
                return [studentUserId, { pendingCount: 0, overdueCount: 0, total: 0 }];
              }
            })
          );
          tasksSummaryByStudent = {
            ...defaultTaskSummary,
            ...Object.fromEntries(taskEntries.filter((entry) => entry && entry[0])),
          };
        } else {
          tasksSummaryByStudent = Object.fromEntries(
            studentUserIds.map((studentUserId) => {
              const row = taskMap[studentUserId] || {};
              return [studentUserId, {
                pendingCount: Number(row?.pendingCount || 0),
                overdueCount: Number(row?.overdueCount || 0),
                total: Number(row?.total || 0),
              }];
            })
          );
        }
      } catch {
        const [timelogEntries, taskEntries] = await Promise.all([
          Promise.all(
            assignedStudents.map(async (student) => {
              const studentUserId = String(student?.user_id || '').trim();
              if (!studentUserId) return [studentUserId, null];

              try {
                const logs = await listSupervisorTimeLogs(supervisorId, studentUserId);
                const todayLog = Array.isArray(logs)
                  ? logs.find((log) => {
                      const raw = String(log?.log_date || '').trim();
                      const dateOnly = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
                      return dateOnly === todayValue;
                    })
                  : null;

                return [studentUserId, todayLog || null];
              } catch {
                return [studentUserId, null];
              }
            })
          ),
          Promise.all(
            assignedStudents.map(async (student) => {
              const studentUserId = String(student?.user_id || '').trim();
              if (!studentUserId) return [studentUserId, { pendingCount: 0, overdueCount: 0, total: 0 }];

              try {
                const tasks = await listTasksByUser(studentUserId, { limit: 200 });
                const list = Array.isArray(tasks) ? tasks : [];
                // Count tasks that are NOT completed (pending, in-progress, etc)
                const pendingCount = list.filter((task) => {
                  const status = String(task?.status || '').toLowerCase().trim();
                  return status !== 'completed' && status !== '';
                }).length;
                const overdueCount = list.filter((task) => String(task?.status || '').toLowerCase().trim() === 'overdue').length;
                return [studentUserId, { pendingCount, overdueCount, total: list.length }];
              } catch {
                return [studentUserId, { pendingCount: 0, overdueCount: 0, total: 0 }];
              }
            })
          ),
        ]);

        if (runId !== loadRunId) {
          return;
        }

        todayTimelogByStudent = Object.fromEntries(timelogEntries.filter((entry) => entry && entry[0]));
        tasksSummaryByStudent = {
          ...defaultTaskSummary,
          ...Object.fromEntries(taskEntries.filter((entry) => entry && entry[0])),
        };
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      errorMessage = err?.message || 'Unable to load dashboard.';
    } finally {
      if (runId === loadRunId) {
        loading = false;
      }
    }
  }

  const onMount = () => {
    unsubscribe = subscribeToCurrentUser(() => {
      loadData();
    });
  };

  const onDestroy = () => {
    if (typeof unsubscribe === 'function') unsubscribe();
  };

  let unsubscribe;
  onMount();

  $: currentRole = String(currentUser?.role || '').trim().toLowerCase();
  $: isSupervisorUser = currentRole === 'supervisor';
  $: weekend = Boolean(today) ? isWeekend(today) : isWeekend(getToday());
  $: totalAssigned = assignedStudents.length;
  $: expectedToday = assignedStudents.filter((s) => !isDayOffForIntern(s, today) && !isApprovedAbsenceToday(s?.user_id)).length;
  $: clockedInToday = assignedStudents.filter((s) => {
    const id = String(s?.user_id || '').trim();
    const row = todayTimelogByStudent[id] || null;
    return Boolean(String(row?.time_in || '').trim());
  }).length;
  $: onApprovedLeaveToday = assignedStudents.filter((s) => isApprovedAbsenceToday(s?.user_id)).length;
  $: filteredAssignedStudents = assignedStudents.filter((intern) => matchesInternStatusFilter(intern));
</script>
{#if currentUser && !isSupervisorUser}
  <section class="warning-alert">
    This page is available for supervisor accounts only.
  </section>
{:else}
<div class="dashboard-root">
  <section class="dashboard-shell supervisor-dashboard-content">
    {#if errorMessage}
      <div class="error-banner">{errorMessage}</div>
    {/if}

    <div class="dash-stat-grid">
      {#if loading}
        {#each [1, 2, 3, 4] as _}
          <div class="dash-stat-card dash-stat-card-skeleton" aria-hidden="true">
            <div class="dash-stat-icon dash-stat-icon-skeleton sk-line shimmer"></div>
            <div class="dash-stat-body dash-stat-body-skeleton">
              <div class="sk-line shimmer" style="height: 11px; width: 120px; border-radius: 7px;"></div>
              <div class="sk-line shimmer" style="height: 24px; width: 34px; border-radius: 8px;"></div>
              <div class="sk-line shimmer" style="height: 11px; width: 112px; border-radius: 7px;"></div>
            </div>
          </div>
        {/each}
      {:else}
      <div class="dash-stat-card">
        <div class="dash-stat-icon stat-icon-assigned"><Users size={18} /></div>
        <div class="dash-stat-body">
          <div class="dash-stat-label">Assigned Interns</div>
          <div class="dash-stat-value">{totalAssigned}</div>
          <div class="dash-stat-sub">Total active interns</div>
        </div>
      </div>

      <div class="dash-stat-card">
        <div class="dash-stat-icon stat-icon-expected"><Clock3 size={18} /></div>
        <div class="dash-stat-body">
          <div class="dash-stat-label">Should Be Present Today</div>
          <div class="dash-stat-value">{expectedToday}</div>
          <div class="dash-stat-sub">Expected on-site today</div>
        </div>
      </div>

      <div class="dash-stat-card">
        <div class="dash-stat-icon stat-icon-clocked"><CheckCircle size={18} /></div>
        <div class="dash-stat-body">
          <div class="dash-stat-label">Clocked In Today</div>
          <div class="dash-stat-value">{clockedInToday}</div>
          <div class="dash-stat-sub">With a time-in log</div>
        </div>
      </div>

      <div class="dash-stat-card">
        <div class="dash-stat-icon stat-icon-absence"><AlertCircle size={18} /></div>
        <div class="dash-stat-body">
          <div class="dash-stat-label">Approved Absence Today</div>
          <div class="dash-stat-value">{onApprovedLeaveToday}</div>
          <div class="dash-stat-sub">Approved leave records</div>
        </div>
      </div>
      {/if}
    </div>

    <section class="dash-panel dash-panel-wide">
      <div class="dash-panel-header">
        <div>
          <h3 class="dash-panel-title">Assigned Interns</h3>
          <p class="dash-panel-subtitle">{normalizeDate(today)} - Status and clock in/out summary for today.</p>
        </div>
      </div>

      <div class="dash-panel-body" aria-busy={loading}>
        {#if loading}
          <div class="intern-grid" role="status" aria-label="Loading assigned interns">
            {#each [1, 2, 3] as _}
              <article class="intern-card skeleton-intern-card">
                <header class="intern-head">
                  <div class="intern-title">
                    <div class="sk-line shimmer" style="height: 16px; width: 62%; border-radius: 8px;"></div>
                    <div class="sk-line shimmer" style="height: 11px; width: 72%; margin-top: 8px; border-radius: 7px;"></div>
                  </div>
                  <div class="sk-pill shimmer"></div>
                </header>

                <div class="intern-body">
                  <div class="intern-row">
                    <span class="sk-dot shimmer" aria-hidden="true"></span>
                    <span class="sk-line shimmer" style="height: 11px; width: 60px; border-radius: 7px;"></span>
                    <span class="sk-line shimmer" style="height: 11px; width: 110px; border-radius: 7px;"></span>
                  </div>
                  <div class="intern-row">
                    <span class="sk-dot shimmer" aria-hidden="true"></span>
                    <span class="sk-line shimmer" style="height: 11px; width: 60px; border-radius: 7px;"></span>
                    <span class="sk-line shimmer" style="height: 11px; width: 88px; border-radius: 7px;"></span>
                  </div>
                  <div class="intern-row">
                    <span class="sk-dot shimmer" aria-hidden="true"></span>
                    <span class="sk-line shimmer" style="height: 11px; width: 60px; border-radius: 7px;"></span>
                    <span class="sk-line shimmer" style="height: 11px; width: 132px; border-radius: 7px;"></span>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {:else if assignedStudents.length === 0}
          <div class="dash-empty-state">
            <div class="dash-empty-icon"><Users size={18} /></div>
            <p class="dash-empty-title">No assigned interns yet.</p>
            <p class="dash-empty-sub">Assigned interns will appear here.</p>
            <button type="button" class="dash-empty-helper-btn" on:click={goToInternManagement}>
              Add Intern in Intern Management
            </button>
          </div>
        {:else if filteredAssignedStudents.length === 0}
          <div class="dash-empty-state">
            <div class="dash-empty-icon"><Users size={18} /></div>
            <p class="dash-empty-title">No interns match this status.</p>
            <p class="dash-empty-sub">Try another status filter.</p>
          </div>
        {:else}
          <div class="intern-grid">
            {#each filteredAssignedStudents as intern (intern.user_id)}
              {@const remainingDays = getRemainingWorkingDays(intern)}
              {@const projectedEndDate = getProjectedEndDateDisplay(intern)}
              {@const attendance = getAttendanceStatus(intern)}
              {@const clock = getClockStatus(intern?.user_id, intern)}
              {@const schedule = getScheduleDisplay(intern)}
              {@const taskSummaryLabel = getTaskSummaryLabel(intern?.user_id)}
              {@const cardTone = remainingDays !== null && remainingDays <= 0 ? 'danger' : (attendance.tone || 'muted')}
              {@const pillTone = cardTone}

              <article class={`intern-card card-tone-${cardTone}`}>
                <header class="intern-head">
                  <div class="intern-title">
                    <p class="intern-name">{intern.full_name}</p>
                    <p class="intern-meta text-muted">
                      Internship ends {projectedEndDate}
                      {#if remainingDays !== null}
                        - {remainingDays <= 0 ? 'Due' : `${remainingDays} days left`}
                      {/if}
                    </p>
                  </div>
                  <div class={`pill tone-${pillTone}`}>{attendance.label}</div>
                </header>

                <div class="intern-body">
                  <div class="intern-row">
                    <span class="row-icon"><Clock3 size={14} /></span>
                    <span class="row-label">Clock</span>
                    <span class={`row-value row-value-clock tone-${clock.tone}`}>{clock.label}</span>
                  </div>
                  <div class="intern-row">
                    <span class="row-icon"><FileText size={14} /></span>
                    <span class="row-label">Tasks</span>
                    <span class="row-value">{taskSummaryLabel}</span>
                  </div>
                  <div class="intern-row">
                    <span class="row-icon"><CheckCircle size={14} /></span>
                    <span class="row-label">Schedule</span>
                    <span class={`row-value tone-${schedule.tone}`}>{schedule.label}</span>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <section class="dash-panel">
      <div class="dash-panel-header">
        <h3 class="dash-panel-title">Pending Requests</h3>
      </div>
      <div class="dash-panel-body" aria-busy={loading}>
        {#if loading}
          <div class="request-list request-list-scroll request-list-skeleton" role="status" aria-label="Loading pending requests">
            {#each [1, 2, 3] as _}
              <div class="request-item request-item-skeleton">
                <div class="request-copy">
                  <div class="sk-line shimmer" style="height: 13px; width: 150px; border-radius: 8px;"></div>
                  <div class="sk-line shimmer" style="height: 11px; width: 210px; margin-top: 7px; border-radius: 7px;"></div>
                </div>
                <span class="sk-pill shimmer" style="width: 66px; height: 26px;"></span>
              </div>
            {/each}
          </div>
        {:else if pendingRequests.length === 0}
          <div class="dash-empty-state">
            <div class="dash-empty-icon"><FileText size={18} /></div>
            <p class="dash-empty-title">No pending requests.</p>
            <p class="dash-empty-sub">Requests from interns will appear here.</p>
          </div>
        {:else}
          <div class="request-list request-list-scroll">
            {#each pendingRequests as req (req.id)}
              <div class="request-item">
                <div class="request-copy">
                  <p class="request-name">{req.student_name}</p>
                  <p class="request-meta text-muted">
                    {req.type}{#if req.date} - {normalizeDate(req.date)}{/if}
                  </p>
                </div>
                <a class="review-btn" href="#/supervisor/requests">Review</a>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </section>
</div>
{/if}

<style>
  .warning-alert {
    border-radius: 0.75rem;
    border: 1px solid;
    padding: 1rem;
    background: #fef3c7;
    border-color: #fcd34d;
    color: #92400e;
    font-size: 0.875rem;
    font-weight: 500;
  }

  :global(.dark) .warning-alert {
    background: #fef3c7;
    border-color: #fcd34d;
    color: #92400e;
  }

  .dashboard-root {
    min-height: 100%;
    font-family: 'DM Sans', sans-serif;
  }

  .dashboard-shell,
  .supervisor-dashboard-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .supervisor-dashboard-content {
    --supervisor-section-gap: 20px;
    gap: var(--supervisor-section-gap);
  }

  .error-banner {
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    background: rgba(220, 38, 38, 0.12);
    border: 1px solid rgba(220, 38, 38, 0.25);
    color: #dc2626;
  }

  :global(.dark) .error-banner {
    color: #f87171;
  }

  .dash-stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin: 0;
  }

  .dash-stat-card,
  .dash-panel,
  .intern-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
  }

  :global(.dark) .dash-stat-card,
  :global(.dark) .dash-panel,
  :global(.dark) .intern-card {
    background: #161c27;
    border-color: rgba(255, 255, 255, 0.06);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }

  .dash-stat-card {
    padding: 18px 20px;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 104px;
  }

  .dash-stat-icon,
  .row-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .dash-stat-body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
  }
  .dash-stat-card-skeleton {
    pointer-events: none;
  }

  .dash-stat-icon-skeleton {
    background: rgba(148, 163, 184, 0.1);
    border: 1px solid rgba(148, 163, 184, 0.12);
  }

  .dash-stat-body-skeleton {
    width: 100%;
    gap: 7px;
  }

  .dash-stat-icon :global(svg) {
    color: currentColor;
    stroke: currentColor;
  }

  .stat-icon-assigned {
    background: rgba(59, 130, 246, 0.14);
    color: #3b82f6;
    border: 1px solid rgba(59, 130, 246, 0.22);
  }

  .stat-icon-expected {
    background: rgba(139, 92, 246, 0.14);
    color: #8b5cf6;
    border: 1px solid rgba(139, 92, 246, 0.22);
  }

  .stat-icon-clocked {
    background: rgba(34, 197, 94, 0.14);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.22);
  }

  .stat-icon-absence {
    background: rgba(245, 158, 11, 0.14);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.22);
  }

  .dash-stat-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #475569;
  }

  .dash-stat-value {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.8px;
    line-height: 1;
    color: #0f172a;
  }

  .dash-stat-sub {
    font-size: 11.5px;
    color: #64748b;
  }

  .dash-panel {
    min-width: 0;
    overflow: hidden;
    margin: 0;
  }

  .dash-panel-wide .dash-panel-body {
    padding-top: 12px;
  }

  .dash-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 18px 20px 12px;
  }

  .dash-panel-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #0f172a;
  }

  .dash-panel-subtitle {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: #64748b;
  }

  .dash-panel-body {
    padding: 12px 20px 18px;
  }

  .intern-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .select-btn {
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #0f172a;
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .select-btn:hover {
    border-color: #93c5fd;
    color: #1d4ed8;
    background: #f8fbff;
  }

  .intern-card {
    padding: 14px;
    border-color: rgba(148, 163, 184, 0.16);
    box-shadow: none;
    transition: border-color 0.2s ease, background-color 0.2s ease;
  }

  .intern-card.card-tone-info {
    background: rgba(30, 64, 175, 0.1);
    border-color: rgba(96, 165, 250, 0.22);
  }

  .intern-card.card-tone-success {
    background: rgba(22, 101, 52, 0.1);
    border-color: rgba(34, 197, 94, 0.24);
  }

  .intern-card.card-tone-warning {
    background: rgba(146, 64, 14, 0.1);
    border-color: rgba(245, 158, 11, 0.24);
  }

  .intern-card.card-tone-danger {
    background: rgba(127, 29, 29, 0.1);
    border-color: rgba(239, 68, 68, 0.24);
  }

  .intern-card.card-tone-muted {
    background: rgba(71, 85, 105, 0.1);
    border-color: rgba(148, 163, 184, 0.24);
  }

  .intern-card:hover {
    border-color: rgba(96, 165, 250, 0.28);
    background: rgba(37, 99, 235, 0.04);
  }

  :global(.dark) .intern-card:hover {
    border-color: rgba(96, 165, 250, 0.32);
    background: rgba(59, 130, 246, 0.08);
  }

  :global(.dark) .intern-card.card-tone-info {
    background: rgba(30, 64, 175, 0.16);
    border-color: rgba(96, 165, 250, 0.22);
  }

  :global(.dark) .intern-card.card-tone-success {
    background: rgba(22, 101, 52, 0.14);
    border-color: rgba(34, 197, 94, 0.24);
  }

  :global(.dark) .intern-card.card-tone-warning {
    background: rgba(146, 64, 14, 0.14);
    border-color: rgba(245, 158, 11, 0.24);
  }

  :global(.dark) .intern-card.card-tone-danger {
    background: rgba(127, 29, 29, 0.14);
    border-color: rgba(239, 68, 68, 0.24);
  }

  :global(.dark) .intern-card.card-tone-muted {
    background: rgba(51, 65, 85, 0.12);
    border-color: rgba(148, 163, 184, 0.2);
  }

  .intern-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }

  .intern-title {
    min-width: 0;
  }

  .intern-name {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
  }

  .intern-meta {
    margin: 4px 0 0;
    font-size: 12px;
  }

  .intern-body {
    display: grid;
    gap: 8px;
  }

  .intern-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
  }

  .row-icon {
    width: 20px;
    height: 20px;
    border-radius: 0;
    color: #7c8aa5;
    background: transparent;
  }

  .intern-card.card-tone-info .row-icon { color: #93c5fd; }
  .intern-card.card-tone-success .row-icon { color: #86efac; }
  .intern-card.card-tone-warning .row-icon { color: #fcd34d; }
  .intern-card.card-tone-danger .row-icon { color: #fca5a5; }
  .intern-card.card-tone-muted .row-icon { color: #94a3b8; }

  .row-label {
    color: #64748b;
    font-weight: 600;
    min-width: 58px;
  }

  .row-value {
    color: #334155;
    font-weight: 600;
  }

  .row-value-clock {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 3px 10px;
    border: 1px solid transparent;
    line-height: 1.3;
  }

  .row-value-clock.tone-success {
    background: rgba(34, 197, 94, 0.14);
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.22);
  }

  .row-value-clock.tone-muted {
    background: rgba(148, 163, 184, 0.1);
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.14);
  }

  .request-list {
    display: grid;
    gap: 10px;
  }

  .request-list-scroll {
    height: 360px;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding-right: 6px;
  }

  .request-list-scroll::-webkit-scrollbar {
    width: 9px;
  }

  .request-list-scroll::-webkit-scrollbar-track {
    background: rgba(148, 163, 184, 0.12);
    border-radius: 999px;
  }

  .request-list-scroll::-webkit-scrollbar-thumb {
    background: rgba(100, 116, 139, 0.55);
    border-radius: 999px;
  }

  .request-list-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(100, 116, 139, 0.72);
  }

  .skeleton-intern-card {
    border-color: rgba(148, 163, 184, 0.12);
    background: rgba(148, 163, 184, 0.06);
  }

  .request-item-skeleton {
    border-color: rgba(148, 163, 184, 0.12);
    background: rgba(148, 163, 184, 0.06);
  }

  .sk-line,
  .sk-dot,
  .sk-pill {
    display: inline-block;
    background: rgba(148, 163, 184, 0.1);
    border: 1px solid rgba(148, 163, 184, 0.12);
  }

  .sk-dot {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .sk-pill {
    width: 82px;
    height: 22px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .shimmer {
    position: relative;
    overflow: hidden;
    isolation: isolate;
  }

  .shimmer::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(
      90deg,
      rgba(148, 163, 184, 0) 0%,
      rgba(148, 163, 184, 0.18) 50%,
      rgba(148, 163, 184, 0) 100%
    );
    animation: dash-shimmer 1.55s ease-in-out infinite;
  }

  @keyframes dash-shimmer {
    100% {
      transform: translateX(100%);
    }
  }

  .dash-empty-state {
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    padding: 18px 14px;
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
  }

  .dash-empty-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    color: #64748b;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
  }

  .dash-empty-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
  }

  .dash-empty-sub {
    margin: 0;
    font-size: 12px;
    color: #64748b;
  }

  .dash-empty-helper-btn {
    margin-top: 4px;
    border: 1px solid #bfdbfe;
    background: rgba(37, 99, 235, 0.1);
    color: #1d4ed8;
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
  }

  .dash-empty-helper-btn:hover {
    background: rgba(37, 99, 235, 0.18);
    border-color: #93c5fd;
  }

  .request-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.02);
    box-shadow: none;
  }

  .request-name {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
  }

  .request-meta {
    margin: 3px 0 0;
    font-size: 12px;
  }

  .review-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid #bfdbfe;
    background: rgba(37, 99, 235, 0.1);
    color: #1d4ed8;
    font-size: 12px;
    font-weight: 700;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .review-btn:hover {
    background: rgba(37, 99, 235, 0.18);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .tone-blue {
    background: rgba(37, 99, 235, 0.12);
    color: #2563eb;
  }

  .tone-green {
    background: rgba(22, 163, 74, 0.12);
    color: #16a34a;
  }

  .tone-indigo {
    background: rgba(79, 70, 229, 0.12);
    color: #4f46e5;
  }

  .tone-amber {
    background: rgba(217, 119, 6, 0.12);
    color: #d97706;
  }

  .tone-success {
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
    border-color: rgba(16, 185, 129, 0.22);
  }

  .tone-info {
    background: rgba(99, 102, 241, 0.12);
    color: #4338ca;
    border-color: rgba(99, 102, 241, 0.22);
  }

  .tone-warning {
    background: rgba(245, 158, 11, 0.14);
    color: #92400e;
    border-color: rgba(245, 158, 11, 0.25);
  }

  .tone-danger {
    background: rgba(239, 68, 68, 0.12);
    color: #b91c1c;
    border-color: rgba(239, 68, 68, 0.22);
  }

  .tone-muted {
    background: rgba(148, 163, 184, 0.18);
    color: #475569;
    border-color: rgba(148, 163, 184, 0.26);
  }

  :global(.dark) .tone-blue {
    background: rgba(59, 130, 246, 0.18);
    color: #60a5fa;
  }

  :global(.dark) .tone-green {
    background: rgba(34, 197, 94, 0.14);
    color: #4ade80;
  }

  :global(.dark) .tone-indigo {
    background: rgba(129, 140, 248, 0.16);
    color: #a5b4fc;
  }

  :global(.dark) .tone-amber {
    background: rgba(245, 158, 11, 0.14);
    color: #fbbf24;
  }

  :global(.dark) .tone-success {
    background: rgba(16, 185, 129, 0.18);
    color: #6ee7b7;
    border-color: rgba(16, 185, 129, 0.3);
  }

  :global(.dark) .tone-info {
    background: rgba(99, 102, 241, 0.18);
    color: #a5b4fc;
    border-color: rgba(99, 102, 241, 0.3);
  }

  :global(.dark) .tone-warning {
    background: rgba(245, 158, 11, 0.18);
    color: #fcd34d;
    border-color: rgba(245, 158, 11, 0.3);
  }

  :global(.dark) .tone-danger {
    background: rgba(239, 68, 68, 0.18);
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.3);
  }

  :global(.dark) .tone-muted {
    background: rgba(148, 163, 184, 0.12);
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.2);
  }

  :global(.dark) .select-btn {
    background: #161c27;
    border-color: rgba(255, 255, 255, 0.12);
    color: #e2e8f0;
  }

  :global(.dark) .select-btn:hover {
    border-color: rgba(96, 165, 250, 0.45);
    color: #93c5fd;
    background: #1a2332;
  }

  :global(.dark) .dash-stat-label {
    color: #ffffff;
  }

  :global(.dark) .dash-stat-value,
  :global(.dark) .dash-panel-title,
  :global(.dark) .intern-name {
    color: #f1f5f9;
  }

  :global(.dark) .dash-stat-sub,
  :global(.dark) .dash-panel-subtitle,
  :global(.dark) .text-muted,
  :global(.dark) .row-label {
    color: #94a3b8;
  }

  :global(.dark) .row-value,
  :global(.dark) .request-meta {
    color: #cbd5e1;
  }

  :global(.dark) .row-value-clock.tone-success {
    background: rgba(34, 197, 94, 0.14);
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.22);
  }

  :global(.dark) .row-value-clock.tone-muted {
    background: rgba(148, 163, 184, 0.1);
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.14);
  }

  :global(.dark) .row-icon {
    color: #8fa0bf;
  }

  :global(.dark) .request-name {
    color: #f1f5f9;
  }

  :global(.dark) .request-item {
    border-color: rgba(148, 163, 184, 0.14);
    background: rgba(2, 6, 23, 0.24);
  }

  :global(.dark) .request-list-scroll::-webkit-scrollbar-track {
    background: rgba(71, 85, 105, 0.32);
  }

  :global(.dark) .request-list-scroll::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.52);
  }

  :global(.dark) .request-list-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(148, 163, 184, 0.72);
  }

  :global(.dark) .skeleton-intern-card,
  :global(.dark) .request-item-skeleton {
    border-color: rgba(148, 163, 184, 0.12);
    background: rgba(148, 163, 184, 0.06);
  }

  :global(.dark) .sk-line,
  :global(.dark) .sk-dot,
  :global(.dark) .sk-pill {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.12);
  }

  :global(.dark) .review-btn {
    background: rgba(59, 130, 246, 0.18);
    border-color: rgba(96, 165, 250, 0.45);
    color: #93c5fd;
  }

  :global(.dark) .review-btn:hover {
    background: rgba(59, 130, 246, 0.28);
  }

  :global(.dark) .dash-empty-state {
    border-color: rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.35);
  }

  :global(.dark) .dash-empty-icon {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(148, 163, 184, 0.25);
    color: #94a3b8;
  }

  :global(.dark) .dash-empty-title {
    color: #f1f5f9;
  }

  :global(.dark) .dash-empty-sub {
    color: #94a3b8;
  }

  :global(.dark) .dash-empty-helper-btn {
    background: rgba(59, 130, 246, 0.18);
    border-color: rgba(96, 165, 250, 0.45);
    color: #93c5fd;
  }

  :global(.dark) .dash-empty-helper-btn:hover {
    background: rgba(59, 130, 246, 0.28);
    border-color: rgba(147, 197, 253, 0.6);
  }

  .text-muted {
    color: #64748b;
  }

  @media (max-width: 1200px) {
    .intern-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 900px) {
    .supervisor-dashboard-content {
      --supervisor-section-gap: 18px;
    }

    .dash-stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .intern-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .supervisor-dashboard-content {
      --supervisor-section-gap: 16px;
    }

    .dash-stat-grid {
      grid-template-columns: 1fr;
    }

    .dash-panel-header,
    .dash-panel-body,
    .dash-stat-card {
      padding-left: 14px;
      padding-right: 14px;
    }

    .request-list-scroll {
      height: 320px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .shimmer::after {
      animation: none;
      transform: none;
      opacity: 0;
    }
  }
</style>
