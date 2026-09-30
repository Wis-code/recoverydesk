// Run in your own signed-in Cloud Shell. Secrets are entered there, never in chat.
const {execFileSync}=require('node:child_process');
const {createInterface}=require('node:readline/promises');
const {Writable}=require('node:stream');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const project='wiscodery-forensic',secret='RECOVERYDESK_NOTIFICATIONS';
let muted=false;const output=new Writable({write(chunk,encoding,cb){if(!muted)process.stdout.write(chunk,encoding);cb();}});
const rl=createInterface({input:process.stdin,output,terminal:true});
async function ask(label,hidden=false){process.stdout.write(label+': ');muted=hidden;try{return (await rl.question('')).trim();}finally{muted=false;if(hidden)process.stdout.write('\n');}}
(async()=>{
 const config=JSON.parse(execFileSync('gcloud',['secrets','versions','access','latest','--secret',secret,'--project',project],{encoding:'utf8',stdio:['ignore','pipe','inherit']}));
 const mode=await ask('Connect email or whatsapp');
 if(mode==='email') {
  const from=await ask('Verified sender (Business <address@yourdomain>)');
  const apiKey=await ask('Resend API key',true);
  if(!from.includes('@') || !apiKey)throw new Error('Sender and API key required');
  config.email={from,apiKey};
 }else if(mode==='whatsapp') {
  const phoneNumberId=await ask('WhatsApp Business phone number ID');
  const apiVersion=await ask('Supported Graph API version (for example v23.0)');
  const language=await ask('Approved template language code');
  const intake=await ask('Approved intake template name (document header; client name and case number body parameters)');
  const collection=await ask('Approved collection template name (client name and case number body parameters)');
  const token=await ask('WhatsApp Business access token',true);
  if(!/^\d+$/.test(phoneNumberId) || !/^v\d+\.\d+$/.test(apiVersion) || !language || !intake || !collection || !token)throw new Error('Complete WhatsApp settings required');
  config.whatsapp={phoneNumberId,apiVersion,language,templates:{intake,collection},token};
 }else throw new Error('Enter email or whatsapp');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd-notify-')),file=path.join(dir,'config.json');
 try {fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});execFileSync('gcloud',['secrets','versions','add',secret,'--project',project,'--data-file',file],{stdio:'inherit'});}finally{fs.rmSync(dir,{recursive:true,force:true});}
 console.log('Connection saved. Run bash scripts/deploy-notifications.sh to activate the new secret version.');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>rl.close());
