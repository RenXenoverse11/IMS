<script>
  import { onDestroy, onMount } from 'svelte';
  import {
    Building2,
    Clock3,
    Layers3,
    RefreshCw,
    Save,
    TrendingUp,
    UserPlus2,
    Users,
  } from 'lucide-svelte';
  import {
    assignStudentsToSupervisor,
    getCurrentUser,
    listStudentsForAssignment,
    listSupervisorAssignedStudents,
    subscribeToCurrentUser,
  } from '../lib/auth.js';

  let currentUser = null;
  let unsubscribeAuth;
  let loading = false;
  let saving = false;
  let errorMessage = '';
  let successMessage = '';

  let companyFilter = '';
  let departmentFilter = '';
  let availableStudents = [];
  let assignedStudents = [];
  let selectedStudentIds = [];

  function normalizeDate(value) {
    const text = String(value || '').trim();
    if (!text) {
      return '-';
    }

    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return text;
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed);
  }

  function toNumber(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toPercent(completed, required) {
    if (required <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((completed / required) * 100));
  }

  function syncSelectedFromAvailable() {
    selectedStudentIds = availableStudents
      .filter((student) => student?.is_assigned)
      .map((student) => String(student.user_id || ''));
  }

  async function loadData() {
    const supervisorId = String(currentUser?.user_id || '').trim();
    if (!supervisorId || !isSupervisorUser) {
      availableStudents = [];
      assignedStudents = [];
      selectedStudentIds = [];
      return;
    }

    loading = true;
    errorMessage = '';

    try {
      const [students, assigned] = await Promise.all([
        listStudentsForAssignment(supervisorId, {
          company: companyFilter,
          department: departmentFilter,
        }),
        listSupervisorAssignedStudents(supervisorId),
      ]);

      availableStudents = students;
      assignedStudents = assigned;
      syncSelectedFromAvailable();
    } catch (err) {
      errorMessage = err?.message || 'Unable to load supervisor dashboard data.';
    } finally {
      loading = false;
    }
  }

  function toggleStudentSelection(studentId) {
    const target = String(studentId || '').trim();
    if (!target) {
      return;
    }

    if (selectedStudentIds.includes(target)) {
      selectedStudentIds = selectedStudentIds.filter((id) => id !== target);
      return;
    }

    selectedStudentIds = [...selectedStudentIds, target];
  }

  async function handleSaveAssignments() {
    const supervisorId = String(currentUser?.user_id || '').trim();
    if (!supervisorId || !isSupervisorUser) {
      errorMessage = 'Only supervisor accounts can save assignments.';
      return;
    }

    saving = true;
    errorMessage = '';
    successMessage = '';

    try {
      await assignStudentsToSupervisor(supervisorId, selectedStudentIds, {
        company: companyFilter,
        department: departmentFilter,
      });
      successMessage = 'Assigned students updated successfully.';
      await loadData();
    } catch (err) {
      errorMessage = err?.message || 'Unable to save assigned students.';
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    currentUser = getCurrentUser();
    departmentFilter = String(currentUser?.department || '').trim();

    unsubscribeAuth = subscribeToCurrentUser((user) => {
      currentUser = user;
      if (!departmentFilter) {
        departmentFilter = String(user?.department || '').trim();
      }
      loadData();
    });

    loadData();
  });

  onDestroy(() => {
    if (typeof unsubscribeAuth === 'function') {
      unsubscribeAuth();
    }
  });

  $: totalAssigned = assignedStudents.length;
  $: totalRequiredHours = assignedStudents.reduce((sum, student) => sum + toNumber(student.required_hours), 0);
  $: totalCompletedHours = assignedStudents.reduce((sum, student) => sum + toNumber(student.completed_hours), 0);
  $: averageProgress = totalRequiredHours > 0 ? Math.round((totalCompletedHours / totalRequiredHours) * 100) : 0;
  $: currentRole = String(currentUser?.role || '').trim().toLowerCase();
  $: isSupervisorUser = currentRole === 'supervisor';
</script>

{#if currentUser && !isSupervisorUser}
  <section class="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
    This page is available for supervisor accounts only.
  </section>
{:else}
  <section class="flex flex-col gap-6">
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article class="supervisor-card rounded-xl border p-5 shadow-md">
        <div class="supervisor-icon icon-blue"><Users size={18} /></div>
        <p class="supervisor-value mt-4">{totalAssigned}</p>
        <p class="supervisor-label mt-1">Assigned Students</p>
      </article>

      <article class="supervisor-card rounded-xl border p-5 shadow-md">
        <div class="supervisor-icon icon-green"><Clock3 size={18} /></div>
        <p class="supervisor-value mt-4">{totalCompletedHours}h</p>
        <p class="supervisor-label mt-1">Total Completed Hours</p>
      </article>

      <article class="supervisor-card rounded-xl border p-5 shadow-md">
        <div class="supervisor-icon icon-violet"><TrendingUp size={18} /></div>
        <p class="supervisor-value mt-4">{averageProgress}%</p>
        <p class="supervisor-label mt-1">Average Progress</p>
      </article>

      <article class="supervisor-card rounded-xl border p-5 shadow-md">
        <div class="supervisor-icon icon-cyan"><Layers3 size={18} /></div>
        <p class="supervisor-value mt-4">{totalRequiredHours}h</p>
        <p class="supervisor-label mt-1">Total Required Hours</p>
      </article>
    </div>

    {#if errorMessage}
      <p class="rounded-xl border border-red-300 bg-red-100 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300">
        {errorMessage}
      </p>
    {/if}

    {#if successMessage}
      <p class="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300">
        {successMessage}
      </p>
    {/if}

    <section class="supervisor-card rounded-xl border p-6 shadow-md">
      <div class="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 class="supervisor-heading text-lg font-semibold">Assign Students</h3>
          <p class="supervisor-sub mt-1 text-sm">Pick students that will be handled by your account.</p>
        </div>

        <div class="flex gap-2">
          <button type="button" class="btn-light rounded-lg px-3 py-2 text-sm font-semibold" on:click={loadData} disabled={loading || saving}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button type="button" class="btn-primary rounded-lg px-3 py-2 text-sm font-semibold" on:click={handleSaveAssignments} disabled={saving}>
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Assignment'}
          </button>
        </div>
      </div>

      <div class="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label class="flex flex-col gap-1.5">
          <span class="supervisor-sub text-sm font-medium">Company</span>
          <div class="relative">
            <Building2 size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-muted)]" />
            <input bind:value={companyFilter} type="text" class="supervisor-input w-full rounded-lg border px-4 py-2.5 pl-9 outline-none" placeholder="e.g. Globe" />
          </div>
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="supervisor-sub text-sm font-medium">Department</span>
          <input bind:value={departmentFilter} type="text" class="supervisor-input w-full rounded-lg border px-4 py-2.5 outline-none" placeholder="e.g. IT Department" />
        </label>
      </div>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {#if availableStudents.length === 0}
          <p class="supervisor-sub text-sm">No students found for the selected filters.</p>
        {:else}
          {#each availableStudents as student (student.user_id)}
            <button
              type="button"
              class="student-pick-card w-full rounded-lg border p-3 text-left"
              class:student-picked={selectedStudentIds.includes(String(student.user_id || ''))}
              on:click={() => toggleStudentSelection(student.user_id)}
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="supervisor-heading text-sm font-semibold">{student.full_name}</p>
                  <p class="supervisor-sub text-xs">{student.email}</p>
                  <p class="supervisor-sub mt-1 text-xs">{student.company || '-'} • {student.department || '-'}</p>
                </div>
                <span class="pick-indicator rounded-full px-2 py-0.5 text-[11px] font-semibold">
                  {selectedStudentIds.includes(String(student.user_id || '')) ? 'Selected' : 'Select'}
                </span>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </section>

    <section class="supervisor-card rounded-xl border p-6 shadow-md">
      <div class="mb-4 flex items-center gap-2">
        <UserPlus2 size={17} class="supervisor-sub" />
        <h3 class="supervisor-heading text-lg font-semibold">Assigned Student Progress</h3>
      </div>

      {#if assignedStudents.length === 0}
        <p class="supervisor-sub text-sm">No students assigned yet.</p>
      {:else}
        <div class="space-y-3">
          {#each assignedStudents as student (student.user_id)}
            {@const required = toNumber(student.required_hours)}
            {@const completed = toNumber(student.completed_hours)}
            {@const progress = toPercent(completed, required)}
            <article class="rounded-lg border border-(--color-border) px-4 py-3">
              <div class="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p class="supervisor-heading text-sm font-semibold">{student.full_name}</p>
                  <p class="supervisor-sub text-xs">{student.department || '-'} • ETA {normalizeDate(student.estimated_end_date)}</p>
                </div>
                <p class="supervisor-sub text-xs font-semibold">{completed}h / {required || '-'}h</p>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-(--color-soft)">
                <div class="h-full rounded-full bg-linear-to-r from-indigo-500 to-cyan-500" style={`width:${progress}%`}></div>
              </div>
              <p class="supervisor-sub mt-2 text-xs">{progress}% complete</p>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </section>
{/if}

<style>
  .supervisor-card {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  .supervisor-heading,
  .supervisor-value {
    color: var(--color-heading);
  }

  .supervisor-label,
  .supervisor-sub {
    color: var(--color-sidebar-text);
  }

  .supervisor-value {
    font-size: 1.75rem;
    line-height: 1;
    font-weight: 700;
  }

  .supervisor-icon {
    width: 2.35rem;
    height: 2.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.8rem;
  }

  .icon-blue {
    background: #dbeafe;
    color: #2563eb;
  }

  .icon-green {
    background: #d1fae5;
    color: #059669;
  }

  .icon-violet {
    background: #ede9fe;
    color: #7c3aed;
  }

  .icon-cyan {
    background: #cffafe;
    color: #0891b2;
  }

  :global(.dark) .icon-blue {
    background: rgba(59, 130, 246, 0.2);
    color: #bfdbfe;
  }

  :global(.dark) .icon-green {
    background: rgba(16, 185, 129, 0.2);
    color: #a7f3d0;
  }

  :global(.dark) .icon-violet {
    background: rgba(139, 92, 246, 0.2);
    color: #ddd6fe;
  }

  :global(.dark) .icon-cyan {
    background: rgba(6, 182, 212, 0.2);
    color: #a5f3fc;
  }

  .supervisor-input {
    background: var(--color-soft);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  .btn-primary,
  .btn-light {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid transparent;
  }

  .btn-primary {
    background: #4f46e5;
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #4338ca;
  }

  .btn-light {
    background: var(--color-soft);
    border-color: var(--color-border);
    color: var(--color-heading);
  }

  .student-pick-card {
    background: var(--color-soft);
    border-color: var(--color-border);
  }

  .student-picked {
    border-color: #4f46e5;
    box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.3);
  }

  .pick-indicator {
    background: var(--color-active-bg);
    color: var(--color-active-text);
  }

</style>
