const DAY = 86400000;

// Derive queues from existing records; no migration or automatic customer sends.
export function buildFollowups(jobs, communications, timestamp = Date.now()) {
  const result = [];
  for (const job of jobs) {
    if (job.archived || job.deleted || job.archivedAt || job.deletedAt || job.testRecord || ['Completed', 'Closed'].includes(job.status)) continue;
    const history = Object.values(communications[job.customerId] || {}).filter(e => e.jobKey === job.key);
    const scheduled=Number(job.followupAt) || 0;
    if(scheduled && timestamp>=scheduled && !history.some(e=>e.type==='Scheduled reminder' && Number(e.createdAt)>=scheduled))result.push({job,kind:'scheduled',title:'Scheduled client reminder',days:Math.floor((timestamp-scheduled)/DAY),overdue:true});
    const received = Number(job.createdAt) || 0;
    if (received && !history.some(e => e.type === 'Device received notice')) {
      result.push({ job, kind: 'received', title: 'Confirm device received', days: Math.max(0, Math.floor((timestamp - received) / DAY)), overdue: false });
    }
    if (job.status !== 'Ready for Collection') continue;
    const milestones = history.filter(e => e.milestone === 'Ready for Collection').map(e => Number(e.createdAt) || 0);
    const readyAt = Number(job.collectionReadyAt) || Math.max(0, ...milestones) || Number(job.updatedAt) || received;
    const lastContact = Math.max(readyAt, ...history.filter(e => e.type === 'Collection reminder').map(e => Number(e.createdAt) || 0));
    const days = readyAt ? Math.max(0, Math.floor((timestamp - readyAt) / DAY)) : null;
    const noticeSent = history.some(e => e.type === 'Collection reminder' && Number(e.createdAt) >= readyAt);
    if (!noticeSent || (lastContact && timestamp - lastContact >= 7 * DAY)) result.push({ job, kind: 'collection', title: days !== null && days >= 7 ? 'Collection overdue' : 'Ready to collect', days, overdue: days !== null && days >= 7 });
  }
  return result.sort((a,b) => Number(b.overdue) - Number(a.overdue) || (b.days || 0) - (a.days || 0));
}

export function customerMessage(item, customer, companyName) {
  const name = customer?.fullName || 'there';
  const caseId = item.job.jobId || item.job.key;
  if(item.kind==='scheduled')return `Hello ${name}, this is a reminder from ${companyName} about your device, case ${caseId}. ${item.job.followupMessage || 'Please contact us for an update or to arrange collection if your device is ready.'}`;
  return item.kind === 'received'
    ? `Hello ${name}, ${companyName} has received your device for case ${caseId}. We will update you after assessment. Please keep this case number for reference.`
    : `Hello ${name}, your device for case ${caseId} is ready for collection at ${companyName}. Please contact us to arrange pickup. Thank you.`;
}

export function whatsappNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return /^0\d{10}$/.test(digits) ? '234' + digits.slice(1) : digits;
}

export function emailReminderLink(email, subject, message) {
  const address=String(email || '').trim();
  if(!/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(address))return '';
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}
