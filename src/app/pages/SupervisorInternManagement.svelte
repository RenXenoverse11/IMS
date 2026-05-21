<script>
  import { onDestroy, onMount } from 'svelte';
  import {
    Check,
    Clock3,
    RefreshCw,
    Search,
    TrendingUp,
    UserRoundCheck,
    X,
    Loader2,
    Plus,
    Trash2
  } from 'lucide-svelte';
  import {
    assignStudentsToSupervisor,
    callApiAction,
    getCurrentUser,
    listStudentsForAssignment,
    listSupervisorAssignedStudents,
    saveInternSchedule,
    subscribeToCurrentUser,
  } from '../lib/auth.js';

  export let currentUser = null;

  let loading = true;
  let saving = false;
  let errorMessage = '';
  let successMessage = '';
  let availableStudents = [];
  let assignedStudents = [];
  let studentSearch = '';
  let unsubscribe;
  let showAddModal = false;
  let addModalSearch = '';
  let removingInternId = null;
  let selectedInternForSetup = null;
  const DEFAULT_DAYS_OFF = [0, 6];
  const DAY_OPTIONS = [
    { label: 'Monday', value: 1 },
    { label: 'Tuesday', value: 2 },
    { label: 'Wednesday', value: 3 },
    { label: 'Thursday', value: 4 },
    { label: 'Friday', value: 5 },
    { label: 'Saturday', value: 6 },
    { label: 'Sunday', value: 0 },
  ];
  let internDaysOff = [...DEFAULT_DAYS_OFF];
  let internShiftStart = '09:00';
  let internShiftEnd = '17:00';
  let bulkAssignMode = false;
  let bulkSelectedInterns = new Set();
  let bulkDaysOff = [...DEFAULT_DAYS_OFF];
  let bulkShiftStart = '09:00';
  let bulkShiftEnd = '17:00';
  let showEditEndDateModal = false;
  let editingInternId = null;
  let editingInternName = '';
  let editingEndDate = '';
  let savingEndDate = false;
  const HOURS_PER_WORKING_DAY = 8;

  function toNumber(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatHours(value) {
    const numeric = toNumber(value);
    const rounded = Math.round(numeric * 10) / 10;
    const normalized = rounded === 0 ? 0 : rounded;

    if (normalized === 0) return '0h';
    if (Math.abs(normalized) < 1) return `${normalized.toFixed(1)}h`;
    if (Number.isInteger(normalized)) return `${normalized}h`;
    return `${normalized.toFixed(1)}h`;
  }

  function toPercent(completed, required) {
    if (required <= 0) return 0;
    return Math.min(100, Math.round((completed / required) * 100));
  }

  function getInitials(fullName) {
    const value = String(fullName || '').trim();
    if (!value) return 'ST';
    return (
      value
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'ST'
    );
  }

  function normalizeDate(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return text;
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed);
  }

  function normalizeDepartment(dept) {
    const d = String(dept || '').trim();
    if (d.toUpperCase() === 'INTERNATIONAL NOC') return 'ISOC';
    return d;
  }

  function firstNonEmptyText(...values) {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return '';
  }

  function formatMaybeDateTime(value, fallback = 'Not available') {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;

    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(direct);
    }

    const dateOnly = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
    const parsedDateOnly = new Date(`${dateOnly}T00:00:00`);
    if (!Number.isNaN(parsedDateOnly.getTime())) {
      return normalizeDate(dateOnly);
    }

    return raw;
  }

  function buildInternMetaLabel(student) {
    const company = String(student?.company || student?.company_name || '').trim();
    const school = String(student?.school || student?.school_name || student?.university || '').trim();
    const program = String(student?.program || student?.course || student?.degree_program || '').trim();
    const department = normalizeDepartment(student?.department || '');

    const pieces = [company, school, program, department]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);

    if (pieces.length === 0) return 'Not available';

    const unique = [];
    for (const item of pieces) {
      if (!unique.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
        unique.push(item);
      }
    }

    return unique.slice(0, 2).join(' • ');
  }

  function calculateDaysRemaining(requiredHours, completedHours) {
    const remainingHours = Math.max(0, toNumber(requiredHours) - toNumber(completedHours));
    return Math.ceil(remainingHours / HOURS_PER_WORKING_DAY);
  }

  function toDateOnly(value) {
    const candidate = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(candidate.getTime())) return null;
    return new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
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

  function addWorkingDaysFrom(baseDateInput, workingDaysToAdd, daysOff = [0, 6]) {
    const baseDate = toDateOnly(baseDateInput);
    if (!baseDate) return null;

    let cursor = new Date(baseDate);
    const total = Math.max(0, Math.floor(Number(workingDaysToAdd) || 0));
    const daysOffSet = new Set(normalizeDaysOff(daysOff));

    while (daysOffSet.has(cursor.getDay())) {
      cursor.setDate(cursor.getDate() + 1);
    }

    let remaining = total;
    while (remaining > 0) {
      cursor.setDate(cursor.getDate() + 1);
      const day = cursor.getDay();
      if (!daysOffSet.has(day)) {
        remaining -= 1;
      }
    }

    return cursor;
  }

  function getProjectedEndDateFromProgress(requiredHours, completedHours, daysOff) {
    const daysLeft = calculateDaysRemaining(requiredHours, completedHours);
    const projected = addWorkingDaysFrom(new Date(), Math.max(0, daysLeft), daysOff);
    return projected;
  }

  function getStudentDaysOff(student) {
    return normalizeDaysOff(student?.days_off);
  }

  function formatDateObject(dateValue) {
    const dateObj = toDateOnly(dateValue);
    if (!dateObj) return 'Not available';

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(dateObj);
  }

  function formatDaysRemaining(days) {
    if (days <= 0) return '0 days left';
    if (days === 1) return '1 day left';
    return `${days} days left`;
  }

  function getDaysStatus(days) {
    if (days <= 0) return 'success';
    if (days <= 7) return 'warning';
    return 'info';
  }

  function syncSelectedFromFetched(students, assigned) {
    // No longer needed - removed
  }

  async function loadData() {
    const supervisorId = String(currentUser?.user_id || '').trim();
    const roleNow = String(currentUser?.role || '').trim().toLowerCase();

    if (!supervisorId || roleNow !== 'supervisor') {
      availableStudents = [];
      assignedStudents = [];
      loading = false;
      return;
    }

    loading = true;
    errorMessage = '';

    try {
      const [students, assigned] = await Promise.all([
        listStudentsForAssignment(supervisorId),
        listSupervisorAssignedStudents(supervisorId),
      ]);

      availableStudents = students;
      assignedStudents = assigned;
    } catch (err) {
      errorMessage = err?.message || 'Unable to load interns.';
    } finally {
      loading = false;
    }
  }

  async function handleAddIntern(studentId) {
    if (!studentId) return;
    const supervisorId = String(currentUser?.user_id || '').trim();
    const roleNow = String(currentUser?.role || '').trim().toLowerCase();

    if (!supervisorId || roleNow !== 'supervisor') {
      errorMessage = 'Only supervisor accounts can add interns.';
      return;
    }

    // Open setup modal for this intern
    selectedInternForSetup = studentId;
    internDaysOff = [...DEFAULT_DAYS_OFF];
    internShiftStart = '09:00';
    internShiftEnd = '17:00';
  }

  function toggleDayOff(dayIndex) {
    if (internDaysOff.includes(dayIndex)) {
      internDaysOff = internDaysOff.filter((d) => d !== dayIndex);
    } else {
      internDaysOff = [...internDaysOff, dayIndex];
    }
  }

  async function confirmAddIntern() {
    if (!selectedInternForSetup) return;

    const supervisorId = String(currentUser?.user_id || '').trim();
    const currentAssignedIds = assignedStudents.map((s) => String(s.user_id || '').trim());
    const newIds = Array.from(new Set([...currentAssignedIds, String(selectedInternForSetup || '').trim()]));

    saving = true;
    errorMessage = '';
    successMessage = '';

    try {
      await assignStudentsToSupervisor(supervisorId, newIds);
      
      // Save the schedule (days off and shift times)
      await saveInternSchedule(
        supervisorId,
        selectedInternForSetup,
        internDaysOff,
        internShiftStart,
        internShiftEnd
      );

      successMessage = 'Intern added successfully with schedule configured.';
      showAddModal = false;
      selectedInternForSetup = null;
      addModalSearch = '';
      await loadData();
    } catch (err) {
      errorMessage = err?.message || 'Unable to add intern.';
    } finally {
      saving = false;
    }
  }

  function cancelSetup() {
    selectedInternForSetup = null;
    internDaysOff = [...DEFAULT_DAYS_OFF];
    internShiftStart = '09:00';
    internShiftEnd = '17:00';
  }

  function openEditEndDateModal(student) {
    editingInternId = student.user_id;
    editingInternName = student.full_name;
    editingEndDate = student.estimated_end_date || '';
    showEditEndDateModal = true;
  }

  function closeEditEndDateModal() {
    showEditEndDateModal = false;
    editingInternId = null;
    editingInternName = '';
    editingEndDate = '';
  }

  async function saveEstimatedEndDate() {
    if (!editingInternId || !editingEndDate) {
      errorMessage = 'Please select a valid date.';
      return;
    }

    savingEndDate = true;
    errorMessage = '';
    successMessage = '';

    try {
      const result = await callApiAction('update_student_ojt_profile', {
        user_id: editingInternId,
        estimated_end_date: editingEndDate,
      });

      if (result && result.ok) {
        successMessage = `Updated OJT end date for ${editingInternName}`;
        await loadData();
        closeEditEndDateModal();
      } else {
        errorMessage = result?.error || 'Failed to update end date.';
      }
    } catch (err) {
      errorMessage = err?.message || 'Unable to save end date.';
      console.error('Save end date error:', err);
    } finally {
      savingEndDate = false;
    }
  }

  function toggleBulkInternSelection(studentId) {
    if (bulkSelectedInterns.has(studentId)) {
      bulkSelectedInterns.delete(studentId);
    } else {
      bulkSelectedInterns.add(studentId);
    }
    bulkSelectedInterns = bulkSelectedInterns;
  }

  function toggleBulkDayOff(dayIndex) {
    if (bulkDaysOff.includes(dayIndex)) {
      bulkDaysOff = bulkDaysOff.filter((d) => d !== dayIndex);
    } else {
      bulkDaysOff = [...bulkDaysOff, dayIndex];
    }
  }

  async function confirmBulkAssign() {
    if (bulkSelectedInterns.size === 0) {
      errorMessage = 'Please select at least one intern.';
      return;
    }

    const supervisorId = String(currentUser?.user_id || '').trim();
    const currentAssignedIds = assignedStudents.map((s) => String(s.user_id || '').trim());
    const newInternIds = Array.from(bulkSelectedInterns).map((id) => String(id || '').trim());
    const newIds = Array.from(new Set([...currentAssignedIds, ...newInternIds]));

    saving = true;
    errorMessage = '';
    successMessage = '';

    try {
      // Assign all students first
      await assignStudentsToSupervisor(supervisorId, newIds);

      // Save schedules for each selected intern
      for (const internId of newInternIds) {
        await saveInternSchedule(
          supervisorId,
          internId,
          bulkDaysOff,
          bulkShiftStart,
          bulkShiftEnd
        );
      }

      successMessage = `${bulkSelectedInterns.size} interns added successfully with schedule configured.`;
      bulkAssignMode = false;
      bulkSelectedInterns = new Set();
      bulkDaysOff = [...DEFAULT_DAYS_OFF];
      bulkShiftStart = '09:00';
      bulkShiftEnd = '17:00';
      addModalSearch = '';
      showAddModal = false;
      await loadData();
    } catch (err) {
      errorMessage = err?.message || 'Unable to add interns.';
    } finally {
      saving = false;
    }
  }

  function cancelBulkAssign() {
    bulkAssignMode = false;
    bulkSelectedInterns = new Set();
    bulkDaysOff = [...DEFAULT_DAYS_OFF];
    bulkShiftStart = '09:00';
    bulkShiftEnd = '17:00';
  }

  async function handleRemoveIntern(internId) {
    const supervisorId = String(currentUser?.user_id || '').trim();
    const roleNow = String(currentUser?.role || '').trim().toLowerCase();

    if (!supervisorId || roleNow !== 'supervisor') {
      errorMessage = 'Only supervisor accounts can remove interns.';
      return;
    }

    removingInternId = internId;
    errorMessage = '';
    successMessage = '';

    try {
      // Remove from the list and save
      const newIds = assignedStudents
        .filter((s) => String(s.user_id || '') !== String(internId || ''))
        .map((s) => String(s.user_id || '').trim());

      await assignStudentsToSupervisor(supervisorId, newIds);
      successMessage = 'Intern removed successfully.';
      await loadData();
    } catch (err) {
      errorMessage = err?.message || 'Unable to remove intern.';
    } finally {
      removingInternId = null;
    }
  }

  function toggleStudentSelection(studentId) {
    // No longer needed - removed
  }

  function selectAllShown() {
    // No longer needed - removed
  }

  function clearSelection() {
    // No longer needed - removed
  }

  function removeSelectedStudent(studentId) {
    // No longer needed - removed
  }

  async function handleSaveAssignments() {
    // No longer needed - removed
  }

  let refreshTimer = null;

  onMount(() => {
    currentUser = currentUser || getCurrentUser();

    unsubscribe = subscribeToCurrentUser((user) => {
      currentUser = user;
      loadData();
    });

    loadData();

    // Refresh days remaining every minute so it's always up-to-date
    refreshTimer = setInterval(() => {
      assignedStudents = assignedStudents; // Trigger reactivity
    }, 60000); // Update every 60 seconds
  });

  onDestroy(() => {
    if (typeof unsubscribe === 'function') unsubscribe();
    if (refreshTimer) clearInterval(refreshTimer);
  });

  $: currentRole = String(currentUser?.role || '').trim().toLowerCase();
  $: isSupervisorUser = currentRole === 'supervisor';
  $: normalizedAddSearch = String(addModalSearch || '').trim().toLowerCase();
  $: assignedIds = new Set(assignedStudents.map((s) => String(s.user_id || '').trim()));
  $: availableToAdd = availableStudents.filter((student) => !assignedIds.has(String(student.user_id || '').trim()));
  $: filteredAvailable = availableToAdd.filter((student) => {
    if (!normalizedAddSearch) return true;
    const haystack = [
      String(student?.full_name || ''),
      String(student?.email || ''),
      String(student?.department || ''),
      String(student?.company || ''),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedAddSearch);
  });
  $: totalAssigned = assignedStudents.length;
  $: totalRequiredHours = assignedStudents.reduce((sum, student) => sum + toNumber(student.required_hours), 0);
  $: totalCompletedHours = assignedStudents.reduce((sum, student) => sum + toNumber(student.completed_hours), 0);
  $: averageProgress = totalRequiredHours > 0 ? Math.round((totalCompletedHours / totalRequiredHours) * 100) : 0;
</script>

{#if currentUser && !isSupervisorUser}
  <section class="warning-alert">
    This page is available for supervisor accounts only.
  </section>
{:else}
  <div class="content">
    <div class="stats-grid">
      {#if loading}
        {#each [1, 2, 3, 4] as _}
          <div class="stat-card stat-card-skeleton" aria-hidden="true">
            <div class="stat-icon stat-icon-skeleton sk-line shimmer"></div>
            <div class="stat-copy stat-copy-skeleton">
              <div class="sk-line shimmer" style="height: 11px; width: 118px; border-radius: 7px;"></div>
              <div class="sk-line shimmer" style="height: 24px; width: 34px; border-radius: 8px;"></div>
              <div class="sk-line shimmer" style="height: 11px; width: 126px; border-radius: 7px;"></div>
            </div>
          </div>
        {/each}
      {:else}
        <div class="stat-card stat-blue">
          <div class="stat-icon"><UserRoundCheck size={18} /></div>
          <div class="stat-copy">
            <p class="stat-label">Assigned Interns</p>
            <p class="stat-value">{totalAssigned}</p>
            <p class="stat-sub">Total active interns</p>
          </div>
        </div>

        <div class="stat-card stat-success">
          <div class="stat-icon"><Check size={18} /></div>
          <div class="stat-copy">
            <p class="stat-label">Completed Hours</p>
            <p class="stat-value" title={String(totalCompletedHours)}>{formatHours(totalCompletedHours)}</p>
            <p class="stat-sub">Logged by assigned interns</p>
          </div>
        </div>

        <div class="stat-card stat-violet">
          <div class="stat-icon"><TrendingUp size={18} /></div>
          <div class="stat-copy">
            <p class="stat-label">Average Progress</p>
            <p class="stat-value">{averageProgress}%</p>
            <p class="stat-sub">Across assigned interns</p>
          </div>
        </div>

        <div class="stat-card stat-cyan">
          <div class="stat-icon"><Clock3 size={18} /></div>
          <div class="stat-copy">
            <p class="stat-label">Required Hours</p>
            <p class="stat-value" title={String(totalRequiredHours)}>{formatHours(totalRequiredHours)}</p>
            <p class="stat-sub">Total OJT target hours</p>
          </div>
        </div>
      {/if}
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Assigned Interns</h3>
          <p class="text-muted text-sm">Add or remove interns from your assigned list.</p>
        </div>

        <div class="btn-group">
          <button class="btn btn-secondary" type="button" on:click={loadData} disabled={loading || saving}>
            <RefreshCw size={15} />Refresh
          </button>
          <button class="btn btn-primary btn-with-icon" type="button" on:click={() => { bulkSelectedInterns = new Set(); bulkDaysOff = [...DEFAULT_DAYS_OFF]; bulkShiftStart = '09:00'; bulkShiftEnd = '17:00'; showAddModal = true; bulkAssignMode = true; }} disabled={loading || saving}>
            <Plus size={15} />
            <span>Add Interns</span>
          </button>
        </div>
      </div>

      <div class="card-body-shell">
      {#if errorMessage}
        <p class="alert alert-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="alert alert-success">{successMessage}</p>
      {/if}

      {#if loading}
        <div class="assigned-grid" role="status" aria-label="Loading assigned interns">
          {#each [1, 2, 3] as _}
            <article class="assigned-card assigned-card-skeleton">
              <div class="card-header-row">
                <div class="assigned-info">
                  <div class="assigned-avatar skeleton-circle shimmer"></div>
                  <div class="info-text">
                    <div class="sk-line shimmer" style="height: 14px; width: 140px; border-radius: 8px;"></div>
                    <div class="sk-line shimmer" style="height: 11px; width: 95px; border-radius: 7px; margin-top: 7px;"></div>
                  </div>
                </div>
                <div class="sk-pill shimmer"></div>
              </div>
              <div class="card-body">
                <div class="hours-row">
                  {#each [1, 2, 3] as __}
                    <div class="hours-stat skeleton-hours-stat">
                      <div class="sk-line shimmer" style="height: 10px; width: 68%; border-radius: 7px; margin: 0 auto;"></div>
                      <div class="sk-line shimmer" style="height: 14px; width: 62%; border-radius: 7px; margin: 8px auto 0;"></div>
                    </div>
                  {/each}
                </div>
                <div class="progress-bar skeleton-progress">
                  <div class="progress-fill progress-tone-mid" style="width: 45%;"></div>
                </div>
                <div class="days-remaining-display skeleton-days-row">
                  <div class="sk-line shimmer" style="height: 10px; width: 46%; border-radius: 7px;"></div>
                  <div class="sk-line shimmer" style="height: 10px; width: 32%; border-radius: 7px;"></div>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {:else if assignedStudents.length === 0}
        <div class="empty-state">
          <div class="empty-icon"><UserRoundCheck size={18} /></div>
          <p class="empty-title">No assigned interns yet.</p>
          <p class="empty-sub">Add interns to start monitoring their OJT progress.</p>
          <button class="btn btn-primary btn-with-icon empty-action" type="button" on:click={() => { bulkSelectedInterns = new Set(); bulkDaysOff = [...DEFAULT_DAYS_OFF]; bulkShiftStart = '09:00'; bulkShiftEnd = '17:00'; showAddModal = true; bulkAssignMode = true; }} disabled={loading || saving}>
            <Plus size={15} />
            <span>Add Interns</span>
          </button>
        </div>
      {:else}
        <div class="assigned-grid">
          {#each assignedStudents as student (student.user_id)}
            {@const required = toNumber(student.required_hours)}
            {@const completed = toNumber(student.completed_hours)}
            {@const remaining = Math.max(0, required - completed)}
            {@const progress = toPercent(completed, required)}
            {@const progressTone = progress >= 100 ? 'complete' : progress >= 80 ? 'near' : progress <= 30 ? 'low' : 'mid'}
            {@const daysLeft = calculateDaysRemaining(required, completed)}
            {@const daysStatus = getDaysStatus(daysLeft)}
            {@const internMetaLabel = buildInternMetaLabel(student)}
            {@const projectedEndDate = getProjectedEndDateFromProgress(required, completed, getStudentDaysOff(student))}
            {@const ojtEndDateDisplay = formatDateObject(projectedEndDate)}
            {@const estimatedCompletionRaw = firstNonEmptyText(student?.estimated_end_date, student?.estimated_completion_date, student?.estimated_completion, student?.projected_completion_date, student?.expected_completion_date)}
            {@const estimatedCompletionDisplay = estimatedCompletionRaw ? normalizeDate(estimatedCompletionRaw) : 'Not available'}
            {@const statusText = firstNonEmptyText(student?.status, student?.intern_status, student?.ojt_status, student?.attendance_status, student?.current_status) || 'Not available'}
            {@const lastActivityRaw = firstNonEmptyText(student?.last_activity, student?.last_time_log, student?.last_timelog, student?.latest_timelog, student?.last_log_date, student?.last_log_at, student?.updated_at)}
            {@const lastActivityDisplay = lastActivityRaw ? formatMaybeDateTime(lastActivityRaw, 'No recent activity') : 'No recent activity'}
            <article class="assigned-card">
              <div class="card-header-row">
                <div class="assigned-info">
                  <div class="assigned-avatar">
                    {#if student.profile_photo_url}
                      <img src={student.profile_photo_url} alt={`${student.full_name} avatar`} />
                    {:else}
                      {getInitials(student.full_name)}
                    {/if}
                  </div>
                  <div class="info-text">
                    <p class="font-semibold">{student.full_name}</p>
                    <p class="text-xs text-muted">{internMetaLabel}</p>
                  </div>
                </div>
                <button 
                  class="btn-remove" 
                  type="button" 
                  on:click={() => handleRemoveIntern(student.user_id)}
                  disabled={removingInternId === student.user_id}
                  title="Remove this intern"
                  aria-label="Remove this intern"
                >
                  {#if removingInternId === student.user_id}
                    <span class="spinning-icon"><Loader2 size={16} /></span>
                  {:else}
                    <Trash2 size={16} />
                  {/if}
                </button>
              </div>

              <div class="card-body">
                <div class="hours-row">
                  <div class="hours-stat">
                    <p class="label">Completed</p>
                    <p class="value" title={String(completed)}>{formatHours(completed)}</p>
                  </div>
                  <div class="hours-stat">
                    <p class="label">Required</p>
                    <p class="value" title={String(required)}>{formatHours(required)}</p>
                  </div>
                  <div class="hours-stat">
                    <p class="label">Remaining</p>
                    <p class="value" title={String(remaining)}>{formatHours(remaining)}</p>
                  </div>
                </div>
                <div class="progress-wrap">
                  <div class="progress-head">
                    <span class="progress-label">Progress</span>
                    <span class="progress-percent">{progress}%</span>
                  </div>
                  <div class="progress-bar"><div class={`progress-fill progress-tone-${progressTone}`} style={`width:${progress}%`}></div></div>
                </div>
                
                <div class="card-footer">
                  <div
                    class="days-remaining-display"
                    class:status-warning={daysStatus === 'warning'}
                    class:status-success={daysStatus === 'success'}
                    class:status-info={daysStatus === 'info'}
                  >
                    <span class="days-label">OJT Ends In:</span>
                    <span class="days-value">{formatDaysRemaining(daysLeft)}</span>
                  </div>
                  <div class="detail-grid">
                    <div class="detail-row">
                      <span class="detail-key">OJT End Date</span>
                      <span class="detail-value">{ojtEndDateDisplay || '—'}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-key">Estimated Completion</span>
                      <span class="detail-value">{estimatedCompletionDisplay || '—'}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-key">Current Status</span>
                      <span class="detail-value detail-status">{statusText || 'Not available'}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-key">Last Activity</span>
                      <span class="detail-value">{lastActivityDisplay || 'No recent activity'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
      </div>
    </div>

    <!-- Add Intern Modal -->
    {#if showAddModal}
      <div class="modal-overlay" role="presentation" on:click={() => (showAddModal = false)}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="modal-content" role="dialog" aria-modal="true" aria-label="Assign Interns" tabindex="-1" on:click|stopPropagation>
          <div class="modal-header">
            <h2>Assign Interns</h2>
            <button class="modal-close" type="button" on:click={() => (showAddModal = false)} aria-label="Close dialog">
              <X size={20} />
            </button>
          </div>

          <div class="modal-body">
            {#if bulkAssignMode}
              <!-- Bulk assign mode -->
              <div class="bulk-header">
                <span class="bulk-count">{bulkSelectedInterns.size} selected</span>
              </div>

              <label class="search-wrap">
                <span class="search-icon"><Search size={14} /></span>
                <input
                  bind:value={addModalSearch}
                  type="text"
                  class="search-input"
                  placeholder="Search interns by name, email, department, or company"
                />
              </label>

              {#if loading}
                <p class="text-muted">Loading...</p>
              {:else if filteredAvailable.length === 0}
                <p class="text-muted">
                  {availableToAdd.length === 0 ? 'All interns are already assigned.' : 'No interns match your search.'}
                </p>
              {:else}
                <div class="intern-list-modal">
                  {#each filteredAvailable as student (student.user_id)}
                    {@const isSelected = bulkSelectedInterns.has(student.user_id)}
                    <button
                      type="button"
                      class="intern-option bulk-option"
                      class:bulk-selected={isSelected}
                      on:click={() => toggleBulkInternSelection(student.user_id)}
                      disabled={saving}
                    >
                      <div class="bulk-checkbox">
                        {#if isSelected}
                          <Check size={16} />
                        {/if}
                      </div>
                      <div class="avatar">
                        {#if student.profile_photo_url}
                          <img src={student.profile_photo_url} alt={`${student.full_name} avatar`} />
                        {:else}
                          {getInitials(student.full_name)}
                        {/if}
                      </div>
                      <div class="intern-option-info">
                        <p class="font-semibold text-sm">{student.full_name}</p>
                        <p class="text-xs text-muted">{student.email}</p>
                        <p class="text-xs text-muted">{student.company || '-'} • {normalizeDepartment(student.department) || '-'}</p>
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="setup-section setup-section-offset">
                <div class="setup-label">Days Off</div>
                <p class="setup-sublabel">Select which days these interns typically have off</p>
                <div class="days-checkbox-list">
                  {#each DAY_OPTIONS as day}
                    <label class="day-checkbox">
                      <input
                        type="checkbox"
                        checked={bulkDaysOff.includes(day.value)}
                        on:change={() => toggleBulkDayOff(day.value)}
                      />
                      <span>{day.label}</span>
                    </label>
                  {/each}
                </div>
              </div>

              <div class="setup-section">
                <div class="setup-label">Shift Time</div>
                <p class="setup-sublabel">Set the regular work hours for these interns</p>
                <div class="shift-grid">
                  <div class="time-input-group">
                    <label for="bulk-shift-start">Start Time</label>
                    <input 
                      id="bulk-shift-start"
                      type="time" 
                      bind:value={bulkShiftStart}
                      class="time-input"
                    />
                  </div>
                  <div class="time-input-group">
                    <label for="bulk-shift-end">End Time</label>
                    <input 
                      id="bulk-shift-end"
                      type="time" 
                      bind:value={bulkShiftEnd}
                      class="time-input"
                    />
                  </div>
                </div>
              </div>

              <div class="setup-actions">
                <button 
                  class="btn btn-secondary" 
                  type="button" 
                  on:click={cancelBulkAssign}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button 
                  class="btn btn-primary btn-with-icon" 
                  type="button" 
                  on:click={confirmBulkAssign}
                  disabled={saving || bulkSelectedInterns.size === 0}
                >
                  {#if saving}
                    <span class="spinning-icon"><Loader2 size={15} /></span>
                  {/if}
                  <span>{saving ? 'Assigning...' : `Assign ${bulkSelectedInterns.size} Interns`}</span>
                </button>
              </div>
            {:else if selectedInternForSetup}
              <!-- Setup form for selected intern -->
              {@const selectedStudent = availableToAdd.find((s) => String(s.user_id) === String(selectedInternForSetup))}
              <div class="setup-header">
                <button 
                  class="setup-back-btn" 
                  type="button" 
                  on:click={cancelSetup}
                  aria-label="Back to intern list"
                >
                  ← Back
                </button>
                <h3>{selectedStudent?.full_name}</h3>
              </div>

              <div class="setup-section">
                <div class="setup-label">Days Off</div>
                <p class="setup-sublabel">Select which days this intern typically has off</p>
                <div class="days-checkbox-list">
                  {#each DAY_OPTIONS as day}
                    <label class="day-checkbox">
                      <input
                        type="checkbox"
                        checked={internDaysOff.includes(day.value)}
                        on:change={() => toggleDayOff(day.value)}
                      />
                      <span>{day.label}</span>
                    </label>
                  {/each}
                </div>
              </div>

              <div class="setup-section">
                <div class="setup-label">Shift Time</div>
                <p class="setup-sublabel">Set the regular work hours for this intern</p>
                <div class="shift-grid">
                  <div class="time-input-group">
                    <label for="shift-start">Start Time</label>
                    <input 
                      id="shift-start"
                      type="time" 
                      bind:value={internShiftStart}
                      class="time-input"
                    />
                  </div>
                  <div class="time-input-group">
                    <label for="shift-end">End Time</label>
                    <input 
                      id="shift-end"
                      type="time" 
                      bind:value={internShiftEnd}
                      class="time-input"
                    />
                  </div>
                </div>
              </div>

              <div class="setup-actions">
                <button 
                  class="btn btn-secondary" 
                  type="button" 
                  on:click={cancelSetup}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button 
                  class="btn btn-primary btn-with-icon" 
                  type="button" 
                  on:click={confirmAddIntern}
                  disabled={saving}
                >
                  {#if saving}
                    <span class="spinning-icon"><Loader2 size={15} /></span>
                  {/if}
                  <span>{saving ? 'Adding...' : 'Add Intern'}</span>
                </button>
              </div>
            {:else}
              <!-- List of available interns -->
              <label class="search-wrap">
                <span class="search-icon"><Search size={14} /></span>
                <input
                  bind:value={addModalSearch}
                  type="text"
                  class="search-input"
                  placeholder="Search interns by name, email, department, or company"
                />
              </label>

              {#if loading}
                <p class="text-muted">Loading...</p>
              {:else if filteredAvailable.length === 0}
                <p class="text-muted">
                  {availableToAdd.length === 0 ? 'All interns are already assigned.' : 'No interns match your search.'}
                </p>
              {:else}
                <div class="intern-list-modal">
                  {#each filteredAvailable as student (student.user_id)}
                    <button
                      type="button"
                      class="intern-option"
                      on:click={() => handleAddIntern(student.user_id)}
                      disabled={saving || selectedInternForSetup}
                    >
                      <div class="avatar">
                        {#if student.profile_photo_url}
                          <img src={student.profile_photo_url} alt={`${student.full_name} avatar`} />
                        {:else}
                          {getInitials(student.full_name)}
                        {/if}
                      </div>
                      <div class="intern-option-info">
                        <p class="font-semibold text-sm">{student.full_name}</p>
                        <p class="text-xs text-muted">{student.email}</p>
                        <p class="text-xs text-muted">{student.company || '-'} • {normalizeDepartment(student.department) || '-'}</p>
                      </div>
                      <span class="add-indicator">Select</span>
                    </button>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Edit OJT End Date Modal -->
    {#if showEditEndDateModal}
      <div class="modal-overlay" role="presentation" on:click={closeEditEndDateModal}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="modal-content" role="dialog" aria-modal="true" tabindex="-1" on:click|stopPropagation>
          <div class="modal-header">
            <h2>Edit OJT End Date</h2>
            <button
              class="modal-close"
              type="button"
              on:click={closeEditEndDateModal}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
          </div>

          <div class="modal-body">
            <p class="text-muted" style="margin-bottom: 1rem;">
              Update the OJT end date for <strong>{editingInternName}</strong>
            </p>
            <div class="form-group">
              <label for="end-date-input" class="form-label">OJT End Date</label>
              <input
                id="end-date-input"
                type="date"
                bind:value={editingEndDate}
                class="form-input"
              />
            </div>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn-cancel"
              on:click={closeEditEndDateModal}
              disabled={savingEndDate}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn-save"
              on:click={saveEstimatedEndDate}
              disabled={savingEndDate || !editingEndDate}
            >
              {#if savingEndDate}
                <Loader2 size={16} style="animation: spin 1s linear infinite;" />
                Saving...
              {:else}
                Save End Date
              {/if}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  :root {
    --text-primary: #0f172a;
    --text-secondary: #1f2937;
    --text-muted: #64748b;
    --border: #e2e8f0;
    --surface: #ffffff;
    --surface-soft: #f8fafc;
    --surface-tint: rgba(148, 163, 184, 0.06);
    --surface-tint-strong: rgba(148, 163, 184, 0.1);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

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

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 20px;
    min-height: 104px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
  }

  .stat-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .stat-icon :global(svg) {
    color: currentColor;
    stroke: currentColor;
  }

  .stat-blue .stat-icon {
    background: rgba(59, 130, 246, 0.14);
    color: #3b82f6;
    border: 1px solid rgba(59, 130, 246, 0.22);
  }

  .stat-success .stat-icon {
    background: rgba(34, 197, 94, 0.14);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.22);
  }

  .stat-violet .stat-icon {
    background: rgba(139, 92, 246, 0.14);
    color: #8b5cf6;
    border: 1px solid rgba(139, 92, 246, 0.22);
  }

  .stat-cyan .stat-icon {
    background: rgba(245, 158, 11, 0.14);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.22);
  }

  .stat-value {
    margin: 0;
    color: var(--text-primary);
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.8px;
  }

  .stat-label {
    margin: 0;
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .stat-copy {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 4px;
  }

  .stat-card-skeleton {
    pointer-events: none;
  }

  .stat-icon-skeleton {
    background: rgba(148, 163, 184, 0.12);
    border: 1px solid rgba(148, 163, 184, 0.18);
  }

  .stat-copy-skeleton {
    width: 100%;
    gap: 7px;
  }

  .stat-sub {
    margin: 0;
    font-size: 11.5px;
    color: #64748b;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
    overflow: hidden;
  }

  .card-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 20px 12px;
  }

  .card-header .text-sm {
    margin: 4px 0 0;
    font-size: 12.5px;
  }

  .alert {
    padding: 0.75rem 1rem;
    border-radius: 10px;
    border: 1px solid;
    font-size: 0.875rem;
    font-weight: 500;
    margin: 0;
  }

  .alert-error {
    background: #fef2f2;
    border-color: #fed7d7;
    color: #991b1b;
  }

  .alert-success {
    background: #ecfdf5;
    border-color: #a7f3d0;
    color: #065f46;
  }

  .card-body-shell {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 20px 18px;
  }

  .search-wrap {
    position: relative;
    flex: 1;
    min-width: 280px;
  }

  .search-icon {
    position: absolute;
    top: 50%;
    left: 0.75rem;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    border: 1px solid var(--border);
    background: #f9fbff;
    color: var(--text-primary);
    border-radius: 0.65rem;
    padding: 0.625rem 0.75rem 0.625rem 2.15rem;
    font-size: 0.875rem;
    outline: none;
  }

  .search-input:focus {
    border-color: #0f6cbd;
    box-shadow: 0 0 0 2px rgba(15, 108, 189, 0.16);
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    color: white;
    font-size: 0.7rem;
    font-weight: 700;
    flex-shrink: 0;
    overflow: hidden;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .assigned-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    align-items: stretch;
    grid-auto-rows: 1fr;
  }

  .assigned-card {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 16px;
    background: var(--surface-tint);
    box-shadow: none;
    transition: border-color 0.2s ease, background-color 0.2s ease;
    display: flex;
    flex-direction: column;
    min-height: 360px;
    height: 100%;
  }

  .assigned-card:hover {
    border-color: rgba(96, 165, 250, 0.28);
    background: rgba(37, 99, 235, 0.04);
  }

  .card-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .assigned-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }

  .info-text {
    min-width: 0;
  }

  .info-text p {
    margin: 0;
  }

  .info-text .font-semibold {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .assigned-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    color: white;
    font-size: 0.8rem;
    font-weight: 700;
    flex-shrink: 0;
    overflow: hidden;
  }

  .assigned-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }

  .hours-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .hours-stat {
    text-align: center;
    padding: 8px 6px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.15);
    background: var(--surface-tint-strong);
  }

  .hours-stat .label {
    margin: 0;
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .hours-stat .value {
    margin: 6px 0 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .progress-wrap {
    display: grid;
    gap: 6px;
  }

  .progress-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .progress-label {
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--text-muted);
  }

  .progress-percent {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .btn-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid rgba(239, 68, 68, 0.16);
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
  }

  .btn-remove:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.16);
    border-color: rgba(239, 68, 68, 0.35);
    color: #dc2626;
  }

  .btn-remove:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(2, 6, 23, 0.62);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--surface);
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    box-shadow: 0 16px 34px rgba(2, 6, 23, 0.2);
    width: 90%;
    max-width: 520px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 20px 22px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.55rem;
    font-weight: 700;
    letter-spacing: -0.2px;
    color: var(--text-primary);
  }

  .modal-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }

  .modal-close:hover {
    background: rgba(148, 163, 184, 0.14);
    border-color: rgba(148, 163, 184, 0.2);
    color: var(--text-primary);
  }

  .modal-body {
    padding: 20px 22px 22px;
    overflow-y: auto;
    flex: 1;
  }

  .modal-body .search-input {
    border-color: #d8e0ec;
    background: var(--surface-soft);
    border-radius: 10px;
    min-height: 42px;
  }

  .modal-body .search-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    background: var(--surface);
  }

  .intern-list-modal {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .intern-option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 12px;
    background: var(--surface-soft);
    border: 1px solid #d9e2ef;
    border-radius: 10px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
  }

  .intern-option:hover:not(:disabled) {
    background: #eef4ff;
    border-color: rgba(37, 99, 235, 0.42);
    transform: none;
  }

  .intern-option:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .intern-option-info {
    flex: 1;
    min-width: 0;
  }

  .intern-option-info p {
    margin: 0;
  }

  .add-indicator {
    border-radius: 9999px;
    background: rgba(37, 99, 235, 0.12);
    color: #1d4ed8;
    border: 1px solid rgba(37, 99, 235, 0.24);
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.2rem 0.5rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Setup form styles */
  .setup-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.24);
  }

  .setup-back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    padding: 0.4rem 0.6rem;
    border: none;
    background: transparent;
    color: #2563eb;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .setup-back-btn:hover {
    background: rgba(37, 99, 235, 0.1);
    border-radius: 0.4rem;
  }

  .setup-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .setup-section {
    margin-bottom: 1.5rem;
  }

  .setup-section-offset {
    margin-top: 1.5rem;
  }

  .setup-label {
    display: block;
    font-weight: 600;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }

  .setup-sublabel {
    display: block;
    font-size: 0.77rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
    margin-top: 0;
  }

  .days-checkbox-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .day-checkbox {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    padding: 0.56rem 0.7rem;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    transition: all 0.2s;
    user-select: none;
  }

  .day-checkbox:hover {
    background: rgba(37, 99, 235, 0.08);
    border-color: rgba(37, 99, 235, 0.2);
  }

  .day-checkbox input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: #0f6cbd;
  }

  .day-checkbox span {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .shift-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .time-input-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .time-input-group label {
    font-weight: 600;
    font-size: 0.74rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .time-input {
    min-height: 40px;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d8e0ec;
    background: var(--surface-soft);
    color: var(--text-primary);
    border-radius: 10px;
    font-size: 0.875rem;
    outline: none;
  }

  .time-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16);
    background: var(--surface);
  }

  .setup-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(148, 163, 184, 0.24);
  }

  .setup-actions .btn {
    flex: 1;
    justify-content: center;
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

  @keyframes card-shimmer {
    100% {
      transform: translateX(100%);
    }
  }

  :global(.dark) .setup-section {
    border-color: #2b3c57;
  }

  :global(.dark) .setup-header {
    border-color: rgba(148, 163, 184, 0.22);
  }

  :global(.dark) .day-checkbox:hover {
    background: rgba(59, 130, 246, 0.16);
    border-color: rgba(96, 165, 250, 0.34);
  }

  :global(.dark) .day-checkbox span {
    color: #e5edf8;
  }

  :global(.dark) .time-input {
    background: #1a2332;
    border-color: rgba(148, 163, 184, 0.24);
    color: #e5edf8;
  }

  :global(.dark) .time-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    background: #161c27;
  }

  :global(.dark) .setup-actions {
    border-color: rgba(148, 163, 184, 0.22);
  }

  :global(.dark) .modal-content {
    background: #161c27;
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow: 0 20px 44px rgba(0, 0, 0, 0.5);
  }

  :global(.dark) .modal-header {
    border-color: rgba(148, 163, 184, 0.2);
  }

  :global(.dark) .modal-close:hover {
    background: rgba(148, 163, 184, 0.18);
    border-color: rgba(148, 163, 184, 0.3);
  }

  :global(.dark) .intern-option {
    background: #1a2332;
    border-color: rgba(148, 163, 184, 0.22);
  }

  :global(.dark) .intern-option:hover:not(:disabled) {
    background: #202b3d;
    border-color: #3b82f6;
  }

  :global(.dark) .days-remaining-display {
    background: #223653;
    border-color: #334b6b;
  }

  :global(.dark) .days-remaining-display.status-warning {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.3);
  }

  :global(.dark) .days-remaining-display.status-success {
    background: rgba(16, 185, 129, 0.15);
    border-color: rgba(16, 185, 129, 0.3);
  }

  :global(.dark) .days-remaining-display.status-info {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.3);
  }

  :global(.dark) .days-label {
    color: #9ba3af;
  }

  :global(.dark) .days-value {
    color: #e5edf8;
  }

  :global(.dark) .progress-label {
    color: #94a3b8;
  }

  :global(.dark) .progress-percent {
    color: #e5edf8;
  }


  .progress-bar {
    height: 8px;
    background: rgba(148, 163, 184, 0.22);
    border-radius: 9999px;
    overflow: hidden;
    margin: 2px 0;
    border: 1px solid rgba(148, 163, 184, 0.2);
  }

  .progress-fill {
    height: 100%;
    border-radius: inherit;
    transition: width 0.25s ease, background-color 0.2s ease;
  }

  .progress-tone-low {
    background: linear-gradient(90deg, #1d4ed8, #3b82f6);
  }

  .progress-tone-mid {
    background: linear-gradient(90deg, #0ea5e9, #38bdf8);
  }

  .progress-tone-near,
  .progress-tone-complete {
    background: linear-gradient(90deg, #16a34a, #22c55e);
  }

  .days-remaining-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px;
    border-radius: 10px;
    margin-top: 4px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.2);
    font-size: 0.875rem;
    font-weight: 500;
    gap: 0.5rem;
  }

  .days-remaining-display.status-warning {
    background: rgba(245, 158, 11, 0.14);
    border-color: rgba(245, 158, 11, 0.28);
  }

  .days-remaining-display.status-success {
    background: rgba(16, 185, 129, 0.14);
    border-color: rgba(16, 185, 129, 0.28);
  }

  .days-remaining-display.status-info {
    background: rgba(99, 102, 241, 0.12);
    border-color: rgba(99, 102, 241, 0.22);
  }

  .days-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .days-value {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-footer {
    margin-top: 2px;
    display: grid;
    gap: 8px;
  }

  .detail-grid {
    display: grid;
    gap: 6px;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(148, 163, 184, 0.08);
  }

  .detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
  }

  .detail-key {
    color: var(--text-muted);
    font-weight: 600;
  }

  .detail-value {
    color: var(--text-primary);
    font-weight: 600;
    text-align: right;
  }

  .detail-status {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(99, 102, 241, 0.25);
    background: rgba(99, 102, 241, 0.12);
    border-radius: 999px;
    padding: 2px 9px;
    line-height: 1.25;
  }

  .empty-state {
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    padding: 24px 16px;
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
    background: var(--surface-tint);
  }

  .empty-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    color: #64748b;
    background: var(--surface-soft);
    border: 1px solid var(--border);
  }

  .empty-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-sub {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .empty-action {
    margin-top: 4px;
  }

  .assigned-card-skeleton {
    border-color: rgba(148, 163, 184, 0.12);
    background: rgba(148, 163, 184, 0.06);
  }

  .skeleton-circle {
    background: rgba(148, 163, 184, 0.14);
    border: 1px solid rgba(148, 163, 184, 0.18);
  }

  .skeleton-hours-stat {
    background: rgba(148, 163, 184, 0.06);
    border-color: rgba(148, 163, 184, 0.16);
  }

  .skeleton-progress {
    border-color: rgba(148, 163, 184, 0.16);
  }

  .skeleton-days-row {
    background: rgba(148, 163, 184, 0.08);
    border-color: rgba(148, 163, 184, 0.14);
  }

  .sk-line,
  .sk-pill {
    display: inline-block;
    background: rgba(148, 163, 184, 0.14);
    border: 1px solid rgba(148, 163, 184, 0.16);
  }

  .sk-pill {
    width: 64px;
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
      rgba(148, 163, 184, 0.2) 50%,
      rgba(148, 163, 184, 0) 100%
    );
    animation: card-shimmer 1.55s ease-in-out infinite;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    justify-content: center;
    padding: 8px 14px;
    border: 1px solid transparent;
    border-radius: 10px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    line-height: 1.2;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-with-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
  }

  .btn-primary {
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    border-color: rgba(37, 99, 235, 0.4);
    color: #ffffff;
    box-shadow: 0 3px 10px rgba(37, 99, 235, 0.28);
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  }

  .btn-secondary {
    background: var(--surface-soft);
    border-color: var(--border);
    color: var(--text-primary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.08);
    border-color: rgba(96, 165, 250, 0.32);
  }

  .btn-cancel {
    background: var(--surface-soft);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 8px 14px;
    border-radius: 10px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
  }

  .btn-cancel:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.08);
  }

  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-save {
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    color: white;
    border: 1px solid rgba(37, 99, 235, 0.4);
    padding: 8px 14px;
    border-radius: 10px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    box-shadow: 0 3px 10px rgba(37, 99, 235, 0.28);
  }

  .btn-save:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding: 1rem;
    border-top: 1px solid rgba(148, 163, 184, 0.24);
  }

  .form-label {
    display: block;
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .form-input {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .form-input:focus {
    outline: none;
    border-color: #0f6cbd;
    box-shadow: 0 0 0 2px rgba(15, 108, 189, 0.1);
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .text-muted {
    color: var(--text-muted);
  }

  .btn-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  :global(.dark) {
    --text-primary: #e5edf8;
    --text-secondary: #cfdceb;
    --text-muted: #94a3b8;
    --border: rgba(255, 255, 255, 0.08);
    --surface: #161c27;
    --surface-soft: #1a2332;
    --surface-tint: rgba(51, 65, 85, 0.12);
    --surface-tint-strong: rgba(71, 85, 105, 0.16);
  }

  :global(.dark) .warning-alert {
    background: #fef3c7;
    border-color: #fcd34d;
    color: #92400e;
  }

  :global(.dark) .stat-label {
    color: #ffffff;
  }

  :global(.dark) .stat-sub {
    color: #94a3b8;
  }

  :global(.dark) .search-input {
    background: #1a2332;
  }

  :global(.dark) .assigned-card {
    border-color: rgba(255, 255, 255, 0.08);
  }

  :global(.dark) .hours-stat {
    background: rgba(71, 85, 105, 0.2);
    border-color: rgba(148, 163, 184, 0.18);
  }

  :global(.dark) .hours-stat .label {
    color: #9ca3af;
  }

  :global(.dark) .hours-stat .value {
    color: #e5edf8;
  }

  :global(.dark) .info-text .font-semibold {
    color: #e5edf8;
  }

  :global(.dark) .btn-secondary {
    background: #1a2332;
    border-color: rgba(255, 255, 255, 0.12);
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: #243047;
    border-color: rgba(96, 165, 250, 0.42);
  }

  :global(.dark) .btn-remove {
    background: rgba(239, 68, 68, 0.16);
    border-color: rgba(239, 68, 68, 0.24);
    color: #fca5a5;
  }

  :global(.dark) .btn-remove:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.28);
    border-color: rgba(239, 68, 68, 0.4);
    color: #fecaca;
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

  :global(.dark) .detail-grid {
    background: rgba(71, 85, 105, 0.16);
    border-color: rgba(148, 163, 184, 0.18);
  }

  :global(.dark) .detail-key {
    color: #94a3b8;
  }

  :global(.dark) .detail-value {
    color: #e2e8f0;
  }

  :global(.dark) .detail-status {
    background: rgba(99, 102, 241, 0.2);
    border-color: rgba(129, 140, 248, 0.34);
    color: #c7d2fe;
  }

  :global(.dark) .assigned-card-skeleton {
    border-color: rgba(148, 163, 184, 0.12);
    background: rgba(148, 163, 184, 0.06);
  }

  :global(.dark) .sk-line,
  :global(.dark) .sk-pill,
  :global(.dark) .skeleton-circle {
    background: rgba(148, 163, 184, 0.12);
    border-color: rgba(148, 163, 184, 0.14);
  }

  /* Bulk assign mode styles */
  .bulk-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.24);
  }

  .bulk-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #2563eb, #3b82f6);
    border: 1px solid rgba(37, 99, 235, 0.3);
    color: white;
    padding: 0.35rem 0.75rem;
    border-radius: 9999px;
    font-weight: 700;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .bulk-option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .bulk-option.bulk-selected {
    background: rgba(37, 99, 235, 0.1);
    border-color: rgba(37, 99, 235, 0.42);
  }

  .bulk-checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border: 1.5px solid rgba(148, 163, 184, 0.45);
    border-radius: 0.35rem;
    background: transparent;
    color: #2563eb;
    flex-shrink: 0;
    transition: all 0.2s;
  }

  .bulk-option.bulk-selected .bulk-checkbox {
    background: #2563eb;
    border-color: #2563eb;
    color: white;
  }

  :global(.dark) .bulk-option.bulk-selected {
    background: rgba(59, 130, 246, 0.16);
    border-color: #3b82f6;
  }

  :global(.dark) .bulk-checkbox {
    border-color: rgba(148, 163, 184, 0.35);
  }

  :global(.dark) .bulk-option.bulk-selected .bulk-checkbox {
    background: #3b82f6;
    border-color: #3b82f6;
  }

  :global(.dark) .bulk-header {
    border-color: rgba(148, 163, 184, 0.22);
  }

  @media (max-width: 1200px) {
    .assigned-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 900px) {
    .card-header {
      flex-direction: column;
      gap: 10px;
    }

    .btn-group {
      width: 100%;
    }

    .btn-group .btn {
      flex: 1;
      justify-content: center;
    }

    .search-wrap {
      min-width: 0;
      width: 100%;
    }

    .stats-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .content {
      gap: 16px;
    }

    .stats-grid {
      grid-template-columns: 1fr;
    }

    .assigned-grid {
      grid-template-columns: 1fr;
    }

    .card-header,
    .card-body-shell,
    .stat-card {
      padding-left: 14px;
      padding-right: 14px;
    }

    .hours-row {
      grid-template-columns: 1fr;
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
