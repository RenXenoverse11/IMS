<script>
	import { getCurrentUser, getStudentProgress, upsertStudentOjtProfile, refreshStudentOjtProfile } from '../lib/auth.js';

	let user = getCurrentUser();
	let totalOjtHours = user?.ojt?.total_ojt_hours || 0;
	let hoursCompleted = 0;
	let startDate = user?.ojt?.start_date || '';
	let estimatedEndDate = user?.ojt?.estimated_end_date || '';
	let course = user?.ojt?.course || '';
	let school = user?.ojt?.school || '';
	let workingDaysCompleted = 0;
	let isLoadingProgress = false;
	let isSavingStartDate = false;
	let startDateMessage = '';
	let firstName = user?.full_name?.split(' ')[0] || 'Student';

	async function loadStudentProgress() {
		if (!user?.user_id) return;
		try {
			const progress = await getStudentProgress(user.user_id);
			if (progress) {
				hoursCompleted = progress.hours_completed || 0;
				workingDaysCompleted = progress.working_days_completed || 0;
			}
		} catch (err) {
			console.error('Failed to load progress:', err);
		}
	}

	async function refreshAllData() {
		if (!user) return;
		try {
			isLoadingProgress = true;
			// Refresh OJT profile from database
			const refreshedProfile = await refreshStudentOjtProfile(user.user_id);
			if (refreshedProfile) {
				totalOjtHours = refreshedProfile.total_ojt_hours || 0;
				startDate = refreshedProfile.start_date || '';
				estimatedEndDate = refreshedProfile.estimated_end_date || '';
				course = refreshedProfile.course || '';
				school = refreshedProfile.school || '';
			}
			// Load progress data from time logs
			await loadStudentProgress();
		} finally {
			isLoadingProgress = false;
		}
	}

	async function initializeDashboard() {
		await refreshAllData();
		
		// Listen for when page becomes visible (tab switching)
		document.addEventListener('visibilitychange', async () => {
			if (document.visibilityState === 'visible') {
				await refreshAllData();
			}
		});
	}

	function calculateWorkingDaysNeeded(hours) {
		// 8 hours per working day
		return Math.ceil(hours / 8);
	}

	function calculateEstimatedEndDate(start, hours) {
		if (!start || !hours) return '';
		const startDateObj = new Date(start);
		const workingDaysNeeded = Math.ceil(hours / 8);
		let workingDaysAdded = 0;
		let current = new Date(startDateObj);
		while (workingDaysAdded < workingDaysNeeded) {
			const day = current.getDay();
			if (day !== 0 && day !== 6) {
				workingDaysAdded++;
			}
			if (workingDaysAdded < workingDaysNeeded) {
				current.setDate(current.getDate() + 1);
			}
		}
		return current.toISOString().split('T')[0];
	}

	async function saveOjtProfile() {
		try {
			isSavingStartDate = true;
			startDateMessage = '';

			// Only calculate end date if start date is provided
			let newEndDate = estimatedEndDate;
			if (startDate && totalOjtHours) {
				newEndDate = calculateEstimatedEndDate(startDate, totalOjtHours);
			}

			// Validate required fields
			if (!user?.user_id) {
				startDateMessage = 'Error: User ID not found.';
				isSavingStartDate = false;
				return;
			}
			
			if (!totalOjtHours || totalOjtHours <= 0) {
				startDateMessage = 'Error: Total OJT hours must be greater than zero.';
				isSavingStartDate = false;
				return;
			}
			
			if (!startDate) {
				startDateMessage = 'Error: Start date is required.';
				isSavingStartDate = false;
				return;
			}
			
			if (!newEndDate) {
				startDateMessage = 'Error: Could not calculate end date.';
				isSavingStartDate = false;
				return;
			}
			
			if (!course || !course.trim()) {
				startDateMessage = 'Error: Course information is missing.';
				isSavingStartDate = false;
				return;
			}
			
			if (!school || !school.trim()) {
				startDateMessage = 'Error: School information is missing.';
				isSavingStartDate = false;
				return;
			}

			console.log('Saving OJT profile:', {
				user_id: user.user_id,
				total_ojt_hours: Number(totalOjtHours),
				start_date: startDate,
				estimated_end_date: newEndDate,
				course: String(course).trim(),
				school: String(school).trim()
			});

			const result = await upsertStudentOjtProfile({
				user_id: user.user_id,
				total_ojt_hours: Number(totalOjtHours),
				start_date: startDate,
				estimated_end_date: newEndDate,
				course: String(course).trim(),
				school: String(school).trim()
			});
			
			console.log('Save result:', result);
			
			// Update the local estimated end date
			estimatedEndDate = newEndDate;
			startDateMessage = 'OJT profile saved successfully!';
			
			// Refresh data from database to ensure persistence
			await refreshAllData();
		} catch (err) {
			startDateMessage = err?.message || 'Failed to save OJT profile';
			console.error('Error saving OJT profile:', err);
		} finally {
			isSavingStartDate = false;
		}
	}

	initializeDashboard();

	$: totalWorkingDaysNeeded = calculateWorkingDaysNeeded(totalOjtHours);
	$: remainingHours = Math.max(0, totalOjtHours - hoursCompleted);
	$: remainingWorkingDays = calculateWorkingDaysNeeded(remainingHours);
	$: daysPercentage = totalWorkingDaysNeeded > 0 ? (workingDaysCompleted / totalWorkingDaysNeeded) * 100 : 0;
	$: hoursPercentage = totalOjtHours > 0 ? (hoursCompleted / totalOjtHours) * 100 : 0;
</script>

<section class="page-shell">
  <div class="dashboard-container">
    <!-- Welcome Banner -->
    <div class="welcome-banner">
      <div class="banner-content">
        <h2>Welcome back, {firstName}! 👋</h2>
        <p>Here's your OJT progress overview for this period.</p>
      </div>
    </div>

    <!-- Attendance Summary Section -->
    <div class="summary-grid">
      <div class="summary-card">
        <div class="card-header">
          <h3>Days Completed</h3>
          <span class="card-icon">📅</span>
        </div>
        <div class="card-content">
          <div class="stat-value">{workingDaysCompleted}</div>
          <div class="stat-label">out of {totalWorkingDaysNeeded} days</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: {daysPercentage}%"></div>
          </div>
          <p class="remaining-text">{Math.max(0, totalWorkingDaysNeeded - workingDaysCompleted)} days remaining</p>
        </div>
      </div>

      <div class="summary-card">
        <div class="card-header">
          <h3>Hours Completed</h3>
          <span class="card-icon">⏱️</span>
        </div>
        <div class="card-content">
          <div class="stat-value">{hoursCompleted}</div>
          <div class="stat-label">out of {totalOjtHours} hours</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: {hoursPercentage}%"></div>
          </div>
          <p class="remaining-text">{remainingHours} hours remaining</p>
        </div>
      </div>

      <div class="summary-card">
        <div class="card-header">
          <h3>Tasks Assigned</h3>
          <span class="card-icon">📋</span>
        </div>
        <div class="card-content">
          <div class="stat-value">12</div>
          <div class="stat-label">total tasks</div>
          <div class="task-status">
            <span class="task-badge completed">8 Completed</span>
            <span class="task-badge pending">4 Pending</span>
          </div>
        </div>
      </div>
    </div>

    <!-- OJT Info Section - Start Date & OJT Hours Editable, Others Read Only -->
    <div class="ojt-info-section">
      <h3>Your OJT Profile</h3>
      <div class="banner-cards">
        <div class="banner-card">
          <label for="start-date">Start Date</label>
          <input 
            id="start-date" 
            type="date" 
            bind:value={startDate} 
            placeholder="mm/dd/yyyy"
          />
        </div>
        <div class="banner-card">
          <label for="end-date">Estimated End Date</label>
          <input id="end-date" type="date" value={estimatedEndDate} disabled readonly placeholder="mm/dd/yyyy" />
        </div>
        <div class="banner-card">
          <label for="total-hours">Total OJT Hours</label>
          <input id="total-hours" type="number" bind:value={totalOjtHours} placeholder="Enter hours" />
        </div>
        <div class="banner-card">
          <label for="course">Course</label>
          <input id="course" type="text" value={course} placeholder="Your course" disabled readonly />
        </div>
        <div class="banner-card">
          <label for="school">School</label>
          <input id="school" type="text" value={school} placeholder="Your school" disabled readonly />
        </div>
      </div>
      
      <div class="button-group">
        <button 
          class="save-btn" 
          on:click={saveOjtProfile}
          disabled={isSavingStartDate}
        >
          {isSavingStartDate ? 'Saving...' : 'Save OJT Profile'}
        </button>
      </div>
      
      {#if startDateMessage}
        <p class="success-message">{startDateMessage}</p>
      {/if}

      <p class="info-note">📝 Start date and OJT hours are editable. Other fields are from your signup. Contact your supervisor to make other changes.</p>
    </div>

    <!-- Main Content Grid -->
    <div class="content-grid">
      <!-- Recent Activity -->
      <div class="card">
        <div class="card-header-main">
          <h3>Recent Activity</h3>
          <a href="/activity" class="view-all">View All →</a>
        </div>
        <div class="activity-list">
          <div class="activity-item">
            <div class="activity-dot completed"></div>
            <div class="activity-content">
              <p class="activity-title">Task Completed: Database Design</p>
              <p class="activity-time">2 hours ago</p>
            </div>
          </div>

          <div class="activity-item">
            <div class="activity-dot submitted"></div>
            <div class="activity-content">
              <p class="activity-title">Document Submitted: System Architecture</p>
              <p class="activity-time">5 hours ago</p>
            </div>
          </div>

          <div class="activity-item">
            <div class="activity-dot reviewed"></div>
            <div class="activity-content">
              <p class="activity-title">Supervisor Review: Login Module</p>
              <p class="activity-time">1 day ago</p>
            </div>
          </div>

          <div class="activity-item">
            <div class="activity-dot assigned"></div>
            <div class="activity-content">
              <p class="activity-title">New Task Assigned: API Integration</p>
              <p class="activity-time">2 days ago</p>
            </div>
          </div>

          <div class="activity-item">
            <div class="activity-dot completed"></div>
            <div class="activity-content">
              <p class="activity-title">Task Completed: UI Redesign</p>
              <p class="activity-time">3 days ago</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Upcoming Tasks -->
      <div class="card">
        <div class="card-header-main">
          <h3>Upcoming Tasks</h3>
          <a href="/tasks" class="view-all">View All →</a>
        </div>
        <div class="tasks-list">
          <div class="task-item">
            <div class="task-info">
              <p class="task-name">API Integration</p>
              <p class="task-deadline">Due: April 10, 2026</p>
            </div>
            <span class="priority-badge high">High</span>
          </div>

          <div class="task-item">
            <div class="task-info">
              <p class="task-name">Testing & QA</p>
              <p class="task-deadline">Due: April 15, 2026</p>
            </div>
            <span class="priority-badge medium">Medium</span>
          </div>

          <div class="task-item">
            <div class="task-info">
              <p class="task-name">Documentation Review</p>
              <p class="task-deadline">Due: April 20, 2026</p>
            </div>
            <span class="priority-badge low">Low</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .dashboard-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  /* Welcome Banner */
  .welcome-banner {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
    padding: 2rem;
    color: white;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    margin-bottom: 1rem;
  }

  .banner-content h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.8rem;
    font-weight: 700;
  }

  .banner-content p {
    margin: 0;
    font-size: 1rem;
    opacity: 0.9;
  }

  /* OJT Info Section */
  .ojt-info-section {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 1px solid #e5e7eb;
  }

  .ojt-info-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1.1rem;
    color: #111827;
  }

  .banner-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .banner-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .banner-card label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #6b7280;
  }

  .banner-card input {
    padding: 0.6rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.95rem;
    transition: border-color 0.2s ease;
  }

  .banner-card input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  .banner-card input:disabled {
    background-color: #f3f4f6;
    cursor: not-allowed;
    color: #6b7280;
  }

  .banner-card input:not(:disabled) {
    background-color: white;
    cursor: text;
    color: #111827;
    border-color: #d1d5db;
  }

  .banner-card input:not(:disabled):focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  .button-group {
    display: flex;
    gap: 1rem;
    margin: 1.5rem 0;
  }

  .save-btn {
    padding: 0.7rem 1.5rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .save-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .info-note {
    color: #6b7280;
    font-size: 0.9rem;
    margin: 1.5rem 0 0 0;
    padding: 1rem;
    background-color: #f3f4f6;
    border-radius: 6px;
    border-left: 4px solid #667eea;
  }

  .success-message {
    color: #059669;
    font-size: 0.9rem;
    margin: 1rem 0 0 0;
    padding: 0.75rem 1rem;
    background-color: #f0fdf4;
    border-left: 4px solid #059669;
    border-radius: 4px;
  }

  /* Summary Grid */
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin-bottom: 1rem;
  }

  .summary-card {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
    padding: 1.5rem;
    color: white;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }

  .summary-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 15px rgba(0, 0, 0, 0.2);
  }

  .summary-card:nth-child(2) {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  }

  .summary-card:nth-child(3) {
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .card-header h3 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0;
    opacity: 0.95;
  }

  .card-icon {
    font-size: 1.5rem;
  }

  .card-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .stat-value {
    font-size: 2.5rem;
    font-weight: 700;
    line-height: 1;
  }

  .stat-label {
    font-size: 0.9rem;
    opacity: 0.9;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 3px;
    overflow: hidden;
    margin: 0.5rem 0;
  }

  .progress-fill {
    height: 100%;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .remaining-text {
    font-size: 0.85rem;
    opacity: 0.85;
    margin: 0;
  }

  .task-status {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }

  .task-badge {
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.2);
  }

  .task-badge.completed {
    background: rgba(34, 197, 94, 0.3);
  }

  .task-badge.pending {
    background: rgba(251, 146, 60, 0.3);
  }

  /* Content Grid */
  .content-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 2rem;
  }

  .card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 1px solid #e5e7eb;
    transition: box-shadow 0.3s ease;
  }

  .card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .card-header-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #e5e7eb;
  }

  .card-header-main h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  .view-all {
    color: #667eea;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 500;
    transition: color 0.3s ease;
  }

  .view-all:hover {
    color: #764ba2;
  }

  /* Activity List */
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .activity-item {
    display: flex;
    gap: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #f3f4f6;
  }

  .activity-item:last-child {
    border-bottom: none;
  }

  .activity-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 4px;
  }

  .activity-dot.completed {
    background: #22c55e;
  }

  .activity-dot.submitted {
    background: #3b82f6;
  }

  .activity-dot.reviewed {
    background: #f59e0b;
  }

  .activity-dot.assigned {
    background: #8b5cf6;
  }

  .activity-content {
    flex: 1;
  }

  .activity-title {
    font-size: 0.95rem;
    font-weight: 500;
    color: #111827;
    margin: 0 0 0.25rem 0;
  }

  .activity-time {
    font-size: 0.85rem;
    color: #6b7280;
    margin: 0;
  }

  /* Tasks List */
  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .task-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: #f9fafb;
    border-radius: 8px;
    transition: background 0.3s ease;
  }

  .task-item:hover {
    background: #f3f4f6;
  }

  .task-info {
    flex: 1;
  }

  .task-name {
    font-weight: 500;
    color: #111827;
    margin: 0 0 0.25rem 0;
    font-size: 0.95rem;
  }

  .task-deadline {
    font-size: 0.85rem;
    color: #6b7280;
    margin: 0;
  }

  .priority-badge {
    display: inline-block;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .priority-badge.high {
    background: #fee2e2;
    color: #991b1b;
  }

  .priority-badge.medium {
    background: #fef3c7;
    color: #92400e;
  }

  .priority-badge.low {
    background: #dcfce7;
    color: #166534;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .summary-grid {
      grid-template-columns: 1fr;
    }

    .content-grid {
      grid-template-columns: 1fr;
    }

    .stat-value {
      font-size: 2rem;
    }
  }
</style>
