<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    AlertCircle,
    Calendar,
    CheckCircle2,
    ClipboardList,
    Clock,
    Coffee,
    Plus,
    Target,
    Trash2,
    Loader2
  } from 'lucide-svelte';
  import * as authApi from '../lib/auth.js';
  import { getEstimatedCompletionDate } from '../lib/getEstimatedCompletionDate.js';

  const DEFAULT_REQUIRED_HOURS = 500;
  const AVERAGE_DAILY_HOURS = 8;
  const INITIAL_COMPLETED_HOURS = 0;
  const ACTIVE_SESSION_STORAGE_PREFIX = 'ims-active-time-session';
  const DEFAULT_TIME_IN = '09:00';
  const DEFAULT_TIME_OUT = '17:00';
  const HTML2PDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  
  // ---- Skeleton loading flag ----
  let isLoading = true;

  let requiredHours = DEFAULT_REQUIRED_HOURS;
  let ojtStartDate = '';
  let approvedAbsenceAdjustmentDays = 0;

  const statusMeta = {
    recorded: {
      label: 'Recorded',
      badgeClass: 'status-badge status-recorded',
      icon: CheckCircle2,
    },
  };

  let entries = [];
  let date = '';
  let timeIn = DEFAULT_TIME_IN;
  let timeOut = DEFAULT_TIME_OUT;
  let logSyncError = '';
  
  let isLoggingIn = false;
  let isLoggingOut = false;
  let isLoggedIn = false;
  let isDeletingEntry = false;
  let isExportingAttendance = false;
  let exportMonth = '';
  let attendanceSheetRef = null;

  // Intern's custom schedule from supervisor assignment
  let internSchedule = {
    shift_start: DEFAULT_TIME_IN,     // Default fallback
    shift_end: DEFAULT_TIME_OUT,      // Default fallback
    days_off: [0, 6],         // Default: Sunday (0) and Saturday (6)
  };
  
  let includeLunch = (() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('ojt_include_lunch') === 'true';
    }
    return false;
  })();
  
  let showDeleteConfirm = false;
  let deleteConfirmEntry = null;
  let unsubscribeAuth = null;
  let queuedAuthRefresh = false;
  let html2pdfLoaderPromise = null;

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

  function getActiveSessionStorageKey(userId) {
    const normalizedUserId = String(userId || '').trim();
    return normalizedUserId ? `${ACTIVE_SESSION_STORAGE_PREFIX}:${normalizedUserId}` : '';
  }

  function saveLocalActiveSession(userId, sessionDate, sessionTimeIn) {
    if (typeof window === 'undefined') return;
    const storageKey = getActiveSessionStorageKey(userId);
    if (!storageKey) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        log_date: normalizeDateOnly(sessionDate),
        time_in: normalizeTimeValue(sessionTimeIn, timeIn || DEFAULT_TIME_IN),
      }),
    );
  }

  function clearLocalActiveSession(userId) {
    if (typeof window === 'undefined') return;
    const storageKey = getActiveSessionStorageKey(userId);
    if (storageKey) window.localStorage.removeItem(storageKey);
  }

  function restoreLocalActiveSession(userId) {
    if (typeof window === 'undefined') return false;
    const storageKey = getActiveSessionStorageKey(userId);
    if (!storageKey) return false;
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (!stored || typeof stored !== 'object') return false;
      const storedDate = normalizeDateOnly(stored.log_date);
      const storedTimeIn = normalizeTimeValue(stored.time_in, '');
      if (!storedDate || !storedTimeIn) return false;
      date = storedDate;
      timeIn = storedTimeIn;
      timeOut = DEFAULT_TIME_OUT;
      isLoggedIn = true;
      return true;
    } catch {
      clearLocalActiveSession(userId);
      return false;
    }
  }

  function normalizeDaysOff(value) {
    if (Array.isArray(value) && value.length) return value;
    return [0, 6];
  }

  function timeToMinutes(value) {
    const normalized = normalizeTimeValue(value, '');
    if (!normalized) return null;
    const [hours, minutes] = normalized.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  }

  function addWorkingDays(startDate, days, daysOff = [0, 6]) {
    const result = new Date(startDate);
    const daysOffSet = new Set(normalizeDaysOff(daysOff));
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      if (!daysOffSet.has(day)) added += 1;
    }
    return result;
  }

  function addWorkingDaysToDateString(dateInput, workingDaysToAdd, daysOff = [0, 6]) {
    const base = parseIsoDateOnly(dateInput);
    if (!base) return '';
    const extra = Math.max(0, Math.floor(Number(workingDaysToAdd) || 0));
    const projected = addWorkingDays(base, extra, daysOff);
    return projected ? normalizeDateOnly(projected) : '';
  }

  function getTodayDateOnly() {
    return normalizeDateOnly(new Date());
  }

  function syncDateToToday() {
    date = getTodayDateOnly();
  }

  function countApprovedAbsenceAdjustments(requests, todayDateOnly) {
    const rows = Array.isArray(requests) ? requests : [];
    const seen = new Set();
    return rows.reduce((count, request) => {
      const requestId = String(request?.id || request?.request_id || '').trim();
      if (requestId && seen.has(requestId)) return count;
      const requestType = String(request?.requestType || request?.request_type || '').trim().toLowerCase();
      const requestStatus = String(request?.status || '').trim().toLowerCase();
      const archivedPrevious = String(request?.archived_previous_status || request?.archivedPreviousStatus || '').trim().toLowerCase();
      const approved = requestStatus === 'approved' || (requestStatus === 'archived' && archivedPrevious === 'approved');
      if (requestType !== 'absence' || !approved) return count;
      const requestDate = normalizeDateOnly(request?.date || request?.request_date || request?.applied_date || '');
      if (!requestDate || (todayDateOnly && requestDate < todayDateOnly)) return count;
      if (requestId) seen.add(requestId);
      return count + 1;
    }, 0);
  }

  function calculateHours(currentTimeIn, currentTimeOut, withLunch = includeLunch) {
    if (!currentTimeIn || !currentTimeOut) return 0;
    const [inHours, inMinutes] = currentTimeIn.split(':').map(Number);
    const [outHours, outMinutes] = currentTimeOut.split(':').map(Number);
    const diffMinutes = outHours * 60 + outMinutes - (inHours * 60 + inMinutes);
    const rawHours = Math.max(0, Math.round((diffMinutes / 60) * 10) / 10);
    if (!withLunch && rawHours > 1) {
      return Math.max(0, Math.round((rawHours - 1) * 10) / 10);
    }
    return rawHours;
  }

  function handleLunchToggle() {
    includeLunch = !includeLunch;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ojt_include_lunch', String(includeLunch));
    }
  }

  function formatDate(value, options) {
    return new Intl.DateTimeFormat('en-US', options).format(new Date(value));
  }

  function formatShortDate(value) {
    return formatDate(value, { month: 'short', day: 'numeric' });
  }

  function formatLongDate(value) {
    return formatDate(value, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatTableDate(value) {
    return formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatHours(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return num.toFixed(1).replace(/\.0$/, '');
  }

  function formatAttendanceHours(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Number(num.toFixed(2)).toString();
  }

  function formatAttendanceDate(value) {
    const dateObj = parseIsoDateOnly(value);
    if (!dateObj) return '';
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const year = String(dateObj.getFullYear()).slice(-2);
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

  function toSafeFilenameSegment(value, fallback = 'Intern') {
    const raw = String(value || '').trim();
    const sanitized = raw.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return sanitized || fallback;
  }

  function getMonthInputFromDate(value) {
    const normalized = normalizeDateOnly(value);
    if (!normalized) return '';
    return normalized.slice(0, 7);
  }

  function getCurrentMonthInput() {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    return `${today.getFullYear()}-${month}`;
  }

  function parseIsoDateOnly(value) {
    const normalized = normalizeDateOnly(value);
    if (!normalized) return null;
    const [y, m, d] = normalized.split('-').map((n) => Number(n));
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  }

  function parseDateLoose(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function normalizeDateOnly(value) {
    function toLocalIsoDate(dateObj) {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const isoWithTimeMatch = text.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (isoWithTimeMatch) return isoWithTimeMatch[1];
    const serial = Number(value);
    if (Number.isFinite(serial) && serial > 1) {
      const millis = Math.round((serial - 25569) * 86400000);
      const serialDate = new Date(millis);
      if (!Number.isNaN(serialDate.getTime())) return toLocalIsoDate(serialDate);
    }
    const dateObj = new Date(text);
    if (Number.isNaN(dateObj.getTime())) return '';
    return toLocalIsoDate(dateObj);
  }

  function isApprovedAbsenceLoginError_(message) {
    const text = String(message || '').trim().toLowerCase();
    if (!text) return false;
    return text.includes('absence request') || text.includes('login is not allowed');
  }

  function isInlineLoginError(message) {
    const text = String(message || '').trim().toLowerCase();
    if (!text) return false;
    return (
      text.includes('login') ||
      text.includes('log in') ||
      text.includes('duplicate') ||
      text.includes('day off') ||
      text.includes('schedule') ||
      text.includes('active session') ||
      text.includes('please select a date and enter your login time')
    );
  }

  function normalizeTimeValue(value, fallback) {
    const to24HourString = (hours, minutes) => `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
    if (!text) return fallback;
    const isoTime = text.match(/T(\d{2}):(\d{2})/);
    if (isoTime) return `${isoTime[1]}:${isoTime[2]}`;
    const amPmTime = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
    if (amPmTime) {
      let hours = Number(amPmTime[1]);
      const minutes = Number(amPmTime[2]);
      const marker = String(amPmTime[3] || '').toUpperCase();
      if (marker === 'PM' && hours < 12) hours += 12;
      if (marker === 'AM' && hours === 12) hours = 0;
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

  function mapApiLogToEntry(row) {
    const sessionId = String(row?.session_id || '').trim();
    const timelogId = String(row?.timelog_id || '').trim();
    return {
      id: timelogId || sessionId || `${normalizeDateOnly(row?.log_date)}-${normalizeTimeValue(row?.time_in, '')}`,
      sessionId,
      timelogId,
      date: normalizeDateOnly(row?.log_date),
      timeIn: normalizeTimeValue(row?.time_in, DEFAULT_TIME_IN),
      timeOut: normalizeTimeValue(row?.time_out, DEFAULT_TIME_OUT),
      hours: Number(row?.hours_rendered || 0),
      status: 'recorded',
      type: String(row?.entry_type || 'login').toLowerCase(),
      notes: String(row?.notes || ''),
      createdAt: String(row?.created_at || ''),
    };
  }

  async function loadEntriesFromApi() {
    const user = authApi.getCurrentUser();
    if (!user?.user_id) {
      entries = [];
      return;
    }
    try {
      const logs = await authApi.listTimeLogsByUser(user.user_id);
      entries = logs
        .map(mapApiLogToEntry)
        .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
      logSyncError = '';
    } catch (err) {
      logSyncError = err?.message || 'Unable to load time logs right now.';
    }
  }

  async function hasApprovedAbsenceRequestForDate_(userId, targetDate) {
    const normalizedUserId = String(userId || '').trim();
    const rawTargetDate = String(targetDate || '').trim();
    if (!normalizedUserId || !rawTargetDate) return false;
    const normalizedDate = normalizeDateOnly(rawTargetDate);

    try {
      const response = await authApi.callApiAction('list_requests_by_user', { user_id: normalizedUserId });
      const requests = Array.isArray(response?.requests) ? response.requests : [];
      return requests.some((request) => {
        const requestType = String(request?.requestType || request?.request_type || '').trim().toLowerCase();
        const requestStatus = String(request?.status || '').trim().toLowerCase();
        const rawRequestDate = String(request?.date || request?.request_date || '').trim();
        if (!rawRequestDate) return false;
        const requestDate = normalizeDateOnly(rawRequestDate);
        return requestType === 'absence' && requestStatus === 'approved' && requestDate === normalizedDate;
      });
    } catch (err) {
      console.error('Error checking approved absence requests:', err);
      return false;
    }
  }

  async function hasApprovedOvertimeRequestForDateAndTime_(userId, targetDate, timeValue) {
    const normalizedUserId = String(userId || '').trim();
    const rawTargetDate = String(targetDate || '').trim();
    if (!normalizedUserId || !rawTargetDate) return false;
    const normalizedDate = normalizeDateOnly(rawTargetDate);
    const timeMinutes = timeToMinutes(timeValue);
    if (timeMinutes === null) return false;

    try {
      const response = await authApi.callApiAction('list_requests_by_user', { user_id: normalizedUserId });
      const requests = Array.isArray(response?.requests) ? response.requests : [];
      return requests.some((request) => {
        const requestType = String(request?.requestType || request?.request_type || '').trim().toLowerCase();
        const requestStatus = String(request?.status || '').trim().toLowerCase();
        const rawRequestDate = String(request?.date || request?.request_date || '').trim();
        const startTime = String(request?.start_time || request?.startTime || '').trim();
        const endTime = String(request?.end_time || request?.endTime || '').trim();
        if (requestType !== 'overtime' || requestStatus !== 'approved') return false;
        if (!rawRequestDate) return false;
        const requestDate = normalizeDateOnly(rawRequestDate);
        if (requestDate !== normalizedDate) return false;
        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);
        if (startMinutes === null || endMinutes === null) return false;
        return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
      });
    } catch (err) {
      console.error('Error checking approved overtime requests:', err);
      return false;
    }
  }

  function isDayOffForDate_(dateValue, daysOff) {
    const normalized = normalizeDateOnly(dateValue);
    if (!normalized) return false;
    const dateObj = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(dateObj.getTime())) return false;
    const daysOffSet = new Set(normalizeDaysOff(daysOff));
    return daysOffSet.has(dateObj.getDay());
  }

  function isTimeWithinSchedule_(timeValue, shiftStart, shiftEnd) {
    const timeMinutes = timeToMinutes(timeValue);
    const startMinutes = timeToMinutes(shiftStart);
    const endMinutes = timeToMinutes(shiftEnd);
    if (timeMinutes === null || startMinutes === null || endMinutes === null) return false;
    return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
  }

  function hasDuplicateLoggedEntry(dateValue, timeValue) {
    const normalizedDate = normalizeDateOnly(dateValue);
    const normalizedTime = normalizeTimeValue(timeValue, '');
    if (!normalizedDate || !normalizedTime) return false;
    return entries.some((entry) => (
      normalizeDateOnly(entry?.date || '') === normalizedDate &&
      normalizeTimeValue(entry?.timeIn || '', '') === normalizedTime
    ));
  }

  function syncRequiredHoursFromAccount() {
    const user = authApi.getCurrentUser();
    const studentHours = Number(user?.ojt?.total_ojt_hours || 0);
    const rawStartDate = user?.ojt?.start_date || user?.first_login_date || '';
    ojtStartDate = normalizeDateOnly(rawStartDate);
    if (user?.role === 'Student' && Number.isFinite(studentHours) && studentHours > 0) {
      requiredHours = studentHours;
    } else {
      requiredHours = DEFAULT_REQUIRED_HOURS;
    }
  }

  async function handleLogin() {
    syncDateToToday();
    if (!date || !timeIn) {
      logSyncError = 'Please select a date and enter your login time.';
      return;
    }
    isLoggingIn = true;
    logSyncError = '';
    const user = authApi.getCurrentUser();
    if (!user?.user_id) {
      logSyncError = 'Please log in to your account first.';
      isLoggingIn = false;
      return;
    }
    
    const finalTimeIn = timeIn;
    
    try {
      const isBlockedByApprovedAbsence = await hasApprovedAbsenceRequestForDate_(user.user_id, date);
      if (isBlockedByApprovedAbsence) {
        logSyncError = `Login is not allowed on ${formatLongDate(date)} because your absence request for this date is approved.`;
        isLoggedIn = false;
        isLoggingIn = false;
        return;
      }

      const isDayOff = isDayOffForDate_(date, internSchedule.days_off);
      const isWithinSchedule = isTimeWithinSchedule_(finalTimeIn, internSchedule.shift_start, internSchedule.shift_end);
      if (isDayOff || !isWithinSchedule) {
        const hasApprovedOvertime = await hasApprovedOvertimeRequestForDateAndTime_(user.user_id, date, finalTimeIn);
        if (!hasApprovedOvertime) {
          if (isDayOff) {
            logSyncError = `Login is not allowed on ${formatLongDate(date)} because it is your day off. Submit an approved OT request to log in.`;
          } else {
            logSyncError = `Login time must be within your schedule (${internSchedule.shift_start} - ${internSchedule.shift_end}). Submit an approved OT request to log in outside your schedule.`;
          }
          isLoggedIn = false;
          isLoggingIn = false;
          return;
        }
      }

      if (hasDuplicateLoggedEntry(date, finalTimeIn)) {
        logSyncError = `Duplicate login is not allowed. A time log for ${formatLongDate(date)} at ${formatAttendanceTime(finalTimeIn)} already exists.`;
        isLoggedIn = false;
        isLoggingIn = false;
        return;
      }

      const response = await authApi.callApiAction('start_session', {
        user_id: user.user_id,
        log_date: date,
        time_in: finalTimeIn,
      });
      if (response && response.ok === true) {
        isLoggedIn = true;
        timeOut = DEFAULT_TIME_OUT;
        saveLocalActiveSession(user.user_id, response.session?.log_date || date, response.session?.time_in || finalTimeIn);
        logSyncError = '';
      } else {
        logSyncError = response?.error || 'Failed to start session';
        if (String(logSyncError || '').toLowerCase().includes('active session')) {
          await checkForActiveSession();
          if (isLoggedIn) logSyncError = '';
        } else {
          isLoggedIn = false;
        }
      }
      isLoggingIn = false;
    } catch (err) {
      logSyncError = err?.message || 'Unable to process login.';
      isLoggedIn = false;
      isLoggingIn = false;
    }
  }

  async function handleLogout() {
    if (!timeOut) {
      logSyncError = 'Please enter your logout time.';
      return;
    }
    if (!timeIn) {
      logSyncError = 'Please enter your login time first.';
      return;
    }
    isLoggingOut = true;
    logSyncError = '';
    const user = authApi.getCurrentUser();
    if (!user?.user_id) {
      logSyncError = 'Please log in again before logging out.';
      isLoggingOut = false;
      return;
    }
    const hours = calculateHours(timeIn, timeOut, includeLunch);
    try {
      const response = await authApi.callApiAction('end_session', {
        user_id: user.user_id,
        log_date: date,
        time_out: timeOut,
        hours_rendered: hours,
      });
      if (response && response.ok === true) {
        logSyncError = '';
        isLoggedIn = false;
        timeOut = DEFAULT_TIME_OUT;
        clearLocalActiveSession(user.user_id);
        await loadEntriesFromApi();
      } else {
        logSyncError = response?.error || 'Unable to complete session.';
      }
      isLoggingOut = false;
    } catch (err) {
      logSyncError = err?.message || 'Unable to log out right now.';
      isLoggingOut = false;
    }
  }

  async function handleDelete(id) {
    const entry = entries.find((e) => String(e.id) === String(id));
    if (!entry) return;
    deleteConfirmEntry = entry;
    showDeleteConfirm = true;
  }

  async function confirmDelete() {
    if (!deleteConfirmEntry) return;
    if (isDeletingEntry) return;
    const user = authApi.getCurrentUser();
    if (!user?.user_id) {
      logSyncError = 'Please log in again before deleting a time log.';
      showDeleteConfirm = false;
      deleteConfirmEntry = null;
      return;
    }
    try {
      isDeletingEntry = true;
      await authApi.deleteTimeLog(user.user_id, deleteConfirmEntry.id, {
        session_id: deleteConfirmEntry.sessionId,
        log_date: deleteConfirmEntry.date,
        time_in: deleteConfirmEntry.timeIn,
        time_out: deleteConfirmEntry.timeOut,
      });
      entries = entries.filter((entry) => String(entry.id) !== String(deleteConfirmEntry.id));
      logSyncError = '';
    } catch (err) {
      logSyncError = err?.message || 'Unable to delete this time log right now.';
    } finally {
      isDeletingEntry = false;
      showDeleteConfirm = false;
      deleteConfirmEntry = null;
    }
  }

  function cancelDelete() {
    if (isDeletingEntry) return;
    showDeleteConfirm = false;
    deleteConfirmEntry = null;
  }

  async function checkForActiveSession() {
    const user = authApi.getCurrentUser();
    if (!user?.user_id) {
      isLoggedIn = false;
      return;
    }
    try {
      const response = await authApi.callApiAction('get_active_session', {
        user_id: user.user_id,
      });
      if (response && response.ok === true && response.session) {
        const sessionDate = normalizeDateOnly(response.session.log_date);
        if (sessionDate) date = sessionDate;
        timeIn = normalizeTimeValue(response.session.time_in, timeIn);
        timeOut = DEFAULT_TIME_OUT;
        isLoggedIn = true;
        saveLocalActiveSession(user.user_id, date, timeIn);
      } else {
        if (!restoreLocalActiveSession(user.user_id)) {
          isLoggedIn = false;
        }
      }
    } catch (err) {
      console.error('Error checking active session:', err);
      if (!restoreLocalActiveSession(user.user_id)) {
        isLoggedIn = false;
      }
    }
  }

  async function refreshTimeLogForCurrentUser() {
    syncDateToToday();
    const user = authApi.getCurrentUser();
    if (user?.user_id) restoreLocalActiveSession(user.user_id);
    syncRequiredHoursFromAccount();
    await loadApprovedAbsenceAdjustments();
    await loadEntriesFromApi();
    await checkForActiveSession();
    requestTlChartInit();
  }

  async function exportAttendanceSheetPdf() {
    if (isExportingAttendance) return;
    if (!attendanceEntriesForExport.length) {
      logSyncError = 'No completed entries found for the selected month.';
      return;
    }
    isExportingAttendance = true;
    logSyncError = '';
    try {
      const html2pdf = await ensureHtml2PdfLoaded();
      if (typeof html2pdf !== 'function') {
        throw new Error('html2pdf.js not available');
      }

      await tick();

      if (!attendanceSheetRef) {
        throw new Error('Attendance sheet preview is not available.');
      }

      const internPart = toSafeFilenameSegment(internFullName || 'Intern', 'Intern');
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
        logSyncError = message || 'Unable to export attendance sheet right now.';
      }
    } finally {
      isExportingAttendance = false;
    }
  }

  // ---- Chart logic (unchanged) ----
  let _chartJsPromise = null;
  function _loadChartJs() {
    if (_chartJsPromise) return _chartJsPromise;
    _chartJsPromise = new Promise((resolve, reject) => {
      if (typeof window !== 'undefined' && window.Chart) { resolve(window.Chart); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = () => resolve(window.Chart);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return _chartJsPromise;
  }

  let tlChart = null;
  let _chartInitRaf = null;
  let _chartRetryTimer = null;
  let _chartResizeObserver = null;
  
  function requestTlChartInit() {
    if (typeof window === 'undefined') return;
    if (_chartInitRaf) cancelAnimationFrame(_chartInitRaf);
    _chartInitRaf = requestAnimationFrame(() => {
      _chartInitRaf = null;
      initTlChart();
    });
  }

  function ensureChartResizeObserver() {
    if (typeof window === 'undefined') return;
    if (_chartResizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;
    const wrap = document.querySelector('.tl-chart-wrap');
    if (!wrap) return;
    _chartResizeObserver = new ResizeObserver(() => requestTlChartInit());
    _chartResizeObserver.observe(wrap);
  }

  function getTlColors() {
    const isDark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
    return {
      accent:        isDark ? '#3b82f6' : '#2563eb',
      accent2:       isDark ? '#60a5fa' : '#3b82f6',
      green:         isDark ? '#22c55e' : '#16a34a',
      grid:          isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0',
      text2:         isDark ? '#94a3b8' : '#64748b',
      surface2:      isDark ? '#1e2736' : '#f8fafc',
      tooltipBg:     isDark ? '#1e2736' : '#ffffff',
      tooltipBorder: isDark ? 'rgba(59,130,246,0.4)' : '#e2e8f0',
      text:          isDark ? '#f1f5f9' : '#0f172a',
    };
  }

  function buildWeeklyData() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const totals = [0, 0, 0, 0, 0, 0, 0];
    const now = new Date();
    const dow = now.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMon);
    monday.setHours(0, 0, 0, 0);
    const completedEntries = entries.filter(e => e.timeOut && Number(e.hours) > 0);
    for (const entry of completedEntries) {
      const d = new Date(entry.date + 'T00:00:00');
      const idx = Math.round((d - monday) / 86400000);
      if (idx >= 0 && idx < 7) totals[idx] = (totals[idx] || 0) + (Number(entry.hours) || 0);
    }
    return { days, totals };
  }

  async function initTlChart(retry = 0) {
    if (typeof window === 'undefined') return;
    const canvas = document.getElementById('tlWeekChart');
    if (!canvas) return;

    // If the canvas is mounted but the layout hasn't measured yet, Chart.js will render a 0px chart.
    const wrap = canvas.parentElement;
    const rect = wrap?.getBoundingClientRect?.();
    if (rect && (rect.width < 10 || rect.height < 10)) {
      if (retry >= 12) return;
      if (_chartRetryTimer) clearTimeout(_chartRetryTimer);
      _chartRetryTimer = setTimeout(() => initTlChart(retry + 1), 50);
      return;
    }

    let Chart;
    try {
      Chart = await _loadChartJs();
    } catch (err) {
      // Allow retry if the CDN script load failed once.
      console.error('Failed to load Chart.js:', err);
      _chartJsPromise = null;
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const c = getTlColors();
    const { days, totals } = buildWeeklyData();
    if (tlChart) { tlChart.destroy(); tlChart = null; }
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 160);
    gradient.addColorStop(0, c.accent + '30');
    gradient.addColorStop(1, c.accent + '00');
    const maxVal = Math.max(...totals);
    
    tlChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: days,
        datasets: [
          {
            data: totals,
            borderColor: c.accent,
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            pointRadius: totals.map((v) => v === maxVal && v > 0 ? 5 : 3),
            pointBackgroundColor: totals.map((v) => v === maxVal && v > 0 ? c.accent : c.accent2),
            pointBorderColor: c.surface2,
            pointBorderWidth: 2,
            borderWidth: 2.5,
            segment: {
              borderDash: (seg) => seg.p1DataIndex >= 5 ? [4, 4] : undefined,
              borderColor: (seg) => seg.p1DataIndex >= 5 ? c.accent + '80' : c.accent,
            },
          },
          {
            data: [8, 8, 8, 8, 8, 8, 8],
            borderColor: c.green + '60',
            borderDash: [4, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === 0,
            backgroundColor: c.tooltipBg,
            borderColor: c.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            titleColor: c.text2,
            bodyColor: c.text,
            bodyFont: { family: 'DM Mono', size: 13, weight: '600' },
            titleFont: { family: 'DM Sans', size: 11 },
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => `  ${item.raw}h logged`,
            },
          },
        },
        scales: {
          x: { grid: { color: c.grid }, ticks: { color: c.text2, font: { family: 'DM Sans', size: 11 } }, border: { color: 'transparent' } },
          y: { min: 0, max: 12, grid: { color: c.grid }, ticks: { color: c.text2, font: { family: 'DM Mono', size: 10 }, stepSize: 4, callback: (v) => v + 'h' }, border: { color: 'transparent' } },
        },
      },
    });

    // One extra resize after paint helps when this page is reached via client-side navigation.
    requestAnimationFrame(() => {
      try { tlChart?.resize?.(); } catch (_) {}
    });
  }

  // ---- Initial load with skeleton ----
  async function loadAllData() {
    isLoading = true;
    try {
      syncRequiredHoursFromAccount();
      
      // Fetch intern's custom schedule
      const user = authApi.getCurrentUser();
      if (user?.user_id) {
        try {
          const scheduleResult = await authApi.callApiAction('get_intern_schedule', {
            intern_user_id: user.user_id,
          });
          if (scheduleResult && scheduleResult.ok && scheduleResult.schedule) {
            const schedule = scheduleResult.schedule;
            internSchedule.shift_start = schedule.shift_start || DEFAULT_TIME_IN;
            internSchedule.shift_end = schedule.shift_end || DEFAULT_TIME_OUT;
            // Ensure days_off is an array - parse if it's a string
            if (typeof schedule.days_off === 'string') {
              try {
                internSchedule.days_off = JSON.parse(schedule.days_off) || [0, 6];
              } catch {
                internSchedule.days_off = [0, 6];
              }
            } else if (Array.isArray(schedule.days_off)) {
              internSchedule.days_off = schedule.days_off;
            } else {
              internSchedule.days_off = [0, 6];
            }
          }
        } catch (err) {
          console.error('Failed to load intern schedule:', err);
          // Use defaults on error
        }
      }
      
      await loadEntriesFromApi();
      await loadApprovedAbsenceAdjustments();
      // Set default date after ensuring user is loaded
      syncDateToToday();
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      if (!exportMonth) {
        exportMonth = `${year}-${month}`;
      }
      await checkForActiveSession();
      requestTlChartInit();
    } catch (err) {
      console.error('Error loading time log data:', err);
      logSyncError = err?.message || 'Failed to load time log data.';
    } finally {
      isLoading = false;
      if (queuedAuthRefresh) {
        queuedAuthRefresh = false;
        try {
          await refreshTimeLogForCurrentUser();
        } catch (err) {
          console.error('Error refreshing time log after auth restore:', err);
        }
      }
    }
  }

  async function loadApprovedAbsenceAdjustments() {
    approvedAbsenceAdjustmentDays = 0;
    const user = authApi.getCurrentUser();
    if (!user?.user_id) return;
    try {
      const response = await authApi.callApiAction('list_requests_by_user', { user_id: user.user_id });
      const requests = Array.isArray(response?.requests) ? response.requests : [];
      approvedAbsenceAdjustmentDays = countApprovedAbsenceAdjustments(requests, getTodayDateOnly());
    } catch (err) {
      console.error('Failed to load approved absence adjustments:', err);
    }
  }

  let _themeObserver = null;
  onMount(() => {
    loadAllData();
    unsubscribeAuth = authApi.subscribeToCurrentUser(async (user) => {
      if (!user?.user_id) return;
      if (isLoading) {
        queuedAuthRefresh = true;
        return;
      }
      await refreshTimeLogForCurrentUser();
    });
    // Watch for theme changes to redraw chart
    _themeObserver = new MutationObserver(() => requestTlChartInit());
    _themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    _themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
  
  onDestroy(() => {
    if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
    if (_themeObserver) _themeObserver.disconnect();
    if (_chartInitRaf) cancelAnimationFrame(_chartInitRaf);
    if (_chartRetryTimer) clearTimeout(_chartRetryTimer);
    if (_chartResizeObserver) _chartResizeObserver.disconnect();
    if (tlChart) { tlChart.destroy(); tlChart = null; }
  });
  
  // Rebuild chart when entries change (but only if not loading)
  $: if (!isLoading && entries) {
    ensureChartResizeObserver();
    requestTlChartInit();
  }

  // Computed values
  $: formHours = calculateHours(timeIn, timeOut, includeLunch);
  $: canLogin = Boolean(date && timeIn && !isLoggedIn);
  $: canLogout = Boolean(isLoggedIn && date && timeIn && timeOut);
  $: currentUserId = String(authApi.getCurrentUser()?.user_id || '').trim();
  $: completedHoursStorageKey = currentUserId ? `ojt_completed_hours_${currentUserId}` : '';
  $: completedHours = INITIAL_COMPLETED_HOURS + entries.reduce((sum, entry) => sum + entry.hours, 0);
  $: remainingHours = Math.max(0, requiredHours - completedHours);
  $: progressPercent = Math.min(100, Math.round((completedHours / requiredHours) * 100));
  $: progressStatus = progressPercent < 40
    ? { tone: 'danger', label: 'Getting started' }
    : progressPercent < 70
      ? { tone: 'warning', label: 'In progress' }
      : progressPercent < 90
        ? { tone: 'success', label: 'On track' }
        : { tone: 'success', label: 'Almost complete' };
  $: completedEntries = entries.filter((entry) => entry.timeOut && Number(entry.hours) > 0);
  $: exportMonth = exportMonth || getMonthInputFromDate(date) || getCurrentMonthInput();
  $: attendanceDayStartDate = normalizeDateOnly(ojtStartDate || '');
  $: attendanceDayEntries = completedEntries
    .slice()
    .sort((a, b) => {
      const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
      if (dateCompare !== 0) return dateCompare;
      const timeCompare = String(a.timeIn || '').localeCompare(String(b.timeIn || ''));
      if (timeCompare !== 0) return timeCompare;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    })
    .filter((entry) => !attendanceDayStartDate || String(entry.date || '') >= attendanceDayStartDate);
  $: attendanceEntriesForExport = attendanceDayEntries
    .map((entry, index) => ({ ...entry, attendanceDay: index + 1 }))
    .filter((entry) => getMonthInputFromDate(entry.date) === exportMonth);
  $: selectedExportMonthLabel = formatMonthLabel(exportMonth, true);
  $: selectedExportMonthTitle = formatMonthLabel(exportMonth, false);
  $: currentUser = authApi.getCurrentUser() || {};
  $: internFullName = String(currentUser?.full_name || '').trim() || 'Intern';
  $: companyName = String(currentUser?.company || currentUser?.ojt?.company || '').trim();
  $: storedEstimatedEndDate = String(currentUser?.ojt?.estimated_end_date || '').trim();
  $: baseEstimatedCompletion = getEstimatedCompletionDate(remainingHours, AVERAGE_DAILY_HOURS, internSchedule.days_off);
  $: computedEstimatedCompletion = addWorkingDaysToDateString(baseEstimatedCompletion, approvedAbsenceAdjustmentDays, internSchedule.days_off) || baseEstimatedCompletion;
  $: storedEstimatedCompletionDateObj = parseDateLoose(storedEstimatedEndDate);
  $: computedEstimatedCompletionDateObj = parseDateLoose(computedEstimatedCompletion);
  $: estimatedCompletionValue = storedEstimatedEndDate
    ? ((computedEstimatedCompletionDateObj && storedEstimatedCompletionDateObj && storedEstimatedCompletionDateObj < computedEstimatedCompletionDateObj)
      ? formatDate(computedEstimatedCompletion, { month: 'short', day: '2-digit', year: 'numeric' })
      : formatDate(storedEstimatedEndDate, { month: 'short', day: '2-digit', year: 'numeric' }))
    : formatDate(computedEstimatedCompletion, { month: 'short', day: '2-digit', year: 'numeric' });
  
  $: if (typeof window !== 'undefined' && completedHours >= 0 && completedHoursStorageKey) {
    localStorage.setItem(completedHoursStorageKey, String(completedHours));
  }
  
  $: effectiveRemaining = Math.max(0, remainingHours);
  $: totalAbsenceHours = 0;
  $: adjustedRequiredHours = Math.max(0, requiredHours);
  $: projectedWorkingDays = Math.ceil(adjustedRequiredHours / AVERAGE_DAILY_HOURS);
  
  $: estimatedDate = (() => {
    const start = parseIsoDateOnly(ojtStartDate) || new Date();
    return addWorkingDays(start, Math.max(0, projectedWorkingDays - 1), internSchedule.days_off);
  })();
  
  $: statCards = [
    { label: 'Total Hours Required', value: `${formatHours(requiredHours || 0)}h`, sub: 'Per internship agreement', icon: Target, tone: 'primary' },
    { label: 'Hours Completed', value: `${formatHours(completedHours || 0)}h`, sub: `${formatHours(remainingHours || 0)}h remaining`, icon: CheckCircle2, tone: 'success' },
    { label: 'Avg. Daily Hours', value: `${AVERAGE_DAILY_HOURS}h`, sub: 'Based on schedule', icon: Clock, tone: 'info' },
    { label: 'Est. Completion', value: estimatedCompletionValue, sub: new Date().getFullYear(), icon: Calendar, tone: 'forecast' },
  ];
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
</svelte:head>

<section class="tl-page">
  {#if isLoading}
    <div class="tl-stat-grid">
      {#each [1,2,3,4] as _}
        <div class="tl-stat-card skeleton-stat">
          <div class="skeleton-icon"></div>
          <div class="tl-stat-body">
            <div class="skeleton-text" style="width: 80px; height: 11px;"></div>
            <div class="skeleton-text" style="width: 60px; height: 24px; margin: 8px 0 4px;"></div>
            <div class="skeleton-text" style="width: 100px; height: 12px;"></div>
          </div>
        </div>
      {/each}
    </div>

    <div class="tl-progress-section skeleton-progress">
      <div class="tl-progress-header">
        <div>
          <div class="tl-progress-title-row">
            <div class="skeleton-text" style="width: 108px; height: 16px;"></div>
            <div class="skeleton-text" style="width: 74px; height: 22px; border-radius: 999px;"></div>
          </div>
          <div class="skeleton-text" style="width: 290px; height: 12px; margin-top: 8px;"></div>
          <div class="skeleton-text" style="width: 320px; height: 12px; margin-top: 8px;"></div>
        </div>
        <div class="skeleton-text" style="width: 44px; height: 24px; border-radius: 999px;"></div>
      </div>
      <div class="skeleton-progress-track"></div>
      <div class="tl-progress-labels">
        <div class="skeleton-text" style="width: 24px;"></div>
        <div class="skeleton-text" style="width: 112px;"></div>
        <div class="skeleton-text" style="width: 34px;"></div>
      </div>
    </div>

    <div class="tl-three-col">
      <div class="tl-card tl-schedule-card skeleton-card">
        <div class="tl-card-title">
          <div class="skeleton-icon-sm"></div>
          <div class="skeleton-text" style="width: 110px; height: 16px;"></div>
        </div>
        <div class="tl-schedule-content">
          {#each [1,2,3] as _}
            <div class="tl-schedule-item">
              <div class="skeleton-text" style="width: 82px; height: 11px; margin-bottom: 8px;"></div>
              <div class="skeleton-text" style="width: 180px; height: 14px;"></div>
            </div>
          {/each}
        </div>
      </div>

      <div class="tl-card skeleton-card">
        <div class="tl-card-title">
          <div class="skeleton-icon-sm"></div>
          <div class="skeleton-text" style="width: 66px; height: 16px;"></div>
        </div>
        <div class="skeleton-text" style="width: 28px; height: 11px;"></div>
        <div class="skeleton-field"></div>
        <div class="skeleton-text" style="width: 70px; height: 11px;"></div>
        <div class="skeleton-field"></div>
        <div class="skeleton-btn"></div>
      </div>

      <div class="tl-card skeleton-card">
        <div class="tl-card-title">
          <div class="skeleton-icon-sm"></div>
          <div class="skeleton-text" style="width: 72px; height: 16px;"></div>
        </div>
        <div class="skeleton-text" style="width: 78px; height: 11px;"></div>
        <div class="skeleton-field"></div>
        <div class="skeleton-text" style="width: 100%; height: 44px; border-radius: 10px; margin-top: 4px;"></div>
        <div class="skeleton-btn"></div>
        <div class="skeleton-text" style="width: 100%; height: 38px; border-radius: 10px; margin-top: 6px;"></div>
      </div>
    </div>

    <div class="tl-card tl-card-chart skeleton-card">
      <div class="tl-chart-header">
        <div>
          <div class="skeleton-text" style="width: 118px; height: 16px;"></div>
          <div class="skeleton-text" style="width: 140px; height: 12px; margin-top: 6px;"></div>
        </div>
        <div class="skeleton-text" style="width: 72px; height: 24px; border-radius: 999px;"></div>
      </div>
      <div class="skeleton-chart"></div>
    </div>

    <div class="tl-table-section skeleton-table">
      <div class="tl-table-header">
        <div class="skeleton-text" style="width: 122px; height: 14px;"></div>
        <div class="tl-table-tools">
          <div class="skeleton-text" style="width: 102px; height: 12px;"></div>
          <div class="skeleton-text" style="width: 142px; height: 34px; border-radius: 8px;"></div>
          <div class="skeleton-text" style="width: 156px; height: 34px; border-radius: 8px;"></div>
        </div>
      </div>
      <div class="tl-table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Created</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {#each [1,2,3,4] as _}
              <tr>
                <td><div class="skeleton-text" style="width: 80px;"></div></td>
                <td><div class="skeleton-text" style="width: 60px;"></div></td>
                <td><div class="skeleton-text" style="width: 50px;"></div></td>
                <td><div class="skeleton-text" style="width: 50px;"></div></td>
                <td><div class="skeleton-text" style="width: 40px;"></div></td>
                <td><div class="skeleton-text" style="width: 70px;"></div></td>
                <td><div class="skeleton-text" style="width: 50px;"></div></td>
                <td><div class="skeleton-icon-sm"></div></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

  {:else}
    {#if logSyncError && !isInlineLoginError(logSyncError)}
      <div class="tl-error-banner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {logSyncError}
      </div>
    {/if}

    <div class="tl-stat-grid">
      {#each statCards as card (card.label)}
        <div class="tl-stat-card tl-stat-{card.tone}">
          <div class="tl-stat-icon">
            <svelte:component this={card.icon} size={17} strokeWidth={2.2} />
          </div>
          <div class="tl-stat-body">
            <div class="tl-stat-label">{card.label}</div>
            <div class="tl-stat-value">{card.value}</div>
            <div class="tl-stat-sub">{card.sub}</div>
          </div>
        </div>
      {/each}
    </div>

    <div class="tl-progress-section">
      <div class="tl-progress-header">
        <div>
          <div class="tl-progress-title-row">
            <div class="tl-progress-title">Hours Progress</div>
            <span class="tl-progress-state tl-progress-state-{progressStatus.tone}">
              <span class="tl-progress-state-dot"></span>
              {progressStatus.label}
            </span>
          </div>
          <div class="tl-progress-meta">{formatHours(completedHours)} of {formatHours(requiredHours)} required hours completed</div>
          <div class="tl-progress-detail">All logged entries are counted immediately toward your OJT hours.</div>
        </div>
        <span class="tl-progress-badge">{progressPercent}%</span>
      </div>
      <div class="tl-progress-track">
        <div class="tl-progress-fill" style="width: {Math.max(progressPercent, 0.5)}%"></div>
      </div>
      <div class="tl-progress-labels">
        <span>0h</span>
        <span class="tl-progress-remaining">{formatHours(remainingHours)}h remaining</span>
        <span>{formatHours(requiredHours)}h</span>
      </div>
    </div>

    <div class="tl-three-col">

      <div class="tl-card tl-schedule-card">
        <div class="tl-card-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Your Schedule
        </div>
        <div class="tl-schedule-content">
          <div class="tl-schedule-item">
            <div class="tl-schedule-label">Shift Hours</div>
            <div class="tl-schedule-value">{internSchedule.shift_start} - {internSchedule.shift_end}</div>
          </div>
          <div class="tl-schedule-item">
            <div class="tl-schedule-label">Working Days</div>
            <div class="tl-schedule-value">
              {#if internSchedule.days_off.length > 0}
                {(() => {
                  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                  const workingDays = days.filter((_, i) => !internSchedule.days_off.includes(i)).join(', ');
                  return workingDays || 'No working days';
                })()}
              {:else}
                Monday - Friday
              {/if}
            </div>
          </div>
          <div class="tl-schedule-item">
            <div class="tl-schedule-label">Days Off</div>
            <div class="tl-schedule-value">
              {#if internSchedule.days_off.length > 0}
                {(() => {
                  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                  const offDays = internSchedule.days_off.map(i => days[i]).join(', ');
                  return offDays || 'None';
                })()}
              {:else}
                None
              {/if}
            </div>
          </div>
        </div>
      </div>

      <div class="tl-card">
        <div class="tl-card-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Time In
        </div>
        <div class="tl-field">
          <label for="tl-date">Date</label>
          <input id="tl-date" type="date" bind:value={date} readonly disabled aria-readonly="true" />
        </div>
        <div class="tl-field">
          <label for="tl-time-in">Login Time <span class="tl-req">*</span></label>
          <input id="tl-time-in" type="time" bind:value={timeIn} />
        </div>
        <button class="tl-btn-primary" type="button" on:click={handleLogin} disabled={!canLogin || isLoggingIn}>
          {#if isLoggingIn}
            <span class="tl-spin"><Loader2 size={14} /></span>
            Logging In...
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Log In
          {/if}
        </button>
        {#if isInlineLoginError(logSyncError)}
          <div class="tl-login-inline-error">{logSyncError}</div>
        {/if}
        {#if isLoggedIn}
          <div class="tl-status-pill tl-status-success">
            <span class="tl-status-dot"></span> Logged in - proceed to Log Out
          </div>
        {/if}
      </div>

      <div class="tl-card">
        <div class="tl-card-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Log Out
        </div>
        <div class="tl-field">
          <label for="tl-time-out">Logout Time <span class="tl-req">*</span></label>
          <input id="tl-time-out" type="time" bind:value={timeOut} disabled={!isLoggedIn} />
        </div>

        {#if isLoggedIn && timeIn && timeOut && formHours > 0}
          <div class="tl-lunch-row">
            <div class="tl-lunch-left">
              <div class="tl-lunch-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
              </div>
              <div>
                <div class="tl-lunch-label">Include Lunch</div>
                <div class="tl-lunch-sub">{includeLunch ? 'Counted' : 'Not counted'}</div>
              </div>
            </div>
            <button type="button" class="tl-toggle-switch" class:tl-toggle-on={includeLunch} on:click={handleLunchToggle} aria-label="Toggle include lunch">
              <span class="tl-toggle-knob" class:tl-knob-on={includeLunch}></span>
            </button>
          </div>
          <div class="tl-duration-chip">
            <strong>{formHours}h</strong>
            {#if !includeLunch && formHours > 0}
              <span class="tl-duration-note">(1h lunch deducted)</span>
            {/if}
          </div>
        {/if}

        <button class="tl-btn-danger" class:tl-btn-disabled={!canLogout || isLoggingOut} type="button" on:click={handleLogout} disabled={!canLogout || isLoggingOut}>
          {#if isLoggingOut}
            <span class="tl-spin"><Loader2 size={14} /></span>
            Logging Out...
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Log Out
          {/if}
        </button>

        {#if !isLoggedIn}
          <div class="tl-status-pill tl-status-amber">
            <span class="tl-status-dot"></span> Not logged in - use Time In first
          </div>
        {/if}
      </div>

    </div>

    <div class="tl-card tl-card-chart">
      <div class="tl-chart-header">
        <div>
          <div class="tl-card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Weekly Overview
          </div>
          <div class="tl-chart-sub">Hours logged this week</div>
        </div>
        <button class="tl-week-btn">This Week</button>
      </div>
      <div class="tl-chart-wrap">
        <canvas id="tlWeekChart"></canvas>
      </div>
    </div>

    <div class="tl-table-section">
      <div class="tl-table-header">
        <span class="tl-table-title">Time Log History</span>
        <div class="tl-table-tools">
          <span class="tl-entry-count">{completedEntries.length} completed {completedEntries.length === 1 ? 'entry' : 'entries'}</span>
          <label class="tl-export-month">
            <span>Month</span>
            <input type="month" bind:value={exportMonth} />
          </label>
          <button class="tl-export-btn" type="button" on:click={exportAttendanceSheetPdf} disabled={isExportingAttendance || attendanceEntriesForExport.length === 0}>
            {#if isExportingAttendance}
              <span class="tl-spin"><Loader2 size={14} /></span>
              Exporting...
            {:else}
              Export Attendance Sheet
            {/if}
          </button>
        </div>
      </div>
      <div class="tl-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Time In</th>
              <th>Time Out</th>
              <th>Hours</th>
              <th>Created</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each completedEntries as entry (entry.id)}
              <tr>
                <td class="tl-td-primary">{formatTableDate(entry.date)}</td>
                <td><span class="tl-tag tl-tag-blue">TIME ENTRY</span></td>
                <td class="tl-mono">{entry.timeIn}</td>
                <td class="tl-mono">{entry.timeOut || '-'}</td>
                <td class="tl-mono tl-hours-val">{formatHours(entry.hours)}h</td>
                <td class="tl-mono tl-created-val">{entry.createdAt || '-'}</td>
                <td>
                  <span class="tl-tag tl-tag-green">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    Recorded
                  </span>
                </td>
                <td>
                  <button class="tl-del-btn" type="button" on:click={() => handleDelete(entry.id)} aria-label="Delete time entry" title="Delete this entry">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </td>
              </tr>
            {/each}
            {#if completedEntries.length === 0}
              <tr>
                <td colspan="8" class="tl-empty-row">No time entries yet. Log in to start tracking your hours.</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="tl-attendance-print-root" aria-hidden="true">
      <div class="tl-attendance-sheet" bind:this={attendanceSheetRef}>
        <div class="tl-attendance-head">
          <h1>OJT DAILY ATTENDANCE SHEET</h1>
          <h2>Month of {selectedExportMonthTitle || '__________'}</h2>
        </div>

        <div class="tl-attendance-meta">
          <div class="tl-attendance-meta-row">
            <span class="tl-attendance-meta-label">Name:</span>
            <span class="tl-attendance-meta-value">{internFullName}</span>
          </div>
          <div class="tl-attendance-meta-row">
            <span class="tl-attendance-meta-label">Company/Department:</span>
            <span class="tl-attendance-meta-value">Globe ISOC</span>
          </div>
        </div>

        <table class="tl-attendance-table">
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
            {#each attendanceEntriesForExport as entry (entry.id)}
              <tr>
                <td>{entry.attendanceDay}</td>
                <td>{formatAttendanceDate(entry.date)}</td>
                <td>{formatAttendanceTime(entry.timeIn)}</td>
                <td>{formatAttendanceTime(entry.timeOut)}</td>
                <td>{formatAttendanceHours(entry.hours)}</td>
                <td></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if showDeleteConfirm && deleteConfirmEntry}
    <div
      class="tl-modal-overlay"
      on:click|self={cancelDelete}
      on:keydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          cancelDelete();
        }
      }}
      role="button"
      tabindex="0"
      aria-label="Close delete confirmation"
    >
      <div class="tl-modal" role="dialog" aria-modal="true" aria-labelledby="tl-modal-title">
        <div class="tl-modal-header">
          <h2 id="tl-modal-title" class="tl-modal-title">Confirm Delete</h2>
          <button class="tl-modal-close" on:click={cancelDelete} aria-label="Close">âœ–</button>
        </div>
        <div class="tl-modal-body">
          <p class="tl-modal-msg">Are you sure you want to delete this time entry?</p>
          <div class="tl-modal-preview">
            <div class="tl-preview-row"><span class="tl-preview-label">Date</span><span class="tl-preview-val">{formatTableDate(deleteConfirmEntry.date)}</span></div>
            <div class="tl-preview-row"><span class="tl-preview-label">Time In</span><span class="tl-preview-val">{deleteConfirmEntry.timeIn}</span></div>
            <div class="tl-preview-row"><span class="tl-preview-label">Time Out</span><span class="tl-preview-val">{deleteConfirmEntry.timeOut || '-'}</span></div>
            <div class="tl-preview-row"><span class="tl-preview-label">Hours</span><span class="tl-preview-val tl-preview-bold">{formatHours(deleteConfirmEntry.hours)}h</span></div>
          </div>
          <p class="tl-modal-warning">This action cannot be undone.</p>
        </div>
        <div class="tl-modal-footer">
          <button class="tl-modal-cancel" on:click={cancelDelete} disabled={isDeletingEntry}>Cancel</button>
          <button class="tl-modal-delete" on:click={confirmDelete} disabled={isDeletingEntry}>
            {#if isDeletingEntry}
              <span class="tl-spin"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>
              Deleting...
            {:else}
              Delete Entry
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  /* ---- Original styles (unchanged) ---- */
  .tl-page {
    --tl-bg:          #f0f4f8;
    --tl-surface:     #ffffff;
    --tl-surface2:    #f8fafc;
    --tl-border:      #e2e8f0;
    --tl-border2:     #cbd5e1;
    --tl-accent:      #2563eb;
    --tl-accent2:     #3b82f6;
    --tl-accent-glow: rgba(37,99,235,0.12);
    --tl-green:       #16a34a;
    --tl-green-dim:   rgba(22,163,74,0.12);
    --tl-amber:       #d97706;
    --tl-amber-dim:   rgba(217,119,6,0.12);
    --tl-red:         #dc2626;
    --tl-red-dim:     rgba(220,38,38,0.12);
    --tl-purple:      #7c3aed;
    --tl-purple-dim:  rgba(124,58,237,0.12);
    --tl-text:        #0f172a;
    --tl-text2:       #64748b;
    --tl-text3:       #94a3b8;
    --tl-radius:      14px;
    --tl-radius-sm:   8px;
    --tl-shadow-sm:   0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03);
    --tl-shadow:      0 4px 16px rgba(0,0,0,0.1);
    font-family: 'DM Sans', sans-serif;
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
    min-height: 0;
  }

  :global(.dark) .tl-page {
    --tl-bg:          #0d1117;
    --tl-surface:     #161c27;
    --tl-surface2:    #1e2736;
    --tl-border:      rgba(255,255,255,0.06);
    --tl-border2:     rgba(255,255,255,0.1);
    --tl-accent:      #3b82f6;
    --tl-accent2:     #60a5fa;
    --tl-accent-glow: rgba(59,130,246,0.18);
    --tl-green:       #22c55e;
    --tl-green-dim:   rgba(34,197,94,0.14);
    --tl-amber:       #f59e0b;
    --tl-amber-dim:   rgba(245,158,11,0.12);
    --tl-red:         #ef4444;
    --tl-red-dim:     rgba(239,68,68,0.14);
    --tl-purple:      #a78bfa;
    --tl-purple-dim:  rgba(167,139,250,0.14);
    --tl-text:        #f1f5f9;
    --tl-text2:       #94a3b8;
    --tl-text3:       #4b5563;
    --tl-shadow-sm:   0 1px 3px rgba(0,0,0,0.18);
    --tl-shadow:      0 8px 20px rgba(0,0,0,0.35);
  }

  /* Error banner (used in skeleton as well) */
  .tl-error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--tl-red-dim);
    border: 1px solid rgba(220,38,38,0.25);
    border-radius: var(--tl-radius-sm);
    font-size: 13px;
    color: var(--tl-red);
    font-weight: 500;
  }

  .tl-login-inline-error {
    margin-top: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid rgba(220, 38, 38, 0.35);
    background: rgba(239, 68, 68, 0.12);
    color: #fecaca;
    font-size: 12px;
    line-height: 1.35;
    font-weight: 500;
  }

  /* Stat cards */
  .tl-stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }
  .tl-stat-card {
    background: var(--tl-surface);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius);
    padding: 18px 20px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    box-shadow: var(--tl-shadow-sm);
    transition: box-shadow 0.2s, transform 0.2s;
  }
  .tl-stat-card:hover { box-shadow: var(--tl-shadow); transform: translateY(-1px); }
  .tl-stat-icon {
    width: 40px; height: 40px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .tl-stat-primary .tl-stat-icon { background: var(--tl-accent-glow); color: var(--tl-accent); }
  .tl-stat-success .tl-stat-icon { background: var(--tl-green-dim);   color: var(--tl-green); }
  .tl-stat-info    .tl-stat-icon { background: var(--tl-amber-dim);   color: var(--tl-amber); }
  .tl-stat-forecast .tl-stat-icon { background: var(--tl-purple-dim); color: var(--tl-purple); }
  .tl-stat-label {
    font-size: 11px;
    font-weight: 600;
    color: #000000;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  :global(.dark) .tl-stat-label { color: #ffffff; }
  .tl-stat-value {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--tl-text);
    margin: 3px 0 2px;
  }
  .tl-stat-sub {
    font-size: 11.5px;
    color: var(--tl-text2);
  }
  .tl-stat-success .tl-stat-sub { color: var(--tl-accent); }

  /* Progress section */
  .tl-progress-section {
    background: var(--tl-surface);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius);
    padding: 20px 24px;
    box-shadow: var(--tl-shadow-sm);
  }
  .tl-progress-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .tl-progress-title { font-size: 14px; font-weight: 600; color: var(--tl-text); }
  .tl-progress-title-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tl-progress-meta  { font-size: 12px; color: var(--tl-text2); margin-top: 3px; }
  .tl-progress-detail { font-size: 12px; color: var(--tl-accent); margin-top: 4px; font-weight: 500; }
  .tl-progress-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid transparent;
    line-height: 1;
  }
  .tl-progress-state-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }
  .tl-progress-state-danger {
    color: var(--tl-red);
    background: var(--tl-red-dim);
    border-color: color-mix(in srgb, var(--tl-red) 28%, transparent);
  }
  .tl-progress-state-warning {
    color: var(--tl-amber);
    background: var(--tl-amber-dim);
    border-color: color-mix(in srgb, var(--tl-amber) 30%, transparent);
  }
  .tl-progress-state-success {
    color: var(--tl-green);
    background: var(--tl-green-dim);
    border-color: color-mix(in srgb, var(--tl-green) 28%, transparent);
  }
  .tl-progress-badge {
    background: var(--tl-accent);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .tl-progress-track {
    height: 8px;
    background: var(--tl-bg, var(--tl-surface2));
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid var(--tl-border);
  }
  :global(.dark) .tl-progress-track { background: rgba(255,255,255,0.04); }
  .tl-progress-fill {
    height: 100%;
    min-width: 2px;
    background: linear-gradient(90deg, var(--tl-accent), var(--tl-accent2));
    border-radius: 999px;
    box-shadow: 0 0 8px var(--tl-accent-glow);
    transition: width 0.7s ease;
  }
  .tl-progress-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 11.5px;
    color: var(--tl-text3);
    font-family: 'DM Mono', monospace;
  }
  .tl-progress-remaining { color: var(--tl-accent); }

  /* Three column row */
  .tl-three-col {
    display: grid;
    grid-template-columns: 1fr 1fr 1.4fr;
    gap: 14px;
    align-items: stretch;
  }
  .tl-card {
    background: var(--tl-surface);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: var(--tl-shadow-sm);
    height: 100%;
  }
  .tl-card-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--tl-text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tl-card-title svg { color: var(--tl-text2); }

  /* Schedule card */
  .tl-schedule-card {
    grid-column: 1 / 2;
  }
  .tl-schedule-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tl-schedule-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 0;
    border-bottom: 1px solid var(--tl-border);
  }
  .tl-schedule-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .tl-schedule-label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--tl-text2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tl-schedule-value {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--tl-text);
  }

  .tl-field { display: flex; flex-direction: column; gap: 6px; }
  .tl-field label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--tl-text2);
  }
  .tl-req { color: var(--tl-red); }
  .tl-field input {
    background: var(--tl-surface2);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius-sm);
    padding: 9px 12px;
    color: var(--tl-text);
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    width: 100%;
  }
  .tl-field input:focus {
    border-color: var(--tl-accent);
    box-shadow: 0 0 0 3px var(--tl-accent-glow);
  }
  .tl-field input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tl-btn-primary {
    width: 100%;
    padding: 11px;
    background: linear-gradient(135deg, var(--tl-accent), var(--tl-accent2));
    border: none;
    border-radius: var(--tl-radius-sm);
    color: #fff;
    font-family: 'DM Sans', inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 4px 14px var(--tl-accent-glow);
    transition: opacity 0.2s, transform 0.15s;
  }
  .tl-btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .tl-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
  }
  .tl-btn-danger {
    width: 100%;
    padding: 11px;
    background: linear-gradient(135deg, var(--tl-red), #b91c1c);
    border: none;
    border-radius: var(--tl-radius-sm);
    color: #fff;
    font-family: 'DM Sans', inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 4px 14px var(--tl-red-dim);
    transition: opacity 0.2s, transform 0.15s;
  }
  .tl-btn-danger:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .tl-btn-disabled,
  .tl-btn-danger:disabled {
    background: var(--tl-surface2) !important;
    color: var(--tl-text3) !important;
    box-shadow: none !important;
    cursor: not-allowed;
    border: 1px solid var(--tl-border);
    transform: none !important;
  }
  .tl-status-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: var(--tl-radius-sm);
    font-size: 12.5px;
    font-weight: 500;
  }
  .tl-status-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }
  .tl-status-amber {
    background: var(--tl-amber-dim);
    border: 1px solid rgba(217,119,6,0.2);
    color: var(--tl-amber);
  }
  .tl-status-success {
    background: var(--tl-green-dim);
    border: 1px solid rgba(22,163,74,0.2);
    color: var(--tl-green);
  }
  .tl-lunch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: var(--tl-radius-sm);
    border: 1px solid var(--tl-border);
    background: var(--tl-surface2);
    transition: border-color 0.15s;
  }
  .tl-lunch-row:hover { border-color: var(--tl-accent2); }
  .tl-lunch-left { display: flex; align-items: center; gap: 10px; }
  .tl-lunch-icon {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: grid; place-items: center;
    background: rgba(217,119,6,0.12);
    color: var(--tl-amber);
  }
  :global(.dark) .tl-lunch-icon { background: rgba(245,158,11,0.15); }
  .tl-lunch-label { font-size: 13px; font-weight: 500; color: var(--tl-text); }
  .tl-lunch-sub   { font-size: 11px; color: var(--tl-text2); }
  .tl-toggle-switch {
    width: 44px; height: 24px;
    background: var(--tl-border2);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    position: relative;
    transition: background 0.2s;
    padding: 0;
  }
  .tl-toggle-on { background: var(--tl-green) !important; }
  .tl-toggle-knob {
    position: absolute;
    left: 3px; top: 3px;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    transition: transform 0.2s;
  }
  .tl-knob-on { transform: translateX(20px); }
  .tl-duration-chip {
    padding: 9px 12px;
    border-radius: var(--tl-radius-sm);
    border: 1px solid var(--tl-border2);
    background: var(--tl-accent-glow);
    color: var(--tl-accent);
    font-size: 13px;
  }
  .tl-duration-note { font-size: 11px; color: var(--tl-text2); margin-left: 6px; }
  .tl-spin {
    display: inline-flex; align-items: center; justify-content: center;
    animation: tlSpin 1s linear infinite;
  }
  @keyframes tlSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .tl-card-chart { gap: 12px; }
  .tl-chart-header { display: flex; align-items: flex-start; justify-content: space-between; }
  .tl-chart-sub { font-size: 11.5px; color: var(--tl-text2); margin-top: 3px; }
  .tl-week-btn {
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--tl-accent);
    color: #fff;
    font-family: 'DM Sans', inherit;
    font-size: 11.5px;
    font-weight: 600;
    border: none;
    cursor: default;
  }
  .tl-chart-wrap { position: relative; height: 160px; }
  .tl-chart-wrap canvas { display: block; width: 100% !important; height: 100% !important; }

  /* Table */
  .tl-table-section {
    background: var(--tl-surface);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius);
    overflow: hidden;
    box-shadow: var(--tl-shadow-sm);
    margin-top: 12px;
  }
  .tl-table-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 16px 22px;
    border-bottom: 1px solid var(--tl-border);
  }
  .tl-table-title { font-size: 14px; font-weight: 600; color: var(--tl-text); }
  .tl-entry-count  { font-size: 12px; color: var(--tl-text2); }
  .tl-table-tools {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .tl-export-month {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: var(--tl-text2);
    font-weight: 600;
  }
  .tl-export-month input {
    width: 148px;
    background: var(--tl-surface2);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius-sm);
    padding: 7px 10px;
    color: var(--tl-text);
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    outline: none;
  }
  .tl-export-month input:focus {
    border-color: var(--tl-accent);
    box-shadow: 0 0 0 3px var(--tl-accent-glow);
  }
  .tl-export-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 34px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--tl-border);
    background: var(--tl-surface2);
    color: var(--tl-text);
    font-family: 'DM Sans', inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tl-export-btn:hover:not(:disabled) {
    border-color: var(--tl-accent2);
    color: var(--tl-accent);
  }
  .tl-export-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .tl-attendance-print-root {
    position: fixed;
    left: -99999px;
    top: 0;
    width: 194mm;
    z-index: -1;
    pointer-events: none;
  }
  .tl-attendance-sheet {
    width: 194mm;
    background: #ffffff;
    color: #000000;
    padding: 10mm 8mm 8mm;
    font-family: 'Times New Roman', Georgia, serif;
    box-sizing: border-box;
  }
  .tl-attendance-head {
    text-align: center;
    margin-bottom: 8mm;
    color: #000000;
  }
  .tl-attendance-head h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: 0.02em;
    font-weight: 700;
    color: #000000;
  }
  .tl-attendance-head h2 {
    margin: 6px 0 0;
    font-size: 18px;
    font-weight: 700;
    color: #000000;
  }
  .tl-attendance-meta {
    display: grid;
    gap: 6px;
    margin-bottom: 8mm;
    color: #000000;
    font-size: 14px;
  }
  .tl-attendance-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tl-attendance-meta-label {
    min-width: 160px;
    font-weight: 700;
    color: #000000;
  }
  .tl-attendance-meta-value {
    flex: 1;
    min-height: 22px;
    border-bottom: 1px solid #000000;
    display: inline-flex;
    align-items: flex-end;
    padding-bottom: 2px;
    color: #000000;
  }
  .tl-attendance-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    color: #000000;
    font-size: 12px;
  }
  .tl-attendance-table th,
  .tl-attendance-table td {
    border: 1px solid #000000;
    padding: 6px 4px;
    text-align: center;
    color: #000000;
  }
  .tl-attendance-table th {
    font-weight: 700;
    color: #000000;
  }
  .tl-attendance-table th:nth-child(1),
  .tl-attendance-table td:nth-child(1) { width: 10%; }
  .tl-attendance-table th:nth-child(2),
  .tl-attendance-table td:nth-child(2) { width: 18%; }
  .tl-attendance-table th:nth-child(3),
  .tl-attendance-table td:nth-child(3) { width: 18%; }
  .tl-attendance-table th:nth-child(4),
  .tl-attendance-table td:nth-child(4) { width: 18%; }
  .tl-attendance-table th:nth-child(5),
  .tl-attendance-table td:nth-child(5) { width: 18%; }
  .tl-attendance-table th:nth-child(6),
  .tl-attendance-table td:nth-child(6) { width: 18%; }
  .tl-table-scroll { overflow-x: auto; max-height: 400px; overflow-y: auto; }
  .tl-table-scroll table { width: 100%; border-collapse: collapse; }
  .tl-table-scroll thead th {
    text-align: left;
    padding: 11px 22px;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--tl-text3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px solid var(--tl-border);
    background: var(--tl-surface2);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .tl-table-scroll tbody tr {
    border-bottom: 1px solid var(--tl-border);
    transition: background 0.15s;
  }
  .tl-table-scroll tbody tr:last-child { border-bottom: none; }
  .tl-table-scroll tbody tr:hover { background: var(--tl-accent-glow); }
  .tl-table-scroll tbody td {
    padding: 13px 22px;
    font-size: 13px;
    color: var(--tl-text2);
  }
  .tl-td-primary { color: var(--tl-text) !important; font-weight: 600; }
  .tl-mono { font-family: 'DM Mono', monospace; font-size: 12px; }
  .tl-hours-val { color: var(--tl-green) !important; font-weight: 700; }
  .tl-created-val { font-size: 11.5px !important; }
  .tl-empty-row {
    text-align: center;
    color: var(--tl-text3) !important;
    padding: 32px 22px !important;
    font-size: 13px !important;
    font-style: italic;
  }
  .tl-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .tl-tag-blue  { background: var(--tl-accent-glow); color: var(--tl-accent2); }
  .tl-tag-green { background: var(--tl-green-dim);  color: var(--tl-green); }
  .tl-del-btn {
    width: 28px; height: 28px;
    border-radius: 6px;
    border: 1px solid var(--tl-border);
    background: transparent;
    color: var(--tl-text3);
    cursor: pointer;
    display: inline-grid;
    place-items: center;
    transition: all 0.15s;
  }
  .tl-del-btn:hover {
    background: var(--tl-red-dim);
    color: var(--tl-red);
    border-color: rgba(220,38,38,0.3);
  }

  /* Scrollbar */
  .tl-table-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(96,165,250,0.4) var(--tl-surface);
  }
  .tl-table-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
  .tl-table-scroll::-webkit-scrollbar-track {
    background: var(--tl-surface);
    border-radius: 999px;
  }
  .tl-table-scroll::-webkit-scrollbar-thumb {
    background: rgba(96,165,250,0.4);
    border-radius: 999px;
  }

  /* Modal (unchanged) */
  .tl-modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center; justify-content: center;
    z-index: 200;
    padding: 1rem;
    backdrop-filter: blur(2px);
    animation: tlFadeIn 0.15s ease;
  }
  @keyframes tlFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .tl-modal {
    background: var(--tl-surface);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius);
    box-shadow: 0 20px 40px rgba(0,0,0,0.25);
    max-width: 420px;
    width: 100%;
    overflow: hidden;
    animation: tlSlideIn 0.2s ease;
  }
  @keyframes tlSlideIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  .tl-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--tl-border);
  }
  .tl-modal-title { font-size: 16px; font-weight: 600; color: var(--tl-text); margin: 0; }
  .tl-modal-close {
    background: none; border: none;
    font-size: 16px; color: var(--tl-text2);
    cursor: pointer; width: 28px;
    height: 28px;
    display: grid; place-items: center;
    border-radius: 6px; transition: all 0.15s;
  }
  .tl-modal-close:hover { background: var(--tl-surface2); color: var(--tl-text); }
  .tl-modal-body { padding: 20px 24px; }
  .tl-modal-msg { font-size: 14px; color: var(--tl-text); font-weight: 500; margin: 0 0 16px; }
  .tl-modal-preview {
    background: var(--tl-surface2);
    border: 1px solid var(--tl-border);
    border-radius: var(--tl-radius-sm);
    padding: 12px 16px;
    margin-bottom: 14px;
  }
  .tl-preview-row {
    display: flex; justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--tl-border);
  }
  .tl-preview-row:last-child { border-bottom: none; }
  .tl-preview-label { color: var(--tl-text2); }
  .tl-preview-val   { color: var(--tl-text); font-weight: 500; }
  .tl-preview-bold  { font-weight: 700; }
  .tl-modal-warning {
    font-size: 12px; color: var(--tl-red);
    padding-top: 12px;
    border-top: 1px solid var(--tl-border);
    margin: 0;
  }
  .tl-modal-footer {
    display: flex; gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid var(--tl-border);
    background: var(--tl-surface2);
  }
  .tl-modal-cancel, .tl-modal-delete {
    flex: 1; padding: 10px 14px;
    border-radius: var(--tl-radius-sm);
    font-family: 'DM Sans', inherit;
    font-size: 13.5px; font-weight: 600;
    cursor: pointer; border: none;
    transition: all 0.2s;
  }
  .tl-modal-cancel {
    background: var(--tl-border);
    color: var(--tl-text);
  }
  .tl-modal-cancel:hover { background: var(--tl-border2); }
  .tl-modal-delete {
    background: var(--tl-red);
    color: #fff;
    box-shadow: 0 4px 12px var(--tl-red-dim);
  }
  .tl-modal-delete:hover { opacity: 0.9; transform: translateY(-1px); }
  .tl-modal-cancel:disabled,
  .tl-modal-delete:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
  .tl-modal-delete:disabled { transform: none; box-shadow: none; }

  /* ---- NEW SKELETON STYLES ---- */
  .skeleton, .skeleton-text, .skeleton-icon, .skeleton-field, .skeleton-btn, .skeleton-chart, .skeleton-progress-track, .skeleton-icon-sm {
    position: relative;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.08);
    border-radius: 4px;
  }
  :global(.dark) .skeleton,
  :global(.dark) .skeleton-text,
  :global(.dark) .skeleton-icon,
  :global(.dark) .skeleton-field,
  :global(.dark) .skeleton-btn,
  :global(.dark) .skeleton-chart,
  :global(.dark) .skeleton-progress-track,
  :global(.dark) .skeleton-icon-sm {
    background: rgba(255, 255, 255, 0.06);
  }
  .skeleton::after, .skeleton-text::after, .skeleton-icon::after, .skeleton-field::after, .skeleton-btn::after, .skeleton-chart::after, .skeleton-progress-track::after, .skeleton-icon-sm::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    transform: translateX(-100%);
    background-image: linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,0.3) 20%, rgba(255,255,255,0.6) 60%, rgba(255,255,255,0));
    animation: shimmer 1.5s infinite;
  }
  :global(.dark) .skeleton::after,
  :global(.dark) .skeleton-text::after,
  :global(.dark) .skeleton-icon::after,
  :global(.dark) .skeleton-field::after,
  :global(.dark) .skeleton-btn::after,
  :global(.dark) .skeleton-chart::after,
  :global(.dark) .skeleton-progress-track::after,
  :global(.dark) .skeleton-icon-sm::after {
    background-image: linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,0.05) 20%, rgba(255,255,255,0.1) 60%, rgba(255,255,255,0));
  }
  @keyframes shimmer {
    100% { transform: translateX(100%); }
  }
  .skeleton-text { height: 1em; border-radius: 6px; }
  .skeleton-icon { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; }
  .skeleton-icon-sm { width: 28px; height: 28px; border-radius: 6px; }
  .skeleton-field { height: 44px; border-radius: var(--tl-radius-sm); margin: 4px 0; }
  .skeleton-btn { height: 44px; border-radius: var(--tl-radius-sm); margin-top: 8px; }
  .skeleton-chart { height: 160px; border-radius: var(--tl-radius-sm); margin-top: 8px; }
  .skeleton-progress-track { height: 8px; border-radius: 999px; margin: 12px 0 8px; }
  .skeleton-stat .tl-stat-body { flex: 1; }
  .skeleton-stat { display: flex; align-items: flex-start; gap: 14px; }
  .skeleton-progress { background: var(--tl-surface); }
  .skeleton-card { background: var(--tl-surface); }
  .skeleton-table { background: var(--tl-surface); }

  @media (max-width: 1100px) {
    .tl-three-col { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 680px) {
    .tl-page {
      gap: 16px;
      padding-bottom: max(10px, calc(env(safe-area-inset-bottom) + 8px));
    }
    .tl-stat-grid { grid-template-columns: 1fr 1fr; }
    .tl-three-col { grid-template-columns: 1fr; }

    /* Keep loading stats fluid on narrow screens (avoid clipped placeholders). */
    .skeleton-stat {
      gap: 10px;
      padding: 16px 14px;
    }
    .skeleton-stat .skeleton-icon {
      width: 34px;
      height: 34px;
      border-radius: 9px;
    }
    .skeleton-stat .tl-stat-body {
      min-width: 0;
    }
    .skeleton-stat .tl-stat-body .skeleton-text {
      max-width: 100% !important;
    }
    .skeleton-stat .tl-stat-body .skeleton-text:nth-child(1) { width: 72% !important; }
    .skeleton-stat .tl-stat-body .skeleton-text:nth-child(2) { width: 56% !important; }
    .skeleton-stat .tl-stat-body .skeleton-text:nth-child(3) { width: 88% !important; }

    .tl-stat-forecast .tl-stat-value {
      font-size: 20px;
      letter-spacing: -0.2px;
      line-height: 1.15;
      word-break: break-word;
    }

    .tl-stat-forecast .tl-stat-sub {
      font-size: 10.5px;
    }
  }
</style>


