// Utility function to calculate estimated completion date, skipping days off
export function getEstimatedCompletionDate(hoursRemaining, avgDailyHours, daysOff = [0, 6]) {
  const workingDaysNeeded = Math.ceil(hoursRemaining / avgDailyHours);
  const daysOffSet = new Set(Array.isArray(daysOff) && daysOff.length ? daysOff : [0, 6]);
  let daysAdded = 0;
  let date = new Date();

  while (daysAdded < workingDaysNeeded) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (!daysOffSet.has(day)) {
      daysAdded++;
    }
  }

  // Format date as 'MMM DD, YYYY'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  });
}

export function getWorkingDurationParts(hoursRemaining, avgDailyHours) {
  const safeHoursRemaining = Math.max(0, Number(hoursRemaining) || 0);
  const safeAvgDailyHours = Math.max(0, Number(avgDailyHours) || 0);

  if (!safeHoursRemaining || !safeAvgDailyHours) {
    return {
      days: 0,
      hours: 0,
      wholeHours: 0,
      hasRemainderHours: false,
    };
  }

  const days = Math.floor(safeHoursRemaining / safeAvgDailyHours);
  const hours = Number((safeHoursRemaining - (days * safeAvgDailyHours)).toFixed(1));
  const wholeHours = Number.isInteger(hours) ? hours : hours;

  return {
    days,
    hours,
    wholeHours,
    hasRemainderHours: hours > 0,
  };
}

export function formatWorkingDuration(hoursRemaining, avgDailyHours) {
  const { days, hours, hasRemainderHours } = getWorkingDurationParts(hoursRemaining, avgDailyHours);

  if (days <= 0 && !hasRemainderHours) {
    return 'Completed';
  }

  const parts = [];

  if (days > 0) {
    parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  }

  if (hasRemainderHours) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }

  return parts.join(' and ');
}
