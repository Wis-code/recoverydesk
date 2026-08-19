import { auth, db, ref, get, update, push, set } from "./firebase.js";

const VERSION = "1.0";
const DEFAULT_DIAGNOSTIC_FEE = 2000;
const BASE = { R0: 10000, R1: 25000, R2: 40000, R3: 60000 };
const CLASS_LABELS = {
  R0: "Healthy media / extraction",
  R1: "Basic logical recovery",
  R2: "Advanced logical recovery",
  R3: "Degraded-media / controlled imaging",
  R4: "Electronics / soldering / PCB intervention — escalate",
  R5: "Heads / mechanical / clean-room intervention — escalate"
};
const PROGNOSIS = {
  P1: "Excellent",
  P2: "Good",
  P3: "Fair / partial likely",
  P4: "Poor",
  P5: "Indeterminate"
};
const CAPACITY_LABELS = {
  le500: "≤ 500GB",
  to1tb: "501GB–1TB",
  two: "2TB",
  threeFour: "3–4TB",
  fiveEight: "5–8TB",
  overEight: "> 8TB"
};

const imagingHealthy = { le500: 0, to1tb: 0, two: 5000, threeFour: 10000, fiveEight: 20000 };
const imagingDegraded = { le500: 5000, to1tb: 10000, two: 15000, threeFour: 25000, fiveEight: 40000 };

const money = value => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(value || 0));
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const numberValue = id => Math.max(0, Number(document.getElementById(id)?.value || 0));
const textValue = id => String(document.getElementById(id)?.value || "").trim();

function currentJobId() {
  const heading = document.querySelector(".page-head h1");
  const value = heading?.textContent?.trim() || "";
  return /^DR-\d{4}-\d+$/i.test(value) ? value : "";
}

async function loadCurrentJob() {
  const jobId = currentJobId();
  if (!jobId) return null;
  const snapshot = await get(ref(db, "jobs"));
  const jobs = snapshot.val() || {};
  for (const [key, value] of Object.entries(jobs)) {
    if ((value?.jobId || key) === jobId) return { key, ...(value || {}) };
  }
  return null;
}

function toast(message, type = "") {
  const host = document.getElementById("toastHost");
  if (!host) return alert(message);
  const item = document.createElement("div");
  item.className = `toast ${type}`.trim();
  item.textContent = message;
  host.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function closePricingModal() {
  const modalHost = document.getElementById("modalHost");
  if (modalHost) modalHost.replaceChildren();
}

function selected(id) {
  return document.getElementById(id)?.value || "";
}

function calculateFromForm(job) {
  const classCode = selected("pfClass");
  const prognosis = selected("pfPrognosis") || "P5";
  const capacity = selected("pfCapacity") || "to1tb";
  const previousAttempt = numberValue("pfPreviousAttempt");
  const encryption = numberValue("pfEncryption");
  const architecture = numberValue("pfArchitecture");
  const otherComplexity = numberValue("pfOtherComplexity");
  const externalCosts = numberValue("pfExternal");
  const urgencyPct = Number(selected("pfUrgency") || 0);
  const assessmentRaw = Number(job?.assessmentFee);
  const diagnosticFee = Number.isFinite(assessmentRaw) && assessmentRaw > 0 ? assessmentRaw : DEFAULT_DIAGNOSTIC_FEE;

  if (["R4", "R5"].includes(classCode)) {
    return {
      escalationRequired: true,
      classCode,
      prognosis,
      diagnosticFee,
      capacity,
      criticalData: textValue("pfCriticalData"),
      notes: textValue("pfNotes")
    };
  }

  if (capacity === "overEight") {
    return { manualReviewRequired: true, classCode, prognosis, diagnosticFee, capacity };
  }

  const baseRecovery = BASE[classCode] || 0;
  const degraded = classCode === "R3";
  const imagingWork = (degraded ? imagingDegraded : imagingHealthy)[capacity] || 0;
  const complexity = previousAttempt + encryption + architecture + otherComplexity;
  const professionalSubtotal = baseRecovery + imagingWork + complexity;
  const urgency = Math.round(professionalSubtotal * urgencyPct / 100);
  const rawTotal = professionalSubtotal + urgency + externalCosts;
  const totalQuote = Math.max(0, Math.round(rawTotal / 1000) * 1000);
  const recoveryChargeAfterDiagnosticCredit = Math.max(0, totalQuote - diagnosticFee);

  return {
    escalationRequired: false,
    manualReviewRequired: false,
    classCode,
    classLabel: CLASS_LABELS[classCode],
    prognosis,
    prognosisLabel: PROGNOSIS[prognosis],
    capacity,
    capacityLabel: CAPACITY_LABELS[capacity],
    diagnosticFee,
    baseRecovery,
    imagingWork,
    previousAttempt,
    encryption,
    architecture,
    otherComplexity,
    complexity,
    professionalSubtotal,
    urgencyPct,
    urgency,
    externalCosts,
    rawTotal,
    totalQuote,
    diagnosticCredit: diagnosticFee,
    recoveryChargeAfterDiagnosticCredit,
    criticalData: textValue("pfCriticalData"),
    notes: textValue("pfNotes")
  };
}

function renderPreview(job) {
  const box = document.getElementById("pfPreview");
  if (!box) return;
  const p = calculateFromForm(job);
  if (p.escalationRequired) {
    box.innerHTML = `<div class="notice warning"><strong>${esc(p.classCode)} — ${esc(CLASS_LABELS[p.classCode])}</strong><br>Automatic recovery pricing stops here. Save this as a specialist escalation; no in-house recovery quote will be issued.</div>`;
    return;
  }
  if (p.manualReviewRequired) {
    box.innerHTML = `<div class="notice warning"><strong>Manual quotation required</strong><br>Devices above 8TB are outside the automatic V1.0 capacity bands.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="grid two" style="margin-top:12px">
      <div class="panel flat"><span class="eyebrow">Total customer quote</span><strong style="display:block;margin-top:7px;font-size:1.35rem">${money(p.totalQuote)}</strong><span class="tiny muted">Includes diagnostic credit</span></div>
      <div class="panel flat"><span class="eyebrow">Balance after diagnostic</span><strong style="display:block;margin-top:7px;font-size:1.35rem">${money(p.recoveryChargeAfterDiagnosticCredit)}</strong><span class="tiny muted">Before any later payments/discounts</span></div>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <div class="detail-item"><span>Base recovery</span><strong>${money(p.baseRecovery)}</strong></div>
      <div class="detail-item"><span>Imaging/media work</span><strong>${money(p.imagingWork)}</strong></div>
      <div class="detail-item"><span>Added complexity</span><strong>${money(p.complexity)}</strong></div>
      <div class="detail-item"><span>Urgency (${p.urgencyPct}%)</span><strong>${money(p.urgency)}</strong></div>
      <div class="detail-item"><span>External/optional costs</span><strong>${money(p.externalCosts)}</strong></div>
      <div class="detail-item"><span>Diagnostic credit</span><strong>-${money(p.diagnosticCredit)}</strong></div>
    </div>`;
}

async function recordPricingAudit(job, summary) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const auditRef = push(ref(db, "audit"));
    await set(auditRef, {
      actorUid: user.uid,
      actorName: user.displayName || user.email || "Staff",
      action: "generated pricing quote",
      entityType: "job",
      entityId: job.jobId || job.key,
      summary,
      createdAt: Date.now()
    });
  } catch (error) {
    console.warn("Pricing audit write failed", error);
  }
}

async function savePricing(job) {
  const button = document.getElementById("pfSave");
  const p = calculateFromForm(job);
  if (p.manualReviewRequired) {
    toast("This capacity requires manual quotation.", "error");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Saving…";
  }

  try {
    const generatedAt = Date.now();
    const generatedBy = auth.currentUser?.uid || "";
    const pricingRecord = { version: VERSION, ...p, generatedAt, generatedBy };

    if (p.escalationRequired) {
      await update(ref(db, `jobs/${job.key}`), {
        assessmentFee: p.diagnosticFee,
        recoveryQuote: 0,
        assessmentResult: "Further Assessment Required",
        status: "Blocked",
        quoteApproval: null,
        pricing: pricingRecord,
        updatedAt: generatedAt
      });
      await recordPricingAudit(job, `${p.classCode} specialist escalation; automatic quote stopped.`);
      closePricingModal();
      toast("Specialist escalation saved. No in-house recovery quote was issued.", "success");
      return;
    }

    const nextStatus = ["Intake Pending", "Ready for Assessment", "Assessment"].includes(job.status)
      ? "Awaiting Approval"
      : (job.status || "Awaiting Approval");

    await update(ref(db, `jobs/${job.key}`), {
      assessmentFee: p.diagnosticFee,
      recoveryQuote: p.recoveryChargeAfterDiagnosticCredit,
      assessmentResult: "Recovery Appears Feasible",
      status: nextStatus,
      quoteApproval: null,
      pricing: pricingRecord,
      updatedAt: generatedAt
    });

    await recordPricingAudit(job, `${p.classCode}/${p.prognosis}; total quote ${p.totalQuote}; recovery charge after diagnostic credit ${p.recoveryChargeAfterDiagnosticCredit}.`);
    closePricingModal();
    toast(`Pricing saved: ${money(p.totalQuote)} total quote. Customer approval is required.`, "success");
  } catch (error) {
    console.error(error);
    toast(error?.message || "Pricing could not be saved.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Save pricing";
    }
  }
}

async function openPricingEngine() {
  const job = await loadCurrentJob();
  if (!job) return toast("The current RecoveryDesk job could not be resolved.", "error");
  const pricing = job.pricing || {};
  const diagnosticFee = Number(job.assessmentFee) > 0 ? Number(job.assessmentFee) : DEFAULT_DIAGNOSTIC_FEE;
  const modalHost = document.getElementById("modalHost");
  if (!modalHost) return;

  modalHost.innerHTML = `
    <div class="modal-backdrop" id="pfBackdrop">
      <section class="modal wide" role="dialog" aria-modal="true">
        <header class="modal-head">
          <div><h2>Wiscode Forensics Pricing Engine</h2><p>${esc(job.jobId || job.key)} · Algorithm v${VERSION}</p></div>
          <button class="ghost close-button" type="button" id="pfClose">×</button>
        </header>
        <div class="modal-body">
          <div class="notice info"><strong>Diagnostic fee: ${money(diagnosticFee)}</strong><br>The diagnostic is credited into an accepted recovery quote. R4/R5 stop automatic pricing because hardware intervention is outside the current in-house scope.</div>
          <div class="form-grid" style="margin-top:14px">
            <label class="field"><span>Recovery class</span><select id="pfClass">
              ${Object.entries(CLASS_LABELS).map(([code,label]) => `<option value="${code}" ${pricing.classCode === code ? "selected" : ""}>${code} — ${esc(label)}</option>`).join("")}
            </select></label>
            <label class="field"><span>Recovery prognosis</span><select id="pfPrognosis">
              ${Object.entries(PROGNOSIS).map(([code,label]) => `<option value="${code}" ${pricing.prognosis === code ? "selected" : ""}>${code} — ${esc(label)}</option>`).join("")}
            </select><small>Probability is recorded separately from price.</small></label>
            <label class="field"><span>Capacity band</span><select id="pfCapacity">
              ${Object.entries(CAPACITY_LABELS).map(([code,label]) => `<option value="${code}" ${pricing.capacity === code ? "selected" : ""}>${esc(label)}</option>`).join("")}
            </select></label>
            <label class="field"><span>Previous intervention</span><select id="pfPreviousAttempt">
              <option value="0">None / viewing only — ₦0</option>
              <option value="2500" ${pricing.previousAttempt===2500?"selected":""}>Recovery software scan — +₦2,500</option>
              <option value="5000" ${pricing.previousAttempt===5000?"selected":""}>CHKDSK / filesystem repair / major writes — +₦5,000</option>
              <option value="10000" ${pricing.previousAttempt===10000?"selected":""}>Technician modified device — +₦10,000</option>
            </select></label>
            <label class="field"><span>Encryption complexity</span><select id="pfEncryption">
              <option value="0">None / no extra work — ₦0</option>
              <option value="5000" ${pricing.encryption===5000?"selected":""}>Key available, extra processing — +₦5,000</option>
              <option value="10000" ${pricing.encryption===10000?"selected":""}>Damaged/complex encrypted filesystem — +₦10,000</option>
            </select></label>
            <label class="field"><span>Architecture complexity</span><select id="pfArchitecture">
              <option value="0">Standard filesystem — ₦0</option>
              <option value="5000" ${pricing.architecture===5000?"selected":""}>Moderately unusual structure — +₦5,000</option>
              <option value="10000" ${pricing.architecture===10000?"selected":""}>Advanced / DVR-style structure — +₦10,000</option>
              <option value="15000" ${pricing.architecture===15000?"selected":""}>Specialist reconstruction — +₦15,000</option>
            </select></label>
            <label class="field"><span>Other justified complexity (₦)</span><input id="pfOtherComplexity" type="number" min="0" step="500" value="${esc(pricing.otherComplexity || 0)}"><small>Use only for independent work not already counted.</small></label>
            <label class="field"><span>Urgency</span><select id="pfUrgency">
              <option value="0">Standard — +0%</option>
              <option value="25" ${pricing.urgencyPct===25?"selected":""}>Priority — +25%</option>
              <option value="50" ${pricing.urgencyPct===50?"selected":""}>Emergency — +50%</option>
            </select></label>
            <label class="field"><span>External / optional costs (₦)</span><input id="pfExternal" type="number" min="0" step="500" value="${esc(pricing.externalCosts || 0)}"><small>Destination media, courier, disclosed third-party costs. Urgency is not applied to this amount.</small></label>
          </div>
          <label class="field"><span>Customer's critical / priority data</span><textarea id="pfCriticalData" placeholder="E.g. 2024–2026 accounts, Documents folder, family photos">${esc(pricing.criticalData || job.requestedData || "")}</textarea></label>
          <label class="field"><span>Pricing / assessment notes</span><textarea id="pfNotes" placeholder="Technical facts that justify this classification">${esc(pricing.notes || "")}</textarea></label>
          <div id="pfPreview"></div>
        </div>
        <footer class="modal-actions">
          <button class="secondary" id="pfCancel">Cancel</button>
          <button class="primary" id="pfSave">Save pricing</button>
        </footer>
      </section>
    </div>`;

  if (!pricing.classCode) document.getElementById("pfClass").value = "R1";
  if (!pricing.prognosis) document.getElementById("pfPrognosis").value = "P5";
  if (!pricing.capacity) document.getElementById("pfCapacity").value = "to1tb";

  const recalcIds = ["pfClass","pfPrognosis","pfCapacity","pfPreviousAttempt","pfEncryption","pfArchitecture","pfOtherComplexity","pfUrgency","pfExternal","pfCriticalData","pfNotes"];
  recalcIds.forEach(id => document.getElementById(id)?.addEventListener("input", () => renderPreview(job)));
  recalcIds.forEach(id => document.getElementById(id)?.addEventListener("change", () => renderPreview(job)));
  document.getElementById("pfClose").onclick = closePricingModal;
  document.getElementById("pfCancel").onclick = closePricingModal;
  document.getElementById("pfBackdrop").onclick = event => { if (event.target.id === "pfBackdrop") closePricingModal(); };
  document.getElementById("pfSave").onclick = () => savePricing(job);
  renderPreview(job);
}

function installPricingButton() {
  const jobId = currentJobId();
  if (!jobId || document.getElementById("pricingEngineBtn")) return;
  const panels = [...document.querySelectorAll("section.panel")];
  const controlsPanel = panels.find(panel => panel.querySelector("h2")?.textContent?.trim() === "Job controls");
  const head = controlsPanel?.querySelector(".panel-head");
  if (!head) return;
  let actions = head.querySelector(".head-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "head-actions";
    head.appendChild(actions);
  }
  const button = document.createElement("button");
  button.id = "pricingEngineBtn";
  button.className = "secondary";
  button.type = "button";
  button.textContent = "Pricing engine";
  button.onclick = openPricingEngine;
  actions.appendChild(button);
}

let queued = false;
function queueInstall() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    installPricingButton();
  });
}

new MutationObserver(queueInstall).observe(document.getElementById("app"), { childList: true, subtree: true });
window.addEventListener("load", queueInstall);
queueInstall();
