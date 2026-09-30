'use strict';
const crypto = require('node:crypto');
const DAY = 86400000;
const id = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const archived = job => !job || job.archived === true || !!job.archivedAt || job.testRecord === true || job.deleted === true;
const phone = value => {
  const digits = String(value || '').replace(/\D/g,'');
  return /^0\d{10}$/.test(digits) ? '234' + digits.slice(1) : digits;
};
function channel(prefs, config) {
  if (!prefs?.requested) return {blocked:'Client updates were not requested'};
  const email = String(prefs.email || '').trim();
  const wanted = prefs.channel || 'auto';
  if ((wanted === 'email' || wanted === 'auto') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return config.email?.apiKey && config.email?.from ? {channel:'email',to:email} : {blocked:'Connect the email sending account'};
  }
  if (wanted === 'email') return {blocked:'No valid client email address'};
  if (!prefs.whatsappConsent) return {blocked:'Confirm client agrees to WhatsApp case updates'};
  const to = phone(prefs.phone);
  if (!/^\d{8,15}$/.test(to)) return {blocked:'No valid client phone number'};
  return config.whatsapp?.token && config.whatsapp?.phoneNumberId && config.whatsapp?.templates?.intake && config.whatsapp?.templates?.collection
    ? {channel:'whatsapp',to} : {blocked:'Connect WhatsApp Business and approved templates'};
}
function validSubscription(s) {
  try {
    const u = new URL(s.endpoint);
    const hosts = ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && hosts.includes(u.hostname)
      && s.endpoint.length < 2048 && /^[A-Za-z0-9_-]{80,120}$/.test(s.keys?.p256dh || '') && /^[A-Za-z0-9_-]{20,30}$/.test(s.keys?.auth || '');
  } catch { return false; }
}
function staffRecipients(users, job) {
  return Object.entries(users || {}).filter(([uid,u]) => u.active !== false && (['owner','admin','subadmin'].includes(u.role) || (u.role === 'worker' && [job.assignedTo,job.createdBy].includes(uid)))).map(([uid])=>uid);
}
function clientRecipients(access, customerId) {
  return Object.entries(access || {}).filter(([,a])=>a.active !== false && a.customerId === customerId).map(([uid])=>uid);
}
function collectionDue(job, history, time) {
  if (archived(job) || job.status !== 'Ready for Collection') return false;
  const logs = Object.values(history || {}).filter(x=>x.jobKey === job.key);
  const ready = Number(job.collectionReadyAt) || Math.max(0,...logs.filter(x=>x.milestone === 'Ready for Collection').map(x=>Number(x.createdAt)||0)) || Number(job.updatedAt) || 0;
  const last = Math.max(ready,...logs.filter(x=>x.type === 'Collection reminder' || x.type === 'Automatic collection reminder').map(x=>Number(x.createdAt)||0));
  return ready > 0 && time - last >= 7*DAY;
}
function retryDelay(attempt) { return Math.min(60*60*1000, 60000 * 2 ** Math.min(attempt,6)); }
module.exports = {DAY,id,archived,phone,channel,validSubscription,staffRecipients,clientRecipients,collectionDue,retryDelay};
