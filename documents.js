import { icon } from "./icons.js";

export function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatDate(value, includeTime = false) {
  if (!value) return "—";
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }
  ).format(date);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

export function buildDocumentHtml({ type, number, company, customer, job, devices = [], payments = [] }) {
  const logo = "./logo.png";
  const title = {
    invoice: "INVOICE",
    receipt: "RECEIPT",
    agreement: "DATA RECOVERY SERVICE AGREEMENT"
  }[type] || "DOCUMENT";

  const deviceRows = devices.length
    ? devices.map((device, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(device.type || "Storage device")}</td>
          <td>${escapeHtml(device.brandModel || "—")}</td>
          <td>${escapeHtml(device.capacity || "—")}</td>
          <td>${escapeHtml(device.serial || "—")}</td>
        </tr>`).join("")
    : `<tr><td colspan="5">No device details recorded.</td></tr>`;

  const assessment = Number(job?.assessmentFee || 0);
  const recovery = Number(job?.recoveryQuote || 0);
  const discount = Number(job?.discount || 0);
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const total = Math.max(0, assessment + recovery - discount);
  const balance = Math.max(0, total - paid);

  let body = "";

  if (type === "invoice") {
    body = `
      <section class="doc-section">
        <div class="doc-two">
          <div>
            <span class="doc-label">Bill to</span>
            <strong>${escapeHtml(customer?.fullName || job?.customerNameSnapshot || "Customer")}</strong>
            <div>${escapeHtml(customer?.phone || "")}</div>
            <div>${escapeHtml(customer?.email || "")}</div>
          </div>
          <div>
            <span class="doc-label">Job reference</span>
            <strong>${escapeHtml(job?.jobId || "—")}</strong>
          </div>
        </div>
      </section>
      <section class="doc-section">
        <table class="doc-table">
          <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
          <tbody>
            ${assessment ? `<tr><td>Assessment / diagnostic service</td><td class="right">${formatMoney(assessment)}</td></tr>` : ""}
            ${recovery ? `<tr><td>Data recovery service</td><td class="right">${formatMoney(recovery)}</td></tr>` : ""}
            ${discount ? `<tr><td>Discount</td><td class="right">-${formatMoney(discount)}</td></tr>` : ""}
          </tbody>
          <tfoot>
            <tr><th>Total</th><th class="right">${formatMoney(total)}</th></tr>
            <tr><td>Paid</td><td class="right">${formatMoney(paid)}</td></tr>
            <tr><th>Balance due</th><th class="right">${formatMoney(balance)}</th></tr>
          </tfoot>
        </table>
      </section>
      <section class="doc-section">
        <span class="doc-label">Devices covered</span>
        <table class="doc-table compact">
          <thead><tr><th>#</th><th>Type</th><th>Brand / model</th><th>Capacity</th><th>Serial</th></tr></thead>
          <tbody>${deviceRows}</tbody>
        </table>
      </section>`;
  }

  if (type === "receipt") {
    const payment = payments[payments.length - 1] || {};
    const isRefund = Number(payment.amount || 0) < 0 || payment.category === "Refund";
    body = `
      <section class="doc-section">
        <div class="receipt-amount">${formatMoney(Math.abs(Number(payment.amount || paid)))}</div>
        <p>${isRefund ? "Refunded to" : "Received from"} <strong>${escapeHtml(customer?.fullName || job?.customerNameSnapshot || "Customer")}</strong>
        in respect of <strong>${escapeHtml(job?.jobId || "data recovery service")}</strong>.</p>
        <div class="doc-two">
          <div><span class="doc-label">Payment method</span><strong>${escapeHtml(payment.method || "—")}</strong></div>
          <div><span class="doc-label">Payment reference</span><strong>${escapeHtml(payment.reference || "—")}</strong></div>
        </div>
      </section>`;
  }

  if (type === "agreement") {
    const signer = job?.signerName || customer?.fullName || "________________";
    const submitter = job?.submitterName || customer?.fullName || "________________";
    const owner = job?.ownerName || customer?.fullName || "________________";
    body = `
      <section class="doc-section agreement-copy">
        <p>This agreement is between <strong>${escapeHtml(company?.name || "WISCODE INNOVATIONS LTD")}</strong>
        ("the Company") and <strong>${escapeHtml(customer?.fullName || "the Client")}</strong> concerning the storage device(s)
        listed below under job <strong>${escapeHtml(job?.jobId || "—")}</strong>.</p>

        <table class="doc-table compact">
          <thead><tr><th>#</th><th>Type</th><th>Brand / model</th><th>Capacity</th><th>Serial</th></tr></thead>
          <tbody>${deviceRows}</tbody>
        </table>

        <h3>Authorization</h3>
        <p>The signer confirms that they are the device owner or have lawful authority from the owner to request assessment
        and data-recovery services. The Company is authorized to inspect, connect, test, diagnose and perform reasonable
        recovery procedures on the submitted device(s).</p>

        <h3>Assessment and recovery</h3>
        <p>The assessment determines the apparent condition of the device and whether recovery appears feasible.
        Data recovery cannot be guaranteed, and particular files may remain unavailable, incomplete or corrupt.</p>

        <h3>Risk acknowledgement</h3>
        <p>Damaged or unstable storage devices may deteriorate or fail during reasonable assessment or recovery attempts.
        The Client accepts risks arising from the device's pre-existing condition. Nothing in this agreement excludes
        liability where exclusion is prohibited by applicable law.</p>

        <h3>Payment</h3>
        <p>The assessment fee is ${formatMoney(job?.assessmentFee || 0)}.
        Any additional recovery fee will be communicated for approval before chargeable recovery work proceeds.
        Unless otherwise agreed, recovered data and/or the device may be released after applicable charges are paid.</p>

        <h3>Confidentiality</h3>
        <p>The Company may access files only as reasonably necessary to diagnose the device, perform recovery and verify results,
        and will take reasonable steps to protect confidential or personal information encountered during the service.</p>

        <div class="doc-three identity-block">
          <div><span class="doc-label">Device owner</span><strong>${escapeHtml(owner)}</strong></div>
          <div><span class="doc-label">Submitted by</span><strong>${escapeHtml(submitter)}</strong></div>
          <div><span class="doc-label">Authorization signed by</span><strong>${escapeHtml(signer)}</strong></div>
        </div>

        <div class="signature-block">
          <div><span>Client / authorized signer</span><div class="signature-line"></div></div>
          <div><span>Date</span><div class="signature-line"></div></div>
          <div><span>Receiving staff</span><div class="signature-line"></div></div>
          <div><span>Date</span><div class="signature-line"></div></div>
        </div>
      </section>`;
  }

  return `
    <article class="generated-document">
      <header class="doc-header">
        <div class="doc-brand">
          <img src="${logo}" alt="">
          <div>
            <strong>${escapeHtml(company?.name || "WISCODE INNOVATIONS LTD")}</strong>
            <span>RC ${escapeHtml(company?.registrationNumber || "9656932")}</span>
            ${company?.address ? `<span>${escapeHtml(company.address)}</span>` : ""}
            ${company?.phone ? `<span>${escapeHtml(company.phone)}</span>` : ""}
            ${company?.email ? `<span>${escapeHtml(company.email)}</span>` : ""}
          </div>
        </div>
        <div class="doc-title">
          <h1>${title}</h1>
          <strong>${escapeHtml(number || "")}</strong>
          <span>${formatDate(Date.now())}</span>
        </div>
      </header>
      ${body}
      <footer class="doc-footer">
        Generated by RecoveryDesk · ${escapeHtml(company?.name || "WISCODE INNOVATIONS LTD")}
      </footer>
    </article>`;
}

export function openPrintableDocument(payload) {
  const host = document.getElementById("documentHost");
  host.innerHTML = `
    <div class="document-overlay">
      <div class="document-actions no-print">
        <button class="button secondary" data-doc-close>${icon("close", 18)} Close</button>
        <button class="button secondary" data-doc-share>${icon("link", 18)} Share</button><button class="button primary" data-doc-print>${icon("download", 18)} Print / Save PDF</button>
      </div>
      ${buildDocumentHtml(payload)}
    </div>`;

  host.querySelector("[data-doc-close]").onclick = () => host.replaceChildren();
  host.querySelector("[data-doc-print]").onclick = () => window.print();
  host.querySelector("[data-doc-share]").onclick = async () => {
    const title = `${payload.type || "RecoveryDesk document"} ${payload.number || ""}`.trim();
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${title} · WISCODE INNOVATIONS LTD` });
      } catch {}
    } else {
      alert("Use Print / Save PDF, then share the saved PDF from your device.");
    }
  };
}
