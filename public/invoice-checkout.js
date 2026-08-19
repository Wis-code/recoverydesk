import { auth, db, BOOTSTRAP_ADMIN_UID, ref, get, update, push, set } from "./firebase.js";

const money = value => new Intl.NumberFormat("en-NG", {
  style: "currency", currency: "NGN", maximumFractionDigits: 0
}).format(Number(value || 0));

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

function currentJobId() {
  const heading = document.querySelector(".page-head h1");
  const value = heading?.textContent?.trim() || "";
  return /^DR-\d{4}-\d+$/i.test(value) ? value : "";
}

async function resolveJob() {
  const jobId = currentJobId();
  if (!jobId) return null;
  const snapshot = await get(ref(db, "jobs"));
  const jobs = snapshot.val() || {};
  for (const [key, value] of Object.entries(jobs)) {
    if ((value?.jobId || key) === jobId) return { key, ...(value || {}) };
  }
  return null;
}

async function currentRole() {
  const user = auth.currentUser;
  if (!user) return "";
  if (user.uid === BOOTSTRAP_ADMIN_UID) return "owner";
  const snap = await get(ref(db, `users/${user.uid}`));
  return snap.val()?.role || "";
}

function canEditDiscount(role) {
  return ["owner","admin","subadmin"].includes(role);
}

async function paidForJob(jobKey) {
  const snap = await get(ref(db, "payments"));
  const payments = snap.val() || {};
  return Object.values(payments)
    .filter(p => p?.jobKey === jobKey && p?.status !== "void")
    .reduce((sum, p) => sum + Number(p?.amount || 0), 0);
}

function closeModal() {
  document.getElementById("modalHost")?.replaceChildren();
}

function updatePreview({ job, paid }) {
  const discount = Math.max(0, Number(document.getElementById("invoiceCheckoutDiscount")?.value || 0));
  const diagnostic = Math.max(0, Number(job.assessmentFee || 0));
  const recovery = Math.max(0, Number(job.recoveryQuote || 0));
  const subtotal = diagnostic + recovery;
  const finalTotal = Math.max(0, subtotal - discount);
  const balance = Math.max(0, finalTotal - paid);

  const el = document.getElementById("invoiceCheckoutPreview");
  if (!el) return;
  el.innerHTML = `
    <div class="form-grid">
      <div class="detail-item"><span>Diagnostic / assessment</span><strong>${money(diagnostic)}</strong></div>
      <div class="detail-item"><span>Recovery service</span><strong>${money(recovery)}</strong></div>
      <div class="detail-item"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
      <div class="detail-item"><span>Discount</span><strong>-${money(discount)}</strong></div>
      <div class="detail-item"><span>Final invoice total</span><strong>${money(finalTotal)}</strong></div>
      <div class="detail-item"><span>Already paid</span><strong>${money(paid)}</strong></div>
      <div class="detail-item"><span>Balance due</span><strong>${money(balance)}</strong></div>
    </div>`;
}

async function auditDiscount(job, before, after) {
  if (before === after) return;
  try {
    const user = auth.currentUser;
    if (!user) return;
    const item = push(ref(db, "audit"));
    await set(item, {
      actorUid: user.uid,
      actorName: user.displayName || user.email || "Administrator",
      action: "changed invoice discount",
      entityType: "job",
      entityId: job.jobId || job.key,
      summary: `Invoice checkout discount changed from ${money(before)} to ${money(after)}.`,
      createdAt: Date.now()
    });
  } catch (error) {
    console.warn("Discount audit write failed", error);
  }
}

async function openInvoiceCheckout(originalButton) {
  const [job, role] = await Promise.all([resolveJob(), currentRole()]);
  if (!job) {
    originalButton.dataset.invoiceCheckoutBypass = "1";
    originalButton.click();
    delete originalButton.dataset.invoiceCheckoutBypass;
    return;
  }

  const paid = await paidForJob(job.key);
  const editable = canEditDiscount(role);
  const currentDiscount = Math.max(0, Number(job.discount || 0));
  const diagnostic = Math.max(0, Number(job.assessmentFee || 0));
  const recovery = Math.max(0, Number(job.recoveryQuote || 0));
  const subtotal = diagnostic + recovery;

  const host = document.getElementById("modalHost");
  if (!host) return;

  host.innerHTML = `
    <div class="modal-backdrop" id="invoiceCheckoutBackdrop">
      <section class="modal" role="dialog" aria-modal="true">
        <header class="modal-head">
          <div>
            <h2>Invoice checkout</h2>
            <p>${esc(job.jobId || job.key)} · Review the commercial total before generating the invoice.</p>
          </div>
          <button class="ghost close-button" id="invoiceCheckoutClose" type="button">×</button>
        </header>
        <div class="modal-body">
          <div class="notice info">
            The diagnostic fee remains part of the final invoice total. The pricing engine stores the recovery charge after the diagnostic credit so it is not charged twice.
          </div>

          <label class="field" style="margin-top:14px">
            <span>Discount (₦)</span>
            <input id="invoiceCheckoutDiscount" type="number" min="0" step="500"
              value="${currentDiscount}" ${editable ? "" : "readonly"}>
            <small>${editable
              ? "Owner/Admin/Sub-Admin may apply the final commercial discount here before the invoice is generated."
              : "Only Owner/Admin/Sub-Admin can change the invoice discount."}</small>
          </label>

          <div id="invoiceCheckoutPreview" style="margin-top:14px"></div>

          ${subtotal <= 0 ? `<div class="notice warning" style="margin-top:12px">This job currently has no billable diagnostic or recovery amount.</div>` : ""}
        </div>
        <footer class="modal-actions">
          <button class="secondary" id="invoiceCheckoutCancel">Cancel</button>
          <button class="primary" id="invoiceCheckoutGenerate">Generate invoice</button>
        </footer>
      </section>
    </div>`;

  updatePreview({ job, paid });

  const discountInput = document.getElementById("invoiceCheckoutDiscount");
  discountInput?.addEventListener("input", () => updatePreview({ job, paid }));

  document.getElementById("invoiceCheckoutClose").onclick = closeModal;
  document.getElementById("invoiceCheckoutCancel").onclick = closeModal;
  document.getElementById("invoiceCheckoutBackdrop").onclick = event => {
    if (event.target.id === "invoiceCheckoutBackdrop") closeModal();
  };

  document.getElementById("invoiceCheckoutGenerate").onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Preparing invoice…";

    try {
      let nextDiscount = currentDiscount;
      if (editable) {
        nextDiscount = Math.max(0, Number(discountInput?.value || 0));
        if (nextDiscount > subtotal) {
          throw new Error("Discount cannot be greater than the invoice subtotal.");
        }

        if (nextDiscount !== currentDiscount) {
          await update(ref(db, `jobs/${job.key}`), {
            discount: nextDiscount,
            discountUpdatedAt: Date.now(),
            discountUpdatedBy: auth.currentUser?.uid || "",
            updatedAt: Date.now()
          });
          await auditDiscount(job, currentDiscount, nextDiscount);
        }
      }

      closeModal();

      setTimeout(() => {
        originalButton.dataset.invoiceCheckoutBypass = "1";
        originalButton.click();
        delete originalButton.dataset.invoiceCheckoutBypass;
      }, editable && nextDiscount !== currentDiscount ? 350 : 0);
    } catch (error) {
      alert(error?.message || "Invoice checkout could not be completed.");
      button.disabled = false;
      button.textContent = "Generate invoice";
    }
  };
}

document.addEventListener("click", event => {
  const button = event.target.closest("#jobInvoiceBtn, #generateInvoice");
  if (!button) return;
  if (button.dataset.invoiceCheckoutBypass === "1") return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openInvoiceCheckout(button).catch(error => {
    console.error(error);
    alert("Invoice checkout could not be opened.");
  });
}, true);
