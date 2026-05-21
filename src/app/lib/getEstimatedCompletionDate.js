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
