/* global google */

// Global user state
let currentUser = null;

/**
 * Get the current logged-in user
 * @returns {Object} Current user object
 */
export function getCurrentUser() {
  if (currentUser) {
    return currentUser;
  }

  // Try to get from Google Apps Script
  // eslint-disable-next-line no-undef
  if (typeof google !== 'undefined' && google.script) {
    try {
      const userEmail = google.script.run.withSuccessHandler(function(email) {
        return email;
      }).getUserEmail();
      
      return {
        email: userEmail,
        user_id: userEmail,
        full_name: 'Student',
        ojt: {
          total_ojt_hours: 0,
          start_date: '',
          estimated_end_date: '',
          course: '',
          school: ''
        }
      };
    } catch (err) {
      console.error('Failed to get user from GAS:', err);
    }
  }

  // Fallback for development
  return {
    email: 'student@example.com',
    user_id: 'student@example.com',
    full_name: 'Student',
    ojt: {
      total_ojt_hours: 0,
      start_date: '',
      estimated_end_date: '',
      course: '',
      school: ''
    }
  };
}

/**
 * Set the current user
 * @param {Object} user - User object
 */
export function setCurrentUser(user) {
  currentUser = user;
}

/**
 * Call a Google Apps Script function
 * @param {string} functionName - Function name in Code.gs
 * @param {any} args - Arguments to pass
 * @returns {Promise} Promise resolving with function result
 */
function callGasFunction(functionName, ...args) {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line no-undef
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      try {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          [functionName](...args);
      } catch (err) {
        reject(err);
      }
    } else {
      reject(new Error('Google Apps Script runtime not available'));
    }
  });
}

/**
 * Get user profile by user ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User profile
 */
export async function getUserProfile(userId) {
  try {
    const profile = await callGasFunction('handleGetStudentProfileByUserId_', userId);
    return profile;
  } catch (err) {
    console.error('Error getting user profile:', err);
    throw err;
  }
}

/**
 * Save or update OJT profile
 * @param {Object} profileData - OJT profile data
 * @returns {Promise<Object>} Updated profile
 */
export async function upsertStudentOjtProfile(profileData) {
  try {
    const result = await callGasFunction('handleUpsertStudentOjtProfile_', profileData);
    return result;
  } catch (err) {
    console.error('Error saving OJT profile:', err);
    throw err;
  }
}

/**
 * Refresh OJT profile from database
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated OJT profile
 */
export async function refreshStudentOjtProfile(userId) {
  try {
    const profile = await callGasFunction('handleGetStudentProfileByUserId_', userId);
    
    if (profile) {
      // Update currentUser with refreshed data
      if (currentUser) {
        currentUser.ojt = {
          total_ojt_hours: profile.total_ojt_hours || 0,
          start_date: profile.start_date || '',
          estimated_end_date: profile.estimated_end_date || '',
          course: profile.course || '',
          school: profile.school || ''
        };
      }
      return profile;
    }
    
    return null;
  } catch (err) {
    console.error('Error refreshing OJT profile:', err);
    throw err;
  }
}

/**
 * Get student progress (hours and working days completed)
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Progress object
 */
export async function getStudentProgress(userId) {
  try {
    const progress = await callGasFunction('handleGetStudentProgress_', userId);
    return progress || {
      hours_completed: 0,
      working_days_completed: 0
    };
  } catch (err) {
    console.error('Error getting student progress:', err);
    return {
      hours_completed: 0,
      working_days_completed: 0
    };
  }
}

/**
 * Log OJT hours
 * @param {string} userId - User ID
 * @param {number} hours - Hours to log
 * @param {string} date - Date of work (YYYY-MM-DD)
 * @param {string} description - Work description
 * @returns {Promise<Object>} Log result
 */
export async function logOjtHours(userId, hours, date, description = '') {
  try {
    const result = await callGasFunction('handleLogOjtHours_', {
      user_id: userId,
      hours: hours,
      date: date,
      description: description
    });
    return result;
  } catch (err) {
    console.error('Error logging OJT hours:', err);
    throw err;
  }
}

/**
 * Login user
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} Login result
 */
export async function login(email, password) {
  try {
    const result = await callGasFunction('handleLogin_', email, password);
    if (result && result.success) {
      currentUser = result.user;
      return result;
    }
    throw new Error(result?.message || 'Login failed');
  } catch (err) {
    console.error('Error during login:', err);
    throw err;
  }
}

/**
 * Sign up user
 * @param {Object} signupData - Signup data
 * @returns {Promise<Object>} Signup result
 */
export async function signup(signupData) {
  try {
    const result = await callGasFunction('handleSignup_', signupData);
    if (result && result.success) {
      currentUser = result.user;
      return result;
    }
    throw new Error(result?.message || 'Signup failed');
  } catch (err) {
    console.error('Error during signup:', err);
    throw err;
  }
}

/**
 * Logout user
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await callGasFunction('handleLogout_');
    currentUser = null;
  } catch (err) {
    console.error('Error during logout:', err);
    currentUser = null;
  }
}

/**
 * Check if user is authenticated
 * @returns {boolean} True if user is authenticated
 */
export function isAuthenticated() {
  return currentUser !== null;
}
