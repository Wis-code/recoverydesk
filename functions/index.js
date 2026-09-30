'use strict';
const {initializeApp} = require('firebase-admin/app');
const {getDatabase} = require('firebase-admin/database');
const {getFirestore,FieldValue} = require('firebase-admin/firestore');
const {onCall,HttpsError} = require('firebase-functions/v2/https');
const {onValueCreated,onValueUpdated} = require('firebase-functions/v2/database');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {setGlobalOptions} = require('firebase-functions/v2');
const {defineSecret} = require('firebase-functions/params');
const webpush = require('web-push');
const {id,archived,channel,validSubscription,staffRecipients,clientRecipients,collectionDue,retryDelay,DAY} = require('./core');
const {intakePdf} = require('./intake-pdf');

initializeApp({databaseURL:'https://wiscodery-forensic-default-rtdb.europe-west1.firebasedatabase.app'});
setGlobalOptions({region:'europe-west1',maxInstances:3,memory:'256MiB',timeoutSeconds:120});
const configSecret = defineSecret('RECOVERYDESK_NOTIFICATIONS');
const db = getDatabase(), store = getFirestore();
const options = {secrets:[configSecret]};
const trigger = {ref:'/jobs/{jobKey}',instance:'wiscodery-forensic-default-rtdb',region:'europe-west1',retry:true};
const config = () => JSON.parse(configSecret.value());
const read = async path => (await db.ref(path).get()).val();
const subs = uid => store.collection('notificationUsers').doc(uid).collection('subscriptions');
const outbox = store.collection('notificationOutbox');

async function identity(uid) {
  const staff = await read(`users/${uid}`);
  if(staff?.role && staff.active !== false)return {staff};
  const access = await read(`customerAccess/${uid}`);
  if(access?.customerId && access.active !== false)return {access};
  throw new HttpsError('permission-denied','Your account is not active.');
}
async function caller(request) {
  if(!request.auth)throw new HttpsError('unauthenticated','Sign in first.');
  return identity(request.auth.uid);
}
async function canReceive(uid,event) {
  try {
    const who = await identity(uid);
    if(!event.jobKey && event.kind === 'test')return true;
    if(event.taskKey) {
      const task = await read(`tasks/${event.taskKey}`);
      return !!who.staff && !!task && !task.archived && !task.archivedAt && task.status !== 'completed' && (task.assignedTo === uid || ['owner','admin','subadmin'].includes(who.staff.role));
    }
    const job = await read(`jobs/${event.jobKey}`);
    if(archived(job))return false;
    if(event.kind === 'collection' && job.status !== 'Ready for Collection')return false;
    if(who.access)return who.access.customerId === job.customerId;
    return staffRecipients({[uid]:who.staff},job).includes(uid);
  }catch{return false;}
}
async function enqueue(key,event) {
  try {await outbox.doc(id(key)).create({...event,status:'pending',attempts:0,dueAt:Date.now(),createdAt:Date.now()});}
  catch(error){if(error.code !== 6 && error.code !== 'already-exists')throw error;}
}
async function pushEvents(key,uids,event) {
  await Promise.all([...new Set(uids)].map(uid=>enqueue(`${key}:push:${uid}`,{...event,transport:'push',uid})));
}
async function jobEvents(job,jobKey,kind,key) {
  if(archived(job))return;
  const [users,access] = await Promise.all([read('users'),read('customerAccess')]);
  const recipients=[...staffRecipients(users,job),...clientRecipients(access,job.customerId)];
  await pushEvents(key,recipients,{kind,jobKey,customerId:job.customerId});
  if(job.notificationPrefs?.requested && kind !== 'update')await enqueue(`${key}:client-sheet`,{kind,jobKey,customerId:job.customerId,transport:'client'});
}

exports.notificationConfig = onCall(options,async request => {
  await caller(request);const c=config();
  return {publicKey:c.vapid?.publicKey || '',emailReady:!!(c.email?.apiKey && c.email?.from),whatsappReady:!!(c.whatsapp?.token && c.whatsapp?.phoneNumberId && c.whatsapp?.templates?.intake && c.whatsapp?.templates?.collection)};
});
exports.savePushSubscription = onCall(async request => {
  await caller(request);const uid=request.auth.uid,s=request.data?.subscription;
  if(!validSubscription(s))throw new HttpsError('invalid-argument','This push subscription is not supported.');
  const ref=subs(uid).doc(id(s.endpoint));
  const existing=await ref.get();
  if(!existing.exists && (await subs(uid).count().get()).data().count >= 8)throw new HttpsError('resource-exhausted','Remove an old device before enabling another.');
  // A shared-browser subscription belongs to only the last signed-in account.
  const owner=store.collection('notificationPushOwners').doc(id(s.endpoint));
  await store.runTransaction(async tx=>{
    const previous=(await tx.get(owner)).data()?.uid;
    if(previous && previous!==uid)tx.delete(subs(previous).doc(id(s.endpoint)));
    tx.set(owner,{uid});
    tx.set(ref,{endpoint:s.endpoint,keys:{auth:s.keys.auth,p256dh:s.keys.p256dh},updatedAt:Date.now()});
  });
  return {saved:true};
});
exports.removePushSubscription = onCall(async request => {
  if(!request.auth)throw new HttpsError('unauthenticated','Sign in first.');
  if(typeof request.data?.endpoint !== 'string')throw new HttpsError('invalid-argument','No subscription supplied.');
  await subs(request.auth.uid).doc(id(request.data.endpoint)).delete();return {removed:true};
});
exports.testPushNotification = onCall(async request => {
  await caller(request);const uid=request.auth.uid,ref=store.collection('notificationUsers').doc(uid);
  await store.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(Date.now()-(snap.data()?.lastTestAt || 0)<60000)throw new HttpsError('resource-exhausted','Wait one minute before another test.');
    tx.set(ref,{lastTestAt:Date.now()},{merge:true});
  });
  await enqueue(`test:${uid}:${Date.now()}`,{uid,kind:'test',transport:'push'});
  return {queued:true};
});
exports.notificationDeliveryStatus = onCall(async request => {
  const who=await caller(request),jobKey=String(request.data?.jobKey || '');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(jobKey))throw new HttpsError('invalid-argument','Choose a case.');
  if(!who.staff || !await canReceive(request.auth.uid,{jobKey,kind:'intake'}))throw new HttpsError('permission-denied','This case is not assigned to you.');
  const docs=await outbox.where('jobKey','==',jobKey).limit(50).get();
  return {items:docs.docs.filter(d=>d.data().transport==='client').map(d=>{const x=d.data();return {kind:x.kind,status:x.status,channel:x.channel || '',reason:x.reason || '',createdAt:x.createdAt};})};
});
exports.onDeviceIntake = onValueCreated(trigger,async event => {
  const job=event.data.val();
  if(job.notificationVersion !== 1)return;
  await jobEvents(job,event.params.jobKey,'intake',`intake:${event.params.jobKey}`);
});
exports.onRecoveryStatus = onValueUpdated(trigger,async event => {
  const before=event.data.before.val(),job=event.data.after.val();
  if(before.status === job.status || archived(job))return;
  const kind=job.status === 'Ready for Collection' ? 'collection' : 'update';
  await jobEvents(job,event.params.jobKey,kind,`status:${event.id}`);
});
exports.onTaskReassigned = onValueUpdated({ref:'/tasks/{taskKey}',instance:'wiscodery-forensic-default-rtdb',retry:true},async event=>{
  const task=event.data.after.val(),before=event.data.before.val();
  if(task.assignedTo && task.assignedTo!==before.assignedTo && !task.archived && !task.archivedAt && task.status!=='completed')await pushEvents(`task-reassigned:${event.id}`,[task.assignedTo],{kind:'task',taskKey:event.params.taskKey});
});
exports.onTaskAssigned = onValueCreated({ref:'/tasks/{taskKey}',instance:'wiscodery-forensic-default-rtdb',retry:true},async event => {
  const task=event.data.val();if(task.assignedTo && !task.archived && !task.archivedAt && task.status !== 'completed')await pushEvents(`task:${event.params.taskKey}`,[task.assignedTo],{kind:'task',taskKey:event.params.taskKey});
});

async function requestJson(url,init) {
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});
  if(!response.ok){const error=new Error(`Provider returned HTTP ${response.status}`);error.httpStatus=response.status;throw error;}
  return response.json();
}
async function sendClient(event,c) {
  const job=await read(`jobs/${event.jobKey}`);
  if(archived(job) || (event.kind==='collection' && job.status!=='Ready for Collection'))return {status:'cancelled'};
  const prefs=job.notificationPrefs,route=channel(prefs,c);
  if(event.kind==='collection') {
    const history=await read(`communications/${job.customerId}`);
    if(Object.values(history || {}).some(x=>x.jobKey===event.jobKey && ['Collection reminder','Automatic collection reminder'].includes(x.type) && Number(x.createdAt)>=event.createdAt))return {status:'cancelled',reason:'A newer collection contact has been recorded'};
  }
  if(route.blocked)return {status:'blocked',reason:route.blocked,dueAt:Date.now()+60*60*1000};
  const customer=await read(`customers/${job.customerId}`) || {};
  const company=await read('settings/company') || {};
  const caseId=job.jobId || event.jobKey;
  let pdf;
  if(event.kind==='intake') {
    const devices=await Promise.all(Object.keys(job.deviceIds || {}).map(key=>read(`devices/${key}`)));
    pdf=await intakePdf({job:{...job,jobId:caseId},customer,company,devices:devices.filter(Boolean)});
  }
  const message=event.kind==='intake' ? `We have received your device(s). Your case reference is ${caseId}. Your intake confirmation is attached.` : `Your device for case ${caseId} is ready for collection. Please contact us to arrange pickup.`;
  if(route.channel==='email') {
    const result=await requestJson('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${c.email.apiKey}`,'Content-Type':'application/json','Idempotency-Key':event.deliveryId},body:JSON.stringify({from:c.email.from,to:[route.to],subject:`${company.name || 'WISCODE'} · ${event.kind==='intake' ? 'Device intake' : 'Ready for collection'} · ${caseId}`,text:`Hello ${customer.fullName || 'there'},\n\n${message}\n\n${company.name || 'WISCODE'}${company.phone ? '\n'+company.phone : ''}`,attachments:pdf?[{filename:`${caseId}-intake.pdf`,content:pdf.toString('base64')}]:undefined})});
    return {status:'accepted',channel:'email',providerId:result.id || ''};
  }
  let mediaId;
  const version=c.whatsapp.apiVersion || 'v23.0';
  if(!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(c.whatsapp.phoneNumberId))throw new Error('Invalid WhatsApp connection settings');
  if(pdf) {
    const form=new FormData();form.append('messaging_product','whatsapp');form.append('type','application/pdf');form.append('file',new Blob([pdf],{type:'application/pdf'}),`${caseId}-intake.pdf`);
    mediaId=(await requestJson(`https://graph.facebook.com/${version}/${c.whatsapp.phoneNumberId}/media`,{method:'POST',headers:{Authorization:`Bearer ${c.whatsapp.token}`},body:form})).id;
  }
  const components=[];
  if(mediaId)components.push({type:'header',parameters:[{type:'document',document:{id:mediaId,filename:`${caseId}-intake.pdf`}}]});
  components.push({type:'body',parameters:[{type:'text',text:customer.fullName || 'Client'},{type:'text',text:caseId}]});
  const result=await requestJson(`https://graph.facebook.com/${version}/${c.whatsapp.phoneNumberId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${c.whatsapp.token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:route.to,type:'template',template:{name:c.whatsapp.templates[event.kind],language:{code:c.whatsapp.language || 'en'},components}})});
  return {status:'accepted',channel:'whatsapp',providerId:result.messages?.[0]?.id || ''};
}
async function sendPush(event,c) {
  if(!await canReceive(event.uid,event))return {status:'cancelled'};
  if(!c.vapid?.publicKey || !c.vapid?.privateKey)return {status:'blocked',reason:'Push setup is incomplete',dueAt:Date.now()+60*60*1000};
  const docs=await subs(event.uid).get();if(docs.empty)return {status:'skipped',reason:'No device has enabled notifications'};
  const bodies={intake:'A device intake has been recorded. Open RecoveryDesk for details.',collection:'A device is ready for collection. Open RecoveryDesk for details.',update:'A recovery case has an update. Open RecoveryDesk for details.',task:'A task needs your attention. Open RecoveryDesk for details.',test:'Background notifications are working.'};
  const results=await Promise.all(docs.docs.map(async d=>{
    const s=d.data();if(!validSubscription(s)){await d.ref.delete();return true;}
    try {await webpush.sendNotification(s,JSON.stringify({title:'RecoveryDesk',body:bodies[event.kind] || bodies.update,tag:event.deliveryId,url:'./'}),{vapidDetails:{subject:c.vapid.subject || 'https://wiscodery-forensic.web.app',publicKey:c.vapid.publicKey,privateKey:c.vapid.privateKey},timeout:15000,TTL:86400,topic:event.deliveryId.slice(0,32)});return true;}
    catch(error){if([404,410].includes(error.statusCode)){await d.ref.delete();return true;}return false;}
  }));
  if(results.some(x=>!x))throw new Error('Some push devices could not be reached');
  return {status:'accepted',channel:'push'};
}
exports.deliverNotifications = onSchedule({...options,schedule:'every 1 minutes',maxInstances:1},async()=>{
  const c=config(),time=Date.now();
  const docs=await outbox.where('dueAt','<=',time).limit(20).get();
  for(const d of docs.docs) {
    let event;
    await store.runTransaction(async tx=>{
      event=undefined;
      const snap=await tx.get(d.ref),x=snap.data();
      if(!x || x.dueAt>time || (x.leaseUntil || 0)>time || !['pending','retry','blocked','sending'].includes(x.status))return;
      // WhatsApp has no send idempotency key: never automatically repeat an interrupted send.
      if(x.status==='sending' && x.transport==='client' && x.channel==='whatsapp'){tx.update(d.ref,{status:'review',reason:'Interrupted WhatsApp send; check delivery before resending',dueAt:FieldValue.delete(),leaseUntil:FieldValue.delete()});return;}
      event={...x,deliveryId:d.id};
      const route=x.transport==='client'?channel((await read(`jobs/${x.jobKey}`))?.notificationPrefs,c):{};
      tx.update(d.ref,{status:'sending',channel:route.channel || x.channel || '',leaseUntil:time+180000});
    });
    if(!event)continue;
    try {
      const result=event.transport==='push'?await sendPush(event,c):await sendClient(event,c);
      await d.ref.update({...result,updatedAt:Date.now(),leaseUntil:FieldValue.delete(),dueAt:result.dueAt || FieldValue.delete()});
      if(result.status==='accepted' && event.transport==='client') {
        const log=db.ref(`communications/${event.customerId}/${d.id}`);
        await log.set({type:event.kind==='intake'?'Device received notice':'Automatic collection reminder',jobKey:event.jobKey,note:`${result.channel} provider accepted the service message`,createdAt:Date.now(),createdBy:'notification-service'}).catch(()=>console.warn('Communication log pending for accepted delivery',d.id));
      }
    }catch(error){
      const route=event.transport==='client'?channel((await read(`jobs/${event.jobKey}`))?.notificationPrefs,c):{};
      const attempts=(event.attempts || 0)+1;
      const review=route.channel==='whatsapp' && (!error.httpStatus || error.httpStatus>=500);
      const terminal=review || attempts>=5 || (error.httpStatus>=400 && error.httpStatus<500 && error.httpStatus!==429);
      await d.ref.update({status:review?'review':terminal?'failed':'retry',reason:review?'WhatsApp delivery uncertain; check provider before resending':error.httpStatus?`Provider returned HTTP ${error.httpStatus}`:'Delivery could not be completed',attempts,leaseUntil:FieldValue.delete(),dueAt:terminal?FieldValue.delete():Date.now()+retryDelay(attempts),updatedAt:Date.now()});
    }
  }
});
exports.dailyRecoveryReminders = onSchedule({schedule:'0 9 * * *',timeZone:'Africa/Lagos'},async()=>{
  const [jobs,tasks,history,users]=await Promise.all([read('jobs'),read('tasks'),read('communications'),read('users')]);
  const time=Date.now(),date=new Date(time).toLocaleDateString('en-CA',{timeZone:'Africa/Lagos'});
  for(const [jobKey,record] of Object.entries(jobs || {})) {
    const job={...record,key:jobKey};
    if(collectionDue(job,history?.[job.customerId],time))await jobEvents(job,jobKey,'collection',`collection-week:${jobKey}:${Math.floor(time/(7*DAY))}`);
  }
  for(const [taskKey,task] of Object.entries(tasks || {})) {
    if(task.archivedAt || task.archived || task.status==='completed' || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt || '') || task.dueAt>date)continue;
    const uids=Object.entries(users || {}).filter(([uid,u])=>u.active!==false && (uid===task.assignedTo || ['owner','admin','subadmin'].includes(u.role))).map(([uid])=>uid);
    await pushEvents(`task-due:${taskKey}:${date}`,uids,{kind:'task',taskKey});
  }
});
