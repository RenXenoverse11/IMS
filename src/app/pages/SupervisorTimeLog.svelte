<script>
  import { onDestroy, onMount } from 'svelte';
  import { Clock3, ListFilter, RefreshCw, Trash2, UserCircle2, Users, Loader2 } from 'lucide-svelte';
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
  let errorMessage = '';
  let successMessage = '';

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

    if (!supervisorId || !studentId || roleNow !== 'supervisor') {
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

  async function handleDelete(logId) {
    const supervisorId = String(currentUser?.user_id || '').trim();
    const studentId = String(selectedStudentId || '').trim();
    const timelogId = String(logId || '').trim();

    if (!supervisorId || !studentId || !timelogId) {
      return;
    }

    const confirmed = window.confirm('Delete this student time log entry?');
    if (!confirmed) {
      return;
    }

    deletingId = timelogId;
    errorMessage = '';
    successMessage = '';

    try {
      await deleteSupervisorTimeLog(supervisorId, studentId, timelogId);
      logs = logs.filter((row) => String(row.timelog_id) !== timelogId);
      successMessage = 'Intern time log deleted successfully.';
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
  $: currentRole = String(currentUser?.role || '').trim().toLowerCase();
  $: isSupervisorUser = currentRole === 'supervisor';
  $: if (assignedStudents.length > 0 && isSupervisorUser) {
    loadActiveSessions();
  }
</script>

{#if currentUser && !isSupervisorUser}
  <section class="warning-alert">
    This page is available for supervisor accounts only.
  </section>
{:else}
  <section class="stl-shell">
    {#if loadingActiveSessions && assignedStudents.length > 0}
      <section class="stl-card stl-card-success stl-skeleton-panel">
        <div class="sk-line shimmer" style="height: 14px; width: 180px; border-radius: 8px;"></div>
        <div class="sk-line shimmer" style="height: 11px; width: 240px; border-radius: 7px; margin-top: 8px;"></div>
      </section>
    {:else if activeSessions.length > 0}
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

    <section class="stl-card">
      <div class="control-head">
        <div>
          <h3 class="section-title">Intern Time Logs</h3>
          <p class="section-sub">View and manage entries of interns assigned to you.</p>
        </div>

        <div class="control-actions">
          <label class="selector-wrap">
            <ListFilter size={15} class="selector-icon" />
            <select bind:value={selectedStudentId} class="stl-input" on:change={loadLogs}>
              {#if loadingStudents}
                <option value="">Loading intern accounts...</option>
              {:else if assignedStudents.length === 0}
                <option value="">No assigned interns</option>
              {:else}
                {#each assignedStudents as student (student.user_id)}
                  <option value={student.user_id}>{student.full_name}</option>
                {/each}
              {/if}
            </select>
          </label>

          <button type="button" class="btn-secondary" on:click={loadAssignedStudents} disabled={loadingStudents || loadingLogs}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>
    </section>

    {#if errorMessage}
      <p class="alert alert-error">{errorMessage}</p>
    {/if}

    {#if successMessage}
      <p class="alert alert-success">{successMessage}</p>
    {/if}

    {#if loadingStudents}
      <div class="stats-grid">
        {#each [1, 2, 3, 4] as _}
          <article class="stl-card stat-card skeleton-stat-card">
            <div class="sk-pill shimmer"></div>
            <div class="sk-line shimmer" style="height: 22px; width: 55%; border-radius: 8px; margin-top: 18px;"></div>
            <div class="sk-line shimmer" style="height: 11px; width: 42%; border-radius: 7px; margin-top: 10px;"></div>
          </article>
        {/each}
      </div>

      <section class="stl-card">
        <h3 class="section-title">Time Log Entries</h3>
        <p class="section-sub">Loading entries...</p>
        <div class="table-wrap">
          <table class="stl-table" style="min-width: 700px;">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th>Hours</th>
                <th>Notes</th>
                <th class="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {#each [1, 2, 3] as __}
                <tr>
                  <td><div class="sk-line shimmer" style="height: 11px; width: 90px; border-radius: 7px;"></div></td>
                  <td><div class="sk-line shimmer" style="height: 11px; width: 64px; border-radius: 7px;"></div></td>
                  <td><div class="sk-line shimmer" style="height: 11px; width: 64px; border-radius: 7px;"></div></td>
                  <td><div class="sk-line shimmer" style="height: 11px; width: 40px; border-radius: 7px;"></div></td>
                  <td><div class="sk-line shimmer" style="height: 11px; width: 70px; border-radius: 7px;"></div></td>
                  <td class="text-right"><div class="sk-pill shimmer" style="width: 58px;"></div></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {:else if selectedStudent}
      {@const summaryProgressTone = selectedProgress >= 80 ? 'high' : selectedProgress >= 40 ? 'mid' : 'low'}
      <div class="stats-grid">
        <article class="stl-card stat-card">
          <div class="stat-icon icon-blue"><UserCircle2 size={18} /></div>
          <p class="stat-value stat-name">{selectedStudent.full_name || 'Intern'}</p>
          <p class="stat-label">Selected Intern</p>
        </article>

        <article class="stl-card stat-card">
          <div class="stat-icon icon-violet"><Users size={18} /></div>
          <p class="stat-value">{selectedProgress}%</p>
          <p class="stat-label">Overall Progress</p>
          <div class="progress-inline">
            <div class="progress-track">
              <div class={`progress-fill progress-${summaryProgressTone}`} style={`width:${selectedProgress}%`}></div>
            </div>
          </div>
        </article>

        <article class="stl-card stat-card">
          <div class="stat-icon icon-green"><Clock3 size={18} /></div>
          <p class="stat-value">{formatHours(selectedCompletedHours)}h</p>
          <p class="stat-label">Completed Hours</p>
        </article>

        <article class="stl-card stat-card">
          <div class="stat-icon icon-amber"><Clock3 size={18} /></div>
          <p class="stat-value">{formatHours(selectedRemainingHours)}h</p>
          <p class="stat-label">Remaining Hours</p>
        </article>
      </div>

      <section class="stl-card">
        <h3 class="section-title">Time Log Entries</h3>
        <p class="section-sub">You can delete invalid entries from your assigned interns.</p>

        {#if loadingLogs}
          <div class="table-wrap">
            <table class="stl-table" style="min-width: 700px;">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th>Hours</th>
                  <th>Notes</th>
                  <th class="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {#each [1, 2, 3] as __}
                  <tr>
                    <td><div class="sk-line shimmer" style="height: 11px; width: 90px; border-radius: 7px;"></div></td>
                    <td><div class="sk-line shimmer" style="height: 11px; width: 64px; border-radius: 7px;"></div></td>
                    <td><div class="sk-line shimmer" style="height: 11px; width: 64px; border-radius: 7px;"></div></td>
                    <td><div class="sk-line shimmer" style="height: 11px; width: 40px; border-radius: 7px;"></div></td>
                    <td><div class="sk-line shimmer" style="height: 11px; width: 70px; border-radius: 7px;"></div></td>
                    <td class="text-right"><div class="sk-pill shimmer" style="width: 58px;"></div></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else if logs.length === 0}
          <div class="empty-state">
            <div class="empty-icon"><Clock3 size={18} /></div>
            <p class="empty-title">No time log entries yet.</p>
            <p class="empty-sub">Entries for the selected intern will appear here.</p>
          </div>
        {:else}
          <div class="table-wrap">
            <table class="stl-table" style="min-width: 700px;">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th>Hours</th>
                  <th>Notes</th>
                  <th class="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {#each logs as row (row.timelog_id)}
                  <tr>
                    <td>{formatDate(row.log_date)}</td>
                    <td>{toTimeText(row.time_in)}</td>
                    <td>{toTimeText(row.time_out)}</td>
                    <td class="font-semibold">{formatHours(row.hours_rendered)}h</td>
                    <td>{row.notes || '-'}</td>
                    <td class="text-right">
                      <button
                        type="button"
                        class="btn-delete"
                        on:click={() => handleDelete(row.timelog_id)}
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

          <div class="timeline-wrap">
            <h4 class="section-title">Login/Logout History</h4>
            <div class="timeline">
              {#each logs as row, idx (row.timelog_id)}
                <div class="timeline-item">
                  <div class="timeline-marker">
                    <div class="timeline-dot"></div>
                    {#if idx !== logs.length - 1}
                      <div class="timeline-line"></div>
                    {/if}
                  </div>
                  <div class="timeline-content">
                    <p class="timeline-date">{formatDate(row.log_date)}</p>
                    <div class="timeline-event login">
                      <span>Logged In</span>
                      <strong>{toTimeText(row.time_in)}</strong>
                    </div>
                    {#if row.time_out}
                      <div class="timeline-event logout">
                        <span>Logged Out</span>
                        <strong>{toTimeText(row.time_out)}</strong>
                      </div>
                      <p class="timeline-duration">Duration: {formatHours(row.hours_rendered)}h</p>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
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
  }

  .stl-card-success {
    border-color: rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.08);
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
    align-items: flex-end;
    justify-content: space-between;
    gap: 14px;
  }

  .control-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(100%, 465px);
  }

  .selector-wrap {
    position: relative;
    flex: 1;
  }

  .selector-icon {
    position: absolute;
    left: 11px;
    top: 50%;
    transform: translateY(-50%);
    color: #64748b;
    pointer-events: none;
  }

  .stl-input {
    width: 100%;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    border-radius: 10px;
    padding: 10px 12px 10px 34px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .stl-input:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    border-radius: 10px;
    padding: 10px 14px;
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
    min-height: 132px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .stat-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .icon-blue {
    background: rgba(59, 130, 246, 0.14);
    color: #3b82f6;
    border: 1px solid rgba(59, 130, 246, 0.22);
  }

  .icon-violet {
    background: rgba(99, 102, 241, 0.14);
    color: #4f46e5;
    border: 1px solid rgba(99, 102, 241, 0.24);
  }

  .icon-green {
    background: rgba(34, 197, 94, 0.14);
    color: #16a34a;
    border: 1px solid rgba(34, 197, 94, 0.22);
  }

  .icon-amber {
    background: rgba(245, 158, 11, 0.14);
    color: #d97706;
    border: 1px solid rgba(245, 158, 11, 0.24);
  }

  .stat-value {
    margin: 8px 0 0;
    font-size: 36px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: -0.8px;
    color: #0f172a;
  }

  .stat-name {
    font-size: 30px;
    line-height: 1.08;
  }

  .stat-label {
    margin: 0;
    font-size: 13px;
    color: #64748b;
  }

  .progress-inline {
    margin-top: auto;
    padding-top: 6px;
  }

  .progress-track {
    height: 8px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(148, 163, 184, 0.2);
    overflow: hidden;
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

  .table-wrap {
    margin-top: 12px;
    overflow-x: auto;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .stl-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    color: #334155;
  }

  .stl-table thead th {
    background: #eff6ff;
    color: #0f172a;
    font-weight: 600;
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid #dbeafe;
  }

  .stl-table td {
    padding: 12px 16px;
    border-top: 1px solid #e2e8f0;
  }

  .stl-table tbody tr:hover {
    background: #f1f5f9;
  }

  .text-right {
    text-align: right;
  }

  .font-semibold {
    font-weight: 700;
  }

  .btn-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid rgba(239, 68, 68, 0.24);
    background: rgba(239, 68, 68, 0.08);
    color: #b91c1c;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-delete:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
    color: #991b1b;
  }

  .btn-delete:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .timeline-wrap {
    margin-top: 20px;
  }

  .timeline {
    margin-top: 10px;
    display: grid;
    gap: 16px;
  }

  .timeline-item {
    display: flex;
    gap: 12px;
  }

  .timeline-marker {
    width: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
  }

  .timeline-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: #3b82f6;
  }

  .timeline-line {
    width: 2px;
    flex: 1;
    margin-top: 6px;
    background: rgba(59, 130, 246, 0.45);
  }

  .timeline-content {
    flex: 1;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 10px 12px;
  }

  .timeline-date {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
  }

  .timeline-event {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 9px;
    border-radius: 8px;
    font-size: 13px;
  }

  .timeline-event.login {
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
  }

  .timeline-event.logout {
    margin-top: 6px;
    background: rgba(59, 130, 246, 0.12);
    color: #1d4ed8;
  }

  .timeline-duration {
    margin: 8px 0 0;
    font-size: 12px;
    color: #64748b;
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

  .sk-line,
  .sk-pill {
    display: inline-block;
    background: rgba(148, 163, 184, 0.12);
    border: 1px solid rgba(148, 163, 184, 0.16);
  }

  .sk-pill {
    width: 68px;
    height: 24px;
    border-radius: 999px;
  }

  .shimmer {
    position: relative;
    overflow: hidden;
  }

  .shimmer::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.2), rgba(148, 163, 184, 0));
    animation: stl-shimmer 1.45s ease-in-out infinite;
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

  @keyframes stl-shimmer {
    100% { transform: translateX(100%); }
  }

  :global(.dark) .warning-alert {
    background: #fef3c7;
    border-color: #fcd34d;
    color: #92400e;
  }

  :global(.dark) .stl-card {
    border-color: rgba(255, 255, 255, 0.08);
    background: #161c27;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }

  :global(.dark) .stl-card-success {
    border-color: rgba(16, 185, 129, 0.3);
    background: rgba(16, 185, 129, 0.12);
  }

  :global(.dark) .section-title,
  :global(.dark) .stat-value,
  :global(.dark) .empty-title,
  :global(.dark) .timeline-date {
    color: #f1f5f9;
  }

  :global(.dark) .section-sub,
  :global(.dark) .stat-label,
  :global(.dark) .empty-sub,
  :global(.dark) .timeline-duration {
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

  :global(.dark) .stl-input,
  :global(.dark) .btn-secondary {
    background: #1a2332;
    border-color: rgba(255, 255, 255, 0.12);
    color: #e2e8f0;
  }

  :global(.dark) .selector-icon {
    color: #94a3b8;
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: #243047;
    border-color: rgba(96, 165, 250, 0.42);
  }

  :global(.dark) .table-wrap {
    border-color: rgba(255, 255, 255, 0.1);
    background: #1a2332;
  }

  :global(.dark) .stl-table {
    color: #cbd5e1;
  }

  :global(.dark) .stl-table thead th {
    background: #1d2a40;
    color: #e2e8f0;
    border-bottom-color: rgba(148, 163, 184, 0.2);
  }

  :global(.dark) .stl-table td {
    border-top-color: rgba(148, 163, 184, 0.14);
  }

  :global(.dark) .stl-table tbody tr:hover {
    background: rgba(59, 130, 246, 0.08);
  }

  :global(.dark) .timeline-content {
    border-color: rgba(148, 163, 184, 0.2);
    background: #1a2332;
  }

  :global(.dark) .timeline-event.login {
    background: rgba(16, 185, 129, 0.2);
    color: #6ee7b7;
  }

  :global(.dark) .timeline-event.logout {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
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

  :global(.dark) .sk-line,
  :global(.dark) .sk-pill {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.12);
  }

  @media (max-width: 1200px) {
    .stats-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 900px) {
    .control-head {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }

    .control-actions {
      width: 100%;
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

    .control-actions {
      flex-direction: column;
      align-items: stretch;
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
