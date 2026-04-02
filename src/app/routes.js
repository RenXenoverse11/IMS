export const pageMeta = {
  '/': {
    title: 'Dashboard',
    description: 'Welcome back, Alex. Here is your internship overview.',
  },
  '/time-log': {
    title: 'Time Log',
    description: 'Track and manage your daily work hours.',
  },
  '/documents': {
    title: 'Documents',
    description: 'Manage your files, reports, and assigned tasks.',
  },
  '/evaluation': {
    title: 'Evaluation',
    description: 'View your performance metrics and supervisor feedback.',
  },
  '/settings': {
    title: 'Settings',
    description: 'Manage your account preferences and profile.',
  },
};

export function normalizePath(path) {
  return pageMeta[path] ? path : '/';
}

export function getPageMeta(path) {
  return pageMeta[path] ?? { title: 'InternTrack', description: '' };
}
