export const pageMeta = {
  '/login': {
    title: 'Login',
    description: 'Access your Internship Management System account.',
  },
  '/signup': {
    title: 'Sign Up',
    description: 'Create a new Internship Management System account.',
  },
  '/': {
    title: 'Dashboard',
    description: 'Track your internship overview.',
  },
  '/time-log': {
    title: 'Time Log',
    description: 'Track daily work hours.',
  },
  '/requests': {
    title: 'Requests',
    description: 'Manage absence and overtime.',
  },
  '/activity': {
    title: 'Activity Log',
    description: 'Review task updates and timeline.',
  },
  '/documents': {
    title: 'Documents',
    description: 'Manage your documents.',
  },
  '/settings': {
    title: 'Settings',
    description: 'Manage your profile.',
  },
  '/projects': {
    title: 'Projects',
    description: 'Manage your assigned projects.',
  },
  '/supervisor': {
    title: 'Supervisor Dashboard',
    description: 'Assign and monitor interns.',
  },
  '/supervisor/interns': {
    title: 'Intern Management',
    description: 'Manage assigned interns.',
  },
  '/supervisor/time-logs': {
    title: 'Time Log Management',
    description: 'Review and manage assigned student time entries.',
  },
  '/supervisor/requests': {
    title: 'Intern Requests',
    description: 'Approve or reject assigned student requests.',
  },
  '/supervisor/projects': {
    title: 'Supervisor Projects',
    description: 'View projects tagged to you by interns.',
  },
  '/supervisor/activity': {
    title: 'Activity Log',
    description: 'Review activity logs of assigned students.',
  },
  '/supervisor/documents': {
    title: 'Documents',
    description: 'Review documents submitted by assigned students.',
  },
};

export function normalizePath(path) {
  return pageMeta[path] ? path : '/';
}

export function getPageMeta(path) {
  return pageMeta[path] ?? { title: 'Internship Management System', description: '' };
}
