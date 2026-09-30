import {firebaseApp} from './firebase.js';
import {getFunctions, httpsCallable} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
const functions = getFunctions(firebaseApp, 'europe-west1');
const call = async (name,data={}) => (await httpsCallable(functions,name)(data)).data;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const registration = () => navigator.serviceWorker.ready;
function publicKey(value) {
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export async function disconnectNotifications() {
  if(!supported())return;
  const reg=await registration(),sub=await reg.pushManager.getSubscription();
  if(!sub)return;
  try {await call('removePushSubscription',{endpoint:sub.endpoint});}finally {await sub.unsubscribe();}
}
export async function mountNotifications(host) {
  host.innerHTML='<p role="status">Checking notification setup…</p>';
  let config;
  try {config=await call('notificationConfig');}catch {
    host.innerHTML='<p role="status">Notification service is not connected yet. Your case records remain available.</p>';return;
  }
  host.innerHTML='<p>Get case and task alerts even when RecoveryDesk is closed. This setting applies to this browser.</p><p id="pushStatus" role="status"></p><button class="primary" id="enablePush">Enable on this device</button> <button class="secondary" id="testPush">Send test alert</button> <button class="ghost" id="disablePush">Disable</button><p id="sendingStatus" class="tiny muted"></p>';
  const status=host.querySelector('#pushStatus');
  host.querySelector('#sendingStatus').textContent=`Client intake sheets: email ${config.emailReady?'connected':'needs connection'} · WhatsApp ${config.whatsappReady?'connected':'needs connection'}.`;
  async function refresh() {
    if(!supported()){status.textContent='This browser does not support background notifications.';return;}
    const sub=await (await registration()).pushManager.getSubscription();
    status.textContent=sub?'Enabled in this browser.':'Disabled in this browser.';
  }
  async function action(button,fn) {button.disabled=true;try {await fn();}catch(error){status.textContent=error.message || 'Unable to update notifications.';}finally {button.disabled=false;}}
  host.querySelector('#enablePush').onclick=function(){action(this,async()=>{
    if(!supported() || !config.publicKey)throw new Error('Push setup is incomplete for this browser.');
    if(await Notification.requestPermission()!=='granted')throw new Error('Allow notifications in your browser settings to enable alerts.');
    const reg=await registration();let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey(config.publicKey)});
    try {await call('savePushSubscription',{subscription:sub.toJSON()});}catch(error){await sub.unsubscribe();throw error;}
    await refresh();
  });};
  host.querySelector('#disablePush').onclick=function(){action(this,async()=>{await disconnectNotifications();await refresh();});};
  host.querySelector('#testPush').onclick=function(){action(this,async()=>{if(!supported() || !await (await registration()).pushManager.getSubscription())throw new Error('Enable notifications on this device first.');await call('testPushNotification');status.textContent='Test queued. It should arrive within a minute.';});};
  await refresh();
}

export async function loadDeliveryStatus(host,jobKey) {
  try {
    const {items}=await call('notificationDeliveryStatus',{jobKey});
    host.textContent=items.length ? '' : 'No automatic delivery recorded for this case.';
    for(const item of items.sort((a,b)=>b.createdAt-a.createdAt)) {
      const row=document.createElement('p');
      row.textContent=`${item.kind==='intake'?'Intake sheet':'Collection update'}: ${item.status==='accepted'?'accepted by sending provider':item.status}${item.channel?' via '+item.channel:''}${item.reason?' — '+item.reason:''}`;
      host.append(row);
    }
  }catch {host.textContent='Delivery tracking is not available yet. Connect the notification service first.';}
}
