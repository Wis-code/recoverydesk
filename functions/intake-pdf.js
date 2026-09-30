'use strict';
const PDFDocument = require('pdfkit');
function intakePdf({job,customer,devices,company}) {
  return new Promise((resolve,reject) => {
    const doc = new PDFDocument({size:'A4',margin:48,info:{Title:`Intake ${job.jobId}`,Author:company.name || 'RecoveryDesk'}});
    const chunks=[]; doc.on('data',c=>chunks.push(c)); doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.on('error',reject);
    const text = value => String(value || '—').slice(0,1500);
    const line = (label,value) => {doc.font('Helvetica-Bold').fontSize(10).text(label); doc.font('Helvetica').fontSize(11).text(text(value)); doc.moveDown(0.5);};
    doc.font('Helvetica-Bold').fontSize(20).text(company.name || 'WISCODE');
    doc.font('Helvetica').fontSize(10).text(company.registrationNumber ? `RC ${company.registrationNumber}` : 'RecoveryDesk');
    doc.moveDown().font('Helvetica-Bold').fontSize(16).text('DEVICE INTAKE CONFIRMATION');
    doc.moveDown(); line('Case number',job.jobId); line('Received',new Date(job.createdAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}));
    line('Client',customer.fullName); line('Contact',[customer.phone,customer.email].filter(Boolean).join(' / '));
    devices.forEach((d,index)=>{
      if(doc.y > 650)doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).text(`Device ${index+1}`);doc.moveDown(0.3);
      line('Device',[d.type,d.brandModel,d.capacity].filter(Boolean).join(' · '));
      line('Serial / reference',d.serial || d.deviceId);
      line('Condition received',job.deviceSnapshots?.[d.deviceId]?.conditionAtIntake || d.condition);
      line('Reported problem',d.problem || (d.symptoms || []).join(', '));
    });
    if(doc.y > 650)doc.addPage();
    doc.moveDown().font('Helvetica').fontSize(10).text('This confirms receipt of the device(s). It is not a recovery guarantee, payment receipt, or substitute for the signed service authorization. Keep your case number when contacting us.');
    if(company.phone)doc.moveDown().text(`Contact: ${text(company.phone)}`);
    doc.end();
  });
}
module.exports = {intakePdf};
