<script>
// @ts-nocheck

let workLogs = [];
let isLoadingWorkLogs = false;
let workLogsError = '';

let allUsers = [];
let assignedSupervisors = [];
let isLoadingAssignedSupervisors = false;
let assignedSupervisorsError = '';

let expandedWorkLog = null;
let hoveredWorkLog = null;

// Toggle worklog expansion when clicking the item body (but ignore clicks on interactive children)
function handleWorklogItemClick(event, idx) {
  if (!event || typeof idx === 'undefined') return;
  try {
    const tgt = event.target || null;
    if (tgt && tgt.closest) {
      const interactive = tgt.closest('a, button, input, label, .worklog-attachment-action, .worklog-attachment-chip');
      if (interactive) return; // let the element handle the interaction
    }
  } catch (e) {
    // ignore
  }
  expandedWorkLog = expandedWorkLog === idx ? null : idx;
}
import { onMount, onDestroy } from 'svelte';
import { theme } from '../context/ThemeContext.js';
// For real-time update of 'Updated X minutes ago'
let now = new Date();
let nowIntervalId;
let recentActivitiesIntervalId;
let stopUserSubscription = () => {};
let forceUpdate = 0; // dummy variable to trigger Svelte reactivity
let pendingDeepLinkTaskId = '';

function updateNow() {
  now = new Date();
  forceUpdate += 1; // force Svelte to update
}

onMount(() => {
  nowIntervalId = setInterval(() => {
    updateNow();
  }, 5000); // update every 5 seconds for better real-time relative time display
});

onDestroy(() => {
  clearInterval(nowIntervalId);
  clearInterval(recentActivitiesIntervalId);
  stopUserSubscription();
  if (typeof window !== 'undefined') {
    window.removeEventListener('hashchange', syncTaskIntentFromHash);
  }
});
// For Recent Activity (automatic, backend-driven)
let recentActivities = [];

// Fetch recent activities from backend
async function fetchRecentActivities() {
  return new Promise((resolve) => {
    try {
      const run = globalThis?.google?.script?.run;
      if (!run) {
        resolve();
        return;
      }
      run
        .withSuccessHandler((data) => {
          if (Array.isArray(data)) {
            recentActivities = data;
          }
          resolve();
        })
        .withFailureHandler(() => {
          resolve();
        })
        .getRecentActivities();
    } catch (e) {
      resolve();
    }
  });
}

// Log a new activity to backend
async function logUserActivity(activity) {
  return new Promise((resolve) => {
    try {
      const run = globalThis?.google?.script?.run;
      if (!run) {
        resolve();
        return;
      }
      run
        .withSuccessHandler(() => {
          // Fetch activities immediately after logging to show in real-time
          setTimeout(() => fetchRecentActivities(), 300);
          resolve();
        })
        .withFailureHandler(() => {
          resolve();
        })
        .logUserActivity(activity);
    } catch (e) {
      resolve();
    }
  });
}

// Format timestamp to relative time (e.g., "3 minutes ago")
function formatRelativeTime(timestamp) {
  const activityDate = new Date(timestamp);
  const diffMs = now - activityDate;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes === 1) return '1 minute ago';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return activityDate.toLocaleDateString();
}

// Format recent activity message consistently: append relative time only when message doesn't already include it
function formatActivityLine(activity) {
  const msg = String(activity?.message || '').trim();
  if (!msg) {
    return formatRelativeTime(activity?.timestamp || '') || '';
  }

  const lower = msg.toLowerCase();
  // if message already contains a relative-time phrase or a date, don't append
  if (lower.includes('ago') || /\b\d{4}-\d{2}-\d{2}\b/.test(msg) || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(msg)) {
    return msg.replace(/\s+,\s*/, ', '); // normalize any stray commas
  }

  const rel = formatRelativeTime(activity?.timestamp || '');
  if (!rel) return msg;

  // ensure punctuation spacing
  const endsPunct = /[.!?]$/.test(msg);
  if (endsPunct) return `${msg} ${rel}.`;
  return `${msg}, ${rel}.`;
}

onMount(() => {
  fetchRecentActivities();
  recentActivitiesIntervalId = setInterval(() => {
    updateNow();
    fetchRecentActivities(); // refresh activities every 10 seconds for more real-time feel
  }, 10000);
});

onMount(async () => {
  try {
    const res = await callGetAllStudents();
    if (res && res.ok && Array.isArray(res.students)) {
      allUsers = res.students.map(s => ({ user_id: String(s.user_id || ''), full_name: String(s.full_name || ''), email: String(s.email || '') }));
    }
  } catch (e) {
    // ignore
  }
});

onMount(() => {
  fetchAssignedTasks();
  fetchWorkLogs();
  fetchAssignedSupervisors();
  stopUserSubscription = subscribeToCurrentUser(() => {
    fetchAssignedTasks();
    fetchWorkLogs();
    fetchAssignedSupervisors();
  });
});

onMount(() => {
  fetchAssignedTasks();
  stopUserSubscription = subscribeToCurrentUser(() => {
    fetchAssignedTasks();
  });
  syncTaskIntentFromHash();
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', syncTaskIntentFromHash);
  }
});

// Helper to compute minutes ago from a date string (using dueDate as a stand-in for last updated)
function getUpdatedMinutesAgo(dateString) {
  // Try to parse the date string (e.g., 'Apr 5, 2026')
  const parsed = parseDueDate(dateString);
  if (!parsed) return '';
  // Use the reactive 'now' variable so Svelte updates the UI
  const diffMs = now.getTime() - parsed.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 0) return '';
  if (diffMinutes < 60) {
    return `Updated ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }
  // If more than 24 hours, show the date
  return `Updated ${dateString}`;
}

function getUserFullName(idOrEmail) {
  if (!idOrEmail) return '';
  const byId = allUsers.find(u => String(u.user_id || '') === String(idOrEmail));
  if (byId) return byId.full_name || byId.user_id || '';
  const byEmail = allUsers.find(u => String(u.email || '').toLowerCase() === String(idOrEmail).toLowerCase());
  if (byEmail) return byEmail.full_name || byEmail.email || '';
  const supervisorById = assignedSupervisors.find(s => String(s.user_id || '') === String(idOrEmail));
  if (supervisorById) return supervisorById.full_name || supervisorById.email || supervisorById.user_id || '';
  const supervisorByEmail = assignedSupervisors.find(s => String(s.email || '').toLowerCase() === String(idOrEmail).toLowerCase());
  if (supervisorByEmail) return supervisorByEmail.full_name || supervisorByEmail.email || supervisorByEmail.user_id || '';
  return String(idOrEmail);
}

function getTaskIntentFromHash() {
  if (typeof window === 'undefined') return '';
  const rawHash = String(window.location.hash || '').trim();
  if (!rawHash) return '';
  const queryIndex = rawHash.indexOf('?');
  if (queryIndex === -1) return '';
  const params = new URLSearchParams(rawHash.slice(queryIndex + 1));
  return String(params.get('taskId') || '').trim();
}

function syncTaskIntentFromHash() {
  pendingDeepLinkTaskId = getTaskIntentFromHash();
}

function clearTaskIntentFromHash() {
  if (typeof window === 'undefined') return;
  const rawHash = String(window.location.hash || '').trim();
  const queryIndex = rawHash.indexOf('?');
  if (queryIndex === -1) return;
  window.location.hash = rawHash.slice(0, queryIndex) || '/activity';
}

function getSupervisorOptionLabel(supervisor) {
  const userId = String(supervisor?.user_id || '').trim();
  const email = String(supervisor?.email || '').trim();
  const resolved = getUserFullName(userId || email);
  if (resolved && resolved !== userId && resolved !== email) return resolved;
  return String(supervisor?.full_name || '').trim() || email || userId || 'Unknown supervisor';
}

import { getCurrentUser, subscribeToCurrentUser } from '../lib/auth.js';
import {
  AlertCircle,
  CheckCircle2,
  Archive,
  ChevronDown,
  Clock,
  Clock3,
  MoreHorizontal,
  List,
  Plus,
  Search,
  LayoutGrid,
  FileEdit,
  Eye,
  RotateCcw,
  BookOpen,
  Loader2,
  Download,
  ExternalLink
} from 'lucide-svelte';

// --- Work Log Form State and Handlers ---

let workLogTask = '';
let workLogNotes = '';
let workLogLearnings = '';
let workLogAttachments = [];
let workLogFileInput; // Reference to file input for resetting
let isSavingWorkLog = false;

// --- Work Log Filters ---
let workLogFilterKeyword = '';
let workLogFilterDate = '';

function callGetActivityWorklogs(payload = {}) {
  return new Promise((resolve, reject) => {
    const run = globalThis?.google?.script?.run;

    if (!run) {
      reject(new Error('Apps Script runtime is not available in this view.'));
      return;
    }

    run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => {
        reject(new Error(error?.message || String(error)));
      })
      .getActivityWorklogs(payload);
  });
}

function callGetAllStudents(payload = {}) {
  return new Promise((resolve, reject) => {
    const run = globalThis?.google?.script?.run;
    if (!run) {
      reject(new Error('Apps Script runtime is not available in this view.'));
      return;
    }
    run.withSuccessHandler(resolve).withFailureHandler((error) => reject(new Error(error?.message || String(error)))).getAllStudents(payload);
  });
}

  function callGetStudentSupervisors(payload = {}) {
    return new Promise((resolve, reject) => {
      const run = globalThis?.google?.script?.run;
      if (!run) {
        reject(new Error('Apps Script runtime is not available in this view.'));
        return;
      }
      run
        .withSuccessHandler(resolve)
        .withFailureHandler((error) => reject(new Error(error?.message || String(error))))
        .getStudentSupervisors(payload);
    });
  }

function mapWorklogToUi(row) {
  const source = row || {};
  const attachments = Array.isArray(source.attachments) ? source.attachments : [];
  return {
    task_id: String(source.task_id || source.id || '').trim(),
    user_id: String(source.user_id || '').trim(),
    task: String(source.task || '').trim(),
    notes: String(source.notes || '').trim(),
    learnings: String(source.learnings || '').trim(),
    date: String(source.date || '').trim(),
    created_at: String(source.created_at || '').trim(),
    created_by: String(source.created_by || '').trim(),
    updated_by: String(source.updated_by || '').trim(),
    attachments: attachments.map(a => ({
      attachment_id: String(a.attachment_id || '').trim(),
      file_type: String(a.file_type || '').trim(),
      file_size: String(a.file_size || '').trim(),
      file_name: String(a.file_name || '').trim(),
      link: String(a.link || '').trim(),
      uploaded_at: String(a.uploaded_at || '').trim()
    }))
  };
}

function getDriveDownloadUrl(link) {
  const url = String(link || '').trim();
  if (!url) return '';
  if (url.includes('uc?export=download')) return url;
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const fileId = idMatch ? idMatch[1] : '';
  return fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : url;
}

async function fetchWorkLogs() {
  const user = getCurrentUser();

  if (!user?.user_id) {
    workLogs = [];
    workLogsError = '';
    return;
  }

  isLoadingWorkLogs = true;
  workLogsError = '';

  try {
    const result = await callGetActivityWorklogs({
      user_id: user.user_id,
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'Unable to load work logs.');
    }

    workLogs = Array.isArray(result.worklogs)
      ? result.worklogs.map((row) => mapWorklogToUi(row))
      : [];
  } catch (error) {
    workLogs = [];
    workLogsError = error?.message || 'Unable to load work logs.';
  } finally {
    isLoadingWorkLogs = false;
  }
}

// Returns true if log matches keyword (in task, notes, learnings, or attachment)
function matchesWorkLogKeyword(log, keyword) {
  if (!keyword.trim()) return true;
  const lower = keyword.trim().toLowerCase();
  return (
    log.task.toLowerCase().includes(lower) ||
    log.notes.toLowerCase().includes(lower) ||
    log.learnings.toLowerCase().includes(lower) ||
    (log.attachments && log.attachments.some(f => f.toLowerCase().includes(lower)))
  );
}

// Returns true if log matches the selected date (YYYY-MM-DD)
function matchesWorkLogDate(log, dateStr) {
  if (!dateStr) return true;
  // log.date is like 'Apr 10, 2026', convert to YYYY-MM-DD
  const parsed = parseDueDate(log.date);
  if (!parsed) return false;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  const logDateStr = `${y}-${m}-${d}`;
  return logDateStr === dateStr;
}

function formatWorklogDate(dateText) {
  const parsed = parseDueDate(dateText);
  const date = parsed || new Date();
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

$: filteredWorkLogs = workLogs.filter(
  log => matchesWorkLogKeyword(log, workLogFilterKeyword) && matchesWorkLogDate(log, workLogFilterDate)
);

function handleWorkLogFileUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) {
    return;
  }
  // store as objects so name can be edited before upload
  const wrapped = files.map(f => ({ file: f, name: f.name }));
  workLogAttachments = [...workLogAttachments, ...wrapped];
  event.target.value = '';
}

function renameWorkLogAttachment(index, newName) {
  if (typeof index !== 'number') return;
  workLogAttachments = workLogAttachments.map((att, i) => i === index ? { ...att, name: String(newName || '').trim() } : att);
}

function removeWorkLogAttachment(index) {
  if (typeof index !== 'number') return;
  workLogAttachments = workLogAttachments.filter((_, i) => i !== index);
  // try resetting file input if empty
  if (workLogAttachments.length === 0 && workLogFileInput) workLogFileInput.value = '';
}

function fileToBase64_(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIndex = dataUrl.indexOf(',');
      resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : '');
    };
    reader.onerror = () => reject(new Error('Unable to read selected file.'));
    reader.readAsDataURL(file);
  });
}

function getFileExtension_(fileName) {
  const name = String(fileName || '').trim();
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) {
    return '';
  }
  return name.slice(dotIndex + 1).toLowerCase();
}

function callAddActivityWorklog(payload) {
  return new Promise((resolve, reject) => {
    const run = globalThis?.google?.script?.run;
    if (!run) {
      reject(new Error('Apps Script runtime is not available in this view.'));
      return;
    }

    run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => {
        reject(new Error(error?.message || String(error)));
      })
      .addActivityWorklog(payload);
  });
}

function callAddWorklogAttachment(payload) {
  return new Promise((resolve, reject) => {
    const run = globalThis?.google?.script?.run;
    if (!run) {
      reject(new Error('Apps Script runtime is not available in this view.'));
      return;
    }

    run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => {
        reject(new Error(error?.message || String(error)));
      })
      .addWorklogAttachment(payload);
  });
}

async function handleAddWorkLog() {
  if (isSavingWorkLog) return;
  if (!workLogTask.trim() && !workLogNotes.trim() && !workLogLearnings.trim()) return;
  
  isSavingWorkLog = true;
  const now = new Date();
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = `${MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  let user = null;
  try {
    user = await getCurrentUser();
  } catch (e) {}

  const payload = {
    task_id: '',
    user_id: user?.user_id || '',
    task: workLogTask.trim(),
    notes: workLogNotes.trim(),
    learnings: workLogLearnings.trim(),
    date,
    created_at: now.toISOString(),
    created_by: user?.user_id || '',
    updated_by: user?.user_id || ''
  };

  try {
    const result = await callAddActivityWorklog(payload);
    const taskId = String(result?.task_id || payload.task_id || '').trim();
    const uploadErrors = [];
    // workLogAttachments entries are { file, name }
    const validAttachments = workLogAttachments.filter((a) => a && a.file && a.file.size > 0);

    if (taskId && validAttachments.length > 0) {
      for (const entry of validAttachments) {
        const file = entry.file;
        const fileName = String(entry.name || file.name || '').trim();
        try {
          const ext = getFileExtension_(fileName);
          const mimeSuffix = String(file.type || '').includes('/') ? String(file.type).split('/').pop() : '';
          const sizeMb = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
          const fileDataBase64 = await fileToBase64_(file);
          const uploadResult = await callAddWorklogAttachment({
            attachment_id: '',
            task_id: taskId,
            user_id: user?.user_id || '',
            file_type: ext || mimeSuffix || String(file.type || '').trim(),
            file_size: sizeMb,
            file_name: fileName,
            file_data_base64: fileDataBase64,
            mime_type: file.type || 'application/octet-stream',
            uploaded_at: now.toISOString(),
            uploaded_by: user?.user_id || ''
          });

          if (!uploadResult?.ok) {
            throw new Error(uploadResult?.error || 'Save failed.');
          }
        } catch (uploadError) {
          uploadErrors.push(`${fileName}: ${uploadError?.message || uploadError}`);
        }
      }
    }

    fetchWorkLogs();
    
    // Log activity
    await logUserActivity({
      message: `Added a new work log`,
      timestamp: new Date().toISOString(),
      user: user && user.email ? user.email : 'Unknown'
    });
    
    workLogTask = '';
    workLogNotes = '';
    workLogLearnings = '';
    workLogAttachments = [];
    
    // Reset the file input element
    if (workLogFileInput) {
      workLogFileInput.value = '';
    }

    if (uploadErrors.length > 0) {
      alert(`Some attachments failed to save:\n${uploadErrors.join('\n')}`);
    }
  } catch (e) {
    alert(`Failed to save work log: ${e?.message || e}`);
  } finally {
    isSavingWorkLog = false;
  }
}

let assignedTasks = [];
let isLoadingAssignedTasks = false;
let assignedTasksError = '';

  let archivedTasks = [];
let archivingTaskMap = {};
let restoringTaskMap = {};

  function getTaskActionKey(taskOrTitle) {
    if (taskOrTitle && typeof taskOrTitle === 'object') {
      return String(taskOrTitle.id || taskOrTitle.task_id || taskOrTitle.title || '').trim();
    }

    return String(taskOrTitle || '').trim();
  }

  const statusClassMap = {
    Pending: 'status-pending',
    'In Progress': 'status-progress',
    Completed: 'status-completed',
    Overdue: 'status-overdue',
  };

  const statusOptions = ['All Status', 'Pending', 'In Progress', 'Overdue', 'Completed'];
  const editStatusOptions = ['Pending', 'In Progress', 'Overdue', 'Completed'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_MAP = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  const TASK_EDIT_RESTRICTED_MESSAGE = 'You can only modify tasks you created unless you are a supervisor.';

  let searchQuery = '';
  let statusFilter = 'All Status';
  let activeView = 'Overview';
  let selectedOverviewTaskId = '';
  let expandedListTaskId = '';
  let isViewTaskModalOpen = false;
  let viewedTaskId = '';
  let isEditingViewedTask = false;
  let isSavingViewedTask = false;
  let taskViewEditForm = {
    title: '',
    status: 'Pending',
    dueDate: '',
    description: '',
    assignedBy: '',
    dailyChecklist: [],
    attachments: [],
  };
  let trackerMenuOpen = false;
  let isEditingTrackerTask = false;
  let isAddTaskOpen = false;
  let isSavingAddTask = false;
  let addTaskError = '';
  let addTaskForm = {
    title: '',
    status: 'Pending',
    owner: '',
    dueDate: '',
    description: '',
    dailyChecklist: [],
    attachments: [],
  };
  let trackerEditForm = {
    title: '',
    status: 'Pending',
    dueDate: '',
    description: '',
    dailyChecklist: [],
    attachments: [],
  };
  let addTaskFileInput; // Reference to file input for task form
  let trackerFileInput; // Reference to file input for tracker form
  let taskViewFileInput; // Reference to file input for task view form

  function matchesStatus(task, filter) {
    if (filter === 'All Status') {
      return true;
    }

    return getTaskStatusLabel(task) === filter;
  }

  function matchesSearch(task, query) {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return true;
    }

    const ownerLabel = getUserFullName(task.owner);
    return [task.title, task.status, task.dueDate, ownerLabel].some((value) =>
      String(value || '').toLowerCase().includes(normalized)
    );
  }

  function formatDueDate(dateText) {
    const normalizedDate = normalizeDisplayDueDate(dateText);
    const parts = normalizedDate.replace(',', '').split(' ');

    if (parts.length !== 3) {
      return normalizedDate;
    }

    const [monthText, dayText, yearText] = parts;
    const month = MONTH_MAP[monthText];

    if (!month) {
      return normalizedDate;
    }

    const day = dayText.padStart(2, '0');
    return `${day}-${month}-${yearText}`;
  }

  function parseDueDate(dateText) {
    if (dateText instanceof Date) {
      return Number.isNaN(dateText.getTime()) ? null : new Date(dateText);
    }

    const raw = String(dateText || '').trim();
    if (!raw) {
      return null;
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(`${year}-${month}-${day}T00:00:00`);
    }

    const nativeParsed = new Date(raw);
    if (!Number.isNaN(nativeParsed.getTime()) && /\bGMT|^\d{4}-\d{2}-\d{2}|^[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{1,2}/.test(raw)) {
      nativeParsed.setHours(0, 0, 0, 0);
      return nativeParsed;
    }

    const parts = raw.replace(',', '').split(' ');

    if (parts.length !== 3) {
      return null;
    }

    const [monthText, dayText, yearText] = parts;
    const month = MONTH_MAP[monthText];

    if (!month) {
      return null;
    }

    return new Date(`${yearText}-${month}-${dayText.padStart(2, '0')}T00:00:00`);
  }

  function normalizeDisplayDueDate(dateValue) {
    const parsed = parseDueDate(dateValue);

    if (!parsed) {
      return String(dateValue || '').trim();
    }

    return `${MONTH_NAMES[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
  }

  function toInputDate(dateText) {
    const parsed = parseDueDate(dateText);

    if (!parsed) {
      return '';
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function fromInputDate(inputDate) {
    if (!inputDate) {
      return '';
    }

    const [year, month, day] = inputDate.split('-');
    const monthIndex = Number(month) - 1;

    if (monthIndex < 0 || monthIndex > 11) {
      return '';
    }

    return `${MONTH_NAMES[monthIndex]} ${Number(day)}, ${year}`;
  }

  function getAttachmentNames(attachments) {
    if (Array.isArray(attachments)) {
      return attachments.map((item) => {
        if (item && typeof item === 'object') {
          return String(item.file_name || item.name || '').trim();
        }
        if (typeof item === 'object' && item instanceof File) {
          return item.name;
        }
        return String(item || '').trim();
      }).filter(Boolean);
    }

    return [];
  }

  function callAddActivityTaskAttachment(payload) {
    return new Promise((resolve, reject) => {
      const run = globalThis?.google?.script?.run;
      if (!run) {
        reject(new Error('Apps Script runtime is not available.'));
        return;
      }

      run
        .withSuccessHandler(resolve)
        .withFailureHandler((error) => {
          reject(new Error(error?.message || String(error)));
        })
        .addActivityTaskAttachment(payload);
    });
  }

  function formatAttachmentCell(attachments) {
    const names = getAttachmentNames(attachments);

    if (names.length === 0) {
      return 'No files';
    }

    return `${names.length} ${names.length === 1 ? 'file' : 'files'}`;
  }

  function formatAttachmentMeta(attachments) {
    const count = getAttachmentNames(attachments).length;
    return `${count} ${count === 1 ? 'attachment' : 'attachments'}`;
  }

  function formatChecklistMeta(dailyChecklist) {
    const items = Array.isArray(dailyChecklist) ? dailyChecklist : [];
    return `${items.length} ${items.length === 1 ? 'checklist item' : 'checklist items'}`;
  }

  function normalizeDate(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  function isSameCalendarDay(left, right) {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  function getUniqueTaskTitle(baseTitle) {
    const trimmedBase = baseTitle.trim();

    if (!assignedTasks.some((task) => task.title === trimmedBase)) {
      return trimmedBase;
    }

    let suffix = 2;
    let candidate = `${trimmedBase} (${suffix})`;

    while (assignedTasks.some((task) => task.title === candidate)) {
      suffix += 1;
      candidate = `${trimmedBase} (${suffix})`;
    }

    return candidate;
  }

  function resetAddTaskForm() {
    const defaultSupervisorId = assignedSupervisors[0]?.user_id || '';
    // revoke any created object URLs to avoid leaks
    if (Array.isArray(addTaskForm.attachments)) {
      for (const a of addTaskForm.attachments) {
        try {
          if (a && a._objectUrl) URL.revokeObjectURL(a._objectUrl);
        } catch (e) {}
      }
    }

    addTaskForm = {
      title: '',
      status: 'Pending',
      owner: defaultSupervisorId,
      dueDate: '',
      description: '',
      dailyChecklist: [],
      attachments: [],
      dateCreated: '',
    };
    addTaskError = '';
    
    // Reset the file input element
    if (addTaskFileInput) {
      addTaskFileInput.value = '';
    }
  }

  function toggleAddTaskForm() {
    isAddTaskOpen = !isAddTaskOpen;

    if (isAddTaskOpen) {
      // Set dateCreated to today when opening the form
      const nowDate = new Date();
      const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      addTaskForm.dateCreated = `${MONTH_NAMES[nowDate.getMonth()]} ${nowDate.getDate()}, ${nowDate.getFullYear()}`;
      if (!addTaskForm.owner && assignedSupervisors.length > 0) {
        addTaskForm.owner = assignedSupervisors[0].user_id;
      }
    } else {
      resetAddTaskForm();
    }
  }

  function cancelAddTask() {
    isAddTaskOpen = false;
    addTaskError = '';
    resetAddTaskForm();
  }

  function handleAddTaskOverlayClick(event) {
    if (event.target === event.currentTarget) {
      cancelAddTask();
    }
  }

  function callCreateActivityTask(payload) {
    return new Promise((resolve, reject) => {
      const run = globalThis?.google?.script?.run;

      if (!run) {
        reject(new Error('Apps Script runtime is not available in this view.'));
        return;
      }

      run
        .withSuccessHandler(resolve)
        .withFailureHandler((error) => {
          reject(new Error(error?.message || String(error)));
        })
        .createActivityTask(payload);
    });
  }

  function callGetActivityTasks(payload = {}) {
    return new Promise((resolve, reject) => {
      const run = globalThis?.google?.script?.run;

      if (!run) {
        reject(new Error('Apps Script runtime is not available in this view.'));
        return;
      }

      run
        .withSuccessHandler(resolve)
        .withFailureHandler((error) => {
          reject(new Error(error?.message || String(error)));
        })
        .getActivityTasks(payload);
    });
  }

  function callUpdateActivityTask(payload) {
    return new Promise((resolve, reject) => {
      const run = globalThis?.google?.script?.run;
      if (!run) {
        reject(new Error('Apps Script runtime is not available in this view.'));
        return;
      }
      run
        .withSuccessHandler(resolve)
        .withFailureHandler((error) => {
          reject(new Error(error?.message || String(error)));
        })
        .updateActivityTask(payload);
    });
  }

  function callSetActivityTaskArchiveStatus(payload) {
    return new Promise((resolve, reject) => {
      const run = globalThis?.google?.script?.run;
      if (!run) {
        reject(new Error('Apps Script runtime is not available in this view.'));
        return;
      }
      run
        .withSuccessHandler(resolve)
        .withFailureHandler((error) => {
          reject(new Error(error?.message || String(error)));
        })
        .setActivityTaskArchiveStatus(payload);
    });
  }

  function parseTaskItems(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return [];
      }

      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return [];
  }

  function normalizeTaskChecklist(value, fallback = []) {
    const items = parseTaskItems(value);

    if (items.length > 0) {
      return items
        .map((item) => ({
          label: String(item?.label || item || '').trim(),
          done: !!item?.done,
        }))
        .filter((item) => item.label);
    }

    return Array.isArray(fallback)
      ? fallback.map((item) => ({
          label: String(item?.label || '').trim(),
          done: !!item?.done,
        })).filter((item) => item.label)
      : [];
  }

  function mapCreatedTaskToUi(task, fallback) {
    const source = task || {};
    const defaultValue = fallback || {};
    const dueDateValue = normalizeDisplayDueDate(
      source.due_date || source.dueDate || defaultValue.due_date || defaultValue.dueDate || ''
    );

    // Normalize attachments: preserve objects with links, or wrap plain strings
    const rawAttachments = source.attachments || defaultValue.attachments || [];
    const attachments = Array.isArray(rawAttachments)
      ? rawAttachments.map(a => {
          if (a && typeof a === 'object') {
            return {
              attachment_id: String(a.attachment_id || a.id || '').trim(),
              file_name: String(a.file_name || a.name || '').trim(),
              file_type: String(a.file_type || '').trim(),
              file_size: String(a.file_size || '').trim(),
              link: String(a.link || '').trim(),
              uploaded_at: String(a.uploaded_at || '').trim(),
            };
          }
          return { attachment_id: '', file_name: String(a || '').trim(), file_type: '', file_size: '', link: '', uploaded_at: '' };
        }).filter(a => a.file_name)
      : [];

    return {
      id: String(source.id || defaultValue.id || '').trim(),
      userId: String(source.user_id || source.userId || defaultValue.user_id || defaultValue.userId || '').trim(),
      title: String(source.task_name || source.title || defaultValue.task_name || defaultValue.title || '').trim(),
      status: String(source.status || defaultValue.status || 'Pending'),
      archivedPreviousStatus: String(source.archived_previous_status || source.archivedPreviousStatus || defaultValue.archived_previous_status || defaultValue.archivedPreviousStatus || '').trim(),
      dueDate: dueDateValue,
      owner: String(source.assigned_by || source.owner || defaultValue.assigned_by || defaultValue.owner || ''),
      createdBy: String(source.created_by || source.createdBy || defaultValue.created_by || defaultValue.createdBy || '').trim(),
      priority: String(source.priority || defaultValue.priority || 'medium'),
      description: String(source.description || defaultValue.description || 'No description provided yet.'),
      attachments,
      dailyChecklist: normalizeTaskChecklist(
        source.daily_checklist || source.checklist,
        defaultValue.dailyChecklist || defaultValue.checklist
      ),
    };
  }

  function isArchivedActivityTask(task) {
    return String(task?.status || '').trim().toLowerCase() === 'archived';
  }

  function isSupervisorUser(user = getCurrentUser()) {
    const role = String(user?.role || user?.effective_role || '').trim().toLowerCase();
    return role === 'supervisor' || role === 'mentor';
  }

  function canModifyTask(task) {
    const currentUser = getCurrentUser();
    const currentUserId = String(currentUser?.user_id || '').trim();
    const currentUserEmail = String(currentUser?.email || '').trim().toLowerCase();
    if (!task || (!currentUserId && !currentUserEmail)) return false;
    if (isSupervisorUser(currentUser)) return true;

    const creatorUserId = String(task?.createdBy || task?.created_by || '').trim();
    if (!creatorUserId) return false;
    const creatorLower = creatorUserId.toLowerCase();
    return creatorUserId === currentUserId || (!!currentUserEmail && creatorLower === currentUserEmail);
  }

  function getTaskStatusLabel(task) {
    if (isArchivedActivityTask(task)) {
      return task?.archivedPreviousStatus || 'Pending';
    }

    return task?.status || 'Pending';
  }

  async function fetchAssignedTasks() {
    const user = getCurrentUser();

    if (!user?.user_id) {
      assignedTasks = [];
      archivedTasks = [];
      assignedTasksError = '';
      return;
    }

    isLoadingAssignedTasks = true;
    assignedTasksError = '';

    try {
      const result = await callGetActivityTasks({
        user_id: user.user_id,
        email: user.email || '',
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to load tasks.');
      }

      const loadedTasks = Array.isArray(result.tasks)
        ? result.tasks.map((task) => mapCreatedTaskToUi(task))
        : [];
      assignedTasks = loadedTasks.filter((task) => !isArchivedActivityTask(task));
      archivedTasks = loadedTasks.filter((task) => isArchivedActivityTask(task));

      if (
        selectedOverviewTaskId &&
        !assignedTasks.some((task) => getTaskActionKey(task) === selectedOverviewTaskId)
      ) {
        selectedOverviewTaskId = '';
      }

      if (viewedTaskId && !assignedTasks.some((task) => getTaskActionKey(task) === viewedTaskId)) {
        closeTaskViewForm();
      }
    } catch (error) {
      assignedTasks = [];
      archivedTasks = [];
      assignedTasksError = error?.message || 'Unable to load tasks.';
    } finally {
      isLoadingAssignedTasks = false;
    }
  }

  async function fetchAssignedSupervisors() {
    const user = getCurrentUser();
    if (!user?.user_id) {
      assignedSupervisors = [];
      assignedSupervisorsError = '';
      return;
    }

    isLoadingAssignedSupervisors = true;
    assignedSupervisorsError = '';

    try {
      const result = await callGetStudentSupervisors({ student_user_id: user.user_id });
      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to load supervisors.');
      }

      assignedSupervisors = Array.isArray(result.supervisors) ? result.supervisors : [];
      if (!addTaskForm.owner && assignedSupervisors.length > 0) {
        addTaskForm.owner = assignedSupervisors[0].user_id;
      }
    } catch (error) {
      assignedSupervisors = [];
      assignedSupervisorsError = error?.message || 'Unable to load supervisors.';
    } finally {
      isLoadingAssignedSupervisors = false;
    }
  }

  async function addNewTask() {
    const rawTitle = addTaskForm.title.trim();
    const assignedBy = addTaskForm.owner.trim();
    const cleanedChecklist = addTaskForm.dailyChecklist
      .filter((item) => item.label.trim())
      .map((item) => ({ label: item.label.trim(), done: !!item.done }));
    const cleanedAttachments = getAttachmentNames(addTaskForm.attachments);

    if (!rawTitle || !addTaskForm.dueDate) {
      return;
    }

    if (!assignedBy) {
      addTaskError = assignedSupervisors.length === 0
        ? 'No supervisor assigned yet.'
        : 'Select a supervisor.';
      return;
    }

    const user = getCurrentUser();
    const nowDate = new Date();
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedNow = `${MONTH_NAMES[nowDate.getMonth()]} ${nowDate.getDate()}, ${nowDate.getFullYear()}`;
    const nextTaskPayload = {
      title: rawTitle,
      status: addTaskForm.status,
      due_date: addTaskForm.dueDate,
      assigned_by: assignedBy,
      owner_email: user && user.email ? user.email : '',
      priority: 'medium',
      description: addTaskForm.description.trim() || 'No description provided yet.',
      attachments: cleanedAttachments,
      dailyChecklist: cleanedChecklist,
      dateCreated: formattedNow,
      // createdBy and updatedBy will be set by backend
    };

    isSavingAddTask = true;
    addTaskError = '';

    try {
      const result = await callCreateActivityTask(nextTaskPayload);

      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to save the task.');
      }

      const savedTask = mapCreatedTaskToUi(result.task, nextTaskPayload);
      const taskId = result.task?.id || '';
      
      // Save attachments to act_attachments sheet
      const attachmentErrors = [];
      if (addTaskForm.attachments.length > 0) {
        for (const attachment of addTaskForm.attachments) {
          // support both plain File objects and wrapped entries created in the UI
          const fileObj = attachment instanceof File ? attachment : (attachment && attachment.file instanceof File ? attachment.file : null);
          const fileName = attachment instanceof File ? attachment.name : (attachment && (attachment.file_name || (attachment.file && attachment.file.name))) || '';

          if (fileObj) {
            try {
              const ext = (fileName || fileObj.name).split('.').pop()?.toLowerCase() || '';
              const sizeMB = `${(fileObj.size / 1024 / 1024).toFixed(2)}MB`;
              // Read file as base64 so the backend can upload it to Drive
              const base64Data = await new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onload = () => res((reader.result || '').replace(/^data:[^;]+;base64,/, ''));
                reader.onerror = () => rej(new Error('Failed to read file'));
                reader.readAsDataURL(fileObj);
              });
              await callAddActivityTaskAttachment({
                task_id: taskId,
                user_id: user?.user_id || '',
                file_type: ext || '',
                file_size: sizeMB,
                file_name: fileName || fileObj.name,
                mime_type: fileObj.type || 'application/octet-stream',
                file_data_base64: base64Data,
                uploaded_at: nowDate.toISOString(),
                uploaded_by: user?.user_id || ''
              });
            } catch (attachError) {
              attachmentErrors.push(`${fileName || 'file'}: ${attachError?.message || attachError}`);
            }
          }
        }
      }
      
      await fetchAssignedTasks();
      selectedOverviewTaskId = getTaskActionKey(savedTask);
      activeView = 'Overview';
      isAddTaskOpen = false;
      resetAddTaskForm();
      // Log activity
      await logUserActivity({
        message: `Added a new task: ${savedTask.title}`,
        timestamp: new Date().toISOString(),
        user: user && user.email ? user.email : 'Unknown'
      });
      fetchRecentActivities();
      
      if (attachmentErrors.length > 0) {
        alert(`Task saved but some attachments failed:\n${attachmentErrors.join('\n')}`);
      }
    } catch (error) {
      addTaskError = error?.message || 'Unable to save the task.';
    } finally {
      isSavingAddTask = false;
    }
  }

  function addNewTaskChecklistItem() {
    addTaskForm = {
      ...addTaskForm,
      dailyChecklist: [...addTaskForm.dailyChecklist, { label: '', done: false }],
    };
  }

  function updateNewTaskChecklistItem(index, field, value) {
    addTaskForm = {
      ...addTaskForm,
      dailyChecklist: addTaskForm.dailyChecklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    };
  }

  function removeNewTaskChecklistItem(index) {
    addTaskForm = {
      ...addTaskForm,
      dailyChecklist: addTaskForm.dailyChecklist.filter((_, itemIndex) => itemIndex !== index),
    };
  }

  function handleAddTaskAttachmentUpload(event) {
    const files = Array.from(event.currentTarget.files || []);
    if (files.length === 0) return;

    const wrapped = files.map((file) => ({
      file,
      file_name: file.name,
      file_type: file.name.split('.').pop()?.toLowerCase() || '',
      file_size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
      link: '',
      uploaded_at: '',
      _objectUrl: URL.createObjectURL(file),
    }));

    addTaskForm = {
      ...addTaskForm,
      attachments: [...addTaskForm.attachments, ...wrapped],
    };

    event.currentTarget.value = '';
  }

  function removeAddTaskAttachment(index) {
    const toRemove = addTaskForm.attachments[index];
    try {
      if (toRemove && toRemove._objectUrl) URL.revokeObjectURL(toRemove._objectUrl);
    } catch (e) {}

    addTaskForm = {
      ...addTaskForm,
      attachments: addTaskForm.attachments.filter((_, itemIndex) => itemIndex !== index),
    };
  }

  function openListWithFilter(filter) {
    statusFilter = filter;
    activeView = 'List';
  }

  function toggleListTask(taskId) {
    expandedListTaskId = expandedListTaskId === taskId ? '' : taskId;
  }

  function openTaskViewForm(task) {
    viewedTaskId = getTaskActionKey(task);
    isEditingViewedTask = false;
    isSavingViewedTask = false;
    taskViewEditForm = {
      title: task.title,
      status: task.status,
      dueDate: toInputDate(task.dueDate),
      description: task.description,
      dailyChecklist: (task.dailyChecklist || []).map((item) => ({ ...item })),
      attachments: (task.attachments || []).map((a) => (typeof a === 'string' ? { file_name: a, link: '' } : { ...a })),
    };
    isViewTaskModalOpen = true;
  }

  function closeTaskViewForm() {
    isViewTaskModalOpen = false;
    viewedTaskId = '';
    isEditingViewedTask = false;
    isSavingViewedTask = false;
    taskViewEditForm = {
      title: '',
      status: 'Pending',
      dueDate: '',
      description: '',
      assignedBy: '',
      dailyChecklist: [],
      attachments: [],
    };
    
    // Reset the file input element
    if (taskViewFileInput) {
      taskViewFileInput.value = '';
    }
  }

  function handleTaskViewOverlayClick(event) {
    if (event.target === event.currentTarget) {
      closeTaskViewForm();
    }
  }

  function openTaskEditFromView() {
    if (!viewedTask) {
      return;
    }
    if (!canModifyTask(viewedTask)) {
      alert(TASK_EDIT_RESTRICTED_MESSAGE);
      return;
    }

    taskViewEditForm = {
      title: viewedTask.title,
      status: viewedTask.status,
      dueDate: toInputDate(viewedTask.dueDate),
      description: viewedTask.description,
      assignedBy: viewedTask.owner || assignedSupervisors[0]?.user_id || '',
      dailyChecklist: viewedTask.dailyChecklist.map((item) => ({ ...item })),
      attachments: (viewedTask.attachments || []).map((a) => (typeof a === 'string' ? { file_name: a, link: '' } : { ...a })),
    };
    isEditingViewedTask = true;
  }

  function cancelTaskEditFromView() {
    if (viewedTask) {
      taskViewEditForm = {
        title: viewedTask.title,
        status: viewedTask.status,
        dueDate: toInputDate(viewedTask.dueDate),
        description: viewedTask.description,
        assignedBy: viewedTask.owner || assignedSupervisors[0]?.user_id || '',
        dailyChecklist: viewedTask.dailyChecklist.map((item) => ({ ...item })),
        attachments: (viewedTask.attachments || []).map((a) => (typeof a === 'string' ? { file_name: a, link: '' } : { ...a })),
      };
    }

    isEditingViewedTask = false;
  }

  function addTaskViewChecklistItem() {
    taskViewEditForm = {
      ...taskViewEditForm,
      dailyChecklist: [...taskViewEditForm.dailyChecklist, { label: '', done: false }],
    };
  }

  function updateTaskViewChecklistItem(index, field, value) {
    taskViewEditForm = {
      ...taskViewEditForm,
      dailyChecklist: taskViewEditForm.dailyChecklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    };
  }

  function removeTaskViewChecklistItem(index) {
    taskViewEditForm = {
      ...taskViewEditForm,
      dailyChecklist: taskViewEditForm.dailyChecklist.filter((_, itemIndex) => itemIndex !== index),
    };
  }

  // Fix: Move updateTaskStatus to top-level scope
  async function updateTaskStatus(taskId, newStatus) {
    let taskIndex = assignedTasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1 && viewedTask) {
      taskIndex = assignedTasks.findIndex((t) => t.title === viewedTask.title);
    }
    if (taskIndex === -1) return;

    const task = assignedTasks[taskIndex];
    if (!canModifyTask(task)) {
      alert(TASK_EDIT_RESTRICTED_MESSAGE);
      return;
    }
    const user = getCurrentUser();
    const payload = {
      id: taskId || task.id,
      title: task.title,
      status: newStatus,
      due_date: toInputDate(task.dueDate),
      description: task.description,
      assigned_by: task.owner,
      created_by: task.createdBy || task.created_by || '',
      // Include checklist using multiple keys to be compatible with backend handlers
      checklist: task.dailyChecklist,
      dailyChecklist: task.dailyChecklist,
      daily_checklist: task.dailyChecklist,
      attachments: task.attachments,
      priority: task.priority,
      user_id: task.userId || user?.user_id || '',
      owner_email: user?.email || '',
      updated_by: user?.user_id || '',
    };
    try {
      const result = await callUpdateActivityTask(payload);
      const nextTask = result?.task ? mapCreatedTaskToUi(result.task, payload) : { ...task, status: newStatus };
      assignedTasks = assignedTasks.map((t, i) =>
        i === taskIndex ? nextTask : t
      );
      if (viewedTask && viewedTask.id === (taskId || task.id)) {
        taskViewEditForm.status = newStatus;
      }
      
      // Log activity
      await logUserActivity({
        message: `Updated task status: ${task.title} → ${newStatus}`,
        timestamp: new Date().toISOString(),
        user: user && user.email ? user.email : 'Unknown'
      });
    } catch (err) {
      alert('Failed to update status: ' + (err?.message || err));
    }
  }

  function handleTaskViewAttachmentUpload(event) {
    const files = Array.from(event.currentTarget.files || []);

    if (files.length === 0) {
      return;
    }

    // Store new File objects wrapped as attachment-like objects (file_name set, file property for later upload)
    const newEntries = files.map(file => ({
      attachment_id: '',
      file_name: file.name,
      file_type: file.name.split('.').pop()?.toLowerCase() || '',
      file_size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
      link: '',
      uploaded_at: '',
      _file: file, // transient: used when saving
    }));

    taskViewEditForm = {
      ...taskViewEditForm,
      attachments: [...taskViewEditForm.attachments, ...newEntries],
    };

    event.currentTarget.value = '';
  }

  function removeTaskViewAttachment(index) {
    taskViewEditForm = {
      ...taskViewEditForm,
      attachments: taskViewEditForm.attachments.filter((_, itemIndex) => itemIndex !== index),
    };
  }

  function buildTaskUpdatePayload(task, formState) {
    const user = getCurrentUser();
    const cleanedChecklist = formState.dailyChecklist
      .filter((item) => item.label.trim())
      .map((item) => ({ label: item.label.trim(), done: !!item.done }));
    // attachments may be objects or strings; extract filenames for the activity_logs column
    const cleanedAttachments = getAttachmentNames(formState.attachments);

    return {
      id: task.id,
      user_id: task.userId || user?.user_id || '',
      title: formState.title.trim() || task.title,
      status: formState.status || task.status,
      due_date: formState.dueDate || toInputDate(task.dueDate),
      description: formState.description.trim() || task.description,
      assigned_by: formState.assignedBy || task.owner,
      created_by: task.createdBy || task.created_by || '',
      // Send checklist under multiple keys for compatibility with backend Apps Script
      checklist: cleanedChecklist,
      dailyChecklist: cleanedChecklist,
      daily_checklist: cleanedChecklist,
      attachments: cleanedAttachments,
      priority: task.priority || 'medium',
      owner_email: user?.email || '',
      updated_by: user?.user_id || '',
    };
  }

  function applyTaskUpdateToUi(originalId, nextTask) {
    const nextKey = getTaskActionKey(nextTask);
    assignedTasks = assignedTasks.map((task) => (getTaskActionKey(task) === originalId ? nextTask : task));

    if (selectedOverviewTaskId === originalId) {
      selectedOverviewTaskId = nextKey;
    }

    if (expandedListTaskId === originalId) {
      expandedListTaskId = nextKey;
    }

    if (viewedTaskId === originalId) {
      viewedTaskId = nextKey;
    }
  }

  async function saveTaskEditFromView() {
    if (!viewedTask || isSavingViewedTask) {
      return;
    }
    if (!canModifyTask(viewedTask)) {
      alert(TASK_EDIT_RESTRICTED_MESSAGE);
      return;
    }

    const originalId = getTaskActionKey(viewedTask);
    const payload = buildTaskUpdatePayload(viewedTask, taskViewEditForm);
    isSavingViewedTask = true;

    try {
      const result = await callUpdateActivityTask(payload);
      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to save task changes.');
      }

      const nextTask = mapCreatedTaskToUi(result.task, payload);

      // Upload any newly added attachments (those with _file property)
      const user = getCurrentUser();
      const nowDate = new Date();
      const newAttachments = taskViewEditForm.attachments.filter(a => a && a._file instanceof File);
      for (const entry of newAttachments) {
        try {
          const base64Data = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res((reader.result || '').replace(/^data:[^;]+;base64,/, ''));
            reader.onerror = () => rej(new Error('Failed to read file'));
            reader.readAsDataURL(entry._file);
          });
          const attResult = await callAddActivityTaskAttachment({
            task_id: viewedTask.id,
            user_id: user?.user_id || '',
            file_type: entry.file_type || '',
            file_size: entry.file_size || '',
            file_name: entry.file_name,
            mime_type: entry._file.type || 'application/octet-stream',
            file_data_base64: base64Data,
            uploaded_at: nowDate.toISOString(),
            uploaded_by: user?.user_id || '',
          });
          if (attResult?.ok && attResult.attachment?.link) {
            entry.link = attResult.attachment.link;
          }
        } catch (e) {
          // non-fatal
        }
      }

      applyTaskUpdateToUi(originalId, nextTask);
      isEditingViewedTask = false;

      // Refresh tasks to get updated attachment list from backend
      await fetchAssignedTasks();
      
      // Reset the file input element
      if (taskViewFileInput) {
        taskViewFileInput.value = '';
      }
    } catch (error) {
      alert('Failed to save task: ' + (error?.message || error));
    } finally {
      isSavingViewedTask = false;
    }
  }

  async function archiveTaskFromView() {
    if (!viewedTask) {
      return;
    }

    const targetId = getTaskActionKey(viewedTask);
    closeTaskViewForm();
    await archiveTask(targetId);

    if (expandedListTaskId === targetId) {
      expandedListTaskId = '';
    }
  }

  function openArchiveView() {
    activeView = 'Archive';
  }

  function selectOverviewTask(task) {
    selectedOverviewTaskId = getTaskActionKey(task);
    trackerMenuOpen = false;
    isEditingTrackerTask = false;
  }

  function toggleTrackerMenu() {
    trackerMenuOpen = !trackerMenuOpen;
  }

  function openTrackerEdit() {
    if (!selectedOverviewTask) {
      return;
    }
    if (!canModifyTask(selectedOverviewTask)) {
      alert(TASK_EDIT_RESTRICTED_MESSAGE);
      return;
    }

    trackerEditForm = {
      title: selectedOverviewTask.title,
      status: selectedOverviewTask.status,
      dueDate: toInputDate(selectedOverviewTask.dueDate),
      description: selectedOverviewTask.description,
      dailyChecklist: selectedOverviewTask.dailyChecklist.map((item) => ({ ...item })),
      attachments: (selectedOverviewTask.attachments || []).map((a) => (typeof a === 'string' ? { file_name: a, link: '' } : { ...a })),
    };
    isEditingTrackerTask = true;
    trackerMenuOpen = false;
  }

  function cancelTrackerEdit() {
    isEditingTrackerTask = false;
    
    // Reset the file input element
    if (trackerFileInput) {
      trackerFileInput.value = '';
    }
  }

  async function saveTrackerEdit() {
    if (!selectedOverviewTask) {
      return;
    }
    if (!canModifyTask(selectedOverviewTask)) {
      alert(TASK_EDIT_RESTRICTED_MESSAGE);
      return;
    }

    const originalId = getTaskActionKey(selectedOverviewTask);
    const payload = buildTaskUpdatePayload(selectedOverviewTask, trackerEditForm);

    try {
      const result = await callUpdateActivityTask(payload);
      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to save task changes.');
      }

      const nextTask = mapCreatedTaskToUi(result.task, payload);
      applyTaskUpdateToUi(originalId, nextTask);
      selectedOverviewTaskId = getTaskActionKey(nextTask);
      isEditingTrackerTask = false;

      // Upload any newly added attachments (those with _file property)
      const user = getCurrentUser();
      const nowDate = new Date();
      const newAttachments = trackerEditForm.attachments.filter(a => a && a._file instanceof File);
      for (const entry of newAttachments) {
        try {
          const base64Data = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res((reader.result || '').replace(/^data:[^;]+;base64,/, ''));
            reader.onerror = () => rej(new Error('Failed to read file'));
            reader.readAsDataURL(entry._file);
          });
          await callAddActivityTaskAttachment({
            task_id: selectedOverviewTask.id,
            user_id: user?.user_id || '',
            file_type: entry.file_type || '',
            file_size: entry.file_size || '',
            file_name: entry.file_name,
            mime_type: entry._file.type || 'application/octet-stream',
            file_data_base64: base64Data,
            uploaded_at: nowDate.toISOString(),
            uploaded_by: user?.user_id || '',
          });
        } catch (e) {
          // non-fatal
        }
      }

      // Refresh tasks to get updated attachment list from backend
      await fetchAssignedTasks();
      
      // Reset the file input element
      if (trackerFileInput) {
        trackerFileInput.value = '';
      }
    } catch (error) {
      alert('Failed to save task: ' + (error?.message || error));
    }
  }

  async function archiveTask(targetId) {
    const taskToArchive = assignedTasks.find((task) => getTaskActionKey(task) === targetId);

    if (!taskToArchive) {
      return false;
    }
    if (!canModifyTask(taskToArchive)) {
      alert(TASK_EDIT_RESTRICTED_MESSAGE);
      return false;
    }

    const taskKey = getTaskActionKey(taskToArchive);
    if (!taskKey || archivingTaskMap[taskKey]) {
      return false;
    }

    const user = getCurrentUser();
    const archivedTask = {
      ...taskToArchive,
      status: 'Archived',
      archivedPreviousStatus: getTaskStatusLabel(taskToArchive),
    };

    archivingTaskMap = { ...archivingTaskMap, [taskKey]: true };

    try {
      const result = await callSetActivityTaskArchiveStatus({
        id: taskToArchive.id,
        user_id: taskToArchive.userId || user?.user_id || '',
        archived: true,
        updated_by: user?.user_id || '',
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to archive task.');
      }

      const savedTask = mapCreatedTaskToUi(result.task, archivedTask);
      assignedTasks = assignedTasks.filter(
        (task) => getTaskActionKey(task) !== taskKey
      );
      archivedTasks = [
        savedTask,
        ...archivedTasks.filter((task) => getTaskActionKey(task) !== taskKey),
      ];

      if (selectedOverviewTaskId === targetId) {
        selectedOverviewTaskId = '';
      }
      return true;
    } catch (error) {
      alert('Failed to archive task: ' + (error?.message || error));
      return false;
    } finally {
      const { [taskKey]: _, ...rest } = archivingTaskMap;
      archivingTaskMap = rest;
    }
  }

  async function restoreArchivedTask(targetId) {
    const taskToRestore = archivedTasks.find((task) => getTaskActionKey(task) === targetId);

    if (!taskToRestore) {
      return;
    }
    if (!canModifyTask(taskToRestore)) {
      alert(TASK_EDIT_RESTRICTED_MESSAGE);
      return;
    }

    const taskKey = getTaskActionKey(taskToRestore);
    if (!taskKey || restoringTaskMap[taskKey]) {
      return;
    }

    const user = getCurrentUser();
    const restoredTask = {
      ...taskToRestore,
      status: getTaskStatusLabel(taskToRestore),
      archivedPreviousStatus: '',
    };

    restoringTaskMap = { ...restoringTaskMap, [taskKey]: true };

    try {
      const result = await callSetActivityTaskArchiveStatus({
        id: taskToRestore.id,
        user_id: taskToRestore.userId || user?.user_id || '',
        archived: false,
        updated_by: user?.user_id || '',
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Unable to restore task.');
      }

      const savedTask = mapCreatedTaskToUi(result.task, restoredTask);
      assignedTasks = [
        savedTask,
        ...assignedTasks.filter((task) => getTaskActionKey(task) !== taskKey),
      ];
      archivedTasks = archivedTasks.filter(
        (task) => getTaskActionKey(task) !== taskKey
      );
    } catch (error) {
      alert('Failed to restore task: ' + (error?.message || error));
    } finally {
      const { [taskKey]: _, ...rest } = restoringTaskMap;
      restoringTaskMap = rest;
    }
  }

  async function handleTrackerAction(action) {
    if (action === 'edit') {
      openTrackerEdit();
      return;
    }

    if (action === 'view') {
      if (selectedOverviewTask) {
        openTaskViewForm(selectedOverviewTask);
      }

      trackerMenuOpen = false;
      return;
    }

    if (!selectedOverviewTask) {
      trackerMenuOpen = false;
      return;
    }

    const targetId = getTaskActionKey(selectedOverviewTask);

    if (action === 'archive') {
      await archiveTask(targetId);
    }

    trackerMenuOpen = false;
  }

  function toggleTrackerChecklistItem(index) {
    if (!selectedOverviewTask) {
      return;
    }

    assignedTasks = assignedTasks.map((task) => {
      if (task.title !== selectedOverviewTask.title) {
        return task;
      }

      return {
        ...task,
        dailyChecklist: task.dailyChecklist.map((item, itemIndex) =>
          itemIndex === index ? { ...item, done: !item.done } : item
        ),
      };
    });
  }

  function addChecklistItem() {
    trackerEditForm = {
      ...trackerEditForm,
      dailyChecklist: [...trackerEditForm.dailyChecklist, { label: '', done: false }],
    };
  }

  function updateChecklistItem(index, field, value) {
    trackerEditForm = {
      ...trackerEditForm,
      dailyChecklist: trackerEditForm.dailyChecklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    };
  }

  function removeChecklistItem(index) {
    trackerEditForm = {
      ...trackerEditForm,
      dailyChecklist: trackerEditForm.dailyChecklist.filter((_, itemIndex) => itemIndex !== index),
    };
  }

  function handleEditTaskAttachmentUpload(event) {
    const files = Array.from(event.currentTarget.files || []);

    if (files.length === 0) {
      return;
    }

    const newEntries = files.map(file => ({
      attachment_id: '',
      file_name: file.name,
      file_type: file.name.split('.').pop()?.toLowerCase() || '',
      file_size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
      link: '',
      uploaded_at: '',
      _file: file,
    }));

    trackerEditForm = {
      ...trackerEditForm,
      attachments: [...trackerEditForm.attachments, ...newEntries],
    };

    event.currentTarget.value = '';
  }

  function removeEditTaskAttachment(index) {
    trackerEditForm = {
      ...trackerEditForm,
      attachments: trackerEditForm.attachments.filter((_, itemIndex) => itemIndex !== index),
    };
  }

  $: filteredTasks = assignedTasks.filter(
    (task) => matchesStatus(task, statusFilter) && matchesSearch(task, searchQuery)
  );

  $: filteredArchivedTasks = archivedTasks.filter(
    (task) => matchesStatus(task, statusFilter) && matchesSearch(task, searchQuery)
  );

  $: pendingCount = assignedTasks.filter((task) => task.status === 'Pending').length;
  $: completedCount = assignedTasks.filter((task) => task.status === 'Completed').length;
  $: totalTaskCount = assignedTasks.length;
  $: overdueCount = assignedTasks.filter((task) => task.status === 'Overdue').length;
  $: completionRate = totalTaskCount > 0 ? Math.round((completedCount / totalTaskCount) * 100) : 0;
  $: summaryCards = [
    {
      label: 'Pending',
      value: pendingCount,
      icon: Clock,
      tone: 'amber',
    },
    {
      label: 'Total Tasks',
      value: totalTaskCount,
      icon: Clock3,
      tone: 'blue',
    },
    {
      label: 'Completed',
      value: completedCount,
      icon: CheckCircle2,
      tone: 'green',
    },
    {
      label: 'Overdue',
      value: overdueCount,
      icon: AlertCircle,
      tone: 'red',
    },
  ];
  $: todayDate = normalizeDate(new Date());
  $: todayTasks = assignedTasks
    .filter((task) => task.status !== 'Completed')
    .filter((task) => {
      const parsedDueDate = parseDueDate(task.dueDate);
      return parsedDueDate ? isSameCalendarDay(normalizeDate(parsedDueDate), todayDate) : false;
    })
    .slice(0, 4);
  $: overdueTasks = assignedTasks.filter((task) => task.status === 'Overdue').slice(0, 3);
  $: dueSoonTasks = [...assignedTasks]
    .filter((task) => task.status !== 'Completed')
    .sort((a, b) => {
      const aDate = parseDueDate(a.dueDate);
      const bDate = parseDueDate(b.dueDate);
      const aTime = aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })
    .slice(0, 4);
  $: selectedOverviewTask =
    assignedTasks.find((task) => getTaskActionKey(task) === selectedOverviewTaskId) ||
    todayTasks[0] ||
    overdueTasks[0] ||
    dueSoonTasks[0] ||
    null;
  $: viewedTask = assignedTasks.find((task) => getTaskActionKey(task) === viewedTaskId) || null;
  $: statsLoading = isLoadingAssignedTasks || isLoadingWorkLogs;
  $: if (isViewTaskModalOpen && viewedTask && isEditingViewedTask && !canModifyTask(viewedTask)) {
    isEditingViewedTask = false;
    isSavingViewedTask = false;
  }
  $: if (pendingDeepLinkTaskId && assignedTasks.length) {
    const targetTask = assignedTasks.find((task) => getTaskActionKey(task) === pendingDeepLinkTaskId);
    if (targetTask) {
      activeView = 'List';
      openTaskViewForm(targetTask);
      pendingDeepLinkTaskId = '';
      clearTaskIntentFromHash();
    }
  }

</script>

<section class="activity-shell documents-page projects-page">
  <div class="stats-grid">
    {#if statsLoading}
      {#each [1, 2, 3, 4] as _}
        <article class="stat-card stat-loading-card">
          <div class="act-skeleton shimmer stat-loading-icon"></div>
          <div class="stat-body">
            <div class="act-skeleton shimmer stat-loading-label"></div>
            <div class="act-skeleton shimmer stat-loading-value"></div>
            <div class="act-skeleton shimmer stat-loading-sub"></div>
          </div>
        </article>
      {/each}
    {:else}
      {#each summaryCards as card}
        <article class={`stat-card tone-card-${card.tone}`}>
          <div class={`stat-icon tone-${card.tone}`}>
            <svelte:component this={card.icon} size={17} />
          </div>
          <div class="stat-body">
            <p class="stat-label">{card.label}</p>
            <p class="stat-value">{card.value}</p>
            <p class="stat-sub">
              {card.label === 'Pending'
                ? 'Tasks waiting to start'
                : card.label === 'Total Tasks'
                  ? 'All assigned tasks'
                  : card.label === 'Completed'
                    ? 'Finished tasks'
                    : 'Needs immediate attention'}
            </p>
          </div>
        </article>
      {/each}
    {/if}
  </div>

  <section class="quick-panel">
    <div class="quick-head">
      <div class="view-toggle view-controls" role="tablist" aria-label="View mode">
      <button
        type="button"
        class="btn btn-ghost"
        role="tab"
        class:active={activeView === 'Overview'}
        aria-selected={activeView === 'Overview'}
        on:click={() => (activeView = 'Overview')}
      >
        <LayoutGrid size={14} />
        <span>Overview</span>
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        role="tab"
        class:active={activeView === 'List'}
        aria-selected={activeView === 'List'}
        on:click={() => (activeView = 'List')}
      >
        <List size={14} />
        <span>List</span>
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        role="tab"
        class:active={activeView === 'Archive'}
        aria-selected={activeView === 'Archive'}
        on:click={openArchiveView}
      >
        <Archive size={14} />
        <span>Archive</span>
      </button>
    </div>

    <div class="controls-right quick-actions">
      <label class="search-control search-wrap" aria-label="Search tasks">
        <Search size={15} />
        <input
          class="search-input"
          type="text"
          placeholder="Search"
          bind:value={searchQuery}
        />
      </label>

      <label class="status-control" aria-label="Status filter">
        <select class="quick-status" bind:value={statusFilter}>
          {#each statusOptions as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>

      <button class="new-task-btn primary" type="button" on:click={toggleAddTaskForm}>
        <Plus size={15} />
        <span>Add Task</span>
      </button>
    </div>
    </div>
  </section>

  {#if assignedTasksError && !isLoadingAssignedTasks}
    <p class="task-form-error">{assignedTasksError}</p>
  {/if}

  {#if isAddTaskOpen}
    <div class="task-view-modal-overlay" role="presentation" on:click={handleAddTaskOverlayClick}>
      <div
        class="task-view-modal task-add-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add task form"
      >
        <form class="task-view-add-form" on:submit|preventDefault={addNewTask}>
          <div class="task-view-modal-head">
            <h4>Add Task</h4>
          </div>

          <div class="task-add-modal-content">
            {#if addTaskError}
              <p class="task-form-error">{addTaskError}</p>
            {/if}

          <div class="task-view-grid">
            <label class="title-field">
              <span>Task Title</span>
              <input id="task-title" type="text" bind:value={addTaskForm.title} required />
            </label>

            <label class="status-field">
              <span>Status</span>
              <select id="task-status" bind:value={addTaskForm.status}>
                {#each editStatusOptions as option}
                  <option value={option}>{option}</option>
                {/each}
              </select>
            </label>

            <label class="due-field">
              <span>Due Date</span>
              <input id="task-due" type="date" bind:value={addTaskForm.dueDate} required />
            </label>

            <label class="assigned-field">
              <span>Assigned by</span>
              <select id="task-owner" bind:value={addTaskForm.owner} disabled={isLoadingAssignedSupervisors || assignedSupervisors.length === 0}>
                {#if isLoadingAssignedSupervisors}
                  <option value="">Loading supervisors...</option>
                {:else if assignedSupervisors.length === 0}
                  <option value="">N/A</option>
                {:else}
                  <option value="">N/A</option>
                  {#each assignedSupervisors as supervisor}
                    <option value={supervisor.user_id}>
                      {getSupervisorOptionLabel(supervisor)}
                    </option>
                  {/each}
                {/if}
              </select>
            </label>
          </div>

          <label class="task-view-description">
            <span>Description</span>
            <textarea id="task-desc" rows="4" bind:value={addTaskForm.description}></textarea>
          </label>

          <div class="task-view-section">
            <div class="task-view-section-head">
              <span>Checklist</span>
              <div class="task-view-section-actions">
                <button type="button" class="ghost btn-compact" on:click={addNewTaskChecklistItem}>+ Add item</button>
              </div>
            </div>
            {#if addTaskForm.dailyChecklist.length > 0}
              <ul style="list-style:none; padding:0; margin:0.5rem 0 0 0;">
                {#each addTaskForm.dailyChecklist as item, index}
                  <li style="display:flex; gap:0.5rem; align-items:center; padding:0.25rem 0;">
                    <input
                      type="checkbox"
                      checked={item.done}
                      on:change={() => updateNewTaskChecklistItem(index, 'done', !item.done)}
                    />
                    <input
                      type="text"
                      value={item.label}
                      on:input={(event) => updateNewTaskChecklistItem(index, 'label', event.currentTarget.value)}
                      placeholder="Item label"
                      style="flex:1;"
                    />
                    <button type="button" class="remove-item" on:click={() => removeNewTaskChecklistItem(index)}>Remove</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <div class="task-view-section">
            <div class="attachment-editor">
              <div class="attachment-editor-head">
                <span>Attachments</span>
                <label class="attachment-upload-btn" for="add-task-file-upload">Upload files</label>
                <input
                  id="add-task-file-upload"
                  class="hidden-file-input"
                  type="file"
                  multiple
                  on:change={handleAddTaskAttachmentUpload}
                  bind:this={addTaskFileInput}
                />
              </div>

              {#if addTaskForm.attachments.length > 0}
                <ul class="attachment-list">
                  {#each addTaskForm.attachments as attachment, index}
                    <li>
                      <div class="attachment-row">
                        <div class="attachment-main">
                          <span>{(attachment && (attachment.file_name || attachment.name)) || attachment}</span>
                        </div>
                        <div class="attachment-actions">
                          <button type="button" class="remove-item" on:click={() => removeAddTaskAttachment(index)}>Remove</button>
                        </div>
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
          </div>

          <div class="task-add-modal-footer">
            <button type="button" class="task-view-action" on:click={cancelAddTask}>Cancel</button>
            <button type="submit" class="task-view-action primary" style="display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;" disabled={isSavingAddTask}>
              {#if isSavingAddTask}
                <span class="spinning-icon"><Loader2 size={16} /></span>
              {/if}
              <span>{isSavingAddTask ? 'Saving...' : 'Save Task'}</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  {/if}

  <div class="documents-grid">
    {#if isLoadingAssignedTasks}
      <section class="tasks-loading-shell" aria-label="Loading tasks">
        <div class="task-loading-grid">
          <article class="task-loading-card">
            <div class="task-loading-head">
              <div class="act-skeleton shimmer" style="width: 26px; height: 26px; border-radius: 8px;"></div>
              <div class="act-skeleton shimmer" style="width: 120px; height: 14px;"></div>
            </div>
            <div class="task-loading-lines">
              <div class="act-skeleton shimmer" style="width: 100%; height: 12px;"></div>
              <div class="act-skeleton shimmer" style="width: 78%; height: 12px;"></div>
              <div class="act-skeleton shimmer" style="width: 56%; height: 12px;"></div>
            </div>
          </article>
          <article class="task-loading-card">
            <div class="task-loading-head">
              <div class="act-skeleton shimmer" style="width: 26px; height: 26px; border-radius: 8px;"></div>
              <div class="act-skeleton shimmer" style="width: 100px; height: 14px;"></div>
            </div>
            <div class="task-loading-lines">
              <div class="act-skeleton shimmer" style="width: 100%; height: 12px;"></div>
              <div class="act-skeleton shimmer" style="width: 74%; height: 12px;"></div>
              <div class="act-skeleton shimmer" style="width: 52%; height: 12px;"></div>
            </div>
          </article>
          <article class="task-loading-card">
            <div class="task-loading-head">
              <div class="act-skeleton shimmer" style="width: 26px; height: 26px; border-radius: 8px;"></div>
              <div class="act-skeleton shimmer" style="width: 132px; height: 14px;"></div>
            </div>
            <div class="task-loading-lines">
              <div class="act-skeleton shimmer" style="width: 100%; height: 12px;"></div>
              <div class="act-skeleton shimmer" style="width: 82%; height: 12px;"></div>
              <div class="act-skeleton shimmer" style="width: 58%; height: 12px;"></div>
            </div>
          </article>
        </div>
        <div class="daily-logs-content task-loading-worklogs">
          <article class="worklog-card worklog-form-card task-loading-worklog">
            <div class="task-loading-head">
              <div class="act-skeleton shimmer" style="width: 26px; height: 26px; border-radius: 8px;"></div>
              <div class="act-skeleton shimmer" style="width: 120px; height: 14px;"></div>
            </div>
            <div class="task-loading-lines">
              <div class="act-skeleton shimmer" style="width: 100%; height: 14px;"></div>
              <div class="act-skeleton shimmer" style="width: 100%; height: 60px;"></div>
              <div class="act-skeleton shimmer" style="width: 100%; height: 14px;"></div>
              <div class="act-skeleton shimmer" style="width: 100%; height: 60px;"></div>
              <div class="act-skeleton shimmer" style="width: 100%; height: 14px;"></div>
              <div class="act-skeleton shimmer" style="width: 100%; height: 60px;"></div>
              <div class="act-skeleton shimmer" style="width: 88px; height: 34px; border-radius: 10px;"></div>
              <div class="act-skeleton shimmer" style="width: 100%; height: 40px; border-radius: 10px;"></div>
            </div>
          </article>
          <article class="worklog-card worklog-list-card task-loading-worklog">
            <div class="task-loading-worklog-head">
              <div class="task-loading-head">
                <div class="act-skeleton shimmer" style="width: 26px; height: 26px; border-radius: 8px;"></div>
                <div class="act-skeleton shimmer" style="width: 92px; height: 14px;"></div>
              </div>
              <div class="task-loading-worklog-filters">
                <div class="act-skeleton shimmer" style="width: 180px; height: 34px; border-radius: 10px;"></div>
                <div class="act-skeleton shimmer" style="width: 122px; height: 34px; border-radius: 10px;"></div>
              </div>
            </div>
            <div class="task-loading-worklog-list">
              {#each [1, 2, 3] as _}
                <article class="task-loading-worklog-item">
                  <div class="act-skeleton shimmer" style="width: 42%; height: 14px;"></div>
                  <div class="act-skeleton shimmer" style="width: 120px; height: 12px;"></div>
                </article>
              {/each}
            </div>
          </article>
        </div>
      </section>
    {:else}
      {#if activeView === 'Overview'}
        <div class="overview-shell">
          <div class="overview-panels">
            <section class="overview-panel task-list-panel" style="background: var(--color-surface);">
              <h4 style="display: flex; align-items: center; gap: 0.5rem;">
                <LayoutGrid size={18} style="color: #0f6cbd; background: color-mix(in srgb, #0f6cbd 10%, var(--color-surface)); border-radius: 0.4rem; padding: 0.18rem;" />
                Today's Task
              </h4>
              {#if todayTasks.length === 0}
                <p class="overview-empty-copy">No tasks with today's deadline.</p>
              {:else}
                <ul class="overview-task-list due-soon-task-list">
                  {#each todayTasks as task}
                    <li>
                      <button
                        type="button"
                        class="overview-task-link due-soon-task-link"
                        on:click={() => openTaskViewForm(task)}
                      >
                        <span>{task.title}</span>
                        <small>{formatDueDate(task.dueDate)}</small>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>

            <section class="overview-panel task-list-panel">
              <h4 style="display: flex; align-items: center; gap: 0.5rem;">
                <Clock size={18} style="color: #22c55e; background: color-mix(in srgb, #22c55e 10%, var(--color-surface)); border-radius: 0.4rem; padding: 0.18rem;" />
                Due Soon
              </h4>
              {#if dueSoonTasks.length === 0}
                <p class="overview-empty-copy">No upcoming due dates.</p>
              {:else}
                <ul class="overview-task-list due-soon-task-list">
                  {#each dueSoonTasks as task}
                    <li>
                      <button
                        type="button"
                        class="overview-task-link due-soon-task-link"
                        on:click={() => openTaskViewForm(task)}
                      >
                        <span>{task.title}</span>
                        <small>{formatDueDate(task.dueDate)}</small>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>

            <section class="overview-panel notes-panel task-list-panel">
              <div class="notes-header" style="display: flex; align-items: center; gap: 0.5rem;">
                <List size={18} style="color: #0f6cbd; background: color-mix(in srgb, #0f6cbd 10%, var(--color-surface)); border-radius: 0.4rem; padding: 0.18rem;" />
                <div class="notes-title">Recent Activity</div>
              </div>
              <div class="recent-activity-list" style="margin-bottom: 0.5rem;">
                {#if recentActivities.length === 0}
                  <p class="overview-empty-copy">No recent activities yet.</p>
                {:else}
                  <ul style="list-style: none; padding: 0; margin: 0;">
                    {#each recentActivities.slice(0, 3) as activity (activity.id)}
                      <li style="margin-bottom: 0.8rem; display: flex; align-items: flex-start; gap: 0.5rem;">
                        <span style="font-size: 1.1rem; color: var(--color-primary, #0f6cbd); margin-top: 0.1rem;">•</span>
                        <div style="flex: 1;">
                                <div style="font-size: 0.9rem; font-style: italic; color: var(--color-text);">{formatActivityLine(activity)}</div>
                              </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </section>
          </div>
        </div>
      {:else if activeView === 'List'}
        <section class="intern-task-scroll-shell" role="table" aria-label="Assigned tasks list">
          <div class="intern-task-scroll-head" role="rowgroup" aria-hidden="true">
            <div class="task-scroll-row task-scroll-header">
              <div class="task-col task-col-title">Tasks</div>
              <div class="task-col task-col-due">Due Date</div>
              <div class="task-col task-col-status">Status</div>
              <div class="task-col task-col-actions">Actions</div>
            </div>
          </div>
          <div class="intern-task-scroll-body">
            {#if filteredTasks.length === 0}
              <p class="empty-state">No tasks found for current filter.</p>
            {:else}
              <div class="intern-task-scroll-table" role="rowgroup">
                {#each filteredTasks as task}
                  <div class="task-scroll-row" role="row">
                    <div class="task-col task-col-title" role="cell">
                      <div class="task-scroll-title" title={task.title}>{task.title}</div>
                    </div>
                    <div class="task-col task-col-due" role="cell">{formatDueDate(task.dueDate)}</div>
                    <div class="task-col task-col-status" role="cell">
                      <span class={`status-pill ${statusClassMap[task.status]}`}>{task.status}</span>
                    </div>
                    <div class="task-col task-col-actions" role="cell">
                      <button
                        class="task-icon-btn"
                        type="button"
                        title="View task"
                        aria-label={`View ${task.title}`}
                        on:click={() => openTaskViewForm(task)}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        class="task-icon-btn"
                        class:is-busy={!!archivingTaskMap[getTaskActionKey(task)]}
                        type="button"
                        title={!canModifyTask(task) ? 'Only task creator or supervisor can archive this task' : (archivingTaskMap[getTaskActionKey(task)] ? 'Archiving...' : 'Archive task')}
                        aria-label={!canModifyTask(task) ? `Archive unavailable for ${task.title}` : (archivingTaskMap[getTaskActionKey(task)] ? `Archiving ${task.title}` : `Archive ${task.title}`)}
                        aria-busy={!!archivingTaskMap[getTaskActionKey(task)]}
                        disabled={!canModifyTask(task) || !!archivingTaskMap[getTaskActionKey(task)]}
                        on:click={() => archiveTask(getTaskActionKey(task))}
                      >
                        {#if archivingTaskMap[getTaskActionKey(task)]}
                          <Loader2 size={16} class="spin" />
                        {:else}
                          <Archive size={16} />
                        {/if}
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {:else}
        <section class="intern-task-scroll-shell" role="table" aria-label="Archived tasks list">
          <div class="intern-task-scroll-head" role="rowgroup" aria-hidden="true">
            <div class="task-scroll-row task-scroll-header">
              <div class="task-col task-col-title">Archive</div>
              <div class="task-col task-col-due">Due Date</div>
              <div class="task-col task-col-status">Status</div>
              <div class="task-col task-col-actions">Action</div>
            </div>
          </div>
          <div class="intern-task-scroll-body">
            {#if filteredArchivedTasks.length === 0}
              <p class="empty-state">No archived tasks yet.</p>
            {:else}
              <div class="intern-task-scroll-table" role="rowgroup">
                {#each filteredArchivedTasks as task}
                  <div class="task-scroll-row archived-row" role="row">
                    <div class="task-col task-col-title" role="cell">
                      <div class="task-scroll-title" title={task.title}>{task.title}</div>
                    </div>
                    <div class="task-col task-col-due" role="cell">{formatDueDate(task.dueDate)}</div>
                    <div class="task-col task-col-status" role="cell">
                      <span class={`status-pill ${statusClassMap[getTaskStatusLabel(task)]}`}>{getTaskStatusLabel(task)}</span>
                    </div>
                    <div class="task-col task-col-actions" role="cell">
                      <button
                        type="button"
                        class="task-icon-btn task-icon-btn-restore"
                        class:is-busy={!!restoringTaskMap[getTaskActionKey(task)]}
                        title={!canModifyTask(task) ? 'Only task creator or supervisor can restore this task' : (restoringTaskMap[getTaskActionKey(task)] ? 'Restoring...' : 'Restore task')}
                        aria-label={!canModifyTask(task) ? `Restore unavailable for ${task.title}` : (restoringTaskMap[getTaskActionKey(task)] ? `Restoring ${task.title}` : `Restore ${task.title}`)}
                        aria-busy={!!restoringTaskMap[getTaskActionKey(task)]}
                        disabled={!canModifyTask(task) || !!restoringTaskMap[getTaskActionKey(task)]}
                        on:click={() => restoreArchivedTask(getTaskActionKey(task))}
                      >
                        {#if restoringTaskMap[getTaskActionKey(task)]}
                          <Loader2 size={16} class="spin" />
                        {:else}
                          <RotateCcw size={16} />
                        {/if}
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {/if}
    {/if}

    {#if activeView === 'Overview'}
      <div class="daily-logs-content">
        <div class="worklog-card worklog-form-card">
          <h4 class="worklog-card-head">
            <span class="wl-icon"><FileEdit size={13} /></span>
            Add Work Log
          </h4>
          <form on:submit|preventDefault={handleAddWorkLog}>
            <label class="form-group">
              <span class="form-label">Task</span>
              <textarea class="form-textarea" bind:value={workLogTask} placeholder="Task worked on" rows="2"></textarea>
            </label>
            <label class="form-group">
              <span class="form-label">Notes</span>
              <textarea class="form-textarea" bind:value={workLogNotes} placeholder="Notes" rows="2"></textarea>
            </label>
            <label class="form-group">
              <span class="form-label">Learnings</span>
              <textarea class="form-textarea" bind:value={workLogLearnings} placeholder="What did you learn today?" rows="2"></textarea>
            </label>
            <div class="form-group">
              <span class="form-label">Attachment</span>
              <label class="file-label" for="work-log-file-upload">
                <FileEdit size={13} />
                Upload files
              </label>
              <input id="work-log-file-upload" class="file-input" type="file" multiple on:change={handleWorkLogFileUpload} bind:this={workLogFileInput} />
              {#if workLogAttachments.length > 0}
                <div style="margin-top: 0.6rem; display:flex; flex-direction:column; gap:0.45rem;">
                  {#each workLogAttachments as att, idx}
                    <div class="worklog-attachment-row" style="display:flex; align-items:center; gap:0.6rem;">
                      <div style="flex:1; min-width:0; display:flex; gap:0.6rem; align-items:center;">
                        <div style="font-size:0.82rem; color:var(--color-muted); width:56px; text-align:center;">{getFileExtension_(att.name) || (att.file.type || '').split('/').pop() || 'file'}</div>
                        <input
                          type="text"
                          class="worklog-attachment-name-input"
                          value={att.name}
                          on:input={(e) => renameWorkLogAttachment(idx, e.currentTarget.value)}
                          style="width:100%; padding:0.4rem 0.6rem; border-radius:0.45rem; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text);"
                        />
                        <div style="font-size:0.82rem; color:var(--color-muted); white-space:nowrap;">{(att.file.size / 1024 / 1024).toFixed(2)} MB</div>
                      </div>
                      <div style="display:flex; gap:0.4rem;">
                        <button type="button" class="ghost btn-compact" on:click={() => removeWorkLogAttachment(idx)} aria-label="Remove attachment">Remove</button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
            <button type="submit" class="submit-worklog-btn" disabled={isSavingWorkLog}>
              {#if isSavingWorkLog}
                <span class="spinning-icon"><Loader2 size={16} /></span>
              {/if}
              <span>{isSavingWorkLog ? 'Saving...' : 'Submit'}</span>
            </button>
          </form>
        </div>

        <div class="worklog-card worklog-list-card">
          <div class="worklog-list-head">
            <h4 class="worklog-card-head">
              <span class="wl-icon"><BookOpen size={13} /></span>
              Work Logs
            </h4>
            <div class="wl-filters">
              <label class="wl-search-box">
                <Search size={13} />
                <input type="text" placeholder="Search task, notes, learnings..." bind:value={workLogFilterKeyword} />
              </label>
              <input class="wl-date-input" type="date" bind:value={workLogFilterDate} />
            </div>
          </div>
          <div class="worklog-list-scroll">
            {#if isLoadingWorkLogs}
              <div class="worklogs-loading-shell" aria-live="polite" aria-busy="true">
                {#each [1, 2, 3, 4] as _}
                  <article class="worklog-loading-item">
                    <div class="worklog-loading-trigger">
                      <div class="worklog-loading-title">
                        <span class="act-skeleton shimmer wl-sk-title"></span>
                        <span class="act-skeleton shimmer wl-sk-date"></span>
                      </div>
                      <span class="act-skeleton shimmer wl-sk-chevron"></span>
                    </div>
                  </article>
                {/each}
              </div>
            {:else if filteredWorkLogs.length === 0}
              <div class="worklogs-empty-center">
                <p class="worklogs-empty">No work logs found for current filter.</p>
              </div>
            {:else}
              <div class="worklogs-accordion-list">
                {#each filteredWorkLogs as log, idx}
                  <div
                    class="worklog-accordion-item {expandedWorkLog === idx ? 'expanded' : ''}"
                    role="button"
                    tabindex="0"
                    on:mouseenter={() => hoveredWorkLog = idx}
                    on:mouseleave={() => hoveredWorkLog = null}
                    on:click={(e) => handleWorklogItemClick(e, idx)}
                    on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleWorklogItemClick(e, idx); } }}
                  >
                    <button class="worklog-accordion-trigger" type="button" aria-expanded={expandedWorkLog === idx} on:click={() => expandedWorkLog = expandedWorkLog === idx ? null : idx}>
                      <span class="worklog-title-meta">
                        <span class="worklog-task-title">{log.task}</span>
                        <span class="worklog-date">{formatWorklogDate(log.date)}</span>
                      </span>
                      <span class="chevron-corner">
                        <svelte:component this={ChevronDown} size={16} class={expandedWorkLog === idx ? 'chevron-open' : ''} />
                      </span>
                    </button>
                    {#if expandedWorkLog === idx}
                      <div class="worklog-accordion-body">
                        <div class="worklog-section">
                          <span class="worklog-label">Notes</span>
                          <div class="worklog-notes">{log.notes}</div>
                        </div>
                        <div class="worklog-section">
                          <span class="worklog-label">Learnings</span>
                          <div class="worklog-learnings">{log.learnings}</div>
                        </div>
                        {#if log.attachments && log.attachments.length > 0}
                          <div class="worklog-section">
                            <span class="worklog-label">Attachments ({log.attachments.length})</span>
                            <div class="worklog-attachments">
                              {#each log.attachments as file}
                                <div class="worklog-attachment-item">
                                  <div class="worklog-attachment-main">
                                    <span class="worklog-attachment-name">
                                      {file.file_name || `${file.file_type || 'file'}`}
                                    </span>
                                    <span class="worklog-attachment-meta">
                                      {file.file_type || 'file'} - {file.file_size || ''}
                                    </span>
                                  </div>
                                  <div class="worklog-attachment-actions">
                                    {#if file.link}
                                      <a
                                        class="worklog-attachment-action action-view"
                                        href={file.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label="View attachment"
                                        title="View"
                                      >
                                        <ExternalLink size={14} />
                                      </a>
                                      <a
                                        class="worklog-attachment-action action-download"
                                        href={getDriveDownloadUrl(file.link)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label="Download attachment"
                                        title="Download"
                                      >
                                        <Download size={14} />
                                      </a>
                                    {:else}
                                      <span class="worklog-attachment-chip">No link</span>
                                    {/if}
                                  </div>
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

  </div>
</section>

{#if isViewTaskModalOpen && viewedTask}
  <div class="task-view-modal-overlay" role="presentation" on:click={handleTaskViewOverlayClick}>
    <div
      class="task-view-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Task details form"
    >
      <div class="task-view-modal-head">
        <h4>Task Details</h4>
        <div class="task-view-head-actions">
          {#if isEditingViewedTask}
            <button
              type="button"
              class="task-view-action"
              style="display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;"
              on:click={saveTaskEditFromView}
              disabled={isSavingViewedTask}
            >
              {#if isSavingViewedTask}
                <span class="spinning-icon"><Loader2 size={16} /></span>
              {/if}
              <span>{isSavingViewedTask ? 'Saving...' : 'Save'}</span>
            </button>
            <button type="button" class="task-view-action" on:click={cancelTaskEditFromView}>Cancel</button>
          {:else}
            <button
              type="button"
              class="task-view-action"
              on:click={openTaskEditFromView}
              disabled={!canModifyTask(viewedTask)}
              title={!canModifyTask(viewedTask) ? 'Only task creator or supervisor can edit this task' : 'Edit task'}
            >
              Edit Task
            </button>
            <button type="button" class="task-view-close" on:click={closeTaskViewForm}>Close</button>
          {/if}
        </div>
      </div>

      <div class="task-view-grid">
        <label>
          <span>Task Title</span>
          <input type="text" bind:value={taskViewEditForm.title} readonly={!isEditingViewedTask} />
        </label>

        <label>
          <span>Status</span>
          {#if isEditingViewedTask}
            <select bind:value={taskViewEditForm.status} on:change={async (e) => {
              let value = '';
              if (e.target && typeof e.target === 'object' && 'value' in e.target) {
                value = String(e.target.value);
              }
              await updateTaskStatus(viewedTask.id, value);
              // Optionally update local state/UI here
            }}>
              {#each editStatusOptions as option}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else}
            <input type="text" value={viewedTask.status} readonly />
          {/if}
        </label>

        <label>
          <span>Due Date</span>
          {#if isEditingViewedTask}
            <input type="date" bind:value={taskViewEditForm.dueDate} />
          {:else}
            <input type="text" value={formatDueDate(viewedTask.dueDate)} readonly />
          {/if}
        </label>

        <label>
          <span>Assigned by</span>
          {#if isEditingViewedTask}
            <select bind:value={taskViewEditForm.assignedBy} disabled={isLoadingAssignedSupervisors || assignedSupervisors.length === 0}>
              {#if isLoadingAssignedSupervisors}
                <option value="">Loading supervisors...</option>
              {:else if assignedSupervisors.length === 0}
                <option value="">N/A</option>
              {:else}
                <option value="">N/A</option>
                {#each assignedSupervisors as supervisor}
                  <option value={supervisor.user_id}>
                    {getSupervisorOptionLabel(supervisor)}
                  </option>
                {/each}
              {/if}
            </select>
          {:else}
            <input type="text" value={getUserFullName(viewedTask.owner) || viewedTask.owner} readonly />
          {/if}
        </label>
      </div>

      <label class="task-view-description">
        <span>Description</span>
        <textarea rows="3" bind:value={taskViewEditForm.description} readonly={!isEditingViewedTask}></textarea>
      </label>

      <div class="task-view-section">
        <span>Checklist</span>
        {#if isEditingViewedTask}
            <div class="tracker-checklist-editor">
            <div class="tracker-checklist-editor-head">
              <button type="button" class="attachment-upload-btn" on:click={addTaskViewChecklistItem}>+ Add item</button>
            </div>

            {#if taskViewEditForm.dailyChecklist.length === 0}
              <p class="overview-empty-copy">No checklist items.</p>
            {:else}
              {#each taskViewEditForm.dailyChecklist as item, index}
                <div class="tracker-checklist-editor-row">
                  <input
                    type="checkbox"
                    checked={item.done}
                    on:change={() => updateTaskViewChecklistItem(index, 'done', !item.done)}
                  />
                  <input
                    type="text"
                    value={item.label}
                    on:input={(event) => updateTaskViewChecklistItem(index, 'label', event.currentTarget.value)}
                    placeholder="Checklist item"
                  />
                  <button type="button" class="remove-item" on:click={() => removeTaskViewChecklistItem(index)}>
                    Remove
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        {:else if viewedTask.dailyChecklist.length === 0}
          <p class="overview-empty-copy">No checklist items.</p>
        {:else}
          <ul>
            {#each viewedTask.dailyChecklist as item}
              <li>
                <input type="checkbox" checked={item.done} disabled />
                <span>{item.label}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="task-view-section">
        <span>Attachments</span>
        {#if isEditingViewedTask}
          <div class="attachment-editor">
            <div class="attachment-editor-head">
              <label class="attachment-upload-btn" for="view-task-file-upload">Upload files</label>
              <input
                id="view-task-file-upload"
                class="hidden-file-input"
                type="file"
                multiple
                on:change={handleTaskViewAttachmentUpload}
                bind:this={taskViewFileInput}
              />
            </div>

            {#if taskViewEditForm.attachments.length === 0}
              <p class="overview-empty-copy">No attachments.</p>
            {:else}
              <ul class="attachment-list">
                {#each taskViewEditForm.attachments as att, index}
                  <li>
                    <div class="attachment-row">
                      <div class="attachment-main">
                        <span>{(att && (att.file_name || att.name)) || att}</span>
                      </div>
                      <div class="attachment-actions">
                        <button type="button" class="remove-item" on:click={() => removeTaskViewAttachment(index)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else if viewedTask.attachments.length === 0}
          <p class="overview-empty-copy">No attachments.</p>
        {:else}
          <ul class="attachment-list">
            {#each viewedTask.attachments as att}
              <li>
                <div class="attachment-row">
                  <div class="attachment-main">
                    {#if att && att.link}
                      <a href={att.link} target="_blank" rel="noopener noreferrer">{att.file_name || att.name || att}</a>
                    {:else}
                      <span>{(att && (att.file_name || att.name)) || att}</span>
                    {/if}
                  </div>
                  <div class="attachment-actions">
                    {#if att && att.link}
                      <a class="attachment-action" href={att.link} target="_blank" rel="noopener noreferrer" aria-label="View attachment" title="View">
                        <Eye size={14} />
                      </a>
                      <a class="attachment-action" href={getDriveDownloadUrl(att.link)} target="_blank" rel="noopener noreferrer" aria-label="Download attachment" title="Download">
                        <Download size={14} />
                      </a>
                    {/if}
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

  <style>
  .notes-panel {
    border: 1px solid var(--color-border);
    border-radius: 1.1rem;
    box-shadow: 0 2px 12px 0 rgba(60, 72, 100, 0.07);
    padding: 1.2rem 1.3rem 1.1rem 1.3rem;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-height: 210px;
    gap: 0.7rem;
    background: var(--color-surface);
  }
  :global(html.dark) .notes-panel {
    background: #161c27 !important;
    border: 1px solid #ffffff0f !important;
  }
  .notes-header {
    display: flex;
    align-items: flex-start;
    gap: 0.9rem;
    margin-bottom: 0.2rem;
  }
  .notes-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, #dbeafe 50%, var(--color-surface));
    border-radius: 0.7rem;
    width: 2.5rem;
    height: 2.5rem;
  }
  .notes-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-heading);
    margin-bottom: 0.1rem;
    letter-spacing: 0.01em;
  }
  .notes-subtitle {
    font-size: 0.86rem;
    color: var(--color-muted);
    font-weight: 500;
    margin-bottom: 0.1rem;
  }
  .notes-textarea-wrap {
    background: var(--color-soft);
    border-radius: 0.7rem;
    padding: 0.7rem 0.7rem 0.5rem 0.7rem;
    border: 1.5px solid var(--color-border);
  }
  .notes-textarea {
    width: 100%;
    border: none;
    background: transparent;
    font-size: 0.9rem;
    color: var(--color-text);
    min-height: 90px;
    resize: vertical;
    outline: none;
    font-family: 'Segoe UI', system-ui, -apple-system, 'Roboto', 'Helvetica Neue', Arial, sans-serif;
    font-weight: 500;
  }
  .notes-textarea::placeholder {
    color: var(--color-muted);
    font-size: 0.9rem;
    font-family: 'Segoe UI', system-ui, -apple-system, 'Roboto', 'Helvetica Neue', Arial, sans-serif;
    font-weight: 500;
    opacity: 1;
  }
  :global(html) {
    font-family: 'Inter', 'Roboto', 'Segoe UI', Arial, sans-serif;
    --color-bg: #f7fbff;
    --color-surface: #ffffff;
    --color-soft: #f4f8fc;
    --color-card: #ffffff;
    --color-border: #d8e2ef;
    --color-heading: #0f172a;
    --color-text: #1f2937;
    --color-muted: #5f7188;
    --color-accent: #0f6cbd;
    --color-accent-bg: #d8ebff;
    --color-danger: #ef4444;
    --color-success: #22c55e;
    --color-warning: #f59e42;
    background: var(--color-app-bg);
    color: var(--color-text);
    scrollbar-gutter: stable;
  }
  :global(html.dark) {
    --color-bg: #0d1117;
    --color-surface: #161c27;
    --color-soft: #1e2736;
    --color-card: #1e2736;
    --color-border: #ffffff1a;
    --color-heading: #e5edf8;
    --color-text: #cfdceb;
    --color-muted: #9ab0cb;
    --color-accent: #7cc3ff;
    --color-accent-bg: #1e2736;
    --color-danger: #ef4444;
    --color-success: #22c55e;
    --color-warning: #f59e42;
    background: var(--color-app-bg);
    color: #cfdceb;
  }

  .activity-shell {
    position: relative;
    border-radius: 1.25rem;
    padding: 0;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .activity-shell::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -2;
    border-radius: 1.25rem;
    background: var(--color-app-bg);
  }

  .activity-shell::after {
    display: none;
  }

  :global(html.dark) .activity-shell::before {
    background: var(--color-app-bg);
  }

  :global(html.dark) .activity-shell::after {
    display: none;
  }

  .documents-page {
    display: grid;
    gap: 1.1rem;
    align-content: start;
  }

  .stats-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: stretch;
  }

  .stat-card,
  .panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 1.1rem;
    box-shadow: 0 18px 36px -30px rgba(15, 23, 42, 0.42);
    /* Ensure all corners are equally rounded */
    -webkit-border-radius: 1.1rem;
    -moz-border-radius: 1.1rem;
    border-bottom-left-radius: 1.1rem;
    border-bottom-right-radius: 1.1rem;
    border-top-left-radius: 1.1rem;
    border-top-right-radius: 1.1rem;
  }

  .stat-card {
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 1.1rem 1.2rem;
    min-height: 5.45rem;
    transition: transform 0.22s ease, box-shadow 0.22s ease;
  }

  :global(html.dark) .stat-card {
    background: #161c27 !important;
    border-color: #ffffff0f !important;
    box-shadow: 0 18px 36px -20px rgba(0,0,0,0.5) !important;
  }

  .stat-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 3px;
    opacity: 0.9;
  }

  .tone-card-indigo::before {
    background: linear-gradient(90deg, #0f6cbd, #38bdf8);
  }

  .tone-card-green::before {
    background: linear-gradient(90deg, #0d9488, #10b981);
  }

  .tone-card-blue::before {
    background: linear-gradient(90deg, #1d4ed8, #3b82f6);
  }

  .tone-card-violet::before {
    background: linear-gradient(90deg, #0891b2, #22d3ee);
  }

  .stat-card:hover {
    transform: translateY(-2px);
  }

  :global(html.dark) .stat-card:hover {
    border-color: #ffffff1a !important;
  }

  .panel {
    transition: box-shadow 0.22s ease, border-color 0.22s ease;
  }

  .panel:hover {
    box-shadow: 0 20px 38px -28px rgba(15, 23, 42, 0.48);
  }

  .stat-icon,
  .file-icon,
  .upload-icon-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.75rem;
  }

  .stat-icon {
    width: 2.2rem;
    height: 2.2rem;
    border-bottom: 2px solid transparent;
  }
  
  .submit-worklog-btn {
    font-size: 0.97rem;
    font-weight: 600;
    color: #fff;
    background: #0f6cbd;
    border: none;
    border-radius: 0.5rem;
    padding: 0.5rem 1.3rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    transition: all 0.2s;
  }
  
  .submit-worklog-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .spinning-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .stat-value {
    margin: 0;
    color: var(--color-heading);
    font-size: 1.7rem;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.01em;
    text-shadow: 0 1px 2px rgba(17,24,39,0.10);
  }

  :global(html.dark) .stat-value {
    color: #e5edf8 !important;
    text-shadow: none;
  }

  .stat-label {
    margin: 0.15rem 0 0;
    color: var(--color-muted);
    font-size: 0.86rem;
    font-weight: 700;
  }

  :global(html.dark) .stat-label {
    color: #8eaec9 !important;
  }

  .documents-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
  }

  .controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
    padding: 0.85rem 0.95rem;
    border-radius: 0.95rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    box-shadow: 0 14px 28px -26px rgba(15, 23, 42, 0.4);
  }

  :global(html.dark) .controls-bar {
    border: 1px solid #ffffff0f !important;
    background: #161c27 !important;
  }

  .controls-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-left: auto;
  }

  .search-control,
  .status-control select,
  .new-task-btn,
  .view-toggle button {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 0.7rem;
    min-height: 2.25rem;
  }

  .search-control {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.7rem;
    color: var(--color-muted);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.7rem;
  }

  :global(html.dark) .search-control {
    background: #161c27 !important;
    border-color: #ffffff0f !important;
  }

  .search-control input {
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    width: 12rem;
    outline: none;
  }

  :global(html.dark) .search-control input {
    color: #e5edf8 !important;
  }

  .status-control {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .status-control::after {
    content: '';
    position: absolute;
    right: 0.75rem;
    width: 0.42rem;
    height: 0.42rem;
    border-right: 1.8px solid var(--color-muted);
    border-bottom: 1.8px solid var(--color-muted);
    transform: rotate(45deg) translateY(-0.08rem);
    pointer-events: none;
  }

  .status-control select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    padding: 0 1.85rem 0 0.75rem;
    color: var(--color-text);
    font-size: 0.84rem;
    cursor: pointer;
    outline: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.7rem;
  }

  :global(html.dark) .status-control select {
    background: #161c27 !important;
    border: 1px solid #ffffff0f !important;
    color: #e5edf8 !important;
  }

  .new-task-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.75rem;
    color: #ffffff;
    background: linear-gradient(90deg, #0f6cbd, #0ea5e9);
    border-color: #0f6cbd;
    font-size: 0.84rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 12px 24px -16px rgba(15, 108, 189, 0.9);
  }

  .new-task-btn:hover {
    filter: brightness(1.05);
    transform: translateY(-1px);
  }


  .view-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .view-toggle button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.75rem;
    color: var(--color-muted);
    font-size: 0.84rem;
    cursor: pointer;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.7rem;
  }

  :global(html.dark) .view-toggle button {
    color: #8eaec9 !important;
    background: #161c27 !important;
    border: 1px solid #ffffff0f !important;
  }

  .view-toggle button.active {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: var(--color-surface);
  }

  :global(html.dark) .view-toggle button.active {
    color: #38bdf8 !important;
    border-color: #38bdf8 !important;
    background: #1e2736 !important;
  }

  .view-toggle button.active span {
    font-weight: 600;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1rem 0.9rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  :global(html.dark) .panel-header {
    background: #161c27 !important;
    border-bottom: 1px solid #ffffff0f !important;
  }

  .tasks-panel {
    overflow: hidden;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }
  :global(html.dark) .tasks-panel {
    background: #0d1117 !important;
    border-color: #ffffff0f !important;
  }

  .section-main-card-head {
    align-items: flex-start;
    gap: 1rem;
  }

  .section-main-card-copy {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }

  .section-main-card-title {
    margin: 0;
    color: var(--color-heading);
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .section-main-card-description {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .tasks-panel-body,
  .daily-logs-panel-body {
    padding: 14px;
  }

  .overview-shell {
    display: grid;
    gap: 1rem;
    padding: 1rem;
  }

  :global(html.dark) .overview-shell {
    background: #0d1117 !important;
  }

  .overview-panels {
    display: grid;
    grid-template-columns: 1fr 1fr 0.8fr;
    gap: 0.85rem;
  }

  .overview-panel {
    border-radius: 0.8rem;
    padding: 0.95rem;
    min-height: 10.25rem;
    box-shadow: 0 12px 24px -20px rgba(0,0,0,0.4);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  :global(html.dark) .overview-panel {
    border: 1px solid #ffffff0f !important;
    background: #161c27 !important;
  }

  .overview-panel h4 {
    margin: 0;
    color: var(--color-heading);
    font-size: 1rem;
    font-weight: 650;
  }

  :global(html.dark) .overview-panel h4 {
    color: #e5edf8 !important;
  }

  .overview-panel ul {
    margin: 0.75rem 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.55rem;
  }

  .overview-panel li {
    margin: 0;
  }

  .overview-task-link {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.81rem;
    color: var(--color-text);
    text-align: left;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    padding: 0.3rem 0.35rem;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  :global(html.dark) .overview-task-link {
    color: #cfdceb !important;
  }

  .overview-task-link:hover,
  .overview-task-link.active {
    background: var(--color-border);
    border-color: var(--color-border);
  }

  :global(html.dark) .overview-task-link:hover,
  :global(html.dark) .overview-task-link.active {
    background: #1e2736 !important;
    border-color: #ffffff1a !important;
  }

  .overview-panel li span {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .overview-panel li small {
    color: var(--color-muted);
    font-size: 0.77rem;
  }

  .overview-empty-copy {
    margin: 0.7rem 0 0;
    color: var(--color-muted);
    font-size: 0.76rem;
  }

  :global(html.dark) .overview-empty-copy {
    color: #8eaec9 !important;
  }

  .completion-panel {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .overview-tracker {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 0.8rem;
    background: var(--color-surface);
    padding: 0.95rem;
    min-height: 10.25rem;
    box-shadow: 0 16px 30px -24px rgba(15, 23, 42, 0.4);
  }

  .tracker-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.55rem;
    padding-left: 0.15rem;
  }

  .tracker-card-heading {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
  }

  .tracker-eyebrow {
    margin: 0;
    color: #0f6cbd;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .tracker-purpose {
    margin: 0.12rem 0 0;
    color: var(--color-muted);
    font-size: 0.82rem;
    line-height: 1.35;
  }

  .tracker-head-actions {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .tracker-menu-trigger {
    width: 1.4rem;
    height: 1.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 999px;
    color: var(--color-muted);
    cursor: pointer;
  }

  .tracker-menu-trigger:hover {
    color: var(--color-text);
    background: var(--color-soft);
    border-color: var(--color-border);
  }

  .tracker-menu {
    position: absolute;
    top: calc(100% + 0.3rem);
    right: 0;
    min-width: 8rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.6rem;
    box-shadow: 0 12px 24px -20px rgba(15, 23, 42, 0.35);
    padding: 0.25rem;
    z-index: 6;
  }

  .tracker-title {
    margin: 0.2rem 0 0;
    color: var(--color-heading);
    font-size: 0.87rem;
    font-weight: 600;
  }

  .tracker-meta {
    margin: 0.35rem 0 0;
    color: var(--color-muted);
    font-size: 0.83rem;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .tracker-description {
    margin: 0.55rem 0 0;
    color: var(--color-text);
    font-size: 0.87rem;
    line-height: 1.45;
  }

  .tracker-summary {
    display: grid;
    gap: 0.1rem;
    padding: 0.5rem 0.75rem 0.65rem;
    border: 1px solid var(--color-border);
    border-radius: 0.85rem;
    background: none;
  }

  .tracker-section-shell {
    margin-top: 0.55rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.85rem;
    background: none;
  }

  .tracker-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }


  .tracker-form {
    display: grid;
    gap: 0.7rem;
    margin-top: 0.6rem;
  }

  .tracker-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .tracker-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .tracker-form-actions .secondary {
    border: 1px solid var(--color-border);
    background: var(--color-soft);
    color: var(--color-text);
  }

  .tracker-form-actions .primary {
    border: 1px solid #0f6cbd;
    background: #0f6cbd;
    color: #ffffff;
  }

  .tracker-checklist-editor {
    background: none;
  }

  .tracker-checklist-editor-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }

  .tracker-checklist-editor-head button,
  .remove-item {
    border: 1px dashed var(--ims-ref-border);
    background: transparent;
    color: var(--color-muted);
    border-radius: 0.6rem;
    padding: 0.32rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }

  /* Ensure checklist add button matches attachment upload size exactly */
  .tracker-checklist-editor-head .attachment-upload-btn {
    border: 1px dashed var(--ims-ref-border);
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text2);
    border-radius: 0.45rem;
    padding: 0.32rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
  }

  .tracker-checklist-editor-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.35rem;
    align-items: center;
  }

  .tracker-checklist-editor-row input[type='checkbox'] {
    width: 0.82rem;
    height: 0.82rem;
  }

  .tracker-checklist-editor-row input[type='text'] {
    width: 100%;
    font-size: 0.78rem;
    padding: 0.32rem 0.45rem;
  }

  .attachment-editor {
    display: grid;
    gap: 0.5rem;
  }

  .attachment-editor-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .attachment-editor-head span {
    color: var(--color-muted);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .attachment-upload-btn {
    border: 1px solid var(--color-border);
    background: var(--color-soft);
    color: var(--color-text);
    border-radius: 0.45rem;
    padding: 0.32rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }

  .hidden-file-input {
    display: none;
  }

  .attachment-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  .attachment-list li {
    display: block;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
  }

  .attachment-list li span {
    color: var(--color-text);
    font-size: 0.78rem;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .completion-value {
    margin: 0.35rem 0 0;
    color: #0f6cbd;
    font-size: 1.6rem;
    font-weight: 800;
  }

  .overview-link {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-soft);
    color: var(--color-text);
    padding: 0.3rem 0.6rem;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    width: fit-content;
  }

  .task-list {
    display: grid;
    background: var(--color-soft);
    padding: 0.4rem;
    gap: 0.45rem;
  }

  .intern-task-scroll-shell {
    display: grid;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  .intern-task-scroll-head {
    border-bottom: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 88%, var(--color-soft));
  }

  .intern-task-scroll-body {
    max-height: clamp(22rem, 62vh, 29rem);
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.85rem;
    background: var(--color-soft);
  }

  .intern-task-scroll-body::-webkit-scrollbar {
    width: 10px;
  }

  .intern-task-scroll-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .intern-task-scroll-body::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.42);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  .intern-task-scroll-body::-webkit-scrollbar-thumb:hover {
    background: rgba(148, 163, 184, 0.58);
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  .intern-task-scroll-table {
    display: grid;
    gap: 0.8rem;
  }

  .task-scroll-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 9rem 8.5rem 8.5rem;
    align-items: center;
    gap: 1rem;
    padding: 0.65rem 0.9rem;
    font-size: 0.84rem;
    border-radius: 0.95rem;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
  }

  .task-scroll-row:hover {
    border-color: rgba(59, 130, 246, 0.26);
    box-shadow: 0 12px 28px -26px rgba(15, 23, 42, 0.48);
  }

  .task-scroll-header,
  .task-scroll-header:hover {
    border: 0;
    border-radius: 0;
    padding: 1rem 1.2rem;
    background: transparent;
    box-shadow: none;
  }

  .task-col {
    min-width: 0;
  }

  .task-scroll-header .task-col {
    color: var(--color-muted);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .task-col-title {
    text-align: left;
    justify-self: stretch;
    display: flex;
    align-items: center;
  }

  .task-col-due,
  .task-col-status,
  .task-col-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    text-align: center;
    justify-self: stretch;
  }

  .task-col-actions {
    gap: 0.5rem;
  }

  .task-scroll-title {
    color: var(--color-heading);
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-scroll-row:not(.task-scroll-header) .task-col-due {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .task-icon-btn {
    width: 2.7rem;
    height: 2.7rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.8rem;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 84%, var(--color-soft));
    color: #38bdf8;
    cursor: pointer;
    transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease;
  }

  .task-icon-btn:hover {
    background: color-mix(in srgb, #0f6cbd 10%, var(--color-surface));
    border-color: rgba(56, 189, 248, 0.2);
  }

  .task-icon-btn-restore {
    color: #94a3b8;
  }

  .task-icon-btn-restore:hover {
    color: #cbd5e1;
    background: color-mix(in srgb, #94a3b8 10%, var(--color-surface));
    border-color: rgba(148, 163, 184, 0.22);
  }

  .task-icon-btn:disabled,
  .task-icon-btn.is-busy {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .task-icon-btn :global(svg.spin) {
    animation: spin 1s linear infinite;
  }

  :global(html.dark) .intern-task-scroll-shell {
    border-color: #ffffff0f;
    background: #161c27;
  }

  :global(html.dark) .intern-task-scroll-head {
    border-bottom-color: #ffffff0f;
    background: #161c27;
  }

  :global(html.dark) .intern-task-scroll-body {
    background: #0d1117;
  }

  :global(html.dark) .task-scroll-row {
    border-color: #ffffff0f;
    background: #0d1117;
  }

  :global(html.dark) .task-scroll-row:hover {
    border-color: rgba(56, 189, 248, 0.18);
    background: #121926;
  }

  :global(html.dark) .task-scroll-header,
  :global(html.dark) .task-scroll-header:hover {
    background: transparent;
  }

  :global(html.dark) .task-scroll-title {
    color: #f1f5f9;
  }

  :global(html.dark) .task-icon-btn {
    border-color: #ffffff10;
    background: #161c27;
    color: #38bdf8;
  }

  :global(html.dark) .task-icon-btn:hover {
    border-color: rgba(56, 189, 248, 0.22);
    background: #1b2433;
  }

  :global(html.dark) .task-icon-btn-restore {
    color: #94a3b8;
  }

  :global(html.dark) .task-icon-btn-restore:hover {
    color: #e2e8f0;
    border-color: rgba(148, 163, 184, 0.24);
    background: #1b2433;
  }

  .task-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8rem 7.5rem 8.75rem;
    align-items: center;
    gap: 1.1rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.65rem;
    background: var(--color-surface);
    transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
  }

  .task-row:hover {
    border-color: var(--color-accent);
    background: var(--color-soft);
    box-shadow: 0 8px 22px -20px rgba(15, 23, 42, 0.35);
  }

  .task-accordion-item {
    border: 1px solid var(--color-border);
    border-radius: 0.65rem;
    background: var(--color-surface);
    overflow: hidden;
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }

  .task-accordion-item.expanded {
    border-color: var(--color-accent);
    box-shadow: 0 8px 22px -20px rgba(15, 23, 42, 0.45);
  }

  .task-accordion-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    text-align: left;
    background: var(--color-surface);
    padding: 1rem 1.4rem;
    padding-right: 3.4rem;
    cursor: pointer;
    transition: background-color 140ms ease;
  }

  .task-accordion-trigger:hover {
    background: var(--color-soft);
  }

  .task-trigger-left {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
  }

  .task-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--color-muted);
    flex-shrink: 0;
  }

  .task-trigger-title {
    color: var(--color-heading);
    font-size: 0.9rem;
    font-weight: 500;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-accordion-trigger :global(svg) {
    color: var(--color-muted);
    transition: transform 140ms ease;
    flex-shrink: 0;
  }

  .task-accordion-trigger :global(svg.chevron-open) {
    transform: rotate(180deg);
  }

  .task-accordion-body-modern {
    display: grid;
    gap: 0.75rem;
    padding: 0.1rem 1rem 1rem 2rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-soft);
  }

  .task-accordion-meta-modern {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.65rem;
    color: var(--color-muted);
    font-size: 0.79rem;
    font-weight: 600;
  }

  .status-chip {
    padding: 0;
    font-size: 0.79rem;
    font-weight: 700;
    border: 0;
    background: transparent;
  }

  .task-description-modern {
    margin: 0;
    color: var(--color-text);
    font-size: 0.87rem;
    line-height: 1.45;
    flex: 1 1 auto;
    min-width: 0;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .task-description-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .task-view-form-btn {
    border: 0;
    background: transparent;
    color: var(--color-muted);
    font-size: 0.76rem;
    font-weight: 700;
    padding: 0;
    cursor: pointer;
    width: auto;
    flex-shrink: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .task-view-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
    z-index: 200;
    padding: 1rem;
  }

  .task-view-modal {
    width: min(38rem, 100%);
    max-height: calc(100vh - 2rem);
    overflow: auto;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.9rem;
    box-shadow: 0 28px 48px -32px rgba(15, 23, 42, 0.55);
    padding: 1rem;
    display: grid;
    gap: 0.9rem;
  }

  .task-view-modal.task-add-modal {
    width: min(92vw, 720px);
    max-height: 90vh;
    padding: 0;
    gap: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border-color: var(--color-border);
    box-shadow: 0 30px 54px -32px rgba(15, 23, 42, 0.3);
  }

  .task-view-modal.task-add-modal .task-view-add-form {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 0;
  }

  .task-view-modal.task-add-modal .task-view-modal-head {
    padding: 18px 22px 12px;
    background: color-mix(in srgb, var(--color-surface) 84%, var(--color-soft));
    border-bottom: 1px solid var(--color-border);
  }

  .task-view-modal.task-add-modal .task-view-modal-head h4 {
    font-size: 15px;
    font-weight: 700;
  }

  .task-add-modal-content {
    padding: 0 22px 16px;
    overflow-y: auto;
    flex: 1;
    display: grid;
    gap: 0.8rem;
    background: var(--color-surface);
  }

  .task-add-modal-footer {
    padding: 12px 22px 16px;
    border-top: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 90%, var(--color-soft));
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  :global(html.dark) .task-view-modal,
  :global(body.dark) .task-view-modal {
    background: #161c27;
    border: 1px solid #ffffff0f;
  }
  :global(html.dark) .task-view-modal.task-add-modal,
  :global(body.dark) .task-view-modal.task-add-modal {
    background: #1f2937;
    border-color: #374151;
  }
  :global(html.dark) .task-view-modal.task-add-modal .task-add-modal-content,
  :global(body.dark) .task-view-modal.task-add-modal .task-add-modal-content {
    background: #1f2937;
  }
  :global(html.dark) .task-view-modal.task-add-modal .task-view-modal-head,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-modal-head {
    background: #1f2937;
    border-bottom-color: #374151;
  }
  :global(html.dark) .task-view-modal.task-add-modal .task-view-grid input,
  :global(html.dark) .task-view-modal.task-add-modal .task-view-grid select,
  :global(html.dark) .task-view-modal.task-add-modal .task-view-description textarea,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-grid input,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-grid select,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-description textarea {
    background: #111827;
    border-color: #374151;
    color: #f1f5f9;
  }
  :global(html.dark) .task-view-modal.task-add-modal .task-view-grid label span,
  :global(html.dark) .task-view-modal.task-add-modal .task-view-description span,
  :global(html.dark) .task-view-modal.task-add-modal .task-view-section-head span,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-grid label span,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-description span,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-section-head span {
    color: #94a3b8;
  }
  :global(html.dark) .task-view-modal.task-add-modal .task-view-action,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-action {
    background: #1f2937;
    border-color: #374151;
    color: #e2e8f0;
  }
  :global(html.dark) .task-view-modal.task-add-modal .task-view-action.primary,
  :global(body.dark) .task-view-modal.task-add-modal .task-view-action.primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #ffffff;
  }
  :global(html.dark) .task-view-modal.task-add-modal .task-add-modal-footer {
    background: #1f2937;
    border-top-color: #374151;
  }
  :global(body.dark) .task-view-modal.task-add-modal .task-add-modal-footer {
    background: #1f2937;
    border-top-color: #374151;
  }

  .task-view-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .task-view-head-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .task-view-modal-head h4 {
    margin: 0;
    color: var(--color-heading);
    font-size: 1rem;
    font-weight: 700;
  }

  .task-view-close {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-soft);
    color: var(--color-text);
    padding: 0.3rem 0.7rem;
    font-size: 0.74rem;
    font-weight: 600;
    cursor: pointer;
  }

  .task-view-action {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-soft);
    color: var(--color-text);
    padding: 0.3rem 0.65rem;
    font-size: 0.74rem;
    font-weight: 600;
    cursor: pointer;
  }

  .task-view-action:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .task-view-action.danger {
    border-color: var(--color-border);
    color: var(--color-text);
    background: var(--color-soft);
  }

  .task-view-action.primary {
    border-color: #0f6cbd;
    background: #0f6cbd;
    color: #ffffff;
  }

  .task-view-action.primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .task-form-error {
    margin: 0;
    color: #dc2626;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .task-view-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
  }

  .task-view-grid label,
  .task-view-description {
    display: grid;
    gap: 0.35rem;
  }

  .task-view-grid label span,
  .task-view-description span {
    color: var(--color-muted);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .task-view-section > span {
    color: var(--color-muted);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .task-view-grid input,
  .task-view-grid select,
  .task-view-description textarea {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 0.55rem;
    background: var(--color-soft);
    color: var(--color-text);
    font-size: 0.82rem;
    padding: 0.45rem 0.55rem;
  }

  .task-view-description textarea {
    resize: vertical;
  }

  .task-view-section {
    display: grid;
    gap: 0.4rem;
  }

  .task-view-section ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.35rem;
  }

  .task-view-section li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--color-text);
    font-size: 0.82rem;
  }

  .task-view-section .attachment-list li {
    background: transparent;
    padding: 0;
  }

  .task-view-section .attachment-list li span {
    color: var(--color-text);
    font-size: 0.82rem;
  }

  .task-view-section li input[type='checkbox'] {
    width: 0.9rem;
    height: 0.9rem;
  }

  .task-view-add-form {
    display: grid;
    gap: 0.8rem;
  }

  .task-view-add-form .task-view-grid {
    gap: 0.65rem;
    align-items: start;
  }

  .task-view-add-form .task-view-description {
    gap: 0.45rem;
  }

  .task-view-add-form .task-view-section {
    gap: 0.5rem;
  }

  .task-view-add-form .task-view-grid label span,
  .task-view-add-form .task-view-description span {
    display: block;
    margin-bottom: 0;
  }

  .task-view-add-form .task-view-grid input,
  .task-view-add-form .task-view-grid select,
  .task-view-add-form .task-view-description textarea {
    box-sizing: border-box;
    min-height: 0;
    line-height: normal;
  }

  .task-view-add-form .task-view-description textarea {
    min-height: 96px;
    font-family: inherit;
  }

  .task-view-add-form .task-view-section .task-view-section-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }

  .task-view-add-form .task-view-section .task-view-section-head span,
  .task-view-add-form .attachment-editor .attachment-editor-head span {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--color-muted);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .task-view-add-form .task-view-section .task-view-section-head button {
    align-self: flex-start;
    margin-top: 0.25rem;
  }

  .task-view-add-form .task-view-section .task-view-section-actions {
    width: 100%;
    display: flex;
    justify-content: flex-start;
  }

  .task-view-add-form .task-view-section .task-view-section-actions button {
    margin: 0;
  }

  .task-view-add-form .attachment-editor {
    display: grid;
    gap: 0.35rem;
  }

  .task-view-add-form .attachment-editor-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.45rem;
  }

  .task-view-add-form .task-view-section .ghost.btn-compact,
  .task-view-add-form .attachment-upload-btn {
    border-style: dashed;
    border-width: 1px;
    border-color: rgba(148, 163, 184, 0.18);
    background: transparent;
    color: var(--color-muted);
    padding: 0.42rem 0.7rem;
    font-size: 0.82rem;
    font-weight: 600;
    border-radius: 0.6rem;
  }

  .task-view-add-form .task-view-section .ghost.btn-compact:hover,
  .task-view-add-form .attachment-upload-btn:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .archived-row {
    background: var(--color-surface);
  }

  .task-name {
    color: var(--color-text);
    font-size: 0.87rem;
    font-weight: 600;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-due {
    justify-self: center;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.83rem;
    font-weight: 500;
  }

  .attachment-btn {
    justify-self: center;
    margin-left: 0;
    border: 1px solid var(--color-border);
    background: var(--color-soft);
    color: var(--color-muted);
    border-radius: 999px;
    padding: 0.28rem 0.55rem;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
  }

  .attachment-text {
    justify-self: center;
    color: #475569;
    font-size: 0.78rem;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .attachment-btn:hover {
    background: color-mix(in srgb, #0f6cbd 10%, var(--color-surface));
    border-color: var(--color-accent);
  }

  .attachment-btn:focus-visible,
  .view-toggle button:focus-visible,
  .search-control input:focus-visible,
  .status-control select:focus-visible {
    outline: 2px solid #7cc3ff;
    outline-offset: 2px;
  }

  .empty-state {
    margin: 0;
    padding: 1.2rem 1rem;
    color: var(--color-muted);
    font-size: 0.85rem;
  }

  .status-pill {
    justify-self: center;
    text-align: center;
    padding: 0;
    font-size: 0.77rem;
    font-weight: 500;
    background: transparent;
    border: 0;
  }

  .status-progress {
    color: #2563eb;
  }

  .status-pending {
    color: #d97706;
  }

  .status-completed {
    color: #059669;
  }

  .status-overdue {
    color: #dc2626;
  }

  .tone-indigo {
    color: #0f6cbd;
    background: #edf4fb;
    border-color: #dbeafe;
  }

  :global(html.dark) .tone-indigo {
    color: #38bdf8 !important;
    background: rgba(56,189,248,0.15) !important;
    border-color: rgba(56,189,248,0.25) !important;
  }

  .tone-card-indigo {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  .tone-card-blue {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  .tone-card-green {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  .tone-card-violet {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  .tone-card-red {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  .tone-card-amber {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  .tone-blue {
    color: #2563eb;
    background: #eff6ff;
    border-color: #dbeafe;
  }

  :global(html.dark) .tone-blue {
    color: #60a5fa !important;
    background: rgba(96,165,250,0.15) !important;
    border-color: rgba(96,165,250,0.25) !important;
  }

  .tone-green {
    color: #059669;
    background: #ecfdf5;
    border-color: #a7f3d0;
  }

  :global(html.dark) .tone-green {
    color: #34d399 !important;
    background: rgba(52,211,153,0.15) !important;
    border-color: rgba(52,211,153,0.25) !important;
  }

  /* Strong overrides to ensure task-view modal attachments match supervisor pill layout */
  .task-view-modal .task-view-section .attachment-row {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 0.6rem !important;
    padding: 0.6rem 0.9rem !important;
    border-radius: 0.7rem !important;
    background: color-mix(in srgb, var(--color-border) 20%, var(--color-surface)) !important;
    border: 1px solid var(--color-border) !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }

  .task-view-modal .task-view-section .attachment-main {
    min-width: 0 !important;
    overflow: hidden !important;
    flex: 1 !important;
  }

  .task-view-modal .task-view-section .attachment-main a,
  .task-view-modal .task-view-section .attachment-main span {
    font-weight: 600 !important;
    color: var(--color-heading) !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    display: inline-block !important;
    font-size: 0.88rem !important;
  }

  .task-view-modal .task-view-section .attachment-actions {
    display: inline-flex !important;
    align-items: center !important;
    gap: 0.4rem !important;
    flex-shrink: 0 !important;
    flex-direction: row !important;
  }

  .task-view-modal .task-view-section .attachment-action {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 36px !important;
    height: 36px !important;
    border-radius: 10px !important;
    border: 1px solid var(--color-border) !important;
    background: var(--color-surface) !important;
    color: var(--color-accent) !important;
  }

  .tone-red {
    color: #ef4444;
    background: #fef2f2;
    border-color: #fecaca;
  }

  .tone-amber {
    color: #d97706;
    background: #fffbeb;
    border-color: #fde68a;
  }

  .tone-violet {
    color: #7c3aed;
    background: #f5f3ff;
    border-color: #ddd6fe;
  }

  :global(html.dark) .tone-violet {
    color: #22d3ee !important;
    background: rgba(34,211,238,0.15) !important;
    border-color: rgba(34,211,238,0.25) !important;
  }

  :global(html.dark) .tone-indigo {
    color: #7cc3ff;
    background: rgba(91, 177, 255, 0.16);
    border-color: rgba(125, 211, 252, 0.38);
  }

  :global(html.dark) .tone-blue {
    color: #93c5fd;
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(147, 197, 253, 0.36);
  }

  :global(html.dark) .tone-green {
    color: #86efac;
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(134, 239, 172, 0.38);
  }

  :global(html.dark) .tone-violet {
    color: #67e8f9;
    background: rgba(6, 182, 212, 0.18);
    border-color: rgba(103, 232, 249, 0.34);
  }

  @media (max-width: 1200px) {
    .stats-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

  }

  @media (max-width: 720px) {
    .activity-shell {
      border-radius: 1rem;
      padding: 0;
    }

    .stats-grid {
      grid-template-columns: 1fr;
    }

    .controls-right,
    .view-toggle {
      width: 100%;
    }

    .search-control,
    .status-control,
    .status-control select,
    .new-task-btn,
    .view-toggle button {
      flex: 1;
    }

    .search-control input {
      width: 100%;
    }

    .task-row {
      grid-template-columns: minmax(0, 1fr) 7rem 7rem 8rem;
      padding-right: 0.8rem;
    }

    .task-scroll-row {
      grid-template-columns: minmax(0, 1fr) 7.25rem 6.75rem 6.75rem;
      gap: 0.75rem;
      padding: 0.75rem 0.8rem;
    }

    .task-icon-btn {
      width: 2.6rem;
      height: 2.6rem;
      border-radius: 0.8rem;
    }

    .overview-panels {
      grid-template-columns: 1fr;
    }

    .tracker-form-grid {
      grid-template-columns: 1fr;
    }

    .attachment-btn {
      margin-left: 0;
    }
  }

  @media (max-width: 560px) {
    .intern-task-scroll-head {
      display: none;
    }

    .intern-task-scroll-body {
      max-height: none;
      padding: 0.7rem;
    }

    .task-scroll-row {
      grid-template-columns: 1fr;
      justify-items: stretch;
      gap: 0.65rem;
    }

    .task-col-due,
    .task-col-status,
    .task-col-actions {
      justify-self: flex-start;
      text-align: left;
    }

    .task-col-actions {
      display: flex;
      gap: 0.5rem;
    }
  }

  /* Scrollbar styling for Recent Activity */
  .recent-activity-list {
    scrollbar-width: thin;
    scrollbar-color: #0f6cbd rgba(0, 0, 0, 0.1);
  }

  .recent-activity-list::-webkit-scrollbar {
    width: 8px;
  }

  .recent-activity-list::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.05);
    border-radius: 4px;
  }

  .recent-activity-list::-webkit-scrollbar-thumb {
    background: #0f6cbd;
    border-radius: 4px;
  }

  .recent-activity-list::-webkit-scrollbar-thumb:hover {
    background: #0a4a8f;
  }

  /* Reference Activity Log restyle */
  :global(html) {
    --ims-ref-bg: #f0f4f8;
    --ims-ref-surface: #ffffff;
    --ims-ref-surface2: #f8fafc;
    --ims-ref-surface3: #f1f5f9;
    --ims-ref-border: #e2e8f0;
    --ims-ref-border2: #cbd5e1;
    --ims-ref-accent: #2563eb;
    --ims-ref-accent2: #3b82f6;
    --ims-ref-accent-glow: #2563eb20;
    --ims-ref-green: #16a34a;
    --ims-ref-green-dim: #16a34a18;
    --ims-ref-amber: #d97706;
    --ims-ref-amber-dim: #d9770618;
    --ims-ref-red: #dc2626;
    --ims-ref-red-dim: #dc262618;
    --ims-ref-text: #0f172a;
    --ims-ref-text2: #64748b;
    --ims-ref-text3: #94a3b8;
    --ims-ref-radius: 14px;
    --ims-ref-radius-sm: 8px;
    --ims-ref-shadow-sm: 0 1px 3px #0000000d, 0 1px 2px #00000008;
    --ims-ref-shadow: 0 4px 16px #0000001a;
    --ims-ref-input-bg: #f8fafc;
  }

  :global(html.dark),
  :global(body.dark) {
    --ims-ref-bg: #0d1117;
    --ims-ref-surface: #161c27;
    --ims-ref-surface2: #1e2736;
    --ims-ref-surface3: #242f42;
    --ims-ref-border: #ffffff0f;
    --ims-ref-border2: #ffffff1a;
    --ims-ref-accent: #3b82f6;
    --ims-ref-accent2: #60a5fa;
    --ims-ref-accent-glow: #3b82f630;
    --ims-ref-green: #22c55e;
    --ims-ref-green-dim: #22c55e22;
    --ims-ref-amber: #f59e0b;
    --ims-ref-amber-dim: #f59e0b18;
    --ims-ref-red: #ef4444;
    --ims-ref-red-dim: #ef444418;
    --ims-ref-text: #f1f5f9;
    --ims-ref-text2: #94a3b8;
    --ims-ref-text3: #4b5563;
    --ims-ref-shadow-sm: 0 1px 3px #00000030;
    --ims-ref-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
    --ims-ref-input-bg: #1e2736;
  }

  .activity-shell {
    --color-bg: var(--ims-ref-bg);
    --color-surface: var(--ims-ref-surface);
    --color-soft: var(--ims-ref-surface2);
    --color-card: var(--ims-ref-surface);
    --color-border: var(--ims-ref-border);
    --color-heading: var(--ims-ref-text);
    --color-text: var(--ims-ref-text);
    --color-muted: var(--ims-ref-text2);
    --color-accent: var(--ims-ref-accent);
    --color-accent-bg: var(--ims-ref-accent-glow);
    width: 100%;
    padding: 0;
    border-radius: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: var(--ims-ref-text);
    background: transparent;
    font-family: 'DM Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
  }

  .activity-shell::before,
  .activity-shell::after {
    display: none !important;
  }

  .stats-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .stat-card {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 14px;
    min-height: 0;
    padding: 14px 16px;
    border-radius: var(--ims-ref-radius-sm);
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
    overflow: visible;
  }

  .stat-card::before {
    display: none;
  }

  .stat-card:hover {
    box-shadow: var(--ims-ref-shadow);
    transform: translateY(-2px);
  }

  .stat-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    border: 0;
  }

  .stat-icon :global(svg) {
    color: currentColor;
  }

  .tone-amber {
    background: rgba(245, 158, 11, 0.14);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.22);
  }

  .tone-blue {
    background: rgba(59, 130, 246, 0.14);
    color: #3b82f6;
    border: 1px solid rgba(59, 130, 246, 0.22);
  }

  .tone-green {
    background: rgba(34, 197, 94, 0.14);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.22);
  }

  .tone-red {
    background: rgba(239, 68, 68, 0.14);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.22);
  }

  :global(html.dark) .tone-amber,
  :global(body.dark) .tone-amber {
    background: rgba(245, 158, 11, 0.14) !important;
    color: #f59e0b !important;
    border: 1px solid rgba(245, 158, 11, 0.22) !important;
  }

  :global(html.dark) .tone-blue,
  :global(body.dark) .tone-blue {
    background: rgba(59, 130, 246, 0.14) !important;
    color: #3b82f6 !important;
    border: 1px solid rgba(59, 130, 246, 0.22) !important;
  }

  :global(html.dark) .tone-green,
  :global(body.dark) .tone-green {
    background: rgba(34, 197, 94, 0.14) !important;
    color: #22c55e !important;
    border: 1px solid rgba(34, 197, 94, 0.22) !important;
  }

  :global(html.dark) .tone-red,
  :global(body.dark) .tone-red {
    background: rgba(239, 68, 68, 0.14) !important;
    color: #ef4444 !important;
    border: 1px solid rgba(239, 68, 68, 0.22) !important;
  }

  .stat-value {
    color: var(--ims-ref-text);
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.4px;
    line-height: 1;
    text-shadow: none;
  }

  .stat-label {
    color: var(--ims-ref-text2);
    font-size: 11px;
    margin-top: 3px;
    font-weight: 500;
  }

  .controls-bar {
    padding: 10px 14px;
    border-radius: var(--ims-ref-radius-sm);
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
    gap: 10px;
  }

  .view-toggle {
    gap: 6px;
  }

  .view-toggle button,
  .search-control,
  .status-control select {
    min-height: 0;
    border-radius: var(--ims-ref-radius-sm);
    border: 1px solid var(--ims-ref-border);
    background: transparent;
    color: var(--ims-ref-text2);
    font-size: 13px;
    font-weight: 500;
    box-shadow: none;
  }

  .view-toggle button {
    padding: 7px 14px;
    gap: 6px;
  }

  .view-toggle button:hover {
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text);
  }

  .view-toggle button.active {
    background: var(--ims-ref-accent-glow);
    color: var(--ims-ref-accent2);
    border-color: var(--ims-ref-accent2);
  }

  .search-control {
    padding: 7px 12px;
    gap: 7px;
    background: var(--ims-ref-surface2);
  }

  .search-control input {
    width: 130px;
    color: var(--ims-ref-text);
    font-size: 13px;
  }

  .search-control input::placeholder {
    color: var(--ims-ref-text3);
  }

  .status-control::after {
    right: 10px;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--ims-ref-text2);
    border-bottom: 1.5px solid var(--ims-ref-text2);
    transform: translateY(-65%) rotate(45deg);
  }

  .status-control select {
    padding: 7px 30px 7px 12px;
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text);
  }

  .new-task-btn {
    min-height: 0;
    padding: 8px 16px;
    border-radius: var(--ims-ref-radius-sm);
    border: 0;
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
  }

  .panel {
    border-radius: var(--ims-ref-radius);
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
    overflow: hidden;
  }

  .panel:hover {
    box-shadow: var(--ims-ref-shadow-sm);
  }

  .panel-header {
    padding: 14px 18px;
    background: var(--ims-ref-surface);
    border-bottom: 1px solid var(--ims-ref-border);
  }

  .tasks-panel,
  .overview-shell,
  .task-list {
    background: var(--ims-ref-surface);
  }

  .overview-shell {
    gap: 14px;
    padding: 16px;
  }

  .overview-panels {
    grid-template-columns: 1fr 1fr 0.9fr;
    gap: 12px;
  }

  .overview-panel,
  .notes-panel {
    min-height: 180px;
    padding: 16px;
    border-radius: var(--ims-ref-radius);
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
    gap: 0;
  }

  .overview-panel h4,
  .notes-title {
    color: var(--ims-ref-text);
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: 0;
  }

  .overview-panel h4 :global(svg),
  .notes-header :global(svg),
  .tracker-card-heading :global(svg) {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    padding: 6px;
  }

  .overview-empty-copy {
    color: var(--ims-ref-text3);
    font-size: 12px;
    margin-top: 8px;
  }

  .overview-panel ul {
    margin-top: 8px;
    gap: 4px;
  }

  .overview-panel.task-list-panel {
    height: 188px;
    min-height: 188px;
    display: flex;
    flex-direction: column;
  }

  .overview-task-list {
    flex: 1;
    min-height: 0;
    align-content: start;
    grid-auto-rows: min-content;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 2px;
  }

  .notes-panel.task-list-panel .recent-activity-list {
    flex: 1;
    min-height: 0;
    max-height: none;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .overview-task-link {
    padding: 9px 11px;
    border-radius: var(--ims-ref-radius-sm);
    color: var(--ims-ref-text2);
    font-size: 13px;
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    margin-bottom: 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    text-align: left;
    transition: all 0.2s ease;
  }

  .overview-task-link span {
    color: var(--ims-ref-text);
    font-size: 12.5px;
    font-weight: 600;
  }

  .overview-task-link small,
  .worklog-date {
    color: var(--ims-ref-text3);
    font-family: 'DM Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11.5px;
  }

  .overview-task-link:hover,
  .overview-task-link.active {
    background: var(--ims-ref-surface2);
    border-color: var(--ims-ref-accent);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .due-soon-task-list {
    gap: 0;
  }

  .due-soon-task-link {
    padding: 7px 10px;
    min-height: 38px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.75rem;
  }

  .due-soon-task-link span,
  .due-soon-task-link small {
    display: block;
    margin: 0;
  }

  .due-soon-task-link span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .due-soon-task-link small {
    text-align: right;
    white-space: nowrap;
    font-size: 10.25px;
  }

  .recent-activity-list li {
    margin-bottom: 10px !important;
    gap: 8px !important;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .recent-activity-list li > span {
    width: 6px;
    height: 6px;
    min-width: 6px;
    margin-top: 6px !important;
    color: transparent !important;
    background: var(--ims-ref-accent2);
    border-radius: 999px;
    overflow: hidden;
  }

  .recent-activity-list li div div {
    color: var(--ims-ref-text2) !important;
    font-size: 12.5px !important;
    line-height: 1.5;
  }

  .overview-tracker {
    min-height: 0;
    padding: 16px 18px;
    border-radius: var(--ims-ref-radius);
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
  }

  .tracker-card-head {
    align-items: center;
    margin-bottom: 12px;
    padding-left: 0;
  }

  .tracker-summary {
    border: 0;
    padding: 0;
    background: transparent;
  }

  .tracker-title {
    color: var(--ims-ref-text);
    font-size: 14px;
    font-weight: 700;
    margin: 0 0 4px;
  }

  .tracker-description {
    color: var(--ims-ref-text2) !important;
    font-size: 12.5px;
    margin: 0 0 8px !important;
    line-height: 1.5;
  }

  .tracker-meta {
    color: var(--ims-ref-text3);
    font-size: 12px;
    gap: 8px;
  }

  .tracker-menu-trigger,
  .btn-more {
    width: 30px;
    height: 30px;
    border-radius: var(--ims-ref-radius-sm);
    border: 1px solid var(--ims-ref-border);
    color: var(--ims-ref-text2);
    background: transparent;
  }

  .tracker-menu-trigger:hover {
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text);
  }

  .status-pill,
  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 11px;
    border-radius: 40px;
    font-size: 11.5px;
    font-weight: 700;
  }

  .status-pill::before,
  .status-chip::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
  }

  .status-pending {
    color: var(--ims-ref-amber);
    background: var(--ims-ref-amber-dim);
  }

  .status-progress {
    color: var(--ims-ref-accent2);
    background: var(--ims-ref-accent-glow);
  }

  .status-completed {
    color: var(--ims-ref-green);
    background: var(--ims-ref-green-dim);
  }

  .status-overdue {
    color: var(--ims-ref-red);
    background: var(--ims-ref-red-dim);
  }

  .daily-logs-panel {
    margin-top: 0;
  }

  .daily-logs-content {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    gap: 14px;
    padding: 0;
    background: transparent;
  }

  .worklog-card {
    min-width: 0;
    padding: 18px;
    border-radius: var(--ims-ref-radius);
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
  }

  .worklog-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px;
    color: var(--ims-ref-text);
    font-size: 13.5px;
    font-weight: 700;
  }

  .wl-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: var(--ims-ref-accent2);
    background: var(--ims-ref-accent-glow);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 12px;
  }

  .form-label {
    color: var(--ims-ref-text2);
    font-size: 12px;
    font-weight: 700;
  }

  .form-input,
  .form-textarea,
  .task-view-grid input,
  .task-view-grid select,
  .task-view-description textarea {
    width: 100%;
    padding: 9px 12px;
    border-radius: var(--ims-ref-radius-sm);
    border: 1px solid var(--ims-ref-border2);
    background: var(--ims-ref-input-bg);
    color: var(--ims-ref-text);
    font-family: inherit;
    font-size: 12.5px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .form-textarea,
  .task-view-description textarea {
    min-height: 60px;
    resize: vertical;
  }

  .form-input:focus,
  .form-textarea:focus,
  .task-view-grid input:focus,
  .task-view-grid select:focus,
  .task-view-description textarea:focus {
    border-color: var(--ims-ref-accent2);
    box-shadow: 0 0 0 3px var(--ims-ref-accent-glow);
  }

  .file-label,
  .attachment-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: fit-content;
    padding: 7px 12px;
    border-radius: var(--ims-ref-radius-sm);
    border: 1px dashed var(--ims-ref-border2);
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text2);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .file-label:hover,
  .attachment-upload-btn:hover {
    border-color: var(--ims-ref-accent2);
    color: var(--ims-ref-accent2);
  }

  .file-input {
    display: none;
  }

  .submit-worklog-btn,
  .btn-submit {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    margin-top: 4px;
    padding: 10px;
    border: 0;
    border-radius: var(--ims-ref-radius-sm);
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    color: #fff;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);
  }

  .submit-worklog-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .worklog-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }

  .worklog-list-head .worklog-card-head {
    margin-bottom: 0;
  }

  .wl-filters {
    display: flex;
    gap: 8px;
    margin: 0;
    flex-wrap: wrap;
  }

  .wl-search-box {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 160px;
    flex: 1;
    padding: 7px 12px;
    border-radius: var(--ims-ref-radius-sm);
    border: 1px solid var(--ims-ref-border);
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text2);
    font-size: 12.5px;
  }

  .wl-search-box input {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--ims-ref-text);
    font-family: inherit;
    font-size: 12.5px;
  }

  .wl-date-input {
    padding: 7px 10px;
    border-radius: var(--ims-ref-radius-sm);
    border: 1px solid var(--ims-ref-border);
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text);
    font-family: 'DM Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    outline: none;
  }

  .worklogs-empty {
    color: var(--ims-ref-text3);
    font-size: 12.5px;
    text-align: center;
    padding: 28px 0;
    margin: 0;
  }

  .worklogs-accordion-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px 0;
  }

  .worklog-accordion-item,
  .task-accordion-item,
  .task-row {
    border-radius: var(--ims-ref-radius-sm);
    border: 1px solid var(--ims-ref-border);
    background: var(--ims-ref-surface2);
    box-shadow: none;
  }

  .worklog-accordion-item:hover,
  .worklog-accordion-item.expanded,
  .task-accordion-item:hover,
  .task-accordion-item.expanded {
    border-color: var(--ims-ref-accent2);
  }

  .worklog-accordion-trigger,
  .task-accordion-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    background: transparent;
  }

  .worklog-title-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .chevron-corner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    flex-shrink: 0;
    color: var(--ims-ref-text3);
  }

  .worklog-task-title,
  .task-trigger-title {
    color: var(--ims-ref-text);
    font-size: 13px;
    font-weight: 700;
  }

  .worklog-accordion-body,
  .task-accordion-body-modern {
    padding: 12px 14px 14px;
    border-top: 1px solid var(--ims-ref-border);
    background: transparent;
  }

  .worklog-label {
    color: var(--ims-ref-text3);
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .worklog-notes,
  .worklog-learnings,
  .task-description-modern {
    color: var(--ims-ref-text2);
    font-size: 12.5px;
    line-height: 1.5;
  }

        .worklog-attachment-chip,
  .worklog-attachment-item {
    border-radius: var(--ims-ref-radius-sm);
    border: 1px solid var(--ims-ref-border);
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text2);
  }

  .worklog-attachment-chip-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .worklog-attachments {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .worklog-attachment-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 10px;
  }

  .worklog-attachment-main {
    min-width: 0;
    flex: 1;
  }

  .worklog-attachment-name {
    display: block;
    font-size: 13px;
    line-height: 1.35;
    word-break: break-word;
  }

  .worklog-attachment-meta {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    color: var(--ims-ref-text3);
  }

  .worklog-attachment-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 8px;
    flex-shrink: 0;
  }

  .worklog-attachment-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--ims-ref-border);
    background: color-mix(in srgb, var(--ims-ref-surface2) 82%, transparent);
    color: var(--ims-ref-text2);
    transition: border-color 0.18s ease, background-color 0.18s ease, color 0.18s ease, transform 0.12s ease;
  }

  .worklog-attachment-action:hover {
    transform: translateY(-1px);
    border-color: var(--ims-ref-accent2);
    background: color-mix(in srgb, var(--ims-ref-accent2) 14%, var(--ims-ref-surface2));
    color: var(--ims-ref-text);
  }

  .worklog-attachment-action:focus-visible {
    outline: none;
    border-color: var(--ims-ref-accent2);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ims-ref-accent2) 35%, transparent);
  }

  .worklog-attachment-action.action-view,
  .worklog-attachment-action.action-download {
    color: #7fb5ff;
  }

  .task-list {
    padding: 12px;
    gap: 8px;
  }

  .task-view-modal {
    width: min(500px, 100%);
    padding: 20px;
    border-radius: var(--ims-ref-radius);
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.25);
  }

  .task-view-modal-head h4 {
    color: var(--ims-ref-text);
    font-size: 15px;
    font-weight: 700;
  }

  .task-view-action,
  .task-view-close,
  .remove-item {
    border-radius: 40px;
    border: 1px solid var(--ims-ref-border);
    background: var(--ims-ref-surface2);
    color: var(--ims-ref-text2);
    font-size: 12.5px;
    font-weight: 600;
  }

  .task-view-action.primary,
  .tracker-form-actions .primary {
    border-color: var(--ims-ref-accent);
    background: var(--ims-ref-accent);
    color: #fff;
  }

  :global(html.dark) .stat-card,
  :global(html.dark) .panel,
  :global(html.dark) .controls-bar,
  :global(html.dark) .panel-header,
  :global(html.dark) .overview-panel,
  :global(html.dark) .notes-panel,
  :global(html.dark) .overview-tracker,
  :global(html.dark) .worklog-card,
  :global(html.dark) .task-view-modal,
  :global(body.dark) .stat-card,
  :global(body.dark) .panel,
  :global(body.dark) .controls-bar,
  :global(body.dark) .panel-header,
  :global(body.dark) .overview-panel,
  :global(body.dark) .notes-panel,
  :global(body.dark) .overview-tracker,
  :global(body.dark) .worklog-card,
  :global(body.dark) .task-view-modal {
    background: var(--ims-ref-surface) !important;
    border-color: var(--ims-ref-border) !important;
    color: var(--ims-ref-text) !important;
  }

  :global(html.dark) .overview-shell,
  :global(html.dark) .daily-logs-content,
  :global(body.dark) .overview-shell,
  :global(body.dark) .daily-logs-content {
    background: var(--ims-ref-bg) !important;
  }

  :global(html.dark) .view-toggle button,
  :global(html.dark) .search-control,
  :global(html.dark) .status-control select,
  :global(html.dark) .wl-search-box,
  :global(html.dark) .wl-date-input,
  :global(html.dark) .form-input,
  :global(html.dark) .form-textarea,
  :global(body.dark) .view-toggle button,
  :global(body.dark) .search-control,
  :global(body.dark) .status-control select,
  :global(body.dark) .wl-search-box,
  :global(body.dark) .wl-date-input,
  :global(body.dark) .form-input,
  :global(body.dark) .form-textarea {
    background: var(--ims-ref-surface2) !important;
    border-color: var(--ims-ref-border) !important;
    color: var(--ims-ref-text) !important;
  }

  :global(html.dark) .activity-shell,
  :global(body.dark) .activity-shell {
    background: #0d1117 !important;
  }

  :global(html.dark) .activity-shell .stat-card,
  :global(html.dark) .activity-shell .controls-bar,
  :global(html.dark) .activity-shell .panel,
  :global(html.dark) .activity-shell .panel-header,
  :global(html.dark) .activity-shell .tasks-panel,
  :global(html.dark) .activity-shell .overview-panel,
  :global(html.dark) .activity-shell .notes-panel,
  :global(html.dark) .activity-shell .overview-tracker,
  :global(html.dark) .activity-shell .worklog-card,
  :global(html.dark) .activity-shell .task-view-modal,
  :global(body.dark) .activity-shell .stat-card,
  :global(body.dark) .activity-shell .controls-bar,
  :global(body.dark) .activity-shell .panel,
  :global(body.dark) .activity-shell .panel-header,
  :global(body.dark) .activity-shell .tasks-panel,
  :global(body.dark) .activity-shell .overview-panel,
  :global(body.dark) .activity-shell .notes-panel,
  :global(body.dark) .activity-shell .overview-tracker,
  :global(body.dark) .activity-shell .worklog-card,
  :global(body.dark) .activity-shell .task-view-modal {
    background-color: #161c27 !important;
    border-color: #ffffff0f !important;
    box-shadow: 0 1px 3px #00000030 !important;
  }

  :global(html.dark) .activity-shell .overview-shell,
  :global(html.dark) .activity-shell .daily-logs-content,
  :global(html.dark) .activity-shell .task-list,
  :global(body.dark) .activity-shell .overview-shell,
  :global(body.dark) .activity-shell .daily-logs-content,
  :global(body.dark) .activity-shell .task-list {
    background-color: #0d1117 !important;
  }

  :global(html.dark) .activity-shell .search-control,
  :global(html.dark) .activity-shell .status-control select,
  :global(html.dark) .activity-shell .view-toggle button,
  :global(html.dark) .activity-shell .form-textarea,
  :global(html.dark) .activity-shell .form-input,
  :global(html.dark) .activity-shell .wl-search-box,
  :global(html.dark) .activity-shell .wl-date-input,
  :global(html.dark) .activity-shell .file-label,
  :global(html.dark) .activity-shell .attachment-upload-btn,
  :global(html.dark) .activity-shell .task-accordion-item,
  :global(html.dark) .activity-shell .worklog-accordion-item,
  :global(html.dark) .activity-shell .worklog-attachment-item,
  :global(html.dark) .activity-shell .attachment-list li,
  :global(body.dark) .activity-shell .search-control,
  :global(body.dark) .activity-shell .status-control select,
  :global(body.dark) .activity-shell .view-toggle button,
  :global(body.dark) .activity-shell .form-textarea,
  :global(body.dark) .activity-shell .form-input,
  :global(body.dark) .activity-shell .wl-search-box,
  :global(body.dark) .activity-shell .wl-date-input,
  :global(body.dark) .activity-shell .file-label,
  :global(body.dark) .activity-shell .attachment-upload-btn,
  :global(body.dark) .activity-shell .task-accordion-item,
  :global(body.dark) .activity-shell .worklog-accordion-item,
  :global(body.dark) .activity-shell .worklog-attachment-item,
  :global(body.dark) .activity-shell .worklog-attachment-item {
    background-color: #1e2736 !important;
    border-color: #ffffff1a !important;
  }

  /* Ensure task attachment list items don't get a separate box; the .attachment-row is the single box */
  :global(body.dark) .activity-shell .attachment-list li {
    background-color: transparent !important;
    border-color: transparent !important;
  }

  :global(html.dark) .activity-shell .overview-task-link:hover,
  :global(html.dark) .activity-shell .overview-task-link.active,
  :global(html.dark) .activity-shell .view-toggle button:hover,
  :global(body.dark) .activity-shell .overview-task-link:hover,
  :global(body.dark) .activity-shell .overview-task-link.active,
  :global(body.dark) .activity-shell .view-toggle button:hover {
    background-color: #1e2736 !important;
    border-color: #ffffff1a !important;
  }

  :global(html.dark) .activity-shell .view-toggle button.active,
  :global(body.dark) .activity-shell .view-toggle button.active {
    background-color: #3b82f630 !important;
    border-color: #60a5fa !important;
    color: #60a5fa !important;
  }

  /* ProjectsIntern visual-alignment overrides */
  .activity-shell.projects-page {
    gap: 14px;
    font-family: inherit;
  }

  .activity-shell.projects-page .stats-grid {
    gap: 14px;
  }

  .activity-shell.projects-page .stat-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
    padding: 18px 20px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    min-height: 0;
    overflow: visible;
  }

  .activity-shell.projects-page .stat-card::before {
    display: none;
  }

  :global(body.dark) .activity-shell.projects-page .stat-card {
    background: #161c27 !important;
    border-color: rgba(255, 255, 255, 0.06) !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18) !important;
  }

  .activity-shell.projects-page .stat-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .activity-shell.projects-page .stat-loading-card {
    align-items: center;
    min-height: 92px;
  }

  .activity-shell.projects-page .stat-loading-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    flex-shrink: 0;
  }

  .activity-shell.projects-page .stat-loading-label {
    width: 110px;
    height: 11px;
    border-radius: 6px;
  }

  .activity-shell.projects-page .stat-loading-value {
    width: 60px;
    height: 24px;
    border-radius: 8px;
  }

  .activity-shell.projects-page .stat-loading-sub {
    width: 140px;
    height: 11px;
    border-radius: 6px;
    margin-top: 2px;
  }

  .activity-shell.projects-page .stat-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .activity-shell.projects-page .stat-label {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #000000;
  }

  :global(body.dark) .activity-shell.projects-page .stat-label {
    color: #ffffff !important;
  }

  .activity-shell.projects-page .stat-value {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.8px;
    line-height: 1;
    color: #0f172a;
    text-shadow: none;
  }

  :global(body.dark) .activity-shell.projects-page .stat-value {
    color: #f1f5f9 !important;
  }

  .activity-shell.projects-page .stat-sub {
    margin: 0;
    font-size: 11.5px;
    color: #64748b;
    line-height: 1.25;
  }

  :global(body.dark) .activity-shell.projects-page .stat-sub {
    color: #94a3b8 !important;
  }

  .activity-shell.projects-page .quick-panel {
    background: transparent !important;
    padding: 0;
    margin-bottom: 0;
    border-radius: 0;
    border: none !important;
    box-shadow: none !important;
  }

  .activity-shell.projects-page .quick-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 0.75rem;
    flex-wrap: nowrap;
  }

  .activity-shell.projects-page .view-controls {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .activity-shell.projects-page .view-controls .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: 0.7rem;
    padding: 0.32rem 0.72rem;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    font-size: 0.84rem;
    height: 2.15rem;
    line-height: 1;
    cursor: pointer;
  }

  .activity-shell.projects-page .view-controls .btn.active {
    background: var(--color-soft);
    color: var(--color-heading);
    border-color: var(--color-border);
  }

  :global(html.dark) .activity-shell.projects-page .view-controls .btn,
  :global(body.dark) .activity-shell.projects-page .view-controls .btn {
    background: transparent !important;
    color: #e2e8f0 !important;
    border-color: #334155 !important;
  }

  :global(html.dark) .activity-shell.projects-page .view-controls .btn:hover,
  :global(body.dark) .activity-shell.projects-page .view-controls .btn:hover {
    background: #1e2736 !important;
    border-color: #ffffff1a !important;
    color: #e5edf8 !important;
  }

  :global(body.dark) .activity-shell.projects-page .view-controls .btn.active {
    background: #1e2736 !important;
    color: #e5edf8 !important;
    border-color: #ffffff1a !important;
  }

  :global(html.dark) .activity-shell.projects-page .view-controls .btn.active,
  :global(body.dark) .activity-shell.projects-page .view-controls .btn.active {
    background: #1e2736 !important;
    color: #e5edf8 !important;
    border-color: #ffffff1a !important;
  }

  .activity-shell.projects-page .quick-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-left: auto;
    flex-wrap: nowrap;
  }

  .activity-shell.projects-page .quick-actions .search-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.7rem;
    color: var(--color-muted);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.7rem;
    height: 2.15rem;
  }

  .activity-shell.projects-page .quick-actions .search-input {
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    width: 11.5rem;
    outline: none;
    padding: 0;
    height: 100%;
  }

  .activity-shell.projects-page .quick-actions .quick-status {
    padding: 0 1.85rem 0 0.75rem;
    border-radius: 0.7rem;
    font-size: 0.85rem;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    height: 2.15rem;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }

  .activity-shell.projects-page .quick-actions .primary {
    padding: 0 0.95rem;
    font-size: 0.85rem;
    border-radius: 0.7rem;
    background: #2563eb;
    color: #fff;
    border: none;
    height: 2.15rem;
    display: inline-flex;
    align-items: center;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: none;
  }

  .activity-shell.projects-page .documents-grid {
    gap: 14px;
  }

  .activity-shell.projects-page .tasks-panel {
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
    overflow: hidden;
  }

  :global(html.dark) .activity-shell.projects-page .tasks-panel,
  :global(body.dark) .activity-shell.projects-page .tasks-panel {
    background: var(--ims-ref-surface) !important;
    border: 1px solid var(--ims-ref-border) !important;
    box-shadow: var(--ims-ref-shadow-sm) !important;
  }

  .activity-shell.projects-page .panel {
    border-radius: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
  }

  .activity-shell.projects-page .panel-header {
    padding: 0.85rem 1rem;
  }

  .activity-shell.projects-page .overview-shell,
  .activity-shell.projects-page .daily-logs-content {
    gap: 14px;
    padding: 14px;
  }

  .activity-shell.projects-page .daily-logs-panel {
    background: var(--ims-ref-surface);
    border: 1px solid var(--ims-ref-border);
    box-shadow: var(--ims-ref-shadow-sm);
    overflow: hidden;
  }

  .activity-shell.projects-page .daily-logs-panel > .panel-header {
    padding: 0.95rem 1rem 0.9rem;
  }

  :global(html.dark) .activity-shell.projects-page .daily-logs-panel > .panel-header,
  :global(body.dark) .activity-shell.projects-page .daily-logs-panel > .panel-header {
    background: var(--ims-ref-surface) !important;
    border-bottom: 1px solid var(--ims-ref-border) !important;
  }

  .activity-shell.projects-page .daily-logs-content {
    align-items: start;
    background: transparent;
    padding: 0;
  }

  :global(html.dark) .activity-shell.projects-page .daily-logs-content,
  :global(body.dark) .activity-shell.projects-page .daily-logs-content {
    background: transparent !important;
  }

  .activity-shell.projects-page .overview-shell {
    background: transparent;
    padding: 0;
  }

  :global(html.dark) .activity-shell.projects-page .overview-shell,
  :global(body.dark) .activity-shell.projects-page .overview-shell {
    background: transparent !important;
  }

  .activity-shell.projects-page .overview-panels {
    gap: 14px;
  }

  .activity-shell.projects-page .overview-panel,
  .activity-shell.projects-page .overview-tracker,
  .activity-shell.projects-page .worklog-card,
  .activity-shell.projects-page .task-accordion-item,
  .activity-shell.projects-page .worklog-accordion-item,
  .activity-shell.projects-page .task-row {
    border-radius: 12px;
  }

  .activity-shell.projects-page .worklog-list-card {
    height: 500px;
    min-height: 500px;
    display: flex;
    flex-direction: column;
  }

  .activity-shell.projects-page .worklog-form-card {
    height: 500px;
    min-height: 500px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .activity-shell.projects-page .worklog-form-card form {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-bottom: 0.45rem;
    padding-right: 2px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .activity-shell.projects-page .worklog-form-card form::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .activity-shell.projects-page .worklog-form-card .submit-worklog-btn {
    margin-top: auto;
    flex-shrink: 0;
  }

  .activity-shell.projects-page .worklog-list-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .activity-shell.projects-page .worklog-list-scroll::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .activity-shell.projects-page .worklogs-loading-center {
    min-height: 100%;
    display: grid;
    place-items: center;
    gap: 0.55rem;
    color: var(--color-muted);
    font-size: 0.92rem;
    text-align: center;
  }

  .activity-shell.projects-page .worklogs-loading-shell {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .activity-shell.projects-page .worklog-loading-item {
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    overflow: hidden;
  }

  .activity-shell.projects-page .worklog-loading-trigger {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 1.05rem 1.4rem;
    min-height: 74px;
  }

  .activity-shell.projects-page .worklog-loading-title {
    display: grid;
    gap: 0.45rem;
    width: 100%;
    max-width: 360px;
  }

  .activity-shell.projects-page .wl-sk-title {
    width: 72%;
    max-width: 260px;
    height: 14px;
    border-radius: 5px;
  }

  .activity-shell.projects-page .wl-sk-date {
    width: 42%;
    max-width: 160px;
    height: 12px;
    border-radius: 5px;
  }

  .activity-shell.projects-page .wl-sk-chevron {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .activity-shell.projects-page .worklogs-empty-center {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 0 1rem;
    text-align: center;
  }

  .activity-shell.projects-page .worklogs-empty-center .worklogs-empty {
    margin: 0;
    padding: 0;
  }

  .activity-shell.projects-page .task-list {
    padding: 0.4rem;
    gap: 0.4rem;
    background: var(--color-soft);
  }

  .tasks-loading-shell {
    display: grid;
    gap: 14px;
    background: transparent;
  }

  .task-loading-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }

  .task-loading-card,
  .task-loading-focus {
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    padding: 14px;
  }

  .task-loading-card {
    height: 190px;
    min-height: 190px;
    display: flex;
    flex-direction: column;
  }

  .task-loading-head,
  .task-loading-focus-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .task-loading-head {
    justify-content: flex-start;
  }

  .task-loading-lines {
    display: grid;
    gap: 8px;
    align-content: start;
    flex: 1;
    min-height: 0;
  }

  .task-loading-worklogs {
    align-items: start;
  }

  .task-loading-worklog {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .task-loading-worklog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }

  .task-loading-worklog-filters {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .task-loading-worklog-list {
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .task-loading-worklog-item {
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-border) 28%, var(--color-surface));
    padding: 12px 14px;
    display: grid;
    gap: 8px;
  }

  .act-skeleton {
    position: relative;
    overflow: hidden;
    border-radius: 7px;
    background: #e2e8f0;
  }

  :global(body.dark) .act-skeleton {
    background: #1e293b;
  }

  .shimmer::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.42), transparent);
    animation: actShimmer 1.5s infinite;
  }

  :global(body.dark) .shimmer::after {
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
  }

  @keyframes actShimmer {
    100% { transform: translateX(100%); }
  }

  @media (max-width: 980px) {
    .activity-shell.projects-page .worklog-list-card {
      height: auto;
      min-height: 0;
    }

    .activity-shell.projects-page .worklog-form-card {
      height: auto;
      min-height: 0;
      overflow: visible;
    }

    .activity-shell.projects-page .worklog-form-card form {
      overflow: visible;
    }

    .activity-shell.projects-page .worklog-list-scroll {
      overflow: visible;
    }

    .task-loading-grid {
      grid-template-columns: 1fr;
    }

    .task-loading-worklog-head {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }

    .task-loading-worklog-filters {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
    }

    .overview-panels,
    .daily-logs-content {
      grid-template-columns: 1fr;
    }

    .activity-shell.projects-page .quick-head {
      flex-direction: column;
      align-items: stretch;
      gap: 0.65rem;
    }

    .activity-shell.projects-page .quick-actions {
      margin-left: 0;
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 0.5rem;
      align-items: stretch;
    }

    .activity-shell.projects-page .quick-actions > * {
      width: 100%;
      min-width: 0;
    }

    .activity-shell.projects-page .quick-actions .search-wrap {
      grid-column: 1 / -1;
      width: 100%;
      box-sizing: border-box;
    }

    .activity-shell.projects-page .quick-actions .status-control {
      width: 100%;
    }

    .activity-shell.projects-page .quick-actions .quick-status {
      width: 100%;
      padding: 0 1.65rem 0 0.62rem;
      font-size: 0.82rem;
      text-overflow: ellipsis;
    }

    .activity-shell.projects-page .quick-actions .status-control::after {
      right: 0.62rem;
    }

    .activity-shell.projects-page .quick-actions .primary {
      width: 100%;
      justify-content: center;
      padding: 0 0.72rem;
    }
  }

  @media (max-width: 720px) {
    .activity-shell {
      gap: 12px;
      padding: 0;
    }

    .stats-grid {
      grid-template-columns: 1fr;
    }

    .controls-right,
    .view-toggle {
      width: 100%;
    }

    .search-control,
    .status-control,
    .status-control select,
    .new-task-btn,
    .view-toggle button {
      flex: 1;
    }

    .search-control input {
      width: 100%;
    }

    .daily-logs-content,
    .overview-shell {
      padding: 12px;
    }

    .activity-shell.projects-page .quick-actions .search-wrap,
    .activity-shell.projects-page .quick-actions .quick-status,
    .activity-shell.projects-page .quick-actions .primary {
      height: 2.35rem;
      min-height: 2.35rem;
      border-radius: 0.72rem;
      box-sizing: border-box;
    }

    .activity-shell.projects-page .quick-actions .search-input {
      width: 100%;
      font-size: 0.9rem;
    }
  }
</style>

