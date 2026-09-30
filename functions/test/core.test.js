const {test}=require('node:test');const assert=require('node:assert/strict');
const {channel,staffRecipients,clientRecipients,collectionDue,validSubscription,DAY}=require('../core');
const {intakePdf}=require('../intake-pdf');
test('WhatsApp requires explicit consent and a connected provider',()=>{
  const prefs={requested:true,phone:'08012345678',channel:'whatsapp'};
  const config={whatsapp:{token:'test',phoneNumberId:'123',templates:{intake:'intake',collection:'collection'}}};
  assert.ok(channel(prefs,config).blocked);assert.equal(channel({...prefs,whatsappConsent:true},config).to,'2348012345678');
  assert.ok(channel({...prefs,whatsappConsent:true},{}).blocked);
});
test('email preference never silently switches to WhatsApp',()=>{
  assert.ok(channel({requested:true,email:'client@example.com',whatsappConsent:true,phone:'08012345678'},{}).blocked);
  assert.equal(channel({requested:true,email:'client@example.com'}, {email:{apiKey:'test',from:'test'}}).channel,'email');
  assert.ok(channel({requested:false},{}).blocked);
});
test('only active assigned staff and linked clients receive case alerts',()=>{
  assert.deepEqual(staffRecipients({a:{role:'admin'},b:{role:'worker'},c:{role:'worker',active:false},d:{role:'worker'}},{assignedTo:'b',createdBy:'c'}),['a','b']);
  assert.deepEqual(clientRecipients({a:{customerId:'1'},b:{customerId:'2'},c:{customerId:'1',active:false}},'1'),['a']);
});
test('collection reminders wait seven days and ignore archived and test records',()=>{
  const job={key:'case',status:'Ready for Collection',collectionReadyAt:DAY};
  assert.equal(collectionDue(job,{},8*DAY),true);assert.equal(collectionDue({...job,archived:true},{},8*DAY),false);
  assert.equal(collectionDue({...job,testRecord:true},{},8*DAY),false);
  assert.equal(collectionDue(job,{a:{jobKey:'case',type:'Collection reminder',createdAt:7*DAY}},8*DAY),false);
});
test('push endpoint validation blocks arbitrary URLs and credentials',()=>{
 const keys={p256dh:'a'.repeat(87),auth:'b'.repeat(22)};
 assert.equal(validSubscription({endpoint:'https://fcm.googleapis.com/send/test',keys}),true);
 for(const endpoint of ['http://fcm.googleapis.com/x','https://localhost/x','https://fcm.googleapis.com.evil.test/x','https://user@fcm.googleapis.com/x'])assert.equal(validSubscription({endpoint,keys}),false);
});
test('intake sheet is a PDF and tolerates missing optional client data',async()=>{
 const pdf=await intakePdf({job:{jobId:'CASE-001',createdAt:Date.now()},customer:{phone:'08012345678'},company:{name:'WISCODE'},devices:[{type:'HDD',brandModel:'Test',capacity:'1TB'}]});
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);
});
