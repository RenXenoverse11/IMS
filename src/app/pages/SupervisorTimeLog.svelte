<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { Clock3, RefreshCw, Trash2, UserCircle2, Users, Loader2, CalendarRange, Download, ChevronDown, Check, X } from 'lucide-svelte';
  import {
    callApiAction,
    deleteSupervisorTimeLog,
    getCurrentUser,
    listSupervisorAssignedStudents,
    listSupervisorTimeLogs,
    subscribeToCurrentUser,
  } from '../lib/auth.js';
  import { subscribeToSync } from '../lib/sync.js';

  let currentUser = null;
  let unsubscribeAuth;
  let unsubscribeSync;
  let assignedStudents = [];
  let selectedStudentId = '';
  let selectedStudent = null;
  let logs = [];
  let activeSessions = [];
  let loadingStudents = true;
  let loadingLogs = false;
  let loadingActiveSessions = false;
  let deletingId = '';
  let isExportingAttendance = false;
  let exportMonth = '';
  let attendanceSheetRef = null;
  let attendanceEntriesForExport = [];
  let selectedExportMonthLabel = '';
  let selectedExportMonthTitle = '';
  let errorMessage = '';
  let successMessage = '';
  let html2pdfLoaderPromise = null;
  let showDeleteConfirm = false;
  let pendingDeleteLogId = '';

  // Override request state variables
  let timelogHistoryFilter = 'entries'; // 'entries' or 'overrides'
  let overrideRequests = [];
  let isLoadingOverrideRequests = false;
  let showApproveConfirm = false;
  let pendingApproveRequest = null;
  let isApprovingRequest = false;
  let showRejectConfirm = false;
  let pendingRejectRequest = null;
  let isRejectingRequest = false;
  let rejectReason = '';
  const ALL_INTERNS_OPTION = '__all__';

  const HTML2PDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

  function toNumber(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatHours(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    const rounded = Math.round(num * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function toDateOnly(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (isoMatch) {
      return isoMatch[1];
    }

    return text;
  }

  function toTimeText(value) {
    const text = String(value || '').trim();
    if (!text) {
      return '-';
    }

    const isoTime = text.match(/T(\d{2}):(\d{2})/);
    if (isoTime) {
      return toTimeText(`${isoTime[1]}:${isoTime[2]}`);
    }

    const amPmTime = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
    if (amPmTime) {
      return `${amPmTime[1]}:${amPmTime[2]} ${String(amPmTime[3] || '').toUpperCase()}`;
    }

    const h24 = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!h24) {
      return text;
    }

    let hours = Number(h24[1]);
    const minutes = String(h24[2]);
    const marker = hours >= 12 ? 'PM' : 'AM';

    if (hours === 0) {
      hours = 12;
    } else if (hours > 12) {
      hours -= 12;
    }

    return `${hours}:${minutes} ${marker}`;
  }

  function normalizeTimeValue(value, fallback = '') {
    const to24HourString = (hours, minutes) => {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    };

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return to24HourString(value.getHours(), value.getMinutes());
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) {
      const fraction = ((numeric % 1) + 1) % 1;
      const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return to24HourString(hours, minutes);
    }

    const text = String(value || '').trim();
    if (!text) {
      return fallback;
    }

    const parsedDate = new Date(text);
    if (!Number.isNaN(parsedDate.getTime())) {
      return to24HourString(parsedDate.getHours(), parsedDate.getMinutes());
    }

    const isoTime = text.match(/T(\d{2}):(\d{2})/);
    if (isoTime) {
      return `${isoTime[1]}:${isoTime[2]}`;
    }

    const amPmTime = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
    if (amPmTime) {
      let hours = Number(amPmTime[1]);
      const minutes = Number(amPmTime[2]);
      const marker = String(amPmTime[3] || '').toUpperCase();

      if (marker === 'PM' && hours < 12) {
        hours += 12;
      }
      if (marker === 'AM' && hours === 12) {
        hours = 0;
      }

      return to24HourString(hours, minutes);
    }

    const h24Time = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
    if (h24Time) {
      const hours = Number(h24Time[1]);
      const minutes = Number(h24Time[2]);

      if (Number.isFinite(hours) && Number.isFinite(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        return to24HourString(hours, minutes);
      }
    }

    return fallback;
  }

  function formatDate(value) {
    const text = toDateOnly(value);
    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return text || '-';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed);
  }

  function formatWeekday(value) {
    const text = toDateOnly(value);
    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
    }).format(parsed);
  }

  function parseIsoDateOnly(value) {
    const text = toDateOnly(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const parsed = new Date(`${text}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function getMonthInputFromDate(value) {
    const parsed = parseIsoDateOnly(value);
    if (!parsed) return '';
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    return `${parsed.getFullYear()}-${month}`;
  }

  function getCurrentMonthInput() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${month}`;
  }

  function formatMonthLabel(monthInput, includeYear = true) {
    const raw = String(monthInput || '').trim();
    if (!/^\d{4}-\d{2}$/.test(raw)) return '';
    const [yearText, monthText] = raw.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return '';
    const dateObj = new Date(year, monthIndex, 1);
    return new Intl.DateTimeFormat('en-US', includeYear ? { month: 'long', year: 'numeric' } : { month: 'long' }).format(dateObj);
  }

  function formatAttendanceDay(value) {
    const parsed = parseIsoDateOnly(value);
    if (!parsed) return '';
    return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(parsed).toUpperCase();
  }

  function formatAttendanceDate(value) {
    const parsed = parseIsoDateOnly(value);
    if (!parsed) return '';
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const year = String(parsed.getFullYear()).slice(-2);
    return `${month}-${day}-${year}`;
  }

  function formatAttendanceTime(value) {
    const normalized = normalizeTimeValue(value, '');
    if (!normalized) return '';
    const [hoursRaw, minutesRaw] = normalized.split(':');
    const hours24 = Number(hoursRaw);
    const minutes = String(minutesRaw || '00').padStart(2, '0');
    if (!Number.isFinite(hours24)) return normalized;
    const hours12 = ((hours24 + 11) % 12) + 1;
    return `${String(hours12).padStart(2, '0')}:${minutes}`;
  }

  function formatAttendanceHours(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Number(num.toFixed(2)).toString();
  }

  function normalizeDaysOff(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
    }

    const text = String(value || '').trim();
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
      }
    } catch (err) {
      // Ignore malformed values and fall back to an empty list.
    }

    return [];
  }

  function formatScheduleDays(daysOff, mode = 'working') {
    const normalizedDaysOff = normalizeDaysOff(daysOff);
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const longDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    if (mode === 'off') {
      return normalizedDaysOff.length
        ? normalizedDaysOff.map((dayIndex) => longDays[dayIndex]).join(', ')
        : 'None';
    }

    const workingDays = shortDays.filter((_, index) => !normalizedDaysOff.includes(index));
    return workingDays.length ? workingDays.join(', ') : 'No working days';
  }

  function toSafeFilenameSegment(value, fallback) {
    const cleaned = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return cleaned || fallback;
  }

  function getHtml2PdfFromWindow() {
    if (typeof window === 'undefined') return null;
    const instance = window.html2pdf;
    return typeof instance === 'function' ? instance : null;
  }

  function ensureHtml2PdfLoaded() {
    const existing = getHtml2PdfFromWindow();
    if (existing) return Promise.resolve(existing);

    if (html2pdfLoaderPromise) return html2pdfLoaderPromise;

    html2pdfLoaderPromise = new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        reject(new Error('html2pdf.js not available'));
        return;
      }

      const current = getHtml2PdfFromWindow();
      if (current) {
        resolve(current);
        return;
      }

      const existingScript = document.querySelector(`script[data-lib="html2pdf"][src="${HTML2PDF_CDN_URL}"]`);
      if (existingScript) {
        existingScript.addEventListener('load', () => {
          const loaded = getHtml2PdfFromWindow();
          if (loaded) {
            resolve(loaded);
            return;
          }
          reject(new Error('html2pdf.js not available'));
        }, { once: true });
        existingScript.addEventListener('error', () => reject(new Error('html2pdf.js not available')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = HTML2PDF_CDN_URL;
      script.async = true;
      script.dataset.lib = 'html2pdf';
      script.onload = () => {
        const loaded = getHtml2PdfFromWindow();
        if (loaded) {
          resolve(loaded);
          return;
        }
        reject(new Error('html2pdf.js not available'));
      };
      script.onerror = () => reject(new Error('html2pdf.js not available'));
      document.head.appendChild(script);
    }).finally(() => {
      html2pdfLoaderPromise = null;
    });

    return html2pdfLoaderPromise;
  }

  function mapLog(row) {
    return {
      timelog_id: String(row?.timelog_id || ''),
      log_date: toDateOnly(row?.log_date),
      time_in: normalizeTimeValue(row?.time_in, ''),
      time_out: normalizeTimeValue(row?.time_out, ''),
      notes: String(row?.notes || ''),
      hours_rendered: toNumber(row?.hours_rendered),
      created_at: String(row?.created_at || ''),
    };
  }

  function getSupervisorUserId() {
    const sessionUser = getCurrentUser();
    return String(sessionUser?.user_id || currentUser?.user_id || '').trim();
  }

  async function loadAssignedStudents() {
    const supervisorId = String(currentUser?.user_id || '').trim();
    const roleNow = String(currentUser?.role || '').trim().toLowerCase();

    if (!supervisorId || roleNow !== 'supervisor') {
      assignedStudents = [];
      selectedStudentId = '';
      selectedStudent = null;
      logs = [];
      loadingStudents = false;
      return;
    }

    loadingStudents = true;
    errorMessage = '';

    try {
      const students = await listSupervisorAssignedStudents(supervisorId);
      assignedStudents = students;

      if (!students.length) {
        selectedStudentId = '';
        selectedStudent = null;
        logs = [];
        return;
      }

      const hasSelection = students.some((student) => String(student.user_id || '') === selectedStudentId);
      if (!hasSelection) {
        selectedStudentId = String(students[0].user_id || '');
      }

      selectedStudent = students.find((student) => String(student.user_id || '') === selectedStudentId) || null;
      await loadLogs();
    } catch (err) {
      errorMessage = err?.message || 'Unable to load assigned students.';
    } finally {
      loadingStudents = false;
    }
  }

  async function loadLogs() {
    const supervisorId = String(currentUser?.user_id || '').trim();
    const studentId = String(selectedStudentId || '').trim();
    const roleNow = String(currentUser?.role || '').trim().toLowerCase();

    if (!supervisorId || !studentId || roleNow !== 'supervisor' || studentId === ALL_INTERNS_OPTION) {
      logs = [];
      return;
    }

    loadingLogs = true;
    errorMessage = '';

    try {
      const rows = await listSupervisorTimeLogs(supervisorId, studentId);
      logs = rows
        .map(mapLog)
        .sort((a, b) => new Date(b.log_date).getTime() - new Date(a.log_date).getTime());
      selectedStudent = assignedStudents.find((student) => String(student.user_id || '') === studentId) || null;
    } catch (err) {
      errorMessage = err?.message || 'Unable to load student time logs.';
    } finally {
      loadingLogs = false;
    }
  }

  async function loadOverrideRequests() {
    const studentId = String(selectedStudentId || '').trim();
    const supervisorId = getSupervisorUserId();
    if (!studentId) {
      overrideRequests = [];
      return;
    }

    isLoadingOverrideRequests = true;
    errorMessage = '';

    try {
      const result = studentId === ALL_INTERNS_OPTION
        ? await callApiAction('list_assigned_student_requests', { supervisor_user_id: supervisorId })
        : await callApiAction('list_requests_by_user', { user_id: studentId });
      const requests = Array.isArray(result?.requests) ? result.requests : [];
      
      // Filter for only time log override requests
      overrideRequests = requests
        .filter((r) => String(r?.requestType || r?.request_type || '').toLowerCase() === 'time log override')
        .map((r) => ({
          id: String(r?.id || r?.request_id || ''),
          date: toDateOnly(r?.date || r?.request_date || ''),
          timeIn: normalizeTimeValue(r?.start_time || r?.startTime || '', ''),
          timeOut: normalizeTimeValue(r?.end_time || r?.endTime || '', ''),
          hours: Number(r?.total_hours || 0),
          reason: String(r?.reason || ''),
          status: String(r?.status || 'pending').toLowerCase(),
          archivedStatus: String(r?.archived_previous_status || r?.archivedPreviousStatus || '').toLowerCase(),
          createdAt: String(r?.created_at || r?.createdAt || ''),
          userId: String(r?.user_id || r?.userId || ''),
          requesterName: String(r?.requester_name || r?.requesterName || ''),
          requestId: String(r?.id || r?.request_id || ''),
        }))
        .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
    } catch (err) {
      errorMessage = err?.message || 'Unable to load override requests.';
      overrideRequests = [];
    } finally {
      isLoadingOverrideRequests = false;
    }
  }

  async function approveOverrideRequest(request = pendingApproveRequest) {
    if (!request) return;
    const supervisorUserId = getSupervisorUserId();
    if (!supervisorUserId) {
      errorMessage = 'Please log in again before approving this request.';
      return;
    }
    const requestId = String(request?.id || request?.requestId || '').trim();
    isApprovingRequest = true;
    errorMessage = '';
    successMessage = '';

    try {
      const result = await callApiAction('approve_request', {
        request_id: requestId,
        supervisor_user_id: supervisorUserId,
        user_id: supervisorUserId,
        student_user_id: String(request?.userId || '').trim(),
        request_date: String(request?.date || '').trim(),
        start_time: String(request?.timeIn || '').trim(),
        end_time: String(request?.timeOut || '').trim(),
        reason: String(request?.reason || '').trim(),
      });

      if (!result?.ok) {
        errorMessage = result?.error || 'Failed to approve override request.';
        return;
      }

      successMessage = 'Override request approved successfully!';
      showApproveConfirm = false;
      pendingApproveRequest = null;
      
      // Reload the override requests
      await loadOverrideRequests();
    } catch (err) {
      errorMessage = err?.message || 'Failed to approve override request.';
    } finally {
      isApprovingRequest = false;
    }
  }

  async function rejectOverrideRequest(request = pendingRejectRequest, customRejectReason = rejectReason) {
    if (!request) return;
    const supervisorUserId = getSupervisorUserId();
    if (!supervisorUserId) {
      errorMessage = 'Please log in again before rejecting this request.';
      return;
    }
    const requestId = String(request?.id || request?.requestId || '').trim();
    isRejectingRequest = true;
    errorMessage = '';
    successMessage = '';

    try {
      const result = await callApiAction('reject_request', {
        request_id: requestId,
        supervisor_user_id: supervisorUserId,
        user_id: supervisorUserId,
        student_user_id: String(request?.userId || '').trim(),
        request_date: String(request?.date || '').trim(),
        start_time: String(request?.timeIn || '').trim(),
        end_time: String(request?.timeOut || '').trim(),
        reason: String(request?.reason || '').trim(),
        rejection_reason: String(customRejectReason || '').trim(),
      });

      if (!result?.ok) {
        errorMessage = result?.error || 'Failed to reject override request.';
        return;
      }

      successMessage = 'Override request rejected successfully!';
      showRejectConfirm = false;
      pendingRejectRequest = null;
      rejectReason = '';
      
      // Reload the override requests
      await loadOverrideRequests();
    } catch (err) {
      errorMessage = err?.message || 'Failed to reject override request.';
    } finally {
      isRejectingRequest = false;
    }
  }

  function cancelApprove() {
    if (isApprovingRequest) return;
    showApproveConfirm = false;
    pendingApproveRequest = null;
  }

  function cancelReject() {
    if (isRejectingRequest) return;
    showRejectConfirm = false;
    pendingRejectRequest = null;
    rejectReason = '';
  }

  function promptApprove(request) {
    pendingApproveRequest = request;
    showApproveConfirm = true;
  }

  function promptReject(request) {
    pendingRejectRequest = request;
    showRejectConfirm = true;
    rejectReason = '';
  }

  function handleApproveClick(request) {
    if (!request || isApprovingRequest || isRejectingRequest) return;
    promptApprove(request);
  }

  function handleRejectClick(request) {
    if (!request || isApprovingRequest || isRejectingRequest) return;
    promptReject(request);
  }

  async function loadActiveSessions() {
    const supervisorId = String(currentUser?.user_id || '').trim();
    const roleNow = String(currentUser?.role || '').trim().toLowerCase();

    if (!supervisorId || roleNow !== 'supervisor') {
      activeSessions = [];
      return;
    }

    loadingActiveSessions = true;

    try {
      const result = await callApiAction('list_supervisor_active_sessions', {
        supervisor_user_id: supervisorId,
      });

      if (result && result.ok) {
        // Map active sessions to include student names
        activeSessions = (result.active_sessions || []).map((session) => {
          const student = assignedStudents.find((s) => String(s.user_id) === String(session.user_id));
          return {
            ...session,
            student_name: student?.full_name || 'Unknown Intern',
            student_email: student?.email || '',
          };
        });
      } else {
        activeSessions = [];
      }
    } catch (err) {
      console.error('Error loading active sessions:', err);
      activeSessions = [];
    } finally {
      loadingActiveSessions = false;
    }
  }

  async function exportAttendanceSheetPdf() {
    if (isExportingAttendance) return;
    if (!attendanceEntriesForExport.length) {
      errorMessage = 'No completed entries found for the selected month.';
      return;
    }

    isExportingAttendance = true;
    errorMessage = '';
    successMessage = '';

    try {
      const html2pdf = await ensureHtml2PdfLoaded();
      if (typeof html2pdf !== 'function') {
        throw new Error('html2pdf.js not available');
      }

      await tick();

      if (!attendanceSheetRef) {
        throw new Error('Attendance sheet preview is not available.');
      }

      const internPart = toSafeFilenameSegment(selectedStudent?.full_name || 'Intern', 'Intern');
      const monthPart = toSafeFilenameSegment(selectedExportMonthLabel || formatMonthLabel(exportMonth, true) || 'Month-Year', 'Month-Year');
      const filename = `OJT-Attendance-Sheet-${internPart}-${monthPart}.pdf`;
      const options = {
        margin: [6, 8, 6, 8],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      };

      await html2pdf().set(options).from(attendanceSheetRef).save();
    } catch (err) {
      const message = String(err?.message || '');
      if (message.toLowerCase().includes('html2pdf')) {
        if (typeof window !== 'undefined') {
          window.alert('html2pdf.js is not installed. Run: npm install html2pdf.js');
        }
      } else {
        errorMessage = message || 'Unable to export attendance sheet right now.';
      }
    } finally {
      isExportingAttendance = false;
    }
  }

  function promptDelete(logId) {
    pendingDeleteLogId = String(logId || '').trim();
    if (!pendingDeleteLogId) return;
    showDeleteConfirm = true;
  }

  function closeDeleteConfirm() {
    if (deletingId) return;
    showDeleteConfirm = false;
    pendingDeleteLogId = '';
  }

  async function handleDelete(logId = pendingDeleteLogId) {
    const supervisorId = String(currentUser?.user_id || '').trim();
    const studentId = String(selectedStudentId || '').trim();
    const timelogId = String(logId || '').trim();

    if (!supervisorId || !studentId || !timelogId) {
      return;
    }

    deletingId = timelogId;
    errorMessage = '';
    successMessage = '';

    try {
      await deleteSupervisorTimeLog(supervisorId, studentId, timelogId);
      logs = logs.filter((row) => String(row.timelog_id) !== timelogId);
      successMessage = 'Intern time log deleted successfully.';
      closeDeleteConfirm();
    } catch (err) {
      errorMessage = err?.message || 'Unable to delete selected time log.';
    } finally {
      deletingId = '';
    }
  }

  onMount(() => {
    currentUser = getCurrentUser();

    unsubscribeAuth = subscribeToCurrentUser((user) => {
      currentUser = user;
      loadAssignedStudents();
    });

    unsubscribeSync = subscribeToSync(() => {
      if (!deletingId) {
        loadAssignedStudents();
      }
    });
  });

  onDestroy(() => {
    if (typeof unsubscribeAuth === 'function') {
      unsubscribeAuth();
    }

    if (typeof unsubscribeSync === 'function') {
      unsubscribeSync();
    }
  });

  $: selectedStudent = assignedStudents.find((student) => String(student.user_id || '') === selectedStudentId) || null;
  $: selectedRequiredHours = toNumber(selectedStudent?.required_hours);
  $: selectedCompletedHours = toNumber(selectedStudent?.completed_hours);
  $: selectedRemainingHours = Math.max(0, selectedRequiredHours - selectedCompletedHours);
  $: selectedProgress = selectedRequiredHours > 0 ? Math.min(100, Math.round((selectedCompletedHours / selectedRequiredHours) * 100)) : 0;
  $: selectedStudentDaysOff = normalizeDaysOff(selectedStudent?.days_off);
  $: selectedStudentShiftStart = normalizeTimeValue(selectedStudent?.shift_start, '09:00');
  $: selectedStudentShiftEnd = normalizeTimeValue(selectedStudent?.shift_end, '17:00');
  $: exportMonth = exportMonth || getCurrentMonthInput();
  $: attendanceEntriesForExport = logs
    .filter((entry) => entry.time_out && toNumber(entry.hours_rendered) > 0 && getMonthInputFromDate(entry.log_date) === exportMonth)
    .map((entry) => ({ ...entry, attendanceDay: formatAttendanceDay(entry.log_date) }))
    .sort((a, b) => new Date(a.log_date).getTime() - new Date(b.log_date).getTime());
  $: selectedExportMonthLabel = formatMonthLabel(exportMonth, true);
  $: selectedExportMonthTitle = formatMonthLabel(exportMonth, false);
  $: currentRole = String(currentUser?.role || '').trim().toLowerCase();
  $: isSupervisorUser = currentRole === 'supervisor';
  $: isAllInternsView = selectedStudentId === ALL_INTERNS_OPTION;
  $: if (assignedStudents.length > 0 && isSupervisorUser) {
    loadActiveSessions();
  }
  $: if (selectedStudentId) {
    overrideRequests = [];
    timelogHistoryFilter = 'entries';
  }
</script>

{#if currentUser && !isSupervisorUser}
  <section class="warning-alert">
    This page is available for supervisor accounts only.
  </section>
{:else}
  <section class="stl-shell">
    {#if activeSessions.length > 0}
      <section class="stl-card stl-card-success">
        <div class="section-head">
          <div class="section-icon icon-green"><Clock3 size={18} /></div>
          <div>
            <h3 class="section-title">Currently Logged In</h3>
            <p class="section-sub">{activeSessions.length} {activeSessions.length === 1 ? 'intern is' : 'interns are'} currently logged in today</p>
          </div>
        </div>
        <div class="session-list">
          {#each activeSessions as session (session.session_id)}
            <div class="session-item">
              <div class="session-left">
                <UserCircle2 size={16} />
                <div>
                  <p class="session-name">{session.student_name}</p>
                  <p class="session-sub">Logged in at {toTimeText(session.time_in)}</p>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if errorMessage}
      <p class="alert alert-error">{errorMessage}</p>
    {/if}

    {#if successMessage}
      <p class="alert alert-success">{successMessage}</p>
    {/if}

    {#if loadingStudents}
      <div class="stats-grid" aria-hidden="true">
        {#each Array(4) as _}
          <article class="stl-card stat-card stat-card-skeleton">
            <div class="stat-icon sk-block sk-shimmer"></div>
            <div class="stat-copy">
              <div class="sk-line sk-shimmer stat-label-sk"></div>
              <div class="sk-line sk-shimmer stat-value-sk"></div>
              <div class="sk-line sk-shimmer stat-sub-sk"></div>
            </div>
          </article>
        {/each}
      </div>

      <div class="control-head">
        <div class="control-actions">
          <div class="selector-wrap selector-wrap-skeleton" aria-hidden="true">
            <div class="sk-line sk-shimmer selector-sk"></div>
          </div>

          <div class="btn-secondary btn-secondary-skeleton" aria-hidden="true">
            <div class="sk-line sk-shimmer button-sk"></div>
          </div>
        </div>
      </div>

      <section class="stl-card stl-table-section">
        <div class="stl-table-header">
          <div>
            <h3 class="section-title">Time Log Entries</h3>
            <p class="section-sub">Loading entries...</p>
          </div>
          <div class="stl-table-tools">
            <div class="loading-chip loading-chip-skeleton" aria-hidden="true">
              <div class="sk-line sk-shimmer chip-sk"></div>
            </div>
          </div>
        </div>
        <div class="table-scroll-y">
          <div class="table-wrap">
            <table class="stl-table table-skeleton" style="min-width: 700px;" aria-hidden="true">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th>Hours</th>
                  <th class="action-col">Action</th>
                </tr>
              </thead>
              <tbody>
                {#each Array(6) as _}
                  <tr>
                    <td><div class="sk-line sk-shimmer cell-date-sk"></div></td>
                    <td><div class="sk-line sk-shimmer cell-time-sk"></div></td>
                    <td><div class="sk-line sk-shimmer cell-time-sk"></div></td>
                    <td><div class="sk-line sk-shimmer cell-hours-sk"></div></td>
                    <td class="action-col"><div class="sk-pill sk-shimmer action-pill-sk"></div></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    {:else if selectedStudent || isAllInternsView}
      {@const summaryProgressTone = selectedProgress >= 80 ? 'high' : selectedProgress >= 40 ? 'mid' : 'low'}
      {#if !isAllInternsView}
        <div class="stats-grid">
          <article class="stl-card stat-card">
            <div class="stat-icon icon-blue"><UserCircle2 size={18} /></div>
            <div class="stat-copy">
              <p class="stat-label">Selected Intern</p>
              <p class="stat-value stat-name">{selectedStudent.full_name || 'Intern'}</p>
              <p class="stat-sub">Current intern record</p>
            </div>
          </article>

          <article class="stl-card stat-card">
            <div class="stat-icon icon-violet"><Users size={18} /></div>
            <div class="stat-copy">
              <p class="stat-label">Overall Progress</p>
              <p class="stat-value">{selectedProgress}%</p>
              <p class="stat-sub">Completion vs required hours</p>
              <div class="progress-inline">
                <div class="progress-track">
                  <div class={`progress-fill progress-${summaryProgressTone}`} style={`width:${selectedProgress}%`}></div>
                </div>
              </div>
            </div>
          </article>

          <article class="stl-card stat-card">
            <div class="stat-icon icon-green"><Clock3 size={18} /></div>
            <div class="stat-copy">
              <p class="stat-label">Completed Hours</p>
              <p class="stat-value">{formatHours(selectedCompletedHours)}h</p>
              <p class="stat-sub">Logged time entries</p>
            </div>
          </article>

          <article class="stl-card stat-card">
            <div class="stat-icon icon-amber"><Clock3 size={18} /></div>
            <div class="stat-copy">
              <p class="stat-label">Remaining Hours</p>
              <p class="stat-value">{formatHours(selectedRemainingHours)}h</p>
              <p class="stat-sub">Until internship target</p>
            </div>
          </article>
        </div>

        <section class="stl-card stl-schedule-card">
          <div class="section-head stl-schedule-head">
            <div class="section-icon icon-violet"><CalendarRange size={18} /></div>
            <div>
              <h3 class="section-title">Intern Schedule</h3>
              <p class="section-sub">Reference schedule for attendance review and late/absence context.</p>
            </div>
          </div>
          <div class="stl-schedule-content">
            <div class="stl-schedule-item">
              <div class="stl-schedule-label">Shift Hours</div>
              <div class="stl-schedule-value">{toTimeText(selectedStudentShiftStart)} - {toTimeText(selectedStudentShiftEnd)}</div>
            </div>
            <div class="stl-schedule-item">
              <div class="stl-schedule-label">Working Days</div>
              <div class="stl-schedule-value">{formatScheduleDays(selectedStudentDaysOff, 'working')}</div>
            </div>
            <div class="stl-schedule-item">
              <div class="stl-schedule-label">Days Off</div>
              <div class="stl-schedule-value">{formatScheduleDays(selectedStudentDaysOff, 'off')}</div>
            </div>
          </div>
        </section>
      {:else}
        <section class="stl-card">
          <div class="section-head">
            <div class="section-icon icon-blue"><Users size={18} /></div>
            <div>
              <h3 class="section-title">All Intern Override Requests</h3>
              <p class="section-sub">Combined override requests from all assigned interns.</p>
            </div>
          </div>
        </section>
      {/if}

      <div class="control-head">
        <div class="control-actions">
          <label class="selector-wrap selector-wrap-intern">
            <span class="selector-icon"><UserCircle2 size={15} /></span>
            <select bind:value={selectedStudentId} class="stl-input" on:change={loadLogs}>
              {#if loadingStudents}
                <option value="">Loading intern accounts...</option>
              {:else if assignedStudents.length === 0}
                <option value="">No assigned interns</option>
              {:else}
                <option value={ALL_INTERNS_OPTION}>All Interns</option>
                {#each assignedStudents as student (student.user_id)}
                  <option value={student.user_id}>{student.full_name}</option>
                {/each}
              {/if}
            </select>
            <span class="selector-caret"><ChevronDown size={15} /></span>
          </label>

          <button type="button" class="btn-secondary btn-refresh" on:click={loadAssignedStudents} disabled={loadingStudents || loadingLogs}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      <section class="stl-card stl-table-section">
        <div class="stl-table-header">
          <span class="stl-table-title">Logged Activity</span>
          <div class="stl-table-tools">
            {#if timelogHistoryFilter === 'entries'}
              <span class="stl-entry-count">{attendanceEntriesForExport.length} completed {attendanceEntriesForExport.length === 1 ? 'entry' : 'entries'}</span>
              <label class="stl-export-month">
                <span><CalendarRange size={14} /> Month</span>
                <input type="month" bind:value={exportMonth} />
              </label>
              <button class="stl-export-btn" type="button" on:click={exportAttendanceSheetPdf} disabled={isExportingAttendance || attendanceEntriesForExport.length === 0}>
                {#if isExportingAttendance}
                  <span class="spinning-icon"><Loader2 size={14} /></span>
                  Exporting...
                {:else}
                  <Download size={14} />
                  Export Attendance Sheet
                {/if}
              </button>
            {:else}
              <span class="stl-entry-count">{overrideRequests.length} {overrideRequests.length === 1 ? 'request' : 'requests'}</span>
            {/if}
          </div>
        </div>

        <div class="stl-history-filters">
          <button
            class="stl-filter-tab"
            class:stl-filter-active={timelogHistoryFilter === 'entries'}
            on:click={() => {
              timelogHistoryFilter = 'entries';
            }}
          >
            Time Entries
          </button>
          <button
            class="stl-filter-tab"
            class:stl-filter-active={timelogHistoryFilter === 'overrides'}
            on:click={() => {
              timelogHistoryFilter = 'overrides';
              if (overrideRequests.length === 0 && !isLoadingOverrideRequests) {
                loadOverrideRequests();
              }
            }}
          >
            Override Requests
          </button>
        </div>

        {#if timelogHistoryFilter === 'entries'}
          {#if loadingLogs}
            <div class="table-scroll-y">
              <div class="table-wrap">
                <table class="stl-table table-skeleton" style="min-width: 700px;" aria-hidden="true">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time In</th>
                      <th>Time Out</th>
                      <th>Hours</th>
                      <th class="action-col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each Array(6) as _}
                      <tr>
                        <td><div class="sk-line sk-shimmer cell-date-sk"></div></td>
                        <td><div class="sk-line sk-shimmer cell-time-sk"></div></td>
                        <td><div class="sk-line sk-shimmer cell-time-sk"></div></td>
                        <td><div class="sk-line sk-shimmer cell-hours-sk"></div></td>
                        <td class="action-col"><div class="sk-pill sk-shimmer action-pill-sk"></div></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {:else if logs.length === 0}
            <div class="empty-state">
              <div class="empty-icon"><Clock3 size={18} /></div>
              <p class="empty-title">No time log entries yet.</p>
              <p class="empty-sub">Entries for the selected intern will appear here.</p>
            </div>
          {:else}
            <div class="table-scroll-y">
              <div class="table-wrap">
                <table class="stl-table" style="min-width: 700px;">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time In</th>
                      <th>Time Out</th>
                      <th>Hours</th>
                      <th class="action-col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each logs as row (row.timelog_id)}
                      <tr>
                        <td data-label="Date">
                        <div class="log-date-cell">
                          <span class="log-date-day">{formatWeekday(row.log_date)}</span>
                          <div class="log-date-copy">
                            <span class="log-date-main">{formatDate(row.log_date)}</span>
                            <span class="log-date-sub">Attendance record</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Time In">
                        <div class="time-cell">
                          <span class="time-main">{toTimeText(row.time_in)}</span>
                          <span class="time-sub">Clock in</span>
                        </div>
                      </td>
                      <td data-label="Time Out">
                        <div class="time-cell">
                          <span class="time-main">{toTimeText(row.time_out)}</span>
                          <span class="time-sub">Clock out</span>
                        </div>
                      </td>
                      <td data-label="Hours">
                        <span class="hours-badge">{formatHours(row.hours_rendered)}h</span>
                      </td>
                      <td class="action-col" data-label="Action">
                        <button
                          type="button"
                          class="btn-delete"
                          on:click={() => promptDelete(row.timelog_id)}
                          disabled={deletingId === row.timelog_id}
                          aria-label="Delete time log entry"
                        >
                          {#if deletingId === row.timelog_id}
                            <span class="spinning-icon"><Loader2 size={13} /></span>
                          {:else}
                            <Trash2 size={13} />
                          {/if}
                          <span>{deletingId === row.timelog_id ? 'Deleting...' : 'Delete'}</span>
                        </button>
                      </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        {:else}
          {#if isLoadingOverrideRequests}
            <div class="table-scroll-y">
              <div class="table-wrap">
                <table class="stl-table table-skeleton" style="min-width: 900px;" aria-hidden="true">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time In</th>
                      <th>Time Out</th>
                      <th>Duration</th>
                      <th>Reason</th>
                      <th class="status-col">Status</th>
                      <th class="action-col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each Array(6) as _}
                      <tr>
                        <td><div class="sk-line sk-shimmer cell-date-sk"></div></td>
                        <td><div class="sk-line sk-shimmer cell-time-sk"></div></td>
                        <td><div class="sk-line sk-shimmer cell-time-sk"></div></td>
                        <td><div class="sk-line sk-shimmer cell-hours-sk"></div></td>
                        <td><div class="sk-line sk-shimmer cell-reason-sk"></div></td>
                        <td><div class="sk-pill sk-shimmer status-pill-sk"></div></td>
                        <td class="action-col"><div class="sk-pill sk-shimmer action-pill-sk"></div></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {:else if overrideRequests.length === 0}
            <div class="empty-state">
              <div class="empty-icon"><Clock3 size={18} /></div>
              <p class="empty-title">No override requests yet.</p>
              <p class="empty-sub">Override requests from the selected intern will appear here.</p>
            </div>
          {:else}
            <div class="table-scroll-y">
              <div class="table-wrap">
                <table class="stl-table stl-override-table" style="min-width: 980px;">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time In</th>
                      <th>Time Out</th>
                      <th>Duration</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th class="action-col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each overrideRequests as req (req.id)}
                      <tr>
                        <td data-label="Date">
                          <span class="override-primary-text">{formatDate(req.date)}</span>
                        </td>
                        <td data-label="Time In">
                          <span class="override-mono-text">{normalizeTimeValue(req.timeIn, '') || '-'}</span>
                        </td>
                        <td data-label="Time Out">
                          <span class="override-mono-text">{normalizeTimeValue(req.timeOut, '') || '-'}</span>
                        </td>
                        <td data-label="Duration">
                          <span class="hours-badge">{formatHours(req.hours)}h</span>
                        </td>
                        <td data-label="Reason">
                          <div class="reason-cell">
                            <span class="reason-text">{req.reason || 'No reason provided'}</span>
                          </div>
                        </td>
                        <td class="status-col" data-label="Status">
                          <span class="status-badge status-{req.status}">{req.status.charAt(0).toUpperCase() + req.status.slice(1)}</span>
                        </td>
                        <td class="action-col" data-label="Action">
                          {#if req.status === 'pending'}
                            <div class="action-buttons">
                              <button
                                type="button"
                                class="btn-approve"
                                on:click={() => handleApproveClick(req)}
                                disabled={isApprovingRequest || isRejectingRequest}
                                aria-label="Approve override request"
                              >
                                <Check size={13} />
                                <span>Approve</span>
                              </button>
                              <button
                                type="button"
                                class="btn-reject"
                                on:click={() => handleRejectClick(req)}
                                disabled={isApprovingRequest || isRejectingRequest}
                                aria-label="Reject override request"
                              >
                                <X size={13} />
                                <span>Reject</span>
                              </button>
                            </div>
                          {:else}
                            <span class="action-status">{req.status === 'approved' ? 'Approved' : 'Rejected'}</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        {/if}
      </section>

      <div class="stl-attendance-print-root" aria-hidden="true">
        <div class="stl-attendance-sheet" bind:this={attendanceSheetRef}>
          <div class="stl-attendance-head">
            <h1>OJT DAILY ATTENDANCE SHEET</h1>
            <h2>Month of {selectedExportMonthTitle || '__________'}</h2>
          </div>

          <div class="stl-attendance-meta">
            <div class="stl-attendance-meta-row">
              <span class="stl-attendance-meta-label">Name:</span>
              <span class="stl-attendance-meta-value">{selectedStudent?.full_name || ''}</span>
            </div>
            <div class="stl-attendance-meta-row">
              <span class="stl-attendance-meta-label">Company Name:</span>
              <span class="stl-attendance-meta-value">{'\u00A0'}</span>
            </div>
            <div class="stl-attendance-meta-row">
              <span class="stl-attendance-meta-label">Name of Representative:</span>
              <span class="stl-attendance-meta-value">{'\u00A0'}</span>
            </div>
          </div>

          <table class="stl-attendance-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Date</th>
                <th>TIME-IN</th>
                <th>TIME-OUT</th>
                <th>Number of Hours</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {#each attendanceEntriesForExport as entry (entry.timelog_id)}
                <tr>
                  <td>{entry.attendanceDay}</td>
                  <td>{formatAttendanceDate(entry.log_date)}</td>
                  <td>{formatAttendanceTime(entry.time_in)}</td>
                  <td>{formatAttendanceTime(entry.time_out)}</td>
                  <td>{formatAttendanceHours(entry.hours_rendered)}</td>
                  <td></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {:else}
      <section class="stl-card">
        <div class="empty-state">
          <div class="empty-icon"><Users size={18} /></div>
          <p class="empty-title">No intern selected.</p>
          <p class="empty-sub">Choose an assigned intern to view time logs.</p>
        </div>
      </section>
    {/if}
  </section>

  {#if showDeleteConfirm}
    <div
      class="modal-overlay"
      role="button"
      tabindex="0"
      aria-label="Close delete confirmation"
      on:click={closeDeleteConfirm}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          closeDeleteConfirm();
        }
      }}
    >
      <div
        class="delete-modal"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        on:click|stopPropagation
        on:keydown|stopPropagation={() => {}}
      >
        <div class="delete-modal-head">
          <div class="delete-modal-icon"><Trash2 size={18} /></div>
          <h3>Delete time log</h3>
          <p>This will permanently remove the selected student entry.</p>
        </div>
        <div class="delete-modal-actions">
          <button type="button" class="btn-secondary" on:click={closeDeleteConfirm} disabled={Boolean(deletingId)}>Cancel</button>
          <button type="button" class="btn-delete btn-delete-modal" on:click={() => handleDelete()} disabled={Boolean(deletingId)}>
            {#if deletingId}
              <span class="spinning-icon"><Loader2 size={13} /></span>
              <span>Deleting...</span>
            {:else}
              <Trash2 size={13} />
              <span>Delete Entry</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showApproveConfirm}
    <div
      class="modal-overlay"
      role="button"
      tabindex="0"
      aria-label="Close approval confirmation"
      on:click={cancelApprove}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cancelApprove();
        }
      }}
    >
      <div
        class="approve-modal"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        on:click|stopPropagation
        on:keydown|stopPropagation={() => {}}
      >
        <div class="approve-modal-head">
          <div class="approve-modal-icon"><Check size={18} /></div>
          <h3>Approve override request</h3>
          <p>This will approve the override time log request for {pendingApproveRequest?.date ? formatDate(pendingApproveRequest.date) : 'this date'}.</p>
        </div>
        <div class="approve-modal-details">
          <div class="detail-row">
            <span class="detail-label">Time Range:</span>
            <span class="detail-value">{toTimeText(pendingApproveRequest?.timeIn)} - {toTimeText(pendingApproveRequest?.timeOut)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Duration:</span>
            <span class="detail-value">{formatHours(pendingApproveRequest?.hours)}h</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Reason:</span>
            <span class="detail-value">{pendingApproveRequest?.reason || 'No reason provided'}</span>
          </div>
        </div>
        <div class="approve-modal-actions">
          <button type="button" class="btn-secondary" on:click={cancelApprove} disabled={isApprovingRequest}>Cancel</button>
          <button type="button" class="btn-approve btn-approve-modal" on:click={approveOverrideRequest} disabled={isApprovingRequest}>
            {#if isApprovingRequest}
              <span class="spinning-icon"><Loader2 size={13} /></span>
              <span>Approving...</span>
            {:else}
              <Check size={13} />
              <span>Approve Request</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showRejectConfirm}
    <div
      class="modal-overlay"
      role="button"
      tabindex="0"
      aria-label="Close rejection confirmation"
      on:click={cancelReject}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cancelReject();
        }
      }}
    >
      <div
        class="reject-modal"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        on:click|stopPropagation
        on:keydown|stopPropagation={() => {}}
      >
        <div class="reject-modal-head">
          <div class="reject-modal-icon"><X size={18} /></div>
          <h3>Reject override request</h3>
          <p>Provide an optional reason for rejecting this override time log request.</p>
        </div>
        <div class="reject-modal-details">
          <div class="detail-row">
            <span class="detail-label">Time Range:</span>
            <span class="detail-value">{toTimeText(pendingRejectRequest?.timeIn)} - {toTimeText(pendingRejectRequest?.timeOut)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Duration:</span>
            <span class="detail-value">{formatHours(pendingRejectRequest?.hours)}h</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Reason:</span>
            <span class="detail-value">{pendingRejectRequest?.reason || 'No reason provided'}</span>
          </div>
        </div>
        <div class="reject-modal-input">
          <label for="reject-reason" class="reject-reason-label">Reason for Rejection (optional):</label>
          <textarea
            id="reject-reason"
            class="reject-reason-textarea"
            placeholder="Briefly explain why this request is being rejected..."
            bind:value={rejectReason}
            disabled={isRejectingRequest}
            rows="4"
          ></textarea>
        </div>
        <div class="reject-modal-actions">
          <button type="button" class="btn-secondary" on:click={cancelReject} disabled={isRejectingRequest}>Cancel</button>
          <button type="button" class="btn-reject btn-reject-modal" on:click={rejectOverrideRequest} disabled={isRejectingRequest}>
            {#if isRejectingRequest}
              <span class="spinning-icon"><Loader2 size={13} /></span>
              <span>Rejecting...</span>
            {:else}
              <X size={13} />
              <span>Reject Request</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .warning-alert {
    border-radius: 12px;
    border: 1px solid #fcd34d;
    padding: 14px 16px;
    background: #fef3c7;
    color: #92400e;
    font-size: 14px;
    font-weight: 500;
  }

  .stl-shell {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .stl-card {
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 18px 20px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
    transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
  }

  .stl-card-success {
    border-color: rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.08);
  }

  .stl-schedule-card {
    padding-top: 16px;
  }

  .stl-schedule-head {
    margin-bottom: 14px;
  }

  .stl-schedule-content {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .stl-schedule-item {
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 12px;
    padding: 14px 15px;
    background: linear-gradient(180deg, rgba(248, 250, 252, 0.92), rgba(241, 245, 249, 0.82));
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stl-schedule-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #64748b;
  }

  .stl-schedule-value {
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
  }

  .section-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 10px;
  }

  .section-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
  }

  .section-sub {
    margin: 4px 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .session-list {
    display: grid;
    gap: 8px;
  }

  .session-item {
    border: 1px solid rgba(16, 185, 129, 0.22);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.45);
    padding: 9px 11px;
  }

  .session-left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #047857;
  }

  .session-name {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #065f46;
  }

  .session-sub {
    margin: 2px 0 0;
    font-size: 12px;
    color: #047857;
  }

  .control-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
    margin: 2px 0 4px;
  }

  .control-actions {
    display: flex;
    align-items: stretch;
    gap: 10px;
    width: min(100%, 560px);
  }

  .selector-wrap {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    min-height: 46px;
    border-radius: 12px;
    overflow: hidden;
  }

  .selector-wrap-intern {
    background: linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(241, 245, 249, 0.96));
    border: 1px solid rgba(148, 163, 184, 0.22);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
  }

  .selector-icon,
  .selector-caret {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    color: #64748b;
    pointer-events: none;
  }

  .selector-icon {
    left: 14px;
  }

  .selector-caret {
    right: 14px;
  }

  .stl-input {
    width: 100%;
    height: 46px;
    box-sizing: border-box;
    border: 0;
    background: transparent;
    color: #0f172a;
    border-radius: 12px;
    padding: 10px 42px 10px 42px;
    font-size: 13.5px;
    font-weight: 600;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    appearance: none;
  }

  .stl-input:focus {
    box-shadow: inset 0 0 0 1px #60a5fa, 0 0 0 3px rgba(59, 130, 246, 0.16);
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 46px;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    border-radius: 12px;
    padding: 0 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .btn-secondary:hover:not(:disabled) {
    border-color: #93c5fd;
    background: #f1f5f9;
  }

  .btn-refresh {
    min-width: 118px;
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.05);
  }

  .btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .alert {
    margin: 0;
    border-radius: 10px;
    border: 1px solid;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 500;
  }

  .alert-error {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
  }

  .alert-success {
    background: #ecfdf5;
    border-color: #a7f3d0;
    color: #047857;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .stat-card {
    min-height: 104px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .stat-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  :global(.dark) .icon-blue {
    background: rgba(59, 130, 246, 0.18);
    border-color: rgba(96, 165, 250, 0.28);
    color: #60a5fa;
  }

  :global(.dark) .icon-violet {
    background: rgba(99, 102, 241, 0.18);
    border-color: rgba(129, 140, 248, 0.28);
    color: #818cf8;
  }

  :global(.dark) .icon-green {
    background: rgba(34, 197, 94, 0.18);
    border-color: rgba(74, 222, 128, 0.28);
    color: #4ade80;
  }

  :global(.dark) .icon-amber {
    background: rgba(245, 158, 11, 0.18);
    border-color: rgba(253, 191, 36, 0.28);
    color: #fbbf24;
  }

  .stat-value {
    margin: 0;
    font-size: 24px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: -0.8px;
    color: #0f172a;
  }

  .stat-name {
    font-size: 24px;
    line-height: 1;
    word-break: break-word;
  }

  .stat-label {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #475569;
  }

  .stat-copy {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    width: 100%;
    gap: 4px;
    min-width: 0;
  }

  .stat-sub {
    margin: 0;
    font-size: 11.5px;
    color: #64748b;
  }

  .progress-inline {
    margin-top: auto;
    padding-top: 7px;
  }

  .progress-track {
    height: 8px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(148, 163, 184, 0.2);
    overflow: hidden;
  }

  :global(.dark) .progress-track {
    border-color: rgba(148, 163, 184, 0.25);
    background: rgba(71, 85, 105, 0.3);
  }

  .progress-fill {
    height: 100%;
    border-radius: inherit;
    transition: width 0.25s ease;
  }

  .progress-high {
    background: linear-gradient(90deg, #16a34a, #22c55e);
  }

  .progress-mid {
    background: linear-gradient(90deg, #0284c7, #38bdf8);
  }

  .progress-low {
    background: linear-gradient(90deg, #2563eb, #3b82f6);
  }

  .stl-table-section {
    padding-top: 0;
    overflow: hidden;
  }

  .stl-table-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
  }

  .stl-table-title {
    font-size: 14px;
    font-weight: 600;
    color: #0f172a;
  }

  .stl-table-tools {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .stl-entry-count {
    font-size: 12px;
    font-weight: 600;
    color: #475569;
  }

  .stl-history-filters {
    display: flex;
    gap: 2px;
    padding: 8px 20px 0;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .stl-filter-tab {
    padding: 10px 16px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #64748b;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stl-filter-tab:hover:not(.stl-filter-active) {
    color: #0f172a;
  }

  .stl-filter-active {
    color: #2563eb;
    border-bottom-color: #2563eb;
  }

  .stl-export-month {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: #64748b;
    font-weight: 600;
  }

  .stl-export-month span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .stl-export-month input {
    width: 148px;
    height: 34px;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    color-scheme: light;
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    outline: none;
  }

  .stl-export-month input:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
  }

  .stl-export-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 34px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.05);
  }

  .stl-export-btn:hover:not(:disabled) {
    border-color: #93c5fd;
    background: #f1f5f9;
  }

  .stl-export-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .table-wrap {
    max-height: 520px;
    overflow: auto;
    border-radius: 0 0 16px 16px;
    border: 0;
    background: transparent;
    box-shadow: none;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .table-scroll-y::-webkit-scrollbar:vertical {
    width: 0;
  }

  .table-wrap {
    overflow: visible;
    overflow-y: visible;
  }

  .table-scroll-y::-webkit-scrollbar:horizontal {
    height: 10px;
  }

  .table-scroll-y::-webkit-scrollbar-track:horizontal {
    background: rgba(148, 163, 184, 0.14);
    border-radius: 999px;
  }

  .table-scroll-y::-webkit-scrollbar-thumb:horizontal {
    background: rgba(59, 130, 246, 0.55);
    border-radius: 999px;
  }

  .stl-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    color: #334155;
    background: transparent;
  }

  .stl-table thead th {
    background: rgba(226, 232, 240, 0.7);
    color: #0f172a;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 14px 18px;
    text-align: left;
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    position: sticky;
    top: 0;
    z-index: 1;
    backdrop-filter: blur(14px);
  }

  .stl-table td {
    padding: 16px 18px;
    border-top: 1px solid rgba(148, 163, 184, 0.14);
    vertical-align: middle;
    background: transparent;
  }

  .stl-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.46);
  }

  .stl-table tbody tr {
    background: transparent;
  }

  .text-right {
    text-align: right;
  }

  .stl-table th.action-col,
  .stl-table td.action-col {
    width: 190px;
    min-width: 190px;
    max-width: 190px;
    text-align: center;
    white-space: nowrap;
    padding-left: 18px;
    padding-right: 18px;
  }

  .stl-table th.status-col,
  .stl-table td.status-col {
    width: 124px;
    min-width: 124px;
    max-width: 124px;
  }

  .stl-override-table th:nth-child(5),
  .stl-override-table td:nth-child(5) {
    min-width: 140px;
  }

  .stl-override-table td {
    padding-top: 14px;
    padding-bottom: 14px;
  }

  .override-primary-text {
    color: #0f172a;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
  }

  .override-mono-text {
    color: #64748b;
    font-size: 13px;
    font-weight: 600;
    font-family: 'DM Mono', monospace;
    line-height: 1.2;
  }

  .font-semibold {
    font-weight: 700;
  }

  .log-date-cell,
  .time-cell {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .log-date-cell {
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 12px;
  }

  .log-date-day {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.08);
    border: 1px solid rgba(37, 99, 235, 0.16);
    color: #1d4ed8;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .log-date-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .log-date-main,
  .time-main {
    color: #0f172a;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
  }

  .log-date-sub,
  .time-sub {
    color: #64748b;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .hours-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 56px;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(59, 130, 246, 0.18);
    color: #1d4ed8;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.01em;
  }

  .btn-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 98px;
    border: 1px solid rgba(239, 68, 68, 0.34);
    background: linear-gradient(180deg, rgba(127, 29, 29, 0.12), rgba(239, 68, 68, 0.1));
    color: #c62828;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    margin: 0 auto;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 23, 0.62);
    backdrop-filter: blur(6px);
    display: grid;
    place-items: center;
    padding: 20px;
    z-index: 80;
  }

  .delete-modal {
    width: min(100%, 420px);
    border-radius: 18px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: linear-gradient(180deg, #1a2230 0%, #141b27 100%);
    box-shadow: 0 28px 60px rgba(2, 6, 23, 0.5);
    overflow: hidden;
  }

  .delete-modal-head {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: 12px;
    padding: 24px 24px 16px;
  }

  .delete-modal-head h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #f8fafc;
  }

  .delete-modal-head p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: #94a3b8;
    max-width: 280px;
  }

  .delete-modal-icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: #fca5a5;
    background: rgba(127, 29, 29, 0.4);
    border: 1px solid rgba(248, 113, 113, 0.26);
  }

  .delete-modal-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    padding: 0 24px 24px;
  }

  .btn-delete-modal {
    min-width: 124px;
    margin: 0;
  }

  .btn-delete:hover:not(:disabled) {
    background: linear-gradient(180deg, rgba(185, 28, 28, 0.24), rgba(239, 68, 68, 0.18));
    border-color: rgba(248, 113, 113, 0.5);
    color: #991b1b;
  }

  .btn-delete:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .approve-modal,
  .reject-modal {
    width: min(100%, 520px);
    border-radius: 18px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: linear-gradient(180deg, #1a2230 0%, #141b27 100%);
    box-shadow: 0 28px 60px rgba(2, 6, 23, 0.5);
    overflow: hidden;
  }

  .approve-modal-head,
  .reject-modal-head {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: 12px;
    padding: 24px 24px 16px;
  }

  .approve-modal-head h3,
  .reject-modal-head h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #f8fafc;
  }

  .approve-modal-head p,
  .reject-modal-head p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: #94a3b8;
    max-width: 320px;
  }

  .approve-modal-icon,
  .reject-modal-icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .approve-modal-icon {
    color: #86efac;
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid rgba(134, 239, 172, 0.26);
  }

  .reject-modal-icon {
    color: #fca5a5;
    background: rgba(127, 29, 29, 0.4);
    border: 1px solid rgba(248, 113, 113, 0.26);
  }

  .approve-modal-details,
  .reject-modal-details {
    padding: 16px 24px;
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    background: rgba(15, 23, 42, 0.3);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 8px 0;
    font-size: 13px;
  }

  .detail-row:last-child {
    padding-bottom: 0;
  }

  .detail-label {
    color: #94a3b8;
    font-weight: 600;
  }

  .detail-value {
    color: #e2e8f0;
    font-weight: 500;
    text-align: right;
    flex: 1;
    line-height: 1.45;
  }

  .reject-modal-input {
    padding: 16px 24px;
  }

  .reject-reason-label {
    display: block;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #cbd5e1;
  }

  .reject-reason-textarea {
    width: 100%;
    min-height: 80px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.26);
    background: rgba(148, 163, 184, 0.08);
    color: #e2e8f0;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    transition: border-color 0.2s ease, background-color 0.2s ease;
  }

  .reject-reason-textarea:focus {
    outline: none;
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.08);
  }

  .reject-reason-textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .approve-modal-actions,
  .reject-modal-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    padding: 0 24px 24px;
  }

  .btn-approve-modal,
  .btn-reject-modal {
    min-width: 124px;
    margin: 0;
  }

  .btn-approve {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid rgba(34, 197, 94, 0.28);
    background: rgba(34, 197, 94, 0.12);
    color: #15803d;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .btn-approve:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.18);
    border-color: rgba(34, 197, 94, 0.4);
  }

  .btn-approve:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .btn-reject {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid rgba(239, 68, 68, 0.26);
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .btn-reject:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.16);
    border-color: rgba(239, 68, 68, 0.38);
  }

  .btn-reject:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .action-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: nowrap;
    justify-content: center;
    width: 100%;
  }

  .action-status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 96px;
    min-height: 34px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    color: #cbd5e1;
    background: rgba(148, 163, 184, 0.12);
    border: 1px solid rgba(148, 163, 184, 0.18);
    white-space: nowrap;
  }

  .status-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }

  .status-pending {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
    border: 1px solid rgba(234, 179, 8, 0.25);
  }

  .status-approved {
    background: rgba(34, 197, 94, 0.15);
    color: #86efac;
    border: 1px solid rgba(134, 239, 172, 0.25);
  }

  .status-rejected {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
    border: 1px solid rgba(248, 113, 113, 0.25);
  }

  .reason-cell {
    max-width: 300px;
  }

  .reason-text {
    display: block;
    font-size: 13px;
    color: #64748b;
    line-height: 1.4;
    word-break: break-word;
    white-space: normal;
  }

  .sk-shimmer {
    position: relative;
    overflow: hidden;
    background: #e2e8f0;
  }

  .sk-shimmer::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.62), transparent);
    animation: shimmer 1.35s ease-in-out infinite;
  }

  :global(.dark) .sk-shimmer::after {
    background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.25), transparent);
  }

  .sk-line,
  .sk-block,
  .sk-pill {
    display: block;
    flex-shrink: 0;
    border-radius: 999px;
  }

  .sk-block {
    border-radius: 10px;
  }

  .stat-card-skeleton {
    align-items: center;
  }

  .stat-label-sk {
    width: 92px;
    height: 11px;
  }

  .stat-value-sk {
    width: 124px;
    height: 26px;
  }

  .stat-sub-sk {
    width: 140px;
    height: 12px;
  }

  .selector-wrap-skeleton {
    pointer-events: none;
  }

  .selector-sk {
    width: calc(100% - 24px);
    height: 14px;
    margin-inline: 12px;
  }

  .btn-secondary-skeleton {
    pointer-events: none;
    min-width: 102px;
  }

  .button-sk {
    width: 56px;
    height: 14px;
  }

  .loading-chip-skeleton {
    min-width: 102px;
    justify-content: center;
  }

  .chip-sk {
    width: 74px;
    height: 12px;
  }

  .table-skeleton tbody tr:hover {
    background: transparent;
  }

  .cell-date-sk {
    width: 152px;
    height: 13px;
  }

  .cell-time-sk {
    width: 86px;
    height: 13px;
  }

  .cell-hours-sk {
    width: 56px;
    height: 34px;
    border-radius: 999px;
  }

  .action-pill-sk {
    width: 98px;
    height: 34px;
    margin: 0 auto;
    border-radius: 10px;
  }

  .loading-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    font-size: 13px;
    font-weight: 600;
  }

  .loading-empty {
    min-height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    background: #f8fafc;
    color: #475569;
    font-size: 14px;
    font-weight: 600;
  }

  .empty-state {
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    padding: 24px 16px;
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
    margin-top: 12px;
  }

  .empty-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    color: #64748b;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
  }

  .empty-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #0f172a;
  }

  .empty-sub {
    margin: 0;
    font-size: 13px;
    color: #64748b;
  }

  .stl-attendance-print-root {
    position: fixed;
    left: -99999px;
    top: 0;
    width: 194mm;
    z-index: -1;
    pointer-events: none;
  }

  .stl-attendance-sheet {
    width: 194mm;
    background: #ffffff;
    color: #000000;
    padding: 10mm 8mm 8mm;
    font-family: 'Times New Roman', Georgia, serif;
    box-sizing: border-box;
  }

  .stl-attendance-head {
    text-align: center;
    margin-bottom: 8mm;
    color: #000000;
  }

  .stl-attendance-head h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: 0.02em;
    font-weight: 700;
    color: #000000;
  }

  .stl-attendance-head h2 {
    margin: 6px 0 0;
    font-size: 18px;
    font-weight: 700;
    color: #000000;
  }

  .stl-attendance-meta {
    display: grid;
    gap: 6px;
    margin-bottom: 8mm;
    color: #000000;
    font-size: 14px;
  }

  .stl-attendance-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stl-attendance-meta-label {
    min-width: 160px;
    font-weight: 700;
    color: #000000;
  }

  .stl-attendance-meta-value {
    flex: 1;
    min-height: 22px;
    border-bottom: 1px solid #000000;
    display: inline-flex;
    align-items: flex-end;
    padding-bottom: 2px;
    color: #000000;
  }

  .stl-attendance-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    color: #000000;
    font-size: 12px;
  }

  .stl-attendance-table th,
  .stl-attendance-table td {
    border: 1px solid #000000;
    padding: 6px 4px;
    text-align: center;
    color: #000000;
  }

  .stl-attendance-table th {
    font-weight: 700;
    color: #000000;
  }

  .stl-attendance-table th:nth-child(1),
  .stl-attendance-table td:nth-child(1) { width: 10%; }
  .stl-attendance-table th:nth-child(2),
  .stl-attendance-table td:nth-child(2) { width: 18%; }
  .stl-attendance-table th:nth-child(3),
  .stl-attendance-table td:nth-child(3) { width: 18%; }
  .stl-attendance-table th:nth-child(4),
  .stl-attendance-table td:nth-child(4) { width: 18%; }
  .stl-attendance-table th:nth-child(5),
  .stl-attendance-table td:nth-child(5) { width: 18%; }
  .stl-attendance-table th:nth-child(6),
  .stl-attendance-table td:nth-child(6) { width: 18%; }

  .spinning-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    animation: spin 1s linear infinite;
  }

  @keyframes shimmer {
    100% { transform: translateX(100%); }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  :global(.dark) .warning-alert {
    background: #fef3c7;
    border-color: #fcd34d;
    color: #92400e;
  }

  :global(.dark) .stl-card {
    border-color: rgba(255, 255, 255, 0.08);
    background: linear-gradient(180deg, #1d2a3a 0%, #161c27 100%);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  :global(.dark) .stl-table-header,
  :global(html.dark) .stl-table-header,
  :global(body.dark) .stl-table-header {
    border-bottom-color: rgba(148, 163, 184, 0.2);
  }

  :global(.dark) .stl-card-success {
    border-color: rgba(16, 185, 129, 0.3);
    background: rgba(16, 185, 129, 0.12);
  }

  :global(.dark) .stl-schedule-item {
    border-color: rgba(148, 163, 184, 0.2);
    background: linear-gradient(180deg, rgba(24, 34, 52, 0.92), rgba(20, 28, 42, 0.82));
  }

  :global(.dark) .stl-schedule-label {
    color: #8da2c0;
  }

  :global(.dark) .stl-schedule-value {
    color: #f1f5f9;
  }

  :global(.dark) .section-title,
  :global(.dark) .stat-value,
  :global(.dark) .empty-title {
    color: #f1f5f9;
  }

  :global(.dark) .override-primary-text,
  :global(html.dark) .override-primary-text,
  :global(body.dark) .override-primary-text {
    color: #f8fafc;
  }

  :global(.dark) .override-mono-text,
  :global(html.dark) .override-mono-text,
  :global(body.dark) .override-mono-text {
    color: #a5b4cf;
  }

  :global(.dark) .reason-text,
  :global(html.dark) .reason-text,
  :global(body.dark) .reason-text {
    color: #cbd5e1;
  }

  :global(.dark) .stl-table-title,
  :global(html.dark) .stl-table-title,
  :global(body.dark) .stl-table-title {
    color: #f1f5f9;
  }

  :global(.dark) .section-sub,
  :global(.dark) .stat-label,
  :global(.dark) .stat-sub,
  :global(.dark) .empty-sub {
    color: #94a3b8;
  }

  :global(.dark) .session-name {
    color: #d1fae5;
  }

  :global(.dark) .session-sub,
  :global(.dark) .session-left {
    color: #a7f3d0;
  }

  :global(.dark) .session-item {
    border-color: rgba(16, 185, 129, 0.25);
    background: rgba(16, 185, 129, 0.08);
  }

  :global(.dark) .sk-shimmer,
  :global(html.dark) .sk-shimmer,
  :global(body.dark) .sk-shimmer {
    background: rgba(71, 85, 105, 0.5);
  }

  :global(.dark) .sk-shimmer::after,
  :global(html.dark) .sk-shimmer::after,
  :global(body.dark) .sk-shimmer::after {
    background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.2), transparent);
  }

  :global(.dark) .stl-input,
  :global(html.dark) .stl-input,
  :global(body.dark) .stl-input,
  :global(.dark) .btn-secondary,
  :global(html.dark) .btn-secondary,
  :global(body.dark) .btn-secondary,
  :global(.dark) .btn-secondary-skeleton,
  :global(html.dark) .btn-secondary-skeleton,
  :global(body.dark) .btn-secondary-skeleton {
    background: #182234;
    border-color: rgba(148, 163, 184, 0.24);
    color: #e2e8f0;
  }

  :global(.dark) .selector-wrap-intern {
    background: linear-gradient(180deg, rgba(24, 34, 52, 0.98), rgba(20, 28, 42, 0.96));
    border-color: rgba(148, 163, 184, 0.24);
    box-shadow: 0 12px 28px rgba(2, 6, 23, 0.22);
  }

  :global(.dark) .selector-icon,
  :global(.dark) .selector-caret {
    color: #8da2c0;
  }

  :global(.dark) .stl-entry-count,
  :global(html.dark) .stl-entry-count,
  :global(body.dark) .stl-entry-count,
  :global(.dark) .loading-chip,
  :global(html.dark) .loading-chip,
  :global(body.dark) .loading-chip,
  :global(.dark) .stl-export-month,
  :global(html.dark) .stl-export-month,
  :global(body.dark) .stl-export-month {
    color: #94a3b8;
  }

  :global(.dark) .stl-entry-count {
    color: #94a3b8;
  }

  :global(.dark) .loading-chip,
  :global(html.dark) .loading-chip,
  :global(body.dark) .loading-chip {
    background: #182234;
    border-color: rgba(148, 163, 184, 0.24);
    color: #e2e8f0;
  }

  :global(.dark) .stl-history-filters,
  :global(html.dark) .stl-history-filters,
  :global(body.dark) .stl-history-filters {
    background: #182234;
    border-bottom-color: rgba(148, 163, 184, 0.2);
  }

  :global(.dark) .stl-filter-tab,
  :global(html.dark) .stl-filter-tab,
  :global(body.dark) .stl-filter-tab {
    color: #94a3b8;
  }

  :global(.dark) .stl-filter-tab:hover:not(.stl-filter-active),
  :global(html.dark) .stl-filter-tab:hover:not(.stl-filter-active),
  :global(body.dark) .stl-filter-tab:hover:not(.stl-filter-active) {
    color: #f1f5f9;
  }

  :global(.dark) .stl-filter-active,
  :global(html.dark) .stl-filter-active,
  :global(body.dark) .stl-filter-active {
    color: #60a5fa;
    border-bottom-color: #60a5fa;
  }

  :global(.dark) .stl-export-month input,
  :global(.dark) .stl-export-btn {
    background: #182234;
    border-color: rgba(148, 163, 184, 0.24);
    color: #e2e8f0;
  }

  :global(.dark) .stl-export-month input {
    color-scheme: dark;
  }

  :global(.dark) .stl-export-btn:hover:not(:disabled) {
    background: #22314a;
    border-color: rgba(96, 165, 250, 0.5);
  }

  :global(.dark) .btn-approve,
  :global(html.dark) .btn-approve,
  :global(body.dark) .btn-approve {
    border-color: rgba(134, 239, 172, 0.3);
    background: rgba(34, 197, 94, 0.18);
    color: #86efac;
  }

  :global(.dark) .btn-approve:hover:not(:disabled),
  :global(html.dark) .btn-approve:hover:not(:disabled),
  :global(body.dark) .btn-approve:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.28);
    border-color: rgba(134, 239, 172, 0.5);
  }

  :global(.dark) .btn-reject,
  :global(html.dark) .btn-reject,
  :global(body.dark) .btn-reject {
    border-color: rgba(248, 113, 113, 0.3);
    background: rgba(239, 68, 68, 0.18);
    color: #fca5a5;
  }

  :global(.dark) .btn-reject:hover:not(:disabled),
  :global(html.dark) .btn-reject:hover:not(:disabled),
  :global(body.dark) .btn-reject:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.28);
    border-color: rgba(248, 113, 113, 0.5);
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: #22314a;
    border-color: rgba(96, 165, 250, 0.5);
  }

  :global(.dark) .table-scroll-y,
  :global(html.dark) .table-scroll-y,
  :global(body.dark) .table-scroll-y {
    border-color: rgba(255, 255, 255, 0.1);
  }

  :global(.dark) .table-wrap,
  :global(html.dark) .table-wrap,
  :global(body.dark) .table-wrap {
    border-color: rgba(255, 255, 255, 0.1);
    background:
      linear-gradient(180deg, rgba(24, 34, 52, 0.98), rgba(20, 28, 42, 0.96));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  :global(.dark) .stl-table,
  :global(html.dark) .stl-table,
  :global(body.dark) .stl-table {
    color: #e2e8f0;
    background: transparent;
  }

  :global(.dark) .stl-table thead th,
  :global(html.dark) .stl-table thead th,
  :global(body.dark) .stl-table thead th {
    background: linear-gradient(180deg, rgba(30, 48, 72, 0.95), rgba(25, 40, 62, 0.88));
    color: #f8fafc;
    border-bottom-color: rgba(148, 163, 184, 0.22);
    font-weight: 700;
  }

  :global(.dark) .stl-table td,
  :global(html.dark) .stl-table td,
  :global(body.dark) .stl-table td {
    border-top-color: rgba(148, 163, 184, 0.12);
    color: #cbd5e1;
    background: transparent;
  }

  :global(.dark) .stl-table tbody tr,
  :global(html.dark) .stl-table tbody tr,
  :global(body.dark) .stl-table tbody tr {
    background: transparent;
  }

  :global(.dark) .stl-table tbody tr:hover,
  :global(html.dark) .stl-table tbody tr:hover,
  :global(body.dark) .stl-table tbody tr:hover {
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.06), rgba(37, 99, 235, 0.04));
  }

  :global(.dark) .log-date-day {
    background: rgba(59, 130, 246, 0.14);
    border-color: rgba(96, 165, 250, 0.22);
    color: #93c5fd;
  }

  .hours-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    height: 34px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.12);
    border: 1px solid rgba(59, 130, 246, 0.2);
    color: #1d4ed8;
    font-size: 13px;
    font-weight: 700;
    transition: all 0.2s ease;
  }

  :global(.dark) .hours-badge {
    background: rgba(59, 130, 246, 0.18);
    border-color: rgba(96, 165, 250, 0.28);
    color: #a5f3fc;
  }

  :global(.dark) .btn-delete,
  :global(html.dark) .btn-delete,
  :global(body.dark) .btn-delete {
    border-color: rgba(248, 113, 113, 0.42);
    background: linear-gradient(180deg, rgba(127, 29, 29, 0.34), rgba(153, 27, 27, 0.22));
    color: #fca5a5;
    box-shadow: inset 0 1px 0 rgba(254, 202, 202, 0.04);
  }

  :global(.dark) .btn-delete:hover:not(:disabled),
  :global(html.dark) .btn-delete:hover:not(:disabled),
  :global(body.dark) .btn-delete:hover:not(:disabled) {
    border-color: rgba(252, 165, 165, 0.56);
    background: linear-gradient(180deg, rgba(185, 28, 28, 0.5), rgba(220, 38, 38, 0.3));
    color: #fee2e2;
  }

  :global(.dark) .log-date-main,
  :global(.dark) .time-main {
    color: #f8fafc;
  }

  :global(.dark) .log-date-sub,
  :global(.dark) .time-sub {
    color: #8da2c0;
  }

  :global(.dark) .empty-state {
    border-color: rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.35);
  }

  :global(.dark) .empty-icon {
    background: rgba(15, 23, 42, 0.6);
    border-color: rgba(148, 163, 184, 0.25);
    color: #94a3b8;
  }

  :global(.dark) .delete-modal,
  :global(html.dark) .delete-modal,
  :global(body.dark) .delete-modal {
    background: linear-gradient(180deg, #1a2230 0%, #141b27 100%);
    border-color: rgba(148, 163, 184, 0.24);
  }

  @media (max-width: 1200px) {
    .stats-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 900px) {
    .stl-schedule-content {
      grid-template-columns: 1fr;
    }

    .control-head {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }

    .control-actions {
      width: 100%;
    }

    .stl-table-tools {
      width: 100%;
      justify-content: flex-start;
    }
  }

  @media (max-width: 640px) {
    .stl-shell {
      gap: 16px;
    }

    .stats-grid {
      grid-template-columns: 1fr;
    }

    .stl-card {
      padding-left: 14px;
      padding-right: 14px;
    }

    .table-scroll-y {
      margin-top: 10px;
      max-height: 460px;
      background:
        linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.88));
      border: 1px solid rgba(148, 163, 184, 0.18);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
      scrollbar-width: auto;
      scrollbar-color: rgba(59, 130, 246, 0.55) transparent;
    }

    :global(.dark) .table-scroll-y {
      background:
        linear-gradient(180deg, rgba(24, 34, 52, 0.98), rgba(20, 28, 42, 0.96));
      border: 1px solid rgba(148, 163, 184, 0.14);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    .control-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .stl-table-header {
      padding-left: 14px;
      padding-right: 14px;
    }

    .stl-table {
      min-width: 620px !important;
    }

    .stl-table thead {
      display: table-header-group;
    }

    .stl-table tbody {
      display: table-row-group;
    }

    .stl-table tr {
      display: table-row;
    }

    .stl-table td,
    .stl-table th {
      display: table-cell;
      box-sizing: border-box;
    }

    .stl-table td::before {
      content: none;
    }

    .log-date-cell {
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 10px;
    }

    .log-date-day {
      min-width: 42px;
      padding: 0 8px;
      font-size: 10px;
    }

    .time-cell,
    .log-date-copy {
      gap: 3px;
    }

    .log-date-main,
    .time-main {
      font-size: 13px;
    }

    .log-date-sub,
    .time-sub {
      font-size: 10px;
    }

    .stl-table thead th,
    .stl-table td {
      padding: 14px 16px;
    }

    .stl-table thead th {
      font-size: 11px;
    }

    .stl-table th.action-col,
    .stl-table td.action-col {
      width: 148px;
      min-width: 148px;
      max-width: 148px;
      padding-left: 12px;
      padding-right: 12px;
    }

    .btn-delete {
      min-width: 92px;
      padding: 8px 8px;
      font-size: 11px;
    }

    .stl-entry-count {
      width: 100%;
    }

    .stl-export-month {
      width: 100%;
      justify-content: space-between;
    }

    .stl-export-month input,
    .stl-export-btn {
      width: 100%;
    }

    .table-scroll-y::-webkit-scrollbar:vertical {
      width: 0;
    }

    .table-scroll-y::-webkit-scrollbar:horizontal {
      height: 10px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
  }
</style>
