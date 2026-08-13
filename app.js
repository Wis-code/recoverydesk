
import {
  auth, db, firestore, storage, googleProvider, BOOTSTRAP_ADMIN_UID,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential, linkWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
  ref, get, set, update, remove, push, onValue, runTransaction,
  doc, getDoc, setDoc, deleteDoc,
  storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "./firebase.js";

import { icon } from "./icons.js";
import { formatMoney, formatDate, openPrintableDocument } from "./documents.js";

const DEFAULT_COMPANY = {
  name: "WISCODE INNOVATIONS LTD",
  registrationNumber: "9656932",
  phone: "",
  email: "",
  address: "",
  defaultAssessmentFee: "",
  requireIntakePhotos: false
};

const JOB_STATUSES = [
  "Intake Pending",
  "Ready for Assessment",
  "Assessment",
  "Awaiting Approval",
  "Recovery In Progress",
  "Ready for Collection",
  "Completed",
  "Closed",
  "Blocked"
];

const ROLE_LABELS = {
  owner: "Owner Administrator",
  subadmin: "Sub-Administrator",
  admin: "Administrator",
  worker: "Worker",
  finance: "Finance"
};

const state = {
  user: null,
  staff: null,
  customerAccess: null,
  identityMode: null,
  loading: true,
  view: "dashboard",
  selectedCustomerId: null,
  selectedJobKey: null,
  intakeDraft: null,
  authMode: "signin",
  requestMode: "staff",
  pendingStaffRequest: null,
  pendingCustomerRequest: null,
  trainingLoaded: false,
  services: {
    online: navigator.onLine,
    firestore: null,
    storage: null
  },
  data: {
    users: {},
    customers: {},
    devices: {},
    jobs: {},
    tasks: {},
    payments: {},
    expenses: {},
    documents: {},
    attachments: {},
    audit: {},
    staffRequests: {},
    customerAccessRequests: {},
    communications: {},
    jobPosts: {},
    workerLedger: {},
    workerLedgerReviews: {},
    training: {},
    settings: {}
  },
  portal: {
    customer: null,
    jobs: [],
    documents: [],
    attachments: []
  },
  unsubs: []
};

const app = document.getElementById("app");
const modalHost = document.getElementById("modalHost");
const toastHost = document.getElementById("toastHost");

const now = () => Date.now();

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function values(obj = {}) {
  return Object.entries(obj || {}).map(([key, value]) => ({ key, ...(value || {}) }));
}

function company() {
  return { ...DEFAULT_COMPANY, ...(state.data.settings?.company || {}) };
}

function profileDisplay(profile = state.staff) {
  if (!profile) return state.user?.email || "User";
  return profile.displayName || profile.realName || profile.name || state.user?.email || "User";
}

function profilePhotoUrl(profile = state.staff) {
  return (
    profile?.photoURL ||
    profile?.photoUrl ||
    profile?.avatarUrl ||
    profile?.profilePhotoUrl ||
    (profile === state.staff ? state.user?.photoURL : "") ||
    ""
  );
}

function avatarMarkup(name, profile = null, className = "avatar") {
  const url = profilePhotoUrl(profile);
  if (url) {
    return `<span class="${className} has-photo"><img src="${esc(url)}" alt="${esc(name || "Profile photo")}" loading="lazy" referrerpolicy="no-referrer"></span>`;
  }
  return `<span class="${className}">${esc(initials(name || ""))}</span>`;
}

function profileRealName(profile = state.staff) {
  if (!profile) return "";
  return profile.realName || profile.name || profile.displayName || "";
}

function roleLabel(role = state.staff?.role) {
  return ROLE_LABELS[role] || "Staff";
}

function isOwner() {
  return state.user?.uid === BOOTSTRAP_ADMIN_UID || state.staff?.role === "owner";
}

function isAdmin() {
  return isOwner() || ["admin", "subadmin"].includes(state.staff?.role);
}

function isOps() {
  return isAdmin() || state.staff?.role === "worker";
}

function isFinance() {
  return isAdmin() || state.staff?.role === "finance";
}

function canManageCriticalSettings() {
  return isOwner();
}

function currentUserActive() {
  return state.staff && state.staff.active !== false;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function normalizePhone(phone = "") {
  return String(phone).replace(/[^\d+]/g, "");
}

function statusTone(status = "") {
  const map = {
    "Intake Pending": "tone-warning",
    "Ready for Assessment": "tone-brand-1",
    "Assessment": "tone-brand-2",
    "Awaiting Approval": "tone-warning",
    "Recovery In Progress": "tone-brand-3",
    "Ready for Collection": "tone-brand-4",
    "Completed": "tone-brand-5",
    "Closed": "tone-neutral",
    "Blocked": "tone-danger",
    "Received": "tone-neutral"
  };
  return map[status] || "tone-neutral";
}

function priorityTone(priority = "") {
  if (priority === "High") return "tone-danger";
  if (priority === "Medium") return "tone-warning";
  return "tone-neutral";
}

function statusPill(status) {
  return `<span class="status-pill ${statusTone(status)}">${esc(status || "Unknown")}</span>`;
}

function rolePill(role) {
  const tone = role === "admin" ? "tone-brand-3" : role === "finance" ? "tone-info" : "tone-neutral";
  return `<span class="role-pill ${tone}">${esc(roleLabel(role))}</span>`;
}

function toast(message, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`.trim();
  item.textContent = message;
  toastHost.appendChild(item);
  setTimeout(() => item.remove(), 3600);
}

function setBusy(button, busy, busyText = "Please wait…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

function emptyState(iconName, title, text, actionHtml = "") {
  return `
    <div class="empty">
      <div class="empty-icon">${icon(iconName, 24)}</div>
      <strong>${esc(title)}</strong>
      <p>${esc(text)}</p>
      ${actionHtml}
    </div>`;
}

function clearSubscriptions() {
  state.unsubs.forEach(unsub => {
    try { unsub?.(); } catch {}
  });
  state.unsubs = [];
}

function sub(path, callback, errorCallback) {
  const unsub = onValue(ref(db, path), callback, errorCallback || (error => {
    console.error(`Subscription failed for ${path}`, error);
  }));
  state.unsubs.push(unsub);
  return unsub;
}

function navigate(view, options = {}) {
  state.view = view;
  if ("customerId" in options) state.selectedCustomerId = options.customerId;
  if ("jobKey" in options) state.selectedJobKey = options.jobKey;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
  setTimeout(() => maybeRunTabTraining(view), 30);
}

function openModal({ title, subtitle = "", body = "", wide = false, actions = "" }) {
  modalHost.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
        <header class="modal-head">
          <div>
            <h2>${title}</h2>
            ${subtitle ? `<p>${subtitle}</p>` : ""}
          </div>
          <button class="ghost close-button" type="button" data-modal-close aria-label="Close">${icon("close", 18)}</button>
        </header>
        <div class="modal-body">${body}</div>
        ${actions ? `<footer class="modal-actions">${actions}</footer>` : ""}
      </section>
    </div>`;

  modalHost.querySelector("[data-modal-close]").onclick = closeModal;
  modalHost.querySelector("[data-modal-backdrop]").onclick = event => {
    if (event.target.matches("[data-modal-backdrop]")) closeModal();
  };
  return modalHost.querySelector(".modal");
}

function closeModal() {
  modalHost.replaceChildren();
}

async function nextNumber(prefix, counterName) {
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let seed = 0;

  const candidates = [];
  if (prefix === "DR") candidates.push(...values(state.data.jobs).map(item => item.jobId || item.key));
  if (prefix === "CUS") candidates.push(...Object.keys(state.data.customers || {}));
  if (prefix === "DEV") candidates.push(...Object.keys(state.data.devices || {}));
  if (["INV","RCT","AGR"].includes(prefix)) candidates.push(...values(state.data.documents).map(item => item.number || item.key));

  candidates.forEach(value => {
    const match = String(value || "").match(pattern);
    if (match) seed = Math.max(seed, Number(match[1]) || 0);
  });

  const counterRef = ref(db, `counters/${counterName}-${year}`);
  const result = await runTransaction(counterRef, current => Math.max(Number(current) || 0, seed) + 1);
  return `${prefix}-${year}-${String(result.snapshot.val()).padStart(4, "0")}`;
}

async function recordAudit(action, entityType, entityId, summary = "") {
  if (!state.user || !state.staff) return;
  try {
    const auditRef = push(ref(db, "audit"));
    await set(auditRef, {
      actorUid: state.user.uid,
      actorName: profileDisplay(),
      actorRealName: profileRealName(),
      action,
      entityType,
      entityId,
      summary,
      createdAt: now()
    });
  } catch (error) {
    console.warn("Audit write failed", error);
  }
}

function customerById(id) {
  return state.data.customers?.[id] ? { customerId: id, ...state.data.customers[id] } : null;
}

function deviceById(id) {
  return state.data.devices?.[id] ? { deviceId: id, ...state.data.devices[id] } : null;
}

function jobByKey(key) {
  return state.data.jobs?.[key] ? { key, ...state.data.jobs[key] } : null;
}

function jobDevices(job) {
  if (!job) return [];
  const ids = Object.keys(job.deviceIds || {});
  if (ids.length) return ids.map(deviceById).filter(Boolean);

  if (job.deviceType || job.brandModel || job.capacity) {
    return [{
      deviceId: "legacy",
      type: job.deviceType || "Storage device",
      brandModel: job.brandModel || "",
      capacity: job.capacity || "",
      serial: job.serial || "",
      condition: job.condition || ""
    }];
  }
  return [];
}

function jobCustomer(job) {
  if (!job) return null;
  if (job.customerId) return customerById(job.customerId);
  return {
    customerId: "",
    fullName: job.clientName || job.customerNameSnapshot || "Legacy customer",
    phone: job.phone || "",
    email: job.email || "",
    address: job.address || ""
  };
}

function jobDisplayName(job) {
  return job?.customerNameSnapshot || job?.clientName || jobCustomer(job)?.fullName || "Customer";
}

function jobDeviceSummary(job) {
  const devices = jobDevices(job);
  if (!devices.length) return "No device";
  if (devices.length === 1) {
    const device = devices[0];
    return [device.type, device.brandModel, device.capacity].filter(Boolean).join(" · ") || "1 device";
  }
  return `${devices.length} devices`;
}

function paymentsForJob(jobKey) {
  return values(state.data.payments)
    .filter(payment => payment.jobKey === jobKey && payment.status !== "void")
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function paidForJob(jobKey) {
  return paymentsForJob(jobKey).reduce((sum, payment) => sum + safeNumber(payment.amount), 0);
}

function expectedForJob(job) {
  return Math.max(0, safeNumber(job?.assessmentFee) + safeNumber(job?.recoveryQuote) - safeNumber(job?.discount));
}

function outstandingForJob(job) {
  return Math.max(0, expectedForJob(job) - paidForJob(job.key || job.jobId));
}

function tasksForCurrentUser() {
  return values(state.data.tasks).filter(task => task.assignedTo === state.user?.uid);
}

function taskDueState(task) {
  if (task.status === "completed") return "completed";
  if (!task.dueAt) return "upcoming";
  const due = new Date(task.dueAt);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const end = start + 86400000;
  if (due.getTime() < start) return "overdue";
  if (due.getTime() < end) return "today";
  return "upcoming";
}

function overdueTaskCount() {
  return tasksForCurrentUser().filter(task => taskDueState(task) === "overdue").length;
}

function pendingAccessCount() {
  if (!isAdmin()) return 0;
  return values(state.data.staffRequests).filter(request => request.status !== "approved" && request.status !== "rejected").length;
}

function pendingCustomerAccessCount() {
  if (!isOps()) return 0;
  return values(state.data.customerAccessRequests).filter(request => request.status !== "approved" && request.status !== "rejected").length;
}

function effectivePostStatus(post) {
  if (!post) return "unknown";
  if (post.status === "available" && (safeNumber(post.deadlineMs) || (post.deadlineAt ? new Date(post.deadlineAt).getTime() : 0)) < now()) return "expired";
  return post.status || "available";
}

function availablePostCount() {
  if (!isOps()) return 0;
  return values(state.data.jobPosts).filter(post => effectivePostStatus(post) === "available").length;
}

function pendingLedgerCount() {
  const entries = typeof allWorkerLedgerEntries === "function" ? allWorkerLedgerEntries() : [];
  if (state.staff?.role === "worker") {
    return entries.filter(entry => !ledgerReview(entry.key, entry.ledgerOwnerUid).reconciledAt).length;
  }
  if (isAdmin() || state.staff?.role === "finance") {
    return entries.filter(entry => !ledgerReview(entry.key, entry.ledgerOwnerUid).reconciledAt).length;
  }
  return 0;
}

function applyTheme() {
  const preference = localStorage.getItem("rd-theme") || "system";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = preference === "dark" || (preference === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0d0c" : "#ffffff");
}

applyTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

window.addEventListener("online", () => {
  state.services.online = true;
  renderTopbarStatusOnly();
  toast("Back online.", "success");
});

window.addEventListener("offline", () => {
  state.services.online = false;
  renderTopbarStatusOnly();
  toast("You are offline. Cloud changes need internet.", "error");
});

function renderTopbarStatusOnly() {
  const dot = document.querySelector("[data-online-dot]");
  const label = document.querySelector("[data-online-label]");
  if (!dot || !label) return;
  dot.classList.toggle("offline", !state.services.online);
  label.textContent = state.services.online ? "Online" : "Offline";
}

async function ensureBootstrapProfile(profile) {
  if (!state.user || state.user.uid !== BOOTSTRAP_ADMIN_UID) return profile;
  const patch = {};
  if (!profile.realName) patch.realName = profile.name || "Administrator";
  if (!profile.displayName) patch.displayName = profile.name || "Administrator";
  if (profile.active === undefined) patch.active = true;
  if (!profile.jobTitle) patch.jobTitle = "Owner Administrator";
  if (profile.role !== "owner") patch.role = "owner";
  if (!profile.email) patch.email = state.user.email || "";
  if (Object.keys(patch).length) {
    try {
      await update(ref(db, `users/${state.user.uid}`), patch);
      return { ...profile, ...patch };
    } catch {}
  }
  return profile;
}

async function ensureFirestoreAccessMirror(profile = state.staff) {
  if (!state.user || !profile) return false;
  try {
    const accessRef = doc(firestore, "access", state.user.uid);
    const snap = await getDoc(accessRef);

    if (!snap.exists() && (state.user.uid === BOOTSTRAP_ADMIN_UID || ["owner","admin","subadmin"].includes(profile.role))) {
      await setDoc(accessRef, {
        role: profile.role,
        active: profile.active !== false,
        realName: profileRealName(profile),
        displayName: profileDisplay(profile),
        email: state.user.email || profile.email || "",
        updatedAt: now()
      });
    } else if (snap.exists() && ["owner","admin","subadmin"].includes(profile.role)) {
      await setDoc(accessRef, {
        role: profile.role,
        active: profile.active !== false,
        realName: profileRealName(profile),
        displayName: profileDisplay(profile),
        email: state.user.email || profile.email || "",
        updatedAt: now()
      }, { merge: true });
    }

    state.services.firestore = true;
    return true;
  } catch (error) {
    console.warn("Firestore access mirror not ready", error);
    state.services.firestore = false;
    return false;
  }
}

async function syncStaffAccessMirror(uid, profile) {
  try {
    await setDoc(doc(firestore, "access", uid), {
      role: profile.role,
      active: profile.active !== false,
      realName: profile.realName || profile.name || "",
      displayName: profile.displayName || profile.realName || profile.name || "",
      email: profile.email || "",
      updatedAt: now()
    }, { merge: true });
    state.services.firestore = true;
    return true;
  } catch (error) {
    state.services.firestore = false;
    console.warn("Could not sync staff access mirror", error);
    return false;
  }
}

async function syncCustomerAccessMirror(uid, access) {
  try {
    await setDoc(doc(firestore, "customerAccess", uid), {
      customerId: access.customerId,
      active: access.active !== false,
      email: access.email || "",
      updatedAt: now()
    }, { merge: true });
    state.services.firestore = true;
    return true;
  } catch (error) {
    state.services.firestore = false;
    console.warn("Could not sync customer access mirror", error);
    return false;
  }
}

function clearIdentityState() {
  clearSubscriptions();
  state.staff = null;
  state.customerAccess = null;
  state.identityMode = null;
  state.pendingStaffRequest = null;
  state.pendingCustomerRequest = null;
  state.portal = { customer: null, jobs: [], documents: [], attachments: [] };
  state.data = {
    users: {}, customers: {}, devices: {}, jobs: {}, tasks: {}, payments: {},
    expenses: {}, documents: {}, attachments: {}, audit: {}, staffRequests: {},
    customerAccessRequests: {}, communications: {}, jobPosts: {}, workerLedger: {}, workerLedgerReviews: {}, training: {}, settings: {}
  };
}

async function resolveIdentity() {
  clearSubscriptions();
  state.staff = null;
  state.customerAccess = null;
  state.identityMode = null;

  if (!state.user) {
    render();
    return;
  }

  try {
    const staffSnap = await get(ref(db, `users/${state.user.uid}`));
    if (staffSnap.exists() && staffSnap.val()?.active !== false) {
      state.staff = await ensureBootstrapProfile({ ...staffSnap.val() });
      state.identityMode = "staff";
      await ensureFirestoreAccessMirror(state.staff);
      startStaffSubscriptions();
      return;
    }
  } catch (error) {
    console.error("Could not resolve staff identity", error);
  }

  try {
    const accessSnap = await get(ref(db, `customerAccess/${state.user.uid}`));
    if (accessSnap.exists() && accessSnap.val()?.active !== false) {
      state.customerAccess = accessSnap.val();
      state.identityMode = "customer";
      await loadCustomerPortal();
      return;
    }
  } catch (error) {
    console.error("Could not resolve customer identity", error);
  }

  state.identityMode = "request";
  try {
    const [staffReq, customerReq] = await Promise.all([
      get(ref(db, `staffRequests/${state.user.uid}`)),
      get(ref(db, `customerAccessRequests/${state.user.uid}`))
    ]);
    state.pendingStaffRequest = staffReq.exists() ? staffReq.val() : null;
    state.pendingCustomerRequest = customerReq.exists() ? customerReq.val() : null;
  } catch {}

  watchPendingApproval();
  render();
}

function watchPendingApproval() {
  clearSubscriptions();
  sub(`users/${state.user.uid}`, snap => {
    if (snap.exists() && snap.val()?.active !== false) resolveIdentity();
  });
  sub(`customerAccess/${state.user.uid}`, snap => {
    if (snap.exists() && snap.val()?.active !== false) resolveIdentity();
  });
  sub(`staffRequests/${state.user.uid}`, snap => {
    state.pendingStaffRequest = snap.exists() ? snap.val() : null;
    render();
  });
  sub(`customerAccessRequests/${state.user.uid}`, snap => {
    state.pendingCustomerRequest = snap.exists() ? snap.val() : null;
    render();
  });
}

function subscribeObject(path, dataKey, shouldSubscribe = true) {
  if (!shouldSubscribe) {
    state.data[dataKey] = {};
    return;
  }
  sub(path, snap => {
    state.data[dataKey] = snap.val() || {};
    render();
  });
}

function startStaffSubscriptions() {
  clearSubscriptions();
  state.trainingLoaded = false;

  subscribeObject("users", "users");
  subscribeObject("customers", "customers");
  subscribeObject("devices", "devices");
  subscribeObject("jobs", "jobs");
  subscribeObject("tasks", "tasks");
  subscribeObject("payments", "payments");
  subscribeObject("documents", "documents");
  subscribeObject("attachments", "attachments");
  subscribeObject("settings", "settings");
  subscribeObject("communications", "communications");
  subscribeObject("jobPosts", "jobPosts", isOps());
  subscribeObject(state.staff?.role === "worker" ? `workerLedger/${state.user.uid}` : "workerLedger", "workerLedger", state.staff?.role === "worker" || isAdmin() || state.staff?.role === "finance");
  subscribeObject(state.staff?.role === "worker" ? `workerLedgerReviews/${state.user.uid}` : "workerLedgerReviews", "workerLedgerReviews", state.staff?.role === "worker" || isAdmin() || state.staff?.role === "finance");
  sub(`training/${state.user.uid}`, snap => {
    state.data.training = snap.val() || {};
    state.trainingLoaded = true;
    render();
  });
  subscribeObject("customerAccessRequests", "customerAccessRequests", isOps());
  subscribeObject("expenses", "expenses", isFinance());
  subscribeObject("staffRequests", "staffRequests", isAdmin());
  subscribeObject("audit", "audit", isAdmin());

  state.loading = false;
  render();
}

async function loadCustomerPortal() {
  clearSubscriptions();
  state.loading = false;
  const customerId = state.customerAccess.customerId;

  sub(`customers/${customerId}`, snap => {
    state.portal.customer = snap.exists() ? { customerId, ...snap.val() } : null;
    render();
  });

  sub(`customerJobs/${customerId}`, async snap => {
    const map = snap.val() || {};
    const keys = Object.keys(map);
    const jobs = await Promise.all(keys.map(async key => {
      try {
        const jobSnap = await get(ref(db, `jobs/${key}`));
        return jobSnap.exists() ? { key, ...jobSnap.val() } : null;
      } catch {
        return null;
      }
    }));
    state.portal.jobs = jobs.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    await loadPortalDocumentsAndAttachments();
    render();
  });

  render();
}

async function loadPortalDocumentsAndAttachments() {
  const documentIds = new Set();
  const attachmentPairs = [];

  state.portal.jobs.forEach(job => {
    Object.keys(job.documentIds || {}).forEach(id => documentIds.add(id));
    Object.keys(job.attachmentIds || {}).forEach(id => attachmentPairs.push([job.key, id]));
  });

  const docs = await Promise.all([...documentIds].map(async id => {
    try {
      const snap = await get(ref(db, `documents/${id}`));
      return snap.exists() && snap.val()?.clientVisible === true ? { documentId: id, ...snap.val() } : null;
    } catch {
      return null;
    }
  }));

  const attachments = await Promise.all(attachmentPairs.map(async ([jobKey, id]) => {
    try {
      const snap = await get(ref(db, `attachments/${jobKey}/${id}`));
      return snap.exists() && snap.val()?.clientVisible === true ? { jobKey, attachmentId: id, ...snap.val() } : null;
    } catch {
      return null;
    }
  }));

  const deviceIds = new Set();
  state.portal.jobs.forEach(job => Object.keys(job.deviceIds || {}).forEach(id => deviceIds.add(id)));
  const devicePairs = await Promise.all([...deviceIds].map(async id => {
    try {
      const snap = await get(ref(db, `devices/${id}`));
      return snap.exists() ? [id, snap.val()] : null;
    } catch {
      return null;
    }
  }));
  devicePairs.filter(Boolean).forEach(([id, value]) => { state.data.devices[id] = value; });

  state.portal.documents = docs.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  state.portal.attachments = attachments.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

getRedirectResult(auth).catch(error => console.warn("Auth redirect result", error));

onAuthStateChanged(auth, async user => {
  clearIdentityState();
  state.user = user;
  state.loading = false;
  if (user) await resolveIdentity();
  else render();
});

function render() {
  if (state.loading) {
    app.innerHTML = `<div class="auth-side" style="min-height:100vh"><div class="empty">${icon("clock", 24)}<p>Loading RecoveryDesk…</p></div></div>`;
    return;
  }
  if (!state.user) return renderAuth();
  if (state.identityMode === "request") return renderAccessRequest();
  if (state.identityMode === "customer") return renderCustomerPortal();
  if (state.identityMode === "staff" && currentUserActive()) return renderStaffApp();
  renderAccessRequest();
}

function renderAuth() {
  const signup = state.authMode === "signup";

  app.innerHTML = `
    <div class="auth-page">
      <section class="auth-brand">
        <div>
          <img src="./logo.png" alt="WISCODE logo">
          <h1>Recovery work,<br><span>under control.</span></h1>
          <p>Customer intake, devices, recovery jobs, tasks, finance and documents — one operating desk for WISCODE.</p>
        </div>
        <div class="auth-meta">
          <span>WISCODE INNOVATIONS LTD</span>
          <span>RC 9656932</span>
          <span>RecoveryDesk V2</span>
        </div>
      </section>

      <section class="auth-side">
        <form class="auth-card" id="authForm">
          <span class="eyebrow">${signup ? "Create account" : "Google or email/password sign-in"}</span>
          <h2>${signup ? "Create your sign-in" : "Welcome back"}</h2>
          <p>${signup ? "Your account still needs Staff/Admin authorization or customer linking before it can access records." : "Sign in to continue to RecoveryDesk."}</p>

          <div id="authError" class="notice warning" style="display:none"></div>

          <button type="button" class="secondary full" id="googleAuthBtn">
            <strong style="font-size:17px">G</strong>
            ${signup ? "Create with Google" : "Continue with Google"}
          </button>

          <div class="auth-divider"><span>or</span></div>

          <label>Email address
            <input id="authEmail" type="email" autocomplete="email" required>
          </label>

          <label>Password
            <input id="authPassword" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required>
          </label>

          ${signup ? `<label>Confirm password
            <input id="authPasswordConfirm" type="password" autocomplete="new-password" minlength="6" required>
          </label>` : ""}

          <button class="primary full" id="authSubmit">
            ${signup ? icon("plus", 18) + " Create account" : icon("shield", 18) + " Sign in"}
          </button>

          ${!signup ? `<button type="button" class="ghost full" id="forgotPasswordBtn" style="margin-top:8px">Forgot password?</button>` : ""}

          <div class="auth-switch">
            ${signup ? "Already have an account?" : "New staff member or client?"}
            <button type="button" id="switchAuthMode">${signup ? "Sign in" : "Create account"}</button>
          </div>
        </form>
      </section>
    </div>`;

  const showError = message => {
    const box = document.getElementById("authError");
    box.textContent = message;
    box.style.display = "block";
  };

  document.getElementById("switchAuthMode").onclick = () => {
    state.authMode = signup ? "signin" : "signup";
    renderAuth();
  };

  document.getElementById("googleAuthBtn").onclick = async event => {
    const button = event.currentTarget;
    setBusy(button, true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      if (["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(error.code)) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      showError("Google sign-in could not be completed. You can use email and password instead.");
      setBusy(button, false);
    }
  };

  document.getElementById("forgotPasswordBtn")?.addEventListener("click", async () => {
    const email = document.getElementById("authEmail").value.trim();
    if (!email) {
      showError("Enter your email address first, then choose Forgot password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Password reset email sent.", "success");
    } catch {
      showError("Password reset email could not be sent.");
    }
  });

  document.getElementById("authForm").onsubmit = async event => {
    event.preventDefault();
    const button = document.getElementById("authSubmit");
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    if (signup && password !== document.getElementById("authPasswordConfirm").value) {
      showError("The two passwords do not match.");
      return;
    }

    setBusy(button, true);

    try {
      if (signup) {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        try { await sendEmailVerification(result.user); } catch {}
        toast("Account created. Next, request the correct RecoveryDesk access.", "success");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      const messages = {
        "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
        "auth/invalid-credential": "The email or password is not correct.",
        "auth/weak-password": "Use a stronger password with at least 6 characters.",
        "auth/too-many-requests": "Too many attempts. Wait a little and try again."
      };
      showError(messages[error.code] || "Authentication could not be completed.");
      setBusy(button, false);
    }
  };
}

function renderAccessRequest() {
  const staffRequest = state.pendingStaffRequest;
  const customerRequest = state.pendingCustomerRequest;
  const pending = staffRequest?.status === "pending" || customerRequest?.status === "pending";

  app.innerHTML = `
    <div class="auth-page">
      <section class="auth-brand">
        <div>
          <img src="./logo.png" alt="WISCODE logo">
          <h1>Your sign-in is ready.<br><span>Access is controlled.</span></h1>
          <p>Signing in proves who you are. RecoveryDesk separately controls whether you are Staff or an approved customer.</p>
        </div>
        <div class="auth-meta"><span>${esc(state.user.email || "")}</span><span>Secure access request</span></div>
      </section>

      <section class="auth-side">
        <div class="request-card">
          <span class="eyebrow">Access request</span>
          <h2 style="font-size:30px;margin:6px 0">Who are you using RecoveryDesk as?</h2>

          ${pending ? `
            <div class="panel">
              <div class="notice info">
                ${staffRequest?.status === "pending"
                  ? "Your staff access request is waiting for an Administrator to approve your role."
                  : "Your customer portal request is waiting for Staff/Admin approval and customer matching."}
              </div>
              <div class="head-actions" style="margin-top:14px;justify-content:flex-start">
                <button class="secondary" id="refreshAccess">${icon("audit", 17)} Check again</button>
                <button class="ghost" id="signOutPending">${icon("logout", 17)} Sign out</button>
              </div>
            </div>
          ` : `
            <div class="access-choice">
              <button class="${state.requestMode === "staff" ? "active" : ""}" data-request-mode="staff">
                ${icon("staff", 22)}
                <strong>I work at WISCODE</strong>
                <span>An Administrator will review your request and assign your system role.</span>
              </button>
              <button class="${state.requestMode === "customer" ? "active" : ""}" data-request-mode="customer">
                ${icon("customers", 22)}
                <strong>I'm a customer</strong>
                <span>Staff will link this login to your existing customer record. Your name stays controlled by WISCODE.</span>
              </button>
            </div>

            ${state.requestMode === "staff" ? staffRequestForm() : customerRequestForm()}
            <button class="ghost full" id="signOutRequest">${icon("logout", 17)} Sign out</button>
          `}
        </div>
      </section>
    </div>`;

  if (pending) {
    document.getElementById("refreshAccess").onclick = resolveIdentity;
    document.getElementById("signOutPending").onclick = () => signOut(auth);
    return;
  }

  document.querySelectorAll("[data-request-mode]").forEach(button => {
    button.onclick = () => {
      state.requestMode = button.dataset.requestMode;
      renderAccessRequest();
    };
  });

  document.getElementById("signOutRequest").onclick = () => signOut(auth);
  if (state.requestMode === "staff") bindStaffRequestForm();
  else bindCustomerRequestForm();
}

function staffRequestForm() {
  return `
    <form class="panel form-section" id="staffRequestForm">
      <h2>Staff access request</h2>
      <p>Your real name remains the underlying identity. You can later edit your display name; the Administrator assigns your role and job title.</p>
      <div class="form-grid">
        <label class="field"><span>Real name *</span><input name="realName" required></label>
        <label class="field"><span>Preferred display name *</span><input name="displayName" required></label>
      </div>
      <label class="field"><span>Work area / job title</span><input name="jobTitle" placeholder="e.g. Recovery Technician"></label>
      <button class="primary" type="submit">${icon("shield", 17)} Request staff access</button>
    </form>`;
}

function customerRequestForm() {
  return `
    <form class="panel form-section" id="customerRequestForm">
      <h2>Customer portal request</h2>
      <p>Enter the customer/job information WISCODE gave you. Staff will verify it before linking your account.</p>
      <div class="form-grid">
        <label class="field"><span>Customer ID</span><input name="customerId" placeholder="CUS-2026-0001"></label>
        <label class="field"><span>Phone number used with WISCODE *</span><input name="phone" required></label>
      </div>
      <label class="field"><span>Job reference (optional)</span><input name="jobId" placeholder="DR-2026-0001"></label>
      <button class="primary" type="submit">${icon("link", 17)} Request customer access</button>
    </form>`;
}

function bindStaffRequestForm() {
  document.getElementById("staffRequestForm").onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector("button[type=submit]");
    setBusy(button, true);
    try {
      await set(ref(db, `staffRequests/${state.user.uid}`), {
        uid: state.user.uid,
        email: state.user.email || "",
        realName: form.get("realName").trim(),
        displayName: form.get("displayName").trim(),
        requestedJobTitle: form.get("jobTitle").trim(),
        status: "pending",
        createdAt: now()
      });
      toast("Staff access request sent.", "success");
    } catch {
      toast("The request could not be sent. Check the database rules or connection.", "error");
      setBusy(button, false);
    }
  };
}

function bindCustomerRequestForm() {
  document.getElementById("customerRequestForm").onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector("button[type=submit]");
    setBusy(button, true);
    try {
      await set(ref(db, `customerAccessRequests/${state.user.uid}`), {
        uid: state.user.uid,
        email: state.user.email || "",
        requestedCustomerId: String(form.get("customerId") || "").trim().toUpperCase(),
        phone: normalizePhone(form.get("phone")),
        jobId: String(form.get("jobId") || "").trim().toUpperCase(),
        status: "pending",
        createdAt: now()
      });
      toast("Customer portal request sent.", "success");
    } catch {
      toast("The request could not be sent. Check the connection.", "error");
      setBusy(button, false);
    }
  };
}



const TRAINING_TABS = new Set(["dashboard","customers","jobs","board","tasks","expenses","finance","staff","audit","settings"]);

function trainingRoleKey() {
  return state.staff?.role || "staff";
}

function trainingSlidesFor(view) {
  const role = trainingRoleKey();
  const management = ["owner","admin","subadmin"].includes(role);

  const common = {
    dashboard: management ? [
      ["home", "Your command centre", "Use this page to spot overdue work, bottlenecks and what needs attention across the business."],
      ["tasks", "Act on exceptions", "The dashboard is for decisions. Open the relevant job, task or finance item instead of changing records casually."],
      ["audit", "Everything important is accountable", "Assignments, submitted-job edits, finance reconciliation and staff actions are designed to leave an audit trail."]
    ] : role === "finance" ? [
      ["finance", "Your finance workspace", "Focus on payments, reconciliation, outstanding balances and worker money declarations."],
      ["shield", "Operations stay read-only", "Finance can inspect the job context needed for money control but cannot change recovery records or legal terms."],
      ["audit", "Reconcile; do not rewrite", "Confirm what reached the company records without changing the worker's original declaration."]
    ] : [
      ["home", "Your work, not everybody's", "Your dashboard focuses on jobs assigned to you and the tasks you need to complete."],
      ["jobs", "Own the work you take", "Claim available work or receive an assignment. Other workers' jobs remain read-only."],
      ["shield", "Submitted records are serious", "Once you submit a job record, any later correction requires a written reason and is permanently auditable."]
    ],
    customers: [
      ["customers", "One permanent customer record", "Search before creating a customer so returning customers keep the same history."],
      ["devices", "Devices stay linked", "A customer may bring several devices today and return later with the same or different devices."],
      ["shield", "Identity matters", "Customer names, owner, submitter and signer details are business records. Change them only when verified."]
    ],
    jobs: [
      ["jobs", "Jobs have ownership", "Only Admin/Sub-Admin/Owner or the worker assigned to a job can change its operational record."],
      ["shield", "Submit when the record is ready", "A worker's draft becomes an auditable submitted record. Later worker edits require a written reason."],
      ["file", "Legal documents preserve history", "Generated agreements and invoices are snapshots. Corrections create a new document rather than silently rewriting the old one."]
    ],
    board: management ? [
      ["jobs", "Post work to the team", "Create an available job with a clear deadline, priority and instructions. You can optionally link it to an existing recovery job."],
      ["clock", "Deadlines are visible", "Unclaimed work past its deadline shows as expired. Urgent work should have a realistic deadline."],
      ["shield", "You remain in control", "You can cancel a post or reassign claimed work. Claims and cancellations are recorded."]
    ] : [
      ["jobs", "Available work lives here", "Active workers can see open posts with priority, instructions and deadline."],
      ["check", "Claim means responsibility", "The first successful claim gets the work. A linked recovery job is assigned to you."],
      ["clock", "Watch the deadline", "Do not claim work you cannot complete responsibly before the deadline."]
    ],
    tasks: management ? [
      ["tasks", "Turn work into clear actions", "Assign tasks to the right person with a due date and priority."],
      ["clock", "Overdue work surfaces automatically", "Use due dates so the dashboard can show what needs intervention."],
      ["audit", "Completion is recorded", "The system records who completed or reopened a task."]
    ] : [
      ["tasks", "This is your to-do list", "Work assigned to you appears here with its due date and priority."],
      ["check", "Complete tasks when truly done", "Marking a task complete records your identity and time."],
      ["clock", "Overdue means act", "If a deadline cannot be met, tell the person responsible instead of ignoring it."]
    ],
    expenses: management || role === "finance" ? [
      ["receipt", "Worker declarations are original records", "Workers can declare expenses or customer money they personally handled. Their original declaration cannot be silently edited."],
      ["finance", "Finance reconciles separately", "Finance/Admin records the review result and note without rewriting what the worker originally submitted."],
      ["shield", "Company payment is preferred", "Customer money should normally go through the company/Finance channel. Personal handling should be exceptional and documented."]
    ] : [
      ["receipt", "Record money you personally handled", "Use this only when you personally paid an expense or received customer money outside the normal company payment channel."],
      ["shield", "Your declaration becomes immutable", "Enter the item, amount, date, payment method and related job carefully. You cannot edit or delete the original after submission."],
      ["finance", "Finance will reconcile it", "Finance/Admin reviews the declaration separately. For bank details, record only an account label and last four digits—not passwords, PINs or OTPs."]
    ],
    finance: [
      ["finance", "Finance controls the money record", "Review customer payments, outstanding balances, company expenses and worker declarations."],
      ["check", "Reconciliation is a separate action", "Mark a payment or worker declaration reconciled only after checking the supporting company record."],
      ["shield", "Do not alter operations", "Finance must not change device ownership, technical recovery status, signer details or legal terms."]
    ],
    staff: [
      ["staff", "Access is approved, not assumed", "A sign-in account does not become staff until an Administrator approves it and assigns a role."],
      ["shield", "Use the least privilege needed", "Worker, Finance and Sub-Administrator roles should match the person's real responsibilities."],
      ["audit", "Owner-level controls stay protected", "Critical company identity/security settings remain Owner-only."]
    ],
    audit: [
      ["audit", "Audit is the accountability trail", "Use it to understand who created, submitted, edited, reassigned or reconciled a record."],
      ["shield", "Reasons matter", "Submitted-job corrections include the worker's written reason and before/after values."],
      ["file", "Do not use audit as an edit screen", "Correct the source record through its proper workflow; Audit exists to preserve history."]
    ],
    settings: [
      ["settings", "Personal and company settings are separate", "Staff may change permitted personal preferences; critical company settings are Owner-controlled."],
      ["shield", "Security comes first", "Password tools depend on your sign-in method. Never share passwords, PINs, OTPs or private banking credentials."],
      ["audit", "Training can be replayed", "The Owner can manage system configuration here, and any user can replay these lessons when they need a refresher."]
    ]
  };
  return common[view] || [];
}

function maybeRunTabTraining(view) {
  if (!state.user || !state.staff || !state.trainingLoaded || !TRAINING_TABS.has(view)) return;
  if (modalHost.children.length) return;
  const key = `${view}_${trainingRoleKey()}`;
  if (state.data.training?.[key]?.completedAt) return;
  const slides = trainingSlidesFor(view);
  if (!slides.length) return;
  openMandatoryTraining(view, key, slides);
}

function openMandatoryTraining(view, key, slides) {
  let index = 0;

  const draw = () => {
    const [iconName, title, text] = slides[index];
    modalHost.innerHTML = `
      <div class="training-backdrop">
        <section class="training-modal" role="dialog" aria-modal="true" aria-label="Required RecoveryDesk training">
          <div class="training-brand"><img src="./logo.png" alt=""><span>RecoveryDesk guided training</span></div>
          <div class="training-animation">${icon(iconName, 42)}<span></span><span></span></div>
          <span class="eyebrow">${esc(currentViewTitle())} · ${index + 1} of ${slides.length}</span>
          <h2>${esc(title)}</h2>
          <p>${esc(text)}</p>
          <div class="training-progress">${slides.map((_,i)=>`<span class="${i <= index ? "done" : ""}"></span>`).join("")}</div>
          <div class="notice info">This first-visit lesson is required. It cannot be skipped.</div>
          <button class="primary full" id="trainingNext" disabled>${index === slides.length - 1 ? "I understand" : "Continue"}</button>
        </section>
      </div>`;

    const button = document.getElementById("trainingNext");
    setTimeout(() => { if (button) button.disabled = false; }, 1100);
    button.onclick = async () => {
      if (index < slides.length - 1) {
        index += 1;
        draw();
        return;
      }
      button.disabled = true;
      try {
        const completion = { completedAt: now(), role: trainingRoleKey(), view, version: "2.3-final" };
        state.data.training[key] = completion;
        await set(ref(db, `training/${state.user.uid}/${key}`), completion);
        modalHost.replaceChildren();
        await recordAudit("completed training", "training", key, `${currentViewTitle()} first-visit training`);
      } catch {
        button.disabled = false;
        toast("Training completion could not be saved. Check your connection and try again.", "error");
      }
    };
  };
  draw();
}

function navItems() {
  const items = [
    ["dashboard", "home", "Dashboard", ""],
    ["customers", "customers", "Customers", pendingCustomerAccessCount() ? String(pendingCustomerAccessCount()) : ""],
    ["jobs", "jobs", "Jobs", ""]
  ];

  if (isOps()) items.push(["board", "jobs", "Job Board", availablePostCount() ? String(availablePostCount()) : ""]);
  items.push(["tasks", "tasks", "Tasks", overdueTaskCount() ? String(overdueTaskCount()) : ""]);
  items.push(["expenses", "receipt", state.staff?.role === "worker" ? "My Expenses" : "Expenses", pendingLedgerCount() ? String(pendingLedgerCount()) : ""]);

  if (isFinance()) items.push(["finance", "finance", "Finance", ""]);
  if (isAdmin()) items.push(["staff", "staff", "Staff", pendingAccessCount() ? String(pendingAccessCount()) : ""]);
  if (isAdmin()) items.push(["audit", "audit", "Audit", ""]);
  items.push(["settings", "settings", "Settings", ""]);
  return items;
}

function navButton(item, mobile = false) {
  const [view, iconName, label, badge] = item;
  const active = state.view === view
    || (view === "customers" && state.view === "customer-detail")
    || (view === "jobs" && ["job-detail", "new-intake"].includes(state.view));

  return `
    <button class="${active ? "active" : ""}" data-nav="${view}">
      ${icon(iconName, mobile ? 20 : 18)}
      <span>${label}</span>
      ${!mobile && badge ? `<span class="nav-badge ${view === "tasks" ? "alert" : ""}">${badge}</span>` : ""}
    </button>`;
}

function currentViewTitle() {
  const map = {
    dashboard: "Dashboard",
    customers: "Customers",
    "customer-detail": "Customer",
    jobs: "Jobs",
    "job-detail": "Job",
    "new-intake": "New intake",
    board: "Job Board",
    tasks: "Tasks",
    expenses: "Expenses",
    finance: "Finance",
    staff: "Staff",
    audit: "Audit",
    settings: "Settings"
  };
  return map[state.view] || "RecoveryDesk";
}

function renderStaffApp() {
  const items = navItems();
  const mobileItems = [
    items.find(item => item[0] === "dashboard"),
    items.find(item => item[0] === "customers"),
    items.find(item => item[0] === "jobs"),
    items.find(item => item[0] === "tasks"),
    items.find(item => item[0] === (isFinance() ? "finance" : "settings"))
  ].filter(Boolean);

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-lockup">
          <img src="./logo.png" alt="">
          <div><strong>RecoveryDesk</strong><span>WISCODE INNOVATIONS LTD</span></div>
        </div>

        <div class="nav-section-label">Workspace</div>
        <nav class="side-nav">
          ${items.map(item => navButton(item)).join("")}
        </nav>

        <div class="sidebar-footer">
          <button class="profile-chip ghost" data-nav="settings">
            ${avatarMarkup(profileDisplay(), state.staff)}
            <span>
              <strong>${esc(profileDisplay())}</strong>
              <span>${esc(state.staff.jobTitle || roleLabel())}</span>
            </span>
            ${icon("chevron", 15)}
          </button>
          <button class="ghost full" id="sidebarSignOut">${icon("logout", 17)} Sign out</button>
        </div>
      </aside>

      <main class="main-shell">
        <header class="topbar">
          <div class="topbar-left">
            <button class="ghost mobile-menu" id="mobileMenuBtn">${icon("menu", 20)}</button>
            <div class="desktop-title"><strong>${esc(currentViewTitle())}</strong></div>
          </div>
          <div class="topbar-right">
            <span class="online-dot ${state.services.online ? "" : "offline"}" data-online-dot></span>
            <span class="tiny muted" data-online-label>${state.services.online ? "Online" : "Offline"}</span>
            ${isOps() ? `<button class="primary" data-action="new-intake">${icon("plus", 17)} <span class="desktop-title">New intake</span></button>` : ""}
          </div>
        </header>

        <div class="content" id="viewHost"></div>

        <nav class="mobile-bottom-nav">
          ${mobileItems.map(item => navButton(item, true)).join("")}
        </nav>
      </main>
    </div>`;

  bindShellEvents();
  renderCurrentView();
  setTimeout(() => maybeRunTabTraining(state.view), 20);
}

function bindShellEvents() {
  document.querySelectorAll("[data-nav]").forEach(button => {
    button.onclick = () => {
      const view = button.dataset.nav;
      if (view === "customers") state.selectedCustomerId = null;
      if (view === "jobs") state.selectedJobKey = null;
      navigate(view);
    };
  });

  document.querySelectorAll("[data-action='new-intake']").forEach(button => {
    button.onclick = () => startIntake();
  });

  document.getElementById("sidebarSignOut")?.addEventListener("click", () => signOut(auth));
  document.getElementById("mobileMenuBtn")?.addEventListener("click", openMobileMenu);
}

function openMobileMenu() {
  const body = `
    <div class="side-nav">${navItems().map(item => navButton(item)).join("")}</div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <button class="ghost full" id="mobileSignOut">${icon("logout", 17)} Sign out</button>`;

  openModal({ title: "RecoveryDesk", subtitle: profileDisplay(), body });

  modalHost.querySelectorAll("[data-nav]").forEach(button => {
    button.onclick = () => {
      closeModal();
      navigate(button.dataset.nav);
    };
  });

  document.getElementById("mobileSignOut").onclick = () => signOut(auth);
}

function renderCurrentView() {
  const host = document.getElementById("viewHost");
  if (!host) return;

  if (state.view === "dashboard") return renderDashboard(host);
  if (state.view === "customers") return renderCustomers(host);
  if (state.view === "customer-detail") return renderCustomerDetail(host);
  if (state.view === "jobs") return renderJobs(host);
  if (state.view === "job-detail") return renderJobDetail(host);
  if (state.view === "new-intake") return renderNewIntake(host);
  if (state.view === "board" && isOps()) return renderJobBoard(host);
  if (state.view === "tasks") return renderTasks(host);
  if (state.view === "expenses") return renderWorkerLedger(host);
  if (state.view === "finance" && isFinance()) return renderFinance(host);
  if (state.view === "staff" && isAdmin()) return renderStaff(host);
  if (state.view === "audit" && isAdmin()) return renderAudit(host);
  if (state.view === "settings") return renderSettings(host);

  state.view = "dashboard";
  renderDashboard(host);
}

function dashboardSentence(overdue, today, attention) {
  if (state.staff?.role === "finance") {
    if (overdue) return `You have ${overdue} overdue finance task${overdue === 1 ? "" : "s"} requiring attention.`;
    return "Review payments, reconciliation and outstanding balances for the business.";
  }
  if (state.staff?.role === "worker") {
    if (overdue) return `You have ${overdue} overdue task${overdue === 1 ? "" : "s"} and work waiting on you.`;
    if (today) return `${today} task${today === 1 ? "" : "s"} are due today.`;
    return "Your dashboard is focused on your assigned work, customers and recovery tasks.";
  }
  if (overdue) return `You have ${overdue} overdue task${overdue === 1 ? "" : "s"} and ${attention} job${attention === 1 ? "" : "s"} needing attention.`;
  if (today) return `${today} task${today === 1 ? "" : "s"} are due today. The rest of your workspace looks under control.`;
  if (attention) return `Your tasks are clear, but ${attention} job${attention === 1 ? "" : "s"} still need attention.`;
  return "Nothing urgent is waiting on you right now. Keep the recovery queue moving.";
}

function dashboardJobsScope(allJobs) {
  if (state.staff?.role === "worker") {
    const assignedJobKeys = new Set(values(state.data.tasks)
      .filter(task => task.assignedTo === state.user.uid && task.jobKey)
      .map(task => task.jobKey));
    const merged = new Map();
    allJobs
      .filter(job =>
        job.assignedTo === state.user.uid ||
        (!job.assignedTo && job.createdBy === state.user.uid) ||
        assignedJobKeys.has(job.key || job.jobId)
      )
      .forEach(job => merged.set(job.key || job.jobId, job));
    return [...merged.values()];
  }
  return allJobs;
}

function statCard(label, value, iconName, foot) {
  return `
    <div class="stat-card">
      <div class="stat-top">
        <span class="stat-label">${esc(label)}</span>
        <span class="stat-icon">${icon(iconName, 18)}</span>
      </div>
      <div>
        <div class="stat-value">${value}</div>
        <div class="stat-foot">${esc(foot)}</div>
      </div>
    </div>`;
}

function quickAction(action, iconName, title, subtitle) {
  return `
    <button class="quick-action" data-quick-action="${action}">
      <span class="qa-icon">${icon(iconName, 18)}</span>
      <div><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div>
    </button>`;
}

function renderPipeline(jobs) {
  const groups = [
    ["Intake", ["Intake Pending", "Received"]],
    ["Ready", ["Ready for Assessment"]],
    ["Assessment", ["Assessment"]],
    ["Approval", ["Awaiting Approval"]],
    ["Recovery", ["Recovery In Progress"]],
    ["Ready / done", ["Ready for Collection", "Completed"]]
  ];

  return `<div class="progress-pipeline">${
    groups.map(([label, statuses], index) => {
      const count = jobs.filter(job => statuses.includes(job.status)).length;
      return `<div class="pipeline-step ${count ? `active-${Math.min(index + 1, 5)}` : ""}">
        <strong>${count}</strong><span>${label}</span>
      </div>`;
    }).join("")
  }</div>`;
}

function taskRowHtml(task) {
  const dueState = taskDueState(task);
  const assignee = state.data.users?.[task.assignedTo];
  return `
    <div class="task-row ${task.status === "completed" ? "completed" : ""} ${isArchived(task) ? "archived" : ""}" data-task-open="${task.key}">
      <button class="task-check ${task.status === "completed" ? "done" : ""}" data-task-toggle="${task.key}">
        ${task.status === "completed" ? icon("check", 15) : ""}
      </button>
      <div class="task-main">
        <strong>${esc(task.title || "Task")}</strong>
        <span>${esc(assignee?.displayName || assignee?.realName || assignee?.name || "Unassigned")}
          ${task.dueAt ? ` · ${dueState === "overdue" ? "Overdue " : "Due "}${esc(formatDate(task.dueAt, false))}` : ""}
        </span>
      </div>
      <span class="priority-pill ${priorityTone(task.priority)}">${esc(task.priority || "Normal")}</span>
      ${canManageTask(task) ? `<button class="ghost" data-task-manage="${task.key}" title="Manage task">${icon("edit",15)}</button>` : ""}
    </div>`;
}

function renderTaskPreview(tasks) {
  if (!tasks.length) return emptyState("tasks", "No immediate tasks", "Nothing overdue or due today.");
  return `<div>${tasks.map(taskRowHtml).join("")}</div>`;
}

function bindTaskChecks(scope = document) {
  scope.querySelectorAll("[data-task-toggle]").forEach(button => {
    button.onclick = async event => {
      event.stopPropagation();
      const key = button.dataset.taskToggle;
      const task = state.data.tasks?.[key];
      if (!task) return;

      const completed = task.status === "completed";

      try {
        await update(ref(db, `tasks/${key}`), {
          status: completed ? "open" : "completed",
          completedAt: completed ? null : now(),
          completedBy: completed ? null : state.user.uid,
          updatedAt: now()
        });
        await recordAudit(completed ? "reopened" : "completed", "task", key, task.title || "");
      } catch {
        toast("Task could not be updated.", "error");
      }
    };
  });
}

function renderJobRows(jobs) {
  if (!jobs.length) return emptyState("jobs", "No jobs", "There are no jobs to show here.");

  return `<div class="list">${jobs.map(job => `
    <div class="list-row clickable" data-job-key="${esc(job.key || job.jobId)}">
      <div class="list-icon">${icon("devices", 18)}</div>
      <div class="list-main">
        <strong>${esc(job.jobId || "Legacy job")} · ${esc(jobDisplayName(job))} ${isArchived(job) ? `<span class="status-pill tone-neutral">Archived</span>` : ""}</strong>
        <span>${esc(jobDeviceSummary(job))} · ${formatDate(job.createdAt)}</span>
      </div>
      <div class="list-side">${statusPill(job.status)}</div>
    </div>`).join("")}</div>`;
}

function bindJobRowClicks(scope = document) {
  scope.querySelectorAll("[data-job-key]").forEach(row => {
    row.onclick = () => navigate("job-detail", { jobKey: row.dataset.jobKey });
  });
}

function renderDashboard(host) {
  const companyJobs = values(state.data.jobs).map(job => ({ ...job, key: job.key || job.jobId }));
  const allJobs = dashboardJobsScope(companyJobs);
  const activeJobs = allJobs.filter(job => !["Completed", "Closed"].includes(job.status));
  const attentionJobs = allJobs.filter(job =>
    ["Intake Pending", "Blocked"].includes(job.status) ||
    (job.status === "Awaiting Approval" && !job.quoteApproval?.approved)
  );
  const readyJobs = allJobs.filter(job => job.status === "Ready for Collection");

  const myTasks = tasksForCurrentUser();
  const overdue = myTasks.filter(task => taskDueState(task) === "overdue");
  const todayTasks = myTasks.filter(task => taskDueState(task) === "today");

  host.innerHTML = `
    <section class="hero">
      <span class="eyebrow">${esc(roleLabel())} workspace</span>
      <h1>${greeting()}, ${esc(profileDisplay())}.</h1>
      <p>${dashboardSentence(overdue.length, todayTasks.length, attentionJobs.length)}</p>
      <div class="hero-actions">
        ${isOps() ? `<button class="primary" data-dashboard-action="intake">${icon("plus", 17)} New intake</button>` : ""}
        <button class="secondary" data-dashboard-action="tasks">${icon("tasks", 17)} My tasks</button>
        ${isFinance() ? `<button class="secondary" data-dashboard-action="finance">${icon("finance", 17)} Finance</button>` : ""}
      </div>
    </section>

    ${state.staff?.role === "finance" ? `
      <div class="grid four">
        ${statCard("Payments recorded", values(state.data.payments).filter(p=>p.status!=="void").length, "finance", "Customer payments")}
        ${statCard("Awaiting reconciliation", values(state.data.payments).filter(p=>p.status==="confirmed" && !p.reconciledAt).length, "clock", "Check against Moniepoint")}
        ${statCard("Outstanding jobs", companyJobs.filter(j=>outstandingForJob(j)>0).length, "receipt", "Balances still due")}
        ${statCard("Overdue tasks", overdue.length, "alert", overdue.length ? "Requires action" : "You're caught up")}
      </div>
    ` : `
      <div class="grid four">
        ${statCard(state.staff?.role==="worker" ? "My active jobs" : "Active jobs", activeJobs.length, "jobs", `${allJobs.length} in this dashboard`)}
        ${statCard("Needs attention", attentionJobs.length, "alert", attentionJobs.length ? "Review pending items" : "Nothing blocked")}
        ${statCard("Ready to collect", readyJobs.length, "check", "Customer handover queue")}
        ${statCard("Overdue tasks", overdue.length, "clock", overdue.length ? "Requires action" : "You're caught up")}
      </div>
    `}

    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <div class="panel-head">
          <div><h2>Your day</h2><p>Tasks assigned to ${esc(profileDisplay())}</p></div>
          <button class="ghost" data-dashboard-action="tasks">View all ${icon("chevron", 15)}</button>
        </div>
        ${renderTaskPreview([...overdue, ...todayTasks].slice(0, 6))}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h2>Quick actions</h2><p>Common actions without hunting through menus</p></div>
        </div>
        <div class="quick-actions">
          ${isOps() ? quickAction("intake", "plus", "New intake", "Customer + devices") : ""}
          ${isOps() ? quickAction("board", "jobs", state.staff?.role === "worker" ? "Available jobs" : "Job board", state.staff?.role === "worker" ? "Claim team work" : "Post work to the team") : ""}
          ${state.staff?.role === "worker" ? quickAction("expenses", "receipt", "Record expense", "Money you personally handled") : ""}
          ${quickAction("customers", "search", "Find customer", "Returning customer history")}
          ${quickAction("jobs", "jobs", "Open jobs", "Recovery work queue")}
          ${isFinance() ? quickAction("finance", "finance", "Finance", "Payments & outstanding") : ""}
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><div><h2>Recovery pipeline</h2><p>A live view of work moving through the desk</p></div></div>
      ${renderPipeline(allJobs)}
    </section>

    <div class="grid two">
      <section class="panel">
        <div class="panel-head">
          <div><h2>Recent jobs</h2><p>Latest customer devices received</p></div>
          <button class="ghost" data-dashboard-action="jobs">View jobs ${icon("chevron", 15)}</button>
        </div>
        ${renderJobRows(allJobs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,6))}
      </section>

      <section class="panel">
        <div class="panel-head"><div><h2>Attention queue</h2><p>Items waiting for a human decision or action</p></div></div>
        ${attentionJobs.length
          ? renderJobRows(attentionJobs.slice(0,6))
          : emptyState("check", "Nothing urgent", "No jobs are currently blocked or waiting on intake requirements.")}
      </section>
    </div>`;

  host.querySelectorAll("[data-dashboard-action]").forEach(button => {
    button.onclick = () => {
      const action = button.dataset.dashboardAction;
      if (action === "intake") startIntake();
      else navigate(action);
    };
  });

  host.querySelectorAll("[data-quick-action]").forEach(button => {
    button.onclick = () => {
      const action = button.dataset.quickAction;
      if (action === "intake") startIntake();
      else navigate(action);
    };
  });

  bindJobRowClicks(host);
  bindTaskChecks(host);
}

function renderCustomers(host) {
  const allCustomers = values(state.data.customers)
    .map(customer => ({ customerId: customer.key, ...customer }))
    .sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
  const showArchivedCustomers = state.ui?.showArchivedCustomers === true;
  const customers = allCustomers.filter(customer => showArchivedCustomers || activeRecord(customer));

  const pendingRequests = values(state.data.customerAccessRequests)
    .filter(request => request.status !== "approved" && request.status !== "rejected");

  host.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">Customer records</span>
        <h1>Customers</h1>
        <p>Search first. Returning customers keep their devices and job history.</p>
      </div>
      <div class="head-actions">
        ${pendingRequests.length && isOps() ? `<button class="secondary" id="portalRequestsBtn">${icon("link",17)} Portal requests <span class="nav-badge alert">${pendingRequests.length}</span></button>` : ""}
        ${isAdmin() ? `<button class="secondary" id="toggleArchivedCustomers">${icon("archive",17)} ${showArchivedCustomers ? "Hide archived" : "Show archived"}</button>` : ""}
        ${isOps() ? `<button class="primary" id="newCustomerBtn">${icon("plus",17)} New customer</button>` : ""}
      </div>
    </div>

    <section class="panel">
      <div class="grid two" style="align-items:end">
        <div class="searchbar">${icon("search",18)}<input id="customerSearch" placeholder="Search name, phone, email or customer ID"></div>
        <div class="muted tiny" style="text-align:right">${customers.length} customer record${customers.length === 1 ? "" : "s"}</div>
      </div>
    </section>

    <section class="panel" id="customerListPanel">${renderCustomerRows(customers)}</section>`;

  document.getElementById("newCustomerBtn")?.addEventListener("click", () => openCustomerModal());
  document.getElementById("toggleArchivedCustomers")?.addEventListener("click", () => {
    state.ui ||= {};
    state.ui.showArchivedCustomers = !state.ui.showArchivedCustomers;
    render();
  });
  document.getElementById("portalRequestsBtn")?.addEventListener("click", openCustomerPortalRequests);

  document.getElementById("customerSearch").oninput = event => {
    const q = event.target.value.trim().toLowerCase();
    const filtered = customers.filter(customer =>
      [customer.customerId, customer.fullName, customer.phone, customer.email]
        .join(" ").toLowerCase().includes(q)
    );
    document.getElementById("customerListPanel").innerHTML = renderCustomerRows(filtered);
    bindCustomerRowClicks();
  };

  bindCustomerRowClicks();
}

function renderCustomerRows(customers) {
  if (!customers.length) return emptyState("customers", "No customers found", "Create a customer before starting their first recovery job.");

  return `<div class="list">${customers.map(customer => {
    const jobCount = values(state.data.jobs).filter(job => job.customerId === customer.customerId).length;
    const deviceCount = values(state.data.devices).filter(device => device.customerId === customer.customerId).length;
    return `
      <div class="list-row clickable" data-customer-id="${customer.customerId}">
        <div class="avatar">${esc(initials(customer.fullName))}</div>
        <div class="list-main">
          <strong>${esc(customer.fullName || "Unnamed customer")} ${isArchived(customer) ? `<span class="status-pill tone-neutral">Archived</span>` : ""}</strong>
          <span>${esc(customer.customerId)} · ${esc(customer.phone || "No phone")} · ${deviceCount} device${deviceCount === 1 ? "" : "s"}</span>
        </div>
        <div class="list-side">
          <span class="status-pill tone-neutral">${jobCount} job${jobCount === 1 ? "" : "s"}</span>
          ${icon("chevron", 16)}
        </div>
      </div>`;
  }).join("")}</div>`;
}

function bindCustomerRowClicks() {
  document.querySelectorAll("[data-customer-id]").forEach(row => {
    row.onclick = () => navigate("customer-detail", { customerId: row.dataset.customerId });
  });
}

function detailTile(label, value) {
  return `<div class="panel flat"><span class="eyebrow">${esc(label)}</span><strong style="display:block;margin-top:7px">${esc(value)}</strong></div>`;
}

function detailInfo(label, value) {
  return `<div><span class="eyebrow">${esc(label)}</span><strong style="display:block;margin-top:6px">${esc(value || "—")}</strong></div>`;
}

function openCustomerModal(existing = null) {
  if (!isOps()) return;
  const isEdit = Boolean(existing);

  const body = `
    <form id="customerForm">
      <div class="form-grid">
        <label class="field"><span>Customer name *</span><input name="fullName" value="${esc(existing?.fullName || "")}" required></label>
        <label class="field"><span>Phone number *</span><input name="phone" value="${esc(existing?.phone || "")}" required></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${esc(existing?.email || "")}"></label>
        <label class="field"><span>Address / area</span><input name="address" value="${esc(existing?.address || "")}"></label>
      </div>
      ${!isEdit && isAdmin() ? `<label class="check-row"><input type="checkbox" name="testRecord"><div><strong>Test / dummy customer</strong><span>Marks this record so the Owner can remove it safely during testing.</span></div></label>` : ""}
      ${isEdit ? `<div class="notice info">Customers cannot change their own name in the portal. Staff changes remain part of the audit history.</div>` : ""}
    </form>`;

  openModal({
    title: isEdit ? "Edit customer" : "New customer",
    subtitle: isEdit ? existing.customerId : "A permanent customer record will be created.",
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="saveCustomerBtn">${icon("check",17)} Save customer</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("saveCustomerBtn").onclick = async () => {
    const formEl = document.getElementById("customerForm");
    if (!formEl.reportValidity()) return;
    const form = new FormData(formEl);
    const button = document.getElementById("saveCustomerBtn");
    setBusy(button, true);

    try {
      if (isEdit) {
        const beforeName = existing.fullName || "";
        await update(ref(db, `customers/${existing.customerId}`), {
          fullName: form.get("fullName").trim(),
          phone: normalizePhone(form.get("phone")),
          email: String(form.get("email") || "").trim(),
          address: String(form.get("address") || "").trim(),
          updatedAt: now(),
          updatedBy: state.user.uid
        });
        await recordAudit(
          "updated",
          "customer",
          existing.customerId,
          beforeName !== form.get("fullName").trim()
            ? `Name changed from ${beforeName} to ${form.get("fullName").trim()}`
            : "Customer details updated"
        );
        toast("Customer updated.", "success");
      } else {
        const customerId = await nextNumber("CUS", "customer");
        await set(ref(db, `customers/${customerId}`), {
          fullName: form.get("fullName").trim(),
          phone: normalizePhone(form.get("phone")),
          email: String(form.get("email") || "").trim(),
          address: String(form.get("address") || "").trim(),
          active: true,
          testRecord: form.get("testRecord") === "on",
          createdAt: now(),
          createdBy: state.user.uid,
          updatedAt: now()
        });
        await recordAudit("created", "customer", customerId, form.get("fullName").trim());
        toast(`${customerId} created.`, "success");
        closeModal();
        navigate("customer-detail", { customerId });
        return;
      }
      closeModal();
    } catch (error) {
      console.error(error);
      toast("Customer could not be saved.", "error");
      setBusy(button, false);
    }
  };
}

function renderCustomerDetail(host) {
  const customer = customerById(state.selectedCustomerId);

  if (!customer) {
    host.innerHTML = emptyState("customers", "Customer not found", "This customer record may have been removed.");
    return;
  }

  const jobs = values(state.data.jobs)
    .filter(job => job.customerId === customer.customerId)
    .map(job => ({ ...job, key: job.key || job.jobId }))
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  const devices = values(state.data.devices)
    .filter(device => device.customerId === customer.customerId)
    .map(device => ({ deviceId: device.key, ...device }))
    .sort((a,b)=>(b.lastSeenAt||b.createdAt||0)-(a.lastSeenAt||a.createdAt||0));

  const accessRequests = values(state.data.customerAccessRequests)
    .filter(request => request.status === "pending" && (
      request.requestedCustomerId === customer.customerId ||
      normalizePhone(request.phone) === normalizePhone(customer.phone)
    ));

  host.innerHTML = `
    <div class="page-head">
      <div>
        <button class="ghost" id="backCustomers">${icon("back",16)} Customers</button>
        <h1>${esc(customer.fullName)}</h1>
        <p>${esc(customer.customerId)} · ${esc(customer.phone || "No phone")}</p>
      </div>
      <div class="head-actions">
        ${accessRequests.length && isOps() ? `<button class="secondary" id="customerAccessBtn">${icon("link",17)} Access request</button>` : ""}
        ${isAdmin() ? `<button class="secondary" id="customerArchiveBtn">${icon("archive",17)} ${isArchived(customer) ? "Restore" : "Archive"}</button>` : ""}
        ${isOwner() && !customer.testRecord ? `<button class="secondary" id="markCustomerTestBtn">${icon("shield",17)} Mark test</button>` : ""}
        ${isOps() ? `<button class="secondary" id="editCustomerBtn">${icon("edit",17)} Edit</button>` : ""}
        ${isOps() && !isArchived(customer) ? `<button class="primary" id="customerNewIntake">${icon("plus",17)} New intake</button>` : ""}
      </div>
    </div>

    <div class="grid three">
      ${detailTile("Phone", customer.phone || "—")}
      ${detailTile("Email", customer.email || "—")}
      ${detailTile("Address / area", customer.address || "—")}
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Customer follow-up</h2><p>Operational emails and relationship follow-up stay on the customer timeline.</p></div>
        <button class="secondary" id="addFollowupBtn">${icon("plus",16)} Add follow-up note</button>
      </div>
      <div class="form-grid">
        ${detailInfo("Marketing / greetings", customer.marketingConsent === false ? "Opted out" : "Allowed / not opted out")}
        ${detailInfo("Last contacted", formatDate(customer.lastContactedAt))}
      </div>
      <div class="notice info" style="margin-top:12px">Automatic email delivery is not active yet. V2.1 records the communication workflow now so an email service can be connected without redesigning customers again.</div>
    </section>

    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <div class="panel-head">
          <div><h2>Registered devices</h2><p>Returning devices stay linked to this customer</p></div>
          <span class="status-pill tone-neutral">${devices.length}</span>
        </div>
        ${devices.length ? `<div class="list">${devices.map(device => `
          <div class="list-row">
            <div class="list-icon">${icon("devices",18)}</div>
            <div class="list-main">
              <strong>${esc(device.deviceId)} · ${esc(device.type || "Device")}</strong>
              <span>${esc([device.brandModel, device.capacity, device.serial].filter(Boolean).join(" · ") || "No further details")}</span>
            </div>
            <div class="list-side"><span class="tiny muted">${device.lastSeenAt ? `Last seen ${formatDate(device.lastSeenAt)}` : ""}</span></div>
          </div>`).join("")}</div>` : emptyState("devices", "No registered devices", "The first intake will create device records.")}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h2>Job history</h2><p>Every visit remains part of the customer history</p></div>
          <span class="status-pill tone-neutral">${jobs.length}</span>
        </div>
        ${renderJobRows(jobs)}
      </section>
    </div>`;

  document.getElementById("backCustomers").onclick = () => navigate("customers");
  document.getElementById("editCustomerBtn")?.addEventListener("click", () => openCustomerModal(customer));
  document.getElementById("customerArchiveBtn")?.addEventListener("click", () => archiveRecord(`customers/${customer.customerId}`, "customer", customer.customerId, customer.fullName, !isArchived(customer)));
  document.getElementById("markCustomerTestBtn")?.addEventListener("click", () => markLegacyTestRecord(`customers/${customer.customerId}`, "customer", customer.customerId, customer.fullName));
  document.getElementById("customerNewIntake")?.addEventListener("click", () => startIntake(customer.customerId));
  document.getElementById("addFollowupBtn")?.addEventListener("click", () => openFollowupModal(customer));
  document.getElementById("customerAccessBtn")?.addEventListener("click", () => openCustomerPortalRequests(customer.customerId));
  bindJobRowClicks(host);
}


function openCustomerPortalRequests(preselectedCustomerId = "") {
  if (!isOps()) return;

  const requests = values(state.data.customerAccessRequests)
    .filter(request => request.status !== "approved" && request.status !== "rejected");

  const customers = values(state.data.customers)
    .map(customer => ({ customerId: customer.key, ...customer }));

  const body = requests.length ? `
    <div class="list">
      ${requests.map(request => `
        <div class="list-row">
          <div class="list-icon">${icon("user",18)}</div>
          <div class="list-main">
            <strong>${esc(request.email || "Signed-in customer")}</strong>
            <span>Requested ${esc(request.requestedCustomerId || "no ID")} · ${esc(request.phone || "no phone")}${request.jobId ? ` · ${esc(request.jobId)}` : ""}</span>
          </div>
          <div class="list-side">
            <button class="primary" data-approve-customer="${request.key}">${icon("check",15)} Review</button>
          </div>
        </div>`).join("")}
    </div>` : emptyState("check", "No pending portal requests", "There are no customer access requests waiting.");

  openModal({
    title: "Customer portal requests",
    subtitle: "Staff/Admin must match each login to a customer record.",
    body,
    wide: true
  });

  modalHost.querySelectorAll("[data-approve-customer]").forEach(button => {
    button.onclick = () => {
      const request = state.data.customerAccessRequests[button.dataset.approveCustomer];
      closeModal();
      openCustomerApprovalModal(button.dataset.approveCustomer, request, customers, preselectedCustomerId);
    };
  });
}

function openCustomerApprovalModal(uid, request, customers, preselectedCustomerId = "") {
  const suggested = preselectedCustomerId || (
    customers.find(customer => customer.customerId === request.requestedCustomerId)?.customerId ||
    customers.find(customer => normalizePhone(customer.phone) === normalizePhone(request.phone))?.customerId ||
    ""
  );

  const body = `
    <div class="notice warning">Verify the person and customer record before approving. Approval lets this login see that customer's client-visible jobs and documents.</div>
    <form id="customerApprovalForm" style="margin-top:14px">
      <label class="field"><span>Customer record *</span>
        <select name="customerId" required>
          <option value="">Select customer</option>
          ${customers
            .sort((a,b)=>(a.fullName||"").localeCompare(b.fullName||""))
            .map(customer => `<option value="${customer.customerId}" ${customer.customerId === suggested ? "selected" : ""}>${esc(customer.customerId)} · ${esc(customer.fullName)}</option>`)
            .join("")}
        </select>
      </label>
      <div class="grid two">
        ${detailTile("Login email", request.email || "—")}
        ${detailTile("Phone supplied", request.phone || "—")}
      </div>
    </form>`;

  openModal({
    title: "Approve customer portal",
    subtitle: request.email || uid,
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="approveCustomerAccess">${icon("shield",17)} Approve access</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("approveCustomerAccess").onclick = async () => {
    const form = document.getElementById("customerApprovalForm");
    if (!form.reportValidity()) return;
    const customerId = new FormData(form).get("customerId");
    const customer = customerById(customerId);
    const button = document.getElementById("approveCustomerAccess");
    setBusy(button, true);

    try {
      const access = {
        customerId,
        email: request.email || "",
        active: true,
        approvedBy: state.user.uid,
        approvedAt: now()
      };

      await set(ref(db, `customerAccess/${uid}`), access);
      await update(ref(db, `customerAccessRequests/${uid}`), {
        status: "approved",
        approvedCustomerId: customerId,
        approvedBy: state.user.uid,
        approvedAt: now()
      });

      const mirror = await syncCustomerAccessMirror(uid, access);
      await recordAudit("approved portal access", "customer", customerId, request.email || "");
      closeModal();
      toast(`Portal access approved for ${customer?.fullName || customerId}.${mirror ? "" : " Storage access mirror will need Firestore setup."}`, "success");
    } catch (error) {
      console.error(error);
      toast("Customer access could not be approved.", "error");
      setBusy(button, false);
    }
  };
}


function openFollowupModal(customer) {
  const body = `
    <form id="followupForm">
      <label class="field"><span>Type</span>
        <select name="type">
          <option>Follow-up call</option>
          <option>Email planned</option>
          <option>Happy New Month</option>
          <option>Holiday greeting</option>
          <option>Thank-you</option>
          <option>Other</option>
        </select>
      </label>
      <label class="field"><span>Note *</span><textarea name="note" required></textarea></label>
      <label class="check-row">
        <input name="marketingConsent" type="checkbox" ${customer.marketingConsent===false?"":"checked"}>
        <div><strong>Customer allows non-service greetings/marketing</strong><span>Operational job updates are separate from promotional or relationship messages.</span></div>
      </label>
    </form>`;

  openModal({
    title:"Customer follow-up",
    subtitle:`${customer.customerId} · ${customer.fullName}`,
    body,
    actions:`<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="saveFollowupBtn">${icon("check",17)} Save</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick=closeModal;

  document.getElementById("saveFollowupBtn").onclick=async()=>{
    const form=document.getElementById("followupForm");
    if(!form.reportValidity()) return;
    const data=new FormData(form);

    try {
      const communicationRef=push(ref(db,`communications/${customer.customerId}`));
      await set(communicationRef,{
        type:data.get("type"),
        note:data.get("note").trim(),
        createdAt:now(),
        createdBy:state.user.uid,
        createdByName:profileDisplay()
      });

      await update(ref(db,`customers/${customer.customerId}`),{
        marketingConsent:data.get("marketingConsent")==="on",
        lastContactedAt:now(),
        updatedAt:now()
      });

      await recordAudit("recorded follow-up","customer",customer.customerId,data.get("type"));
      closeModal();
      toast("Follow-up recorded.","success");
    } catch {
      toast("Follow-up could not be saved.","error");
    }
  };
}


function renderJobs(host) {
  const allJobs = values(state.data.jobs)
    .map(job => ({ ...job, key: job.key || job.jobId }))
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const showArchivedJobs = state.ui?.showArchivedJobs === true;
  const jobs = allJobs.filter(job => showArchivedJobs || activeRecord(job));

  host.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">Recovery work</span>
        <h1>Jobs</h1>
        <p>Every intake, device and recovery decision in one queue.</p>
      </div>
      <div class="head-actions">
        ${isAdmin() ? `<button class="secondary" id="toggleArchivedJobs">${icon("archive",17)} ${showArchivedJobs ? "Hide archived" : "Show archived"}</button>` : ""}
        ${isOps() ? `<button class="primary" id="jobsNewIntake">${icon("plus",17)} New intake</button>` : ""}
      </div>
    </div>

    <section class="panel">
      <div class="grid two">
        <div class="searchbar">${icon("search",18)}<input id="jobSearch" placeholder="Search job, customer, phone or device"></div>
        <div class="filters" style="justify-content:flex-end">
          <select id="jobStatusFilter">
            <option value="">All statuses</option>
            ${JOB_STATUSES.map(status => `<option>${status}</option>`).join("")}
          </select>
        </div>
      </div>
    </section>

    <section class="panel" id="jobListHost">${renderJobRows(jobs)}</section>`;

  document.getElementById("jobsNewIntake")?.addEventListener("click", () => startIntake());
  document.getElementById("toggleArchivedJobs")?.addEventListener("click", () => {
    state.ui ||= {};
    state.ui.showArchivedJobs = !state.ui.showArchivedJobs;
    render();
  });

  const filter = () => {
    const q = document.getElementById("jobSearch").value.trim().toLowerCase();
    const status = document.getElementById("jobStatusFilter").value;

    const filtered = jobs.filter(job => {
      const customer = jobCustomer(job);
      const hay = [
        job.jobId,
        jobDisplayName(job),
        customer?.phone,
        jobDeviceSummary(job)
      ].join(" ").toLowerCase();

      return (!q || hay.includes(q)) && (!status || job.status === status);
    });

    document.getElementById("jobListHost").innerHTML = renderJobRows(filtered);
    bindJobRowClicks(document.getElementById("jobListHost"));
  };

  document.getElementById("jobSearch").oninput = filter;
  document.getElementById("jobStatusFilter").onchange = filter;
  bindJobRowClicks(host);
}

function startIntake(preselectedCustomerId = "") {
  if (!isOps()) return;
  state.intakeDraft = createIntakeDraft(preselectedCustomerId);
  navigate("new-intake");
}

function createIntakeDraft(customerId = "") {
  return {
    customerMode: "existing",
    customerId,
    newCustomer: { fullName: "", phone: "", email: "", address: "" },
    ownerName: "",
    submitterName: "",
    submitterRelationship: "",
    signerName: "",
    signerAuthority: "",
    assessmentFee: company().defaultAssessmentFee || "",
    paymentMethod: "Moniepoint Transfer",
    paymentReference: "",
    paymentConfirmed: false,
    feeWaived: false,
    signatureCollected: false,
    staffNotes: "",
    devices: []
  };
}

function intakeField(label, path, value = "", type = "text", placeholder = "") {
  return `<label class="field"><span>${esc(label)}</span><input data-intake-field="${esc(path)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
}

function intakeCheck(path, title, description, checked) {
  return `
    <label class="check-row">
      <input type="checkbox" data-intake-field="${path}" ${checked ? "checked" : ""}>
      <div><strong>${esc(title)}</strong><span>${esc(description)}</span></div>
    </label>`;
}

function checkpointHtml(label, done, text) {
  return `<div class="checkpoint ${done ? "done" : "attention"}">
    <strong>${done ? icon("check",15) : icon("alert",15)} ${esc(label)}</strong>
    <span>${esc(text)}</span>
  </div>`;
}

function intakeDeviceCard(device, index) {
  const selectedCustomer = customerById(state.intakeDraft.customerId);
  const existingDevices = selectedCustomer
    ? values(state.data.devices)
        .filter(item => item.customerId === selectedCustomer.customerId)
        .map(item => ({ deviceId: item.key, ...item }))
    : [];

  return `
    <div class="device-card" data-device-index="${index}">
      <div class="device-card-head">
        <strong>
          ${icon("devices",18)}
          Device ${index + 1}
          ${device.mode === "existing"
            ? `<span class="status-pill tone-info">Returning</span>`
            : `<span class="status-pill tone-brand-1">New</span>`}
        </strong>
        <button class="ghost danger" data-remove-intake-device="${index}">${icon("trash",16)} Remove</button>
      </div>

      ${device.mode === "existing" ? `
        <label class="field"><span>Registered device *</span>
          <select data-device-field="deviceId">
            <option value="">Select device</option>
            ${existingDevices.map(item => `<option value="${item.deviceId}" ${device.deviceId === item.deviceId ? "selected" : ""}>${esc(item.deviceId)} · ${esc(item.type || "Device")} · ${esc(item.brandModel || item.capacity || "")}</option>`).join("")}
          </select>
        </label>
        <label class="field"><span>Condition at this intake</span><input data-device-field="conditionAtIntake" value="${esc(device.conditionAtIntake || "")}" placeholder="Any new damage, symptoms or changes"></label>
      ` : `
        <div class="form-grid three">
          <label class="field"><span>Device type *</span>
            <select data-device-field="type">
              ${["Hard Disk Drive (HDD)","Solid State Drive (SSD)","SD Card","MicroSD Card","USB Flash Drive","Other"]
                .map(type => `<option ${device.type === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Brand / model</span><input data-device-field="brandModel" value="${esc(device.brandModel || "")}"></label>
          <label class="field"><span>Capacity</span><input data-device-field="capacity" value="${esc(device.capacity || "")}" placeholder="e.g. 1TB, 64GB"></label>
          <label class="field"><span>Serial number</span><input data-device-field="serial" value="${esc(device.serial || "")}"></label>
          <label class="field"><span>Physical condition</span><input data-device-field="conditionAtIntake" value="${esc(device.conditionAtIntake || "")}"></label>
          <label class="field"><span>Previous repair/recovery attempt?</span>
            <select data-device-field="previousAttempt">
              ${["No","Yes","Unknown"].map(value => `<option ${device.previousAttempt === value ? "selected" : ""}>${value}</option>`).join("")}
            </select>
          </label>
        </div>
        <label class="field"><span>Problem reported</span><textarea data-device-field="problem">${esc(device.problem || "")}</textarea></label>
        <label class="field"><span>Important data requested</span><textarea data-device-field="requestedData">${esc(device.requestedData || "")}</textarea></label>
      `}

      <div class="device-photo-drop">
        ${icon("camera",20)}
        <strong style="display:block;margin-top:6px;color:var(--text)">Intake / condition photos</strong>
        <span class="tiny">${device.files?.length
          ? `${device.files.length} photo${device.files.length === 1 ? "" : "s"} selected`
          : "Optional until Firebase Storage is enabled; later this can become a required checkpoint."}</span>
        <label class="button secondary" style="margin-top:8px">
          ${icon("camera",16)} Take / choose photos
          <input class="file-input-hidden" type="file" accept="image/*" capture="environment" multiple data-device-photos="${index}">
        </label>
      </div>
    </div>`;
}

function renderNewIntake(host) {
  if (!isOps()) {
    host.innerHTML = emptyState("shield", "Operations access required", "Your role cannot create recovery jobs.");
    return;
  }

  if (!state.intakeDraft) state.intakeDraft = createIntakeDraft();

  const draft = state.intakeDraft;
  const customers = values(state.data.customers)
    .map(customer => ({ customerId: customer.key, ...customer }))
    .sort((a,b)=>(a.fullName||"").localeCompare(b.fullName||""));

  host.innerHTML = `
    <div class="page-head">
      <div>
        <button class="ghost" id="cancelIntake">${icon("back",16)} Back</button>
        <h1>New intake</h1>
        <p>One customer, one job, one or many devices.</p>
      </div>
      <div class="head-actions"><span class="status-pill tone-brand-1">Intake workflow</span></div>
    </div>

    <section class="panel form-section">
      <h2>1. Customer</h2>
      <p>Search and reuse a returning customer's record whenever possible.</p>

      <div class="segmented" style="margin-bottom:14px">
        <button class="${draft.customerMode === "existing" ? "active" : ""}" data-customer-mode="existing">Existing customer</button>
        <button class="${draft.customerMode === "new" ? "active" : ""}" data-customer-mode="new">New customer</button>
      </div>

      ${draft.customerMode === "existing" ? `
        <label class="field"><span>Customer *</span>
          <select id="intakeCustomerId">
            <option value="">Select customer</option>
            ${customers.map(customer => `<option value="${customer.customerId}" ${draft.customerId === customer.customerId ? "selected" : ""}>${esc(customer.customerId)} · ${esc(customer.fullName)} · ${esc(customer.phone || "")}</option>`).join("")}
          </select>
        </label>
      ` : `
        <div class="form-grid">
          ${intakeField("Customer name *", "newCustomer.fullName", draft.newCustomer.fullName)}
          ${intakeField("Phone number *", "newCustomer.phone", draft.newCustomer.phone)}
          ${intakeField("Email", "newCustomer.email", draft.newCustomer.email, "email")}
          ${intakeField("Address / area", "newCustomer.address", draft.newCustomer.address)}
        </div>
      `}
    </section>

    <section class="panel form-section">
      <div class="panel-head">
        <div><h2>2. Devices</h2><p>Add every device handed over in this visit.</p></div>
        <div class="head-actions">
          ${draft.customerMode === "existing" && draft.customerId ? `<button class="secondary" id="addExistingDevice">${icon("link",16)} Existing device</button>` : ""}
          <button class="primary" id="addNewDevice">${icon("plus",16)} New device</button>
        </div>
      </div>

      <div id="intakeDeviceList">
        ${draft.devices.length
          ? draft.devices.map((device,index) => intakeDeviceCard(device,index)).join("")
          : emptyState("devices","No devices added","Add the HDD, SSD, SD card or other storage device being submitted.")}
      </div>
    </section>

    <section class="panel form-section">
      <h2>3. Ownership, submitter & signer</h2>
      <p>These can be different people. Leave a field blank to use the selected customer's name.</p>
      <div class="form-grid three">
        ${intakeField("Device owner", "ownerName", draft.ownerName)}
        ${intakeField("Submitted by", "submitterName", draft.submitterName)}
        ${intakeField("Submitter relationship", "submitterRelationship", draft.submitterRelationship, "text", "e.g. employee, brother, courier")}
        ${intakeField("Authorization signed by", "signerName", draft.signerName)}
        ${intakeField("Signer authority / relationship", "signerAuthority", draft.signerAuthority)}
      </div>
    </section>

    <section class="panel form-section">
      <h2>4. Assessment payment & physical authorization</h2>
      <p>The worker receiving the device confirms the real-world payment and signed paperwork.</p>

      <div class="form-grid three">
        ${intakeField("Assessment fee (₦)", "assessmentFee", draft.assessmentFee, "number")}
        <label class="field"><span>Payment method</span>
          <select data-intake-field="paymentMethod">
            ${["Moniepoint Transfer","POS","Cash","Bank Transfer","Other"]
              .map(method => `<option ${draft.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}
          </select>
        </label>
        ${intakeField("Payment reference", "paymentReference", draft.paymentReference)}
      </div>

      <div style="margin-top:8px">
        ${intakeCheck("paymentConfirmed", "Payment confirmed", "The receiving worker has verified the assessment payment.", draft.paymentConfirmed)}
        ${intakeCheck("feeWaived", "Assessment fee waived", "Admin/authorized staff has approved proceeding without the assessment fee.", draft.feeWaived)}
        ${intakeCheck("signatureCollected", "Physical authorization signed and collected", "The customer/authorized signer has signed the printed intake/service agreement.", draft.signatureCollected)}
      </div>
    </section>

    <section class="panel form-section">
      <h2>5. Staff notes</h2>
      <textarea data-intake-field="staffNotes" placeholder="Internal notes for the recovery team">${esc(draft.staffNotes)}</textarea>
    </section>

    <section class="panel">
      <div class="checkpoint-grid">
        ${checkpointHtml("Devices", draft.devices.length > 0, `${draft.devices.length} device${draft.devices.length === 1 ? "" : "s"} added`)}
        ${checkpointHtml("Payment", draft.paymentConfirmed || draft.feeWaived || !safeNumber(draft.assessmentFee), draft.feeWaived ? "Fee waived" : draft.paymentConfirmed ? "Confirmed" : "Not confirmed")}
        ${checkpointHtml("Authorization", draft.signatureCollected, draft.signatureCollected ? "Signature collected" : "Signature pending")}
      </div>

      <div class="head-actions" style="margin-top:16px">
        <button class="secondary" id="discardIntake">Discard</button>
        <button class="primary" id="saveIntake">${icon("check",17)} Save intake</button>
      </div>
    </section>`;

  bindIntakeEvents(host);
}

function setNested(object, path, value) {
  const parts = path.split(".");
  let current = object;
  parts.slice(0,-1).forEach(part => {
    if (!current[part]) current[part] = {};
    current = current[part];
  });
  current[parts.at(-1)] = value;
}

function historyBackFromIntake() {
  if (state.intakeDraft?.customerId) navigate("customer-detail", { customerId: state.intakeDraft.customerId });
  else navigate("jobs");
}

function bindIntakeEvents(host) {
  document.getElementById("cancelIntake").onclick = historyBackFromIntake;
  document.getElementById("discardIntake").onclick = () => {
    state.intakeDraft = null;
    navigate("jobs");
  };

  host.querySelectorAll("[data-customer-mode]").forEach(button => {
    button.onclick = () => {
      state.intakeDraft.customerMode = button.dataset.customerMode;
      state.intakeDraft.customerId = "";
      state.intakeDraft.devices = [];
      renderCurrentView();
    };
  });

  document.getElementById("intakeCustomerId")?.addEventListener("change", event => {
    state.intakeDraft.customerId = event.target.value;
    state.intakeDraft.devices = [];
    renderCurrentView();
  });

  host.querySelectorAll("[data-intake-field]").forEach(input => {
    input.oninput = input.onchange = () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      setNested(state.intakeDraft, input.dataset.intakeField, value);
    };
  });

  document.getElementById("addNewDevice").onclick = () => {
    state.intakeDraft.devices.push({
      mode: "new",
      type: "Hard Disk Drive (HDD)",
      brandModel: "",
      capacity: "",
      serial: "",
      conditionAtIntake: "",
      previousAttempt: "No",
      problem: "",
      requestedData: "",
      files: []
    });
    renderCurrentView();
  };

  document.getElementById("addExistingDevice")?.addEventListener("click", () => {
    state.intakeDraft.devices.push({
      mode: "existing",
      deviceId: "",
      conditionAtIntake: "",
      files: []
    });
    renderCurrentView();
  });

  host.querySelectorAll("[data-remove-intake-device]").forEach(button => {
    button.onclick = () => {
      state.intakeDraft.devices.splice(Number(button.dataset.removeIntakeDevice), 1);
      renderCurrentView();
    };
  });

  host.querySelectorAll("[data-device-index]").forEach(card => {
    const index = Number(card.dataset.deviceIndex);
    card.querySelectorAll("[data-device-field]").forEach(input => {
      input.oninput = input.onchange = () => {
        state.intakeDraft.devices[index][input.dataset.deviceField] = input.value;
      };
    });
  });

  host.querySelectorAll("[data-device-photos]").forEach(input => {
    input.onchange = () => {
      const index = Number(input.dataset.devicePhotos);
      state.intakeDraft.devices[index].files = [...input.files];
      renderCurrentView();
    };
  });

  document.getElementById("saveIntake").onclick = saveIntake;
}

async function saveIntake() {
  const draft = state.intakeDraft;
  const button = document.getElementById("saveIntake");

  if (!draft.devices.length) return toast("Add at least one device.", "error");
  if (draft.customerMode === "existing" && !draft.customerId) return toast("Select the customer.", "error");

  if (draft.customerMode === "new" && (!draft.newCustomer.fullName.trim() || !draft.newCustomer.phone.trim())) {
    return toast("Enter the new customer's name and phone number.", "error");
  }

  if (draft.devices.some(device => device.mode === "existing" && !device.deviceId)) {
    return toast("Choose each returning device.", "error");
  }

  if (draft.devices.some(device => device.mode === "new" && !device.type)) {
    return toast("Complete the device type for every new device.", "error");
  }

  setBusy(button, true, "Saving intake…");

  try {
    let customerId = draft.customerId;
    let customer = customerById(customerId);

    if (draft.customerMode === "new") {
      customerId = await nextNumber("CUS", "customer");
      customer = {
        customerId,
        fullName: draft.newCustomer.fullName.trim(),
        phone: normalizePhone(draft.newCustomer.phone),
        email: draft.newCustomer.email.trim(),
        address: draft.newCustomer.address.trim()
      };

      await set(ref(db, `customers/${customerId}`), {
        fullName: customer.fullName,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        active: true,
        createdAt: now(),
        createdBy: state.user.uid,
        updatedAt: now()
      });

      await recordAudit("created", "customer", customerId, customer.fullName);
    }

    if (!customer) throw new Error("Customer not found");

    const deviceIds = {};
    const deviceSnapshots = {};
    const uploadQueue = [];

    for (const draftDevice of draft.devices) {
      let deviceId;
      let deviceRecord;

      if (draftDevice.mode === "existing") {
        deviceId = draftDevice.deviceId;
        deviceRecord = deviceById(deviceId);

        if (!deviceRecord || deviceRecord.customerId !== customerId) {
          throw new Error("Returning device does not belong to customer");
        }

        await update(ref(db, `devices/${deviceId}`), {
          lastSeenAt: now(),
          latestCondition: draftDevice.conditionAtIntake || deviceRecord.latestCondition || deviceRecord.condition || "",
          updatedAt: now()
        });
      } else {
        deviceId = await nextNumber("DEV", "device");
        deviceRecord = {
          deviceId,
          customerId,
          type: draftDevice.type,
          brandModel: draftDevice.brandModel || "",
          capacity: draftDevice.capacity || "",
          serial: draftDevice.serial || "",
          condition: draftDevice.conditionAtIntake || "",
          previousAttempt: draftDevice.previousAttempt || "No",
          problem: draftDevice.problem || "",
          requestedData: draftDevice.requestedData || "",
          testRecord: Boolean(customer.testRecord),
          createdAt: now(),
          createdBy: state.user.uid,
          lastSeenAt: now(),
          updatedAt: now()
        };

        await set(ref(db, `devices/${deviceId}`), deviceRecord);
        await set(ref(db, `customerDevices/${customerId}/${deviceId}`), true);
        await recordAudit("registered", "device", deviceId, `${deviceRecord.type} for ${customer.fullName}`);
      }

      deviceIds[deviceId] = true;
      deviceSnapshots[deviceId] = {
        conditionAtIntake: draftDevice.conditionAtIntake || deviceRecord.condition || "",
        returning: draftDevice.mode === "existing",
        capturedAt: now()
      };

      if (draftDevice.files?.length) uploadQueue.push({ deviceId, files: draftDevice.files });
    }

    const jobId = await nextNumber("DR", "jobs");
    const assessmentFee = safeNumber(draft.assessmentFee);
    const paymentSatisfied = draft.paymentConfirmed || draft.feeWaived || assessmentFee === 0;
    const photoRequired = Boolean(company().requireIntakePhotos);
    const photoSatisfiedInitially = !photoRequired || uploadQueue.length >= draft.devices.length;
    const ready = paymentSatisfied && draft.signatureCollected && photoSatisfiedInitially;

    const job = {
      jobId,
      customerId,
      customerNameSnapshot: customer.fullName,
      ownerName: draft.ownerName.trim() || customer.fullName,
      submitterName: draft.submitterName.trim() || customer.fullName,
      submitterRelationship: draft.submitterRelationship.trim(),
      signerName: draft.signerName.trim() || customer.fullName,
      signerAuthority: draft.signerAuthority.trim(),
      deviceIds,
      deviceSnapshots,
      assessmentFee,
      assessmentPaymentMethod: draft.paymentMethod,
      assessmentPaymentReference: draft.paymentReference.trim(),
      assessmentPaymentConfirmed: Boolean(draft.paymentConfirmed),
      assessmentPaymentConfirmedBy: draft.paymentConfirmed ? state.user.uid : "",
      assessmentPaymentConfirmedAt: draft.paymentConfirmed ? now() : null,
      assessmentFeeWaived: Boolean(draft.feeWaived),
      signatureCollected: Boolean(draft.signatureCollected),
      signatureConfirmedBy: draft.signatureCollected ? state.user.uid : "",
      signatureConfirmedAt: draft.signatureCollected ? now() : null,
      intakePhotosRequired: photoRequired,
      intakePhotosComplete: !photoRequired,
      staffNotes: draft.staffNotes.trim(),
      assessmentResult: "Pending",
      recoveryQuote: 0,
      status: ready ? "Ready for Assessment" : "Intake Pending",
      assignedTo: state.user.uid,
      assignedToName: profileDisplay(),
      assignedAt: now(),
      assignedBy: state.user.uid,
      recordState: "draft",
      testRecord: Boolean(customer.testRecord),
      submittedAt: null,
      submittedBy: "",
      createdAt: now(),
      createdBy: state.user.uid,
      updatedAt: now()
    };

    await set(ref(db, `jobs/${jobId}`), job);
    await set(ref(db, `customerJobs/${customerId}/${jobId}`), true);

    if (draft.paymentConfirmed && assessmentFee > 0) {
      await createPayment({
        jobKey: jobId,
        customerId,
        amount: assessmentFee,
        category: "Assessment fee",
        method: draft.paymentMethod,
        reference: draft.paymentReference.trim(),
        note: "Recorded during intake"
      }, false);
    }

    await recordAudit("created", "job", jobId, `${customer.fullName} · ${draft.devices.length} device(s)`);

    let allUploadsSucceeded = true;

    if (uploadQueue.length) {
      for (const item of uploadQueue) {
        const result = await uploadFilesForJob({
          jobKey: jobId,
          job: { ...job, key: jobId },
          customerId,
          files: item.files,
          category: "device-intake",
          deviceId: item.deviceId,
          clientVisible: false,
          silentFailure: true
        });
        if (!result) allUploadsSucceeded = false;
      }
    }

    if (photoRequired) {
      const photosComplete = allUploadsSucceeded && uploadQueue.length >= draft.devices.length;
      await update(ref(db, `jobs/${jobId}`), {
        intakePhotosComplete: photosComplete,
        status: paymentSatisfied && draft.signatureCollected && photosComplete ? "Ready for Assessment" : "Intake Pending",
        updatedAt: now()
      });
    }

    state.intakeDraft = null;
    toast(`${jobId} created.`, "success");
    navigate("job-detail", { jobKey: jobId });
  } catch (error) {
    console.error(error);
    toast("The intake could not be saved. Nothing should be handed to assessment until the record is complete.", "error");
    setBusy(button, false);
  }
}



function openMailComposer({ to = "", subject = "", body = "" }) {
  if (!to) {
    toast("This customer does not have an email address saved.", "error");
    return;
  }

  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
}

function emailJobUpdate(job) {
  const customer = jobCustomer(job);
  openMailComposer({
    to: customer?.email || "",
    subject: `${company().name} · ${job.jobId || job.key} · ${job.status}`,
    body:
`Hello ${customer?.fullName || "Customer"},

Your data recovery job ${job.jobId || job.key} has reached this stage:

${job.status}

You can contact WISCODE INNOVATIONS LTD if you need clarification.

Regards,
${company().name}`
  });
}

function emailInvoiceNotice(job) {
  const customer = jobCustomer(job);
  openMailComposer({
    to: customer?.email || "",
    subject: `${company().name} invoice · ${job.jobId || job.key}`,
    body:
`Hello ${customer?.fullName || "Customer"},

Your invoice for data recovery job ${job.jobId || job.key} is ready.

Please attach the PDF generated from RecoveryDesk before sending this email.

Job: ${job.jobId || job.key}
Outstanding balance: ${formatMoney(outstandingForJob(job))}

Regards,
${company().name}`
  });
}

function staffName(uid) {
  const profile = state.data.users?.[uid];
  return profile?.displayName || profile?.realName || profile?.name || "staff";
}


function isArchived(record) {
  return Boolean(record?.archivedAt || record?.archived === true);
}

function activeRecord(record) {
  return !isArchived(record);
}

function managementReasonModal({ title, subtitle = "", warning = "", label = "Reason *", minLength = 5, confirmText = "Confirm" }) {
  return new Promise(resolve => {
    const body = `
      ${warning ? `<div class="notice warning">${warning}</div>` : ""}
      <form id="managementReasonForm" style="margin-top:12px">
        <label class="field"><span>${esc(label)}</span>
          <textarea id="managementReasonText" minlength="${minLength}" required></textarea>
        </label>
      </form>`;
    openModal({
      title,
      subtitle,
      body,
      actions: `<button class="secondary" id="managementReasonCancel">Cancel</button><button class="primary" id="managementReasonConfirm">${confirmText}</button>`
    });
    document.getElementById("managementReasonCancel").onclick = () => {
      closeModal();
      resolve("");
    };
    document.getElementById("managementReasonConfirm").onclick = () => {
      const form = document.getElementById("managementReasonForm");
      if (!form.reportValidity()) return;
      const value = document.getElementById("managementReasonText").value.trim();
      closeModal();
      resolve(value);
    };
  });
}

async function archiveRecord(path, recordType, recordId, label, archived = true) {
  const reason = await managementReasonModal({
    title: archived ? `Archive ${recordType}` : `Restore ${recordType}`,
    subtitle: label || recordId,
    warning: archived
      ? "Archiving removes this record from normal active queues without erasing its history."
      : "Restoring returns this record to active operational lists.",
    label: archived ? "Reason for archive *" : "Reason for restoration *",
    confirmText: archived ? "Archive" : "Restore"
  });
  if (!reason) return false;

  try {
    await update(ref(db, path), archived ? {
      archived: true,
      archivedAt: now(),
      archivedBy: state.user.uid,
      archivedByName: profileDisplay(),
      archiveReason: reason,
      updatedAt: now()
    } : {
      archived: false,
      archivedAt: null,
      archivedBy: "",
      archivedByName: "",
      archiveReason: "",
      restoredAt: now(),
      restoredBy: state.user.uid,
      updatedAt: now()
    });
    await recordAudit(archived ? "archived" : "restored", recordType, recordId, reason);
    toast(`${recordType[0].toUpperCase()+recordType.slice(1)} ${archived ? "archived" : "restored"}.`, "success");
    return true;
  } catch (error) {
    console.error(error);
    toast(`${recordType} could not be ${archived ? "archived" : "restored"}.`, "error");
    return false;
  }
}

async function markLegacyTestRecord(path, recordType, recordId, label) {
  if (!isOwner()) return;
  const reason = await managementReasonModal({
    title: "Mark as test data",
    subtitle: label || recordId,
    warning: "This does not delete anything now. It only makes this old record eligible for Owner Test Data Cleanup. Do not use this on a real customer/job.",
    label: "Why is this a test/dummy record? *",
    minLength: 8,
    confirmText: "Mark as test"
  });
  if (!reason) return;
  try {
    await update(ref(db, path), {
      testRecord: true,
      testMarkedAt: now(),
      testMarkedBy: state.user.uid,
      testMarkReason: reason,
      updatedAt: now()
    });
    await recordAudit("marked test data", recordType, recordId, reason);
    toast("Marked as test data. It will now appear in Owner Test Data Cleanup.", "success");
  } catch (error) {
    console.error(error);
    toast("Record could not be marked as test data.", "error");
  }
}

function canManageTask(task) {
  return isAdmin() || task?.assignedTo === state.user?.uid;
}


function workerOwnsJob(job) {
  return state.staff?.role === "worker" && (
    job?.assignedTo === state.user?.uid ||
    (!job?.assignedTo && job?.createdBy === state.user?.uid)
  );
}

function canControlJob(job) {
  return isAdmin() || workerOwnsJob(job);
}

function jobIsSubmitted(job) {
  return job?.recordState === "submitted";
}

function requestSubmittedEditReason(job) {
  return new Promise(resolve => {
    const body = `
      <div class="notice warning">
        This job record has already been submitted. Changes are permanently auditable and may have legal or compliance consequences if the record is altered inaccurately.
      </div>
      <form id="submittedEditReasonForm" style="margin-top:14px">
        <label class="field"><span>Reason for editing this submitted record *</span>
          <textarea id="submittedEditReason" minlength="10" required placeholder="Explain exactly why this submitted job record needs to be changed."></textarea>
        </label>
        <div class="notice info">The reason, your identity, date/time and the edited values will be kept in the audit trail.</div>
      </form>`;

    openModal({
      title: "Edit submitted job",
      subtitle: job.jobId || job.key,
      body,
      actions: `<button class="secondary" id="cancelSubmittedEdit">Cancel</button><button class="primary" id="confirmSubmittedEdit">${icon("audit",17)} Continue with edit</button>`
    });

    document.getElementById("cancelSubmittedEdit").onclick = () => {
      closeModal();
      resolve("");
    };

    document.getElementById("confirmSubmittedEdit").onclick = () => {
      const form = document.getElementById("submittedEditReasonForm");
      if (!form.reportValidity()) return;
      const reason = document.getElementById("submittedEditReason").value.trim();
      closeModal();
      resolve(reason);
    };
  });
}

function renderJobDetail(host) {
  const job = jobByKey(state.selectedJobKey);

  if (!job) {
    host.innerHTML = emptyState("jobs", "Job not found", "This recovery job is not available.");
    return;
  }

  const customer = jobCustomer(job);
  const devices = jobDevices(job);
  const payments = paymentsForJob(job.key);
  const attachments = values(state.data.attachments?.[job.key] || {});
  const documents = Object.keys(job.documentIds || {})
    .map(id => state.data.documents[id] ? ({ documentId: id, ...state.data.documents[id] }) : null)
    .filter(Boolean);
  const tasks = values(state.data.tasks).filter(task => task.jobKey === job.key);

  const paymentSatisfied = job.assessmentPaymentConfirmed || job.assessmentFeeWaived || safeNumber(job.assessmentFee) === 0;
  const photoSatisfied = !job.intakePhotosRequired || job.intakePhotosComplete;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <button class="ghost" id="backJobs">${icon("back",16)} Jobs</button>
        <h1>${esc(job.jobId || job.key)}</h1>
        <p><strong>Owner: ${esc(job.ownerName || customer?.fullName || jobDisplayName(job))}</strong> · Customer: ${esc(customer?.fullName || jobDisplayName(job))} · ${esc(jobDeviceSummary(job))}</p>
      </div>
      <div class="head-actions">
        ${isAdmin() ? `<button class="secondary" id="jobArchiveBtn">${icon("archive",17)} ${isArchived(job) ? "Restore" : "Archive"}</button>` : ""}
        ${isOwner() && !job.testRecord ? `<button class="secondary" id="markJobTestBtn">${icon("shield",17)} Mark test</button>` : ""}
        ${canControlJob(job) && !isArchived(job) ? `<button class="secondary" id="jobTaskBtn">${icon("tasks",17)} Add task</button>` : ""}
        <button class="secondary" id="jobEmailUpdateBtn">${icon("file",17)} Email update</button>
        ${canControlJob(job) ? `<button class="secondary" id="jobAgreementBtn">${icon("signature",17)} Agreement</button>` : ""}
        ${canControlJob(job) ? `<button class="primary" id="jobInvoiceBtn">${icon("receipt",17)} Invoice</button>` : ""}
      </div>
    </div>

    <div class="grid four">
      <div class="panel flat">
        <span class="eyebrow">Current status</span>
        <div style="margin-top:8px">${statusPill(job.status)}</div>
      </div>
      <div class="panel flat">
        <span class="eyebrow">Customer</span>
        <strong style="display:block;margin-top:8px">${esc(customer?.fullName || jobDisplayName(job))}</strong>
        <span class="tiny muted">${esc(customer?.customerId || "Legacy record")}</span>
      </div>
      <div class="panel flat">
        <span class="eyebrow">Outstanding</span>
        <strong style="display:block;margin-top:8px">${formatMoney(outstandingForJob(job))}</strong>
        <span class="tiny muted">${formatMoney(paidForJob(job.key))} recorded paid</span>
      </div>
      <div class="panel flat">
        <span class="eyebrow">Record state</span>
        <div style="margin-top:8px">${jobIsSubmitted(job) ? `<span class="status-pill tone-warning">${icon("shield",13)} Submitted / auditable</span>` : `<span class="status-pill tone-brand-1">Draft</span>`}</div>
        <span class="tiny muted">${jobIsSubmitted(job) ? `Submitted ${formatDate(job.submittedAt, true)} by ${esc(staffName(job.submittedBy))}` : "Assigned worker may still complete the draft"}</span>
      </div>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Intake checkpoints</h2><p>Assessment readiness is based on real-world confirmation.</p></div>
      </div>
      <div class="checkpoint-grid">
        ${checkpointHtml("Authorization", Boolean(job.signatureCollected), job.signatureCollected ? `Confirmed by ${staffName(job.signatureConfirmedBy)}` : "Physical signature not confirmed")}
        ${checkpointHtml("Assessment payment", paymentSatisfied, job.assessmentFeeWaived ? "Fee waived" : job.assessmentPaymentConfirmed ? `${job.assessmentPaymentMethod || "Payment"} confirmed` : "Payment not confirmed")}
        ${checkpointHtml("Intake photos", photoSatisfied, job.intakePhotosRequired ? (job.intakePhotosComplete ? "Required photos complete" : "Required photos incomplete") : "Currently optional")}
      </div>
      ${isOps() && (!job.signatureCollected || !paymentSatisfied) ? `<div class="head-actions" style="justify-content:flex-start;margin-top:14px">
        ${!job.signatureCollected ? `<button class="secondary" id="confirmSignatureBtn">${icon("signature",16)} Confirm physical signature</button>` : ""}
        ${!paymentSatisfied ? `<button class="secondary" id="checkpointPaymentBtn">${icon("finance",16)} Record assessment payment</button>` : ""}
      </div>` : ""}
    </section>

    <div class="grid two">
      <section class="panel">
        <div class="panel-head"><div><h2>People & authority</h2><p>Owner, submitter and signer can be different.</p></div></div>
        <div class="form-grid">
          ${detailInfo("Device owner", job.ownerName || customer?.fullName || "—")}
          ${detailInfo("Submitted by", job.submitterName || customer?.fullName || "—")}
          ${detailInfo("Relationship", job.submitterRelationship || "—")}
          ${detailInfo("Signed by", job.signerName || customer?.fullName || "—")}
          ${detailInfo("Signer authority", job.signerAuthority || "—")}
          ${detailInfo("Received", formatDate(job.createdAt, true))}
          ${detailInfo("Assigned worker", staffName(job.assignedTo) || (job.createdBy ? staffName(job.createdBy) : "Unassigned"))}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h2>Job controls</h2><p>Technical progress and commercial quote</p></div>
        </div>
        ${safeNumber(job.recoveryQuote) > 0 ? `<div class="notice ${job.quoteApproval?.approved ? "success" : "info"}" style="margin-bottom:12px">
          ${job.quoteApproval?.approved
            ? `Recovery quote ${formatMoney(job.quoteApproval.quotedAmount || job.recoveryQuote)} approved ${job.quoteApproval.source === "customer-portal" ? "through the customer portal" : "and confirmed by staff"} on ${formatDate(job.quoteApproval.approvedAt, true)}.`
            : `Recovery quote is ${formatMoney(job.recoveryQuote)}. ${job.status === "Awaiting Approval" ? "Customer approval is still pending." : "Move the job to Awaiting Approval when the quote is ready for the customer."}`}
          ${isOps() && job.status === "Awaiting Approval" && !job.quoteApproval?.approved ? `<div style="margin-top:9px"><button class="secondary" id="confirmLocalQuoteApproval">${icon("check",16)} Confirm local customer approval</button></div>` : ""}
        </div>` : ""}
        ${canControlJob(job) ? `
          <div class="form-grid">
            <label class="field"><span>Status</span>
              <select id="jobStatus">${JOB_STATUSES.map(status => `<option ${job.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>
            </label>
            <label class="field"><span>Assessment result</span>
              <select id="jobAssessmentResult">
                ${["Pending","Recovery Appears Feasible","Not Recoverable","Further Assessment Required"].map(value => `<option ${job.assessmentResult === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label class="field"><span>Recovery quote (₦)</span><input id="jobRecoveryQuote" type="number" min="0" value="${esc(job.recoveryQuote || "")}"></label>
            ${isAdmin() ? `<label class="field"><span>Assigned worker</span>
              <select id="jobAssignedTo">
                <option value="">Unassigned</option>
                ${values(state.data.users)
                  .filter(profile => profile.active !== false && ["worker","subadmin","admin","owner"].includes(profile.role))
                  .map(profile => ({uid: profile.key, ...profile}))
                  .sort((a,b)=>profileNameForSort(a).localeCompare(profileNameForSort(b)))
                  .map(profile => `<option value="${profile.uid}" ${job.assignedTo === profile.uid ? "selected" : ""}>${esc(profileDisplayName(profile))}</option>`)
                  .join("")}
              </select>
              <small>Add, replace or return the job to Unassigned.</small>
            </label>` : ""}
            ${isAdmin() ? `<label class="field"><span>Discount (₦)</span><input id="jobDiscount" type="number" min="0" value="${esc(job.discount || "")}"><small>Administrator-controlled commercial adjustment</small></label>` : ""}
          </div>
          ${jobIsSubmitted(job) && workerOwnsJob(job) ? `<div class="notice warning" style="margin-bottom:10px">${icon("audit",15)} This record has been submitted. Every worker edit now requires a written reason and is permanently logged.</div>` : ""}
          <label class="field"><span>Internal staff notes</span><textarea id="jobStaffNotes">${esc(job.staffNotes || "")}</textarea></label>
          <div class="head-actions" style="justify-content:flex-start">
            <button class="primary" id="saveJobControls">${icon("check",17)} ${jobIsSubmitted(job) && workerOwnsJob(job) ? "Edit submitted job" : "Save job changes"}</button>
            ${workerOwnsJob(job) && !jobIsSubmitted(job) ? `<button class="secondary" id="submitJobRecord">${icon("shield",17)} Submit job record</button>` : ""}
          </div>
        ` : `<div class="notice info">Read-only record. Only an Administrator or the worker assigned to this job can change its operational details.</div>`}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Devices</h2><p>${devices.length} device${devices.length === 1 ? "" : "s"} attached to this job</p></div>
      </div>
      <div class="grid ${devices.length > 1 ? "two" : ""}">
        ${devices.map(device => renderJobDeviceCard(job, device)).join("")}
      </div>
    </section>

    <div class="grid two">
      <section class="panel">
        <div class="panel-head">
          <div><h2>Payments</h2><p>Assessment, deposits and recovery charges</p></div>
          <div class="head-actions">
            ${payments.length ? `<button class="secondary" id="jobReceiptBtn">${icon("receipt",16)} Receipt</button>` : ""}
            ${canControlJob(job) || state.staff?.role === "finance" ? `<button class="secondary" id="recordPaymentBtn">${icon("plus",16)} Record payment</button>` : ""}
          </div>
        </div>
        ${renderPayments(payments)}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h2>Tasks</h2><p>Work linked specifically to this job</p></div>
          ${canControlJob(job) ? `<button class="secondary" id="jobTaskBtn2">${icon("plus",16)} Add</button>` : ""}
        </div>
        ${tasks.length ? tasks.map(taskRowHtml).join("") : emptyState("tasks","No job tasks","Add a task for assessment, customer contact or recovery work.")}
      </section>
    </div>

    <div class="grid two">
      <section class="panel">
        <div class="panel-head">
          <div><h2>Documents</h2><p>Invoices, receipts and the service agreement</p></div>
          <div class="head-actions">
            <button class="secondary" id="emailInvoiceNotice">${icon("file",16)} Email invoice</button>
            ${canControlJob(job) ? `<button class="secondary" id="generateAgreement">${icon("signature",16)} Agreement</button>` : ""}
            ${canControlJob(job) ? `<button class="secondary" id="generateInvoice">${icon("receipt",16)} Invoice</button>` : ""}
          </div>
        </div>
        ${renderDocumentsList(documents, job)}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h2>Attachments</h2><p>Device photos and exact copies of signed paperwork</p></div>
          ${canControlJob(job) ? `<button class="secondary" id="uploadSignedAgreement">${icon("upload",16)} Signed copy</button>` : ""}
        </div>
        ${renderAttachments(attachments, job)}
      </section>
    </div>`;

  document.getElementById("backJobs").onclick = () => navigate("jobs");
  document.getElementById("jobArchiveBtn")?.addEventListener("click", () => archiveRecord(`jobs/${job.key}`, "job", job.jobId || job.key, job.jobId || job.key, !isArchived(job)));
  document.getElementById("markJobTestBtn")?.addEventListener("click", () => markLegacyTestRecord(`jobs/${job.key}`, "job", job.jobId || job.key, job.jobId || job.key));
  document.getElementById("saveJobControls")?.addEventListener("click", () => saveJobControls(job));
  document.getElementById("submitJobRecord")?.addEventListener("click", () => submitJobRecord(job));
  document.getElementById("recordPaymentBtn")?.addEventListener("click", () => openPaymentModal(job));
  document.getElementById("confirmLocalQuoteApproval")?.addEventListener("click", () => confirmQuoteApproval(job, "staff-confirmed"));
  document.getElementById("checkpointPaymentBtn")?.addEventListener("click", () => openPaymentModal(job));
  document.getElementById("confirmSignatureBtn")?.addEventListener("click", () => confirmPhysicalSignature(job));
  document.getElementById("jobReceiptBtn")?.addEventListener("click", () => generateDocument(job, "receipt"));
  document.getElementById("jobTaskBtn")?.addEventListener("click", () => openTaskModal(job));
  document.getElementById("jobTaskBtn2")?.addEventListener("click", () => openTaskModal(job));
  document.getElementById("jobEmailUpdateBtn")?.addEventListener("click", () => emailJobUpdate(job));
  document.getElementById("jobAgreementBtn")?.addEventListener("click", () => generateDocument(job, "agreement"));
  document.getElementById("jobInvoiceBtn")?.addEventListener("click", () => generateDocument(job, "invoice"));
  document.getElementById("emailInvoiceNotice")?.addEventListener("click", () => emailInvoiceNotice(job));
  document.getElementById("generateAgreement")?.addEventListener("click", () => generateDocument(job, "agreement"));
  document.getElementById("generateInvoice")?.addEventListener("click", () => generateDocument(job, "invoice"));
  document.getElementById("uploadSignedAgreement")?.addEventListener("click", () => openAttachmentModal(job, "signed-agreement"));

  host.querySelectorAll("[data-upload-device-photos]").forEach(button => {
    button.onclick = () => openAttachmentModal(job, "device-intake", button.dataset.uploadDevicePhotos);
  });

  host.querySelectorAll("[data-generate-doc]").forEach(button => {
    button.onclick = () => generateDocument(job, button.dataset.generateDoc);
  });

  host.querySelectorAll("[data-document-id]").forEach(button => {
    button.onclick = () => openDocumentRecord(button.dataset.documentId, job);
  });

  host.querySelectorAll("[data-attachment-preview]").forEach(button => {
    button.onclick = () => previewAttachment(job.key, button.dataset.attachmentPreview);
  });

  host.querySelectorAll("[data-edit-device]").forEach(button => {
    button.onclick = () => {
      const device = state.data.devices?.[button.dataset.editDevice];
      if (device) openDeviceEditModal({deviceId: button.dataset.editDevice, ...device});
    };
  });
  host.querySelectorAll("[data-archive-device]").forEach(button => {
    button.onclick = () => {
      const deviceId = button.dataset.archiveDevice;
      const device = state.data.devices?.[deviceId];
      if (device) archiveRecord(`devices/${deviceId}`, "device", deviceId, `${device.type || "Device"} ${deviceId}`, !isArchived(device));
    };
  });
  bindTaskManagement(host);
  host.querySelectorAll("[data-void-payment]").forEach(button => {
    button.onclick = async () => {
      const payment = state.data.payments?.[button.dataset.voidPayment];
      if (!payment) return;
      const reason = await managementReasonModal({
        title: "Void payment record",
        subtitle: `${formatMoney(payment.amount)} · ${payment.category || "Payment"}`,
        warning: "Voiding preserves the original payment record and removes it from active financial totals. It is safer than deleting financial history.",
        label: "Reason for void *",
        minLength: 8,
        confirmText: "Void payment"
      });
      if (!reason) return;
      try {
        await update(ref(db, `payments/${button.dataset.voidPayment}`), {
          status: "void",
          voidReason: reason,
          voidedAt: now(),
          voidedBy: state.user.uid,
          voidedByName: profileDisplay()
        });
        await recordAudit("voided", "payment", button.dataset.voidPayment, reason);
        toast("Payment voided; original history preserved.", "success");
      } catch (error) {
        console.error(error);
        toast("Payment could not be voided.", "error");
      }
    };
  });
  bindTaskChecks(host);
}

async function confirmQuoteApproval(job, source = "staff-confirmed") {
  if (source !== "customer-portal" && !isOps()) return;
  if (!safeNumber(job.recoveryQuote)) return toast("Set a recovery quote first.", "error");

  const approval = {
    approved: true,
    source,
    quotedAmount: safeNumber(job.recoveryQuote),
    approvedAt: now(),
    approvedByUid: state.user.uid,
    approvedByName: source === "customer-portal" ? (state.portal.customer?.fullName || state.user.email || "Customer") : profileDisplay()
  };

  try {
    await set(ref(db, `jobs/${job.key}/quoteApproval`), approval);
    if (source !== "customer-portal") {
      await recordAudit("confirmed recovery quote approval", "job", job.jobId || job.key, formatMoney(job.recoveryQuote));
    }
    toast("Recovery quote approval recorded.", "success");
  } catch (error) {
    console.error(error);
    toast("Quote approval could not be recorded.", "error");
  }
}

async function confirmPhysicalSignature(job) {
  if (!isOps()) return;
  const signer = job.signerName || jobCustomer(job)?.fullName || "the authorized signer";
  const body = `<div class="notice warning">Only confirm this after you have physically received the signed authorization/agreement from ${esc(signer)}.</div>`;
  openModal({
    title: "Confirm physical authorization",
    subtitle: job.jobId || job.key,
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="doConfirmSignature">${icon("signature",17)} Confirm collected</button>`
  });
  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;
  document.getElementById("doConfirmSignature").onclick = async event => {
    const button = event.currentTarget;
    setBusy(button, true, "Confirming…");
    try {
      await update(ref(db, `jobs/${job.key}`), {
        signatureCollected: true,
        signatureConfirmedBy: state.user.uid,
        signatureConfirmedAt: now(),
        updatedAt: now()
      });
      await recomputeJobReadiness(job.key);
      await recordAudit("confirmed physical authorization", "job", job.jobId || job.key, `Signed by ${signer}`);
      closeModal();
      toast("Physical authorization confirmed.", "success");
    } catch (error) {
      console.error(error);
      toast("Authorization confirmation could not be saved.", "error");
      setBusy(button, false);
    }
  };
}


function openDeviceEditModal(device) {
  if (!isAdmin()) return;
  const deviceId = device.deviceId || device.key;
  const body = `
    <form id="deviceEditForm">
      <div class="form-grid three">
        <label class="field"><span>Device type *</span><input name="type" value="${esc(device.type || "")}" required></label>
        <label class="field"><span>Brand / model</span><input name="brandModel" value="${esc(device.brandModel || "")}"></label>
        <label class="field"><span>Capacity</span><input name="capacity" value="${esc(device.capacity || "")}"></label>
        <label class="field"><span>Serial number</span><input name="serial" value="${esc(device.serial || "")}"></label>
        <label class="field"><span>Physical condition</span><input name="physicalCondition" value="${esc(device.physicalCondition || "")}"></label>
      </div>
      <label class="field"><span>Device notes</span><textarea name="notes">${esc(device.notes || "")}</textarea></label>
    </form>`;
  openModal({
    title: "Edit device",
    subtitle: deviceId,
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="saveDeviceEdit">Save device</button>`
  });
  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;
  document.getElementById("saveDeviceEdit").onclick = async () => {
    const form = document.getElementById("deviceEditForm");
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    try {
      await update(ref(db, `devices/${deviceId}`), {
        type: data.get("type").trim(),
        brandModel: String(data.get("brandModel") || "").trim(),
        capacity: String(data.get("capacity") || "").trim(),
        serial: String(data.get("serial") || "").trim(),
        physicalCondition: String(data.get("physicalCondition") || "").trim(),
        notes: String(data.get("notes") || "").trim(),
        updatedAt: now(),
        updatedBy: state.user.uid
      });
      await recordAudit("updated", "device", deviceId, "Device details updated");
      closeModal();
      toast("Device updated.", "success");
    } catch (error) {
      console.error(error);
      toast("Device could not be updated.", "error");
    }
  };
}

function renderJobDeviceCard(job, device) {
  const snapshot = job.deviceSnapshots?.[device.deviceId] || {};

  return `
    <div class="device-card">
      <div class="device-card-head">
        <strong>${icon("devices",18)} ${esc(device.deviceId || "Device")}</strong>
        ${snapshot.returning ? `<span class="status-pill tone-info">Returning device</span>` : `<span class="status-pill tone-brand-1">Registered</span>`}
      </div>
      <div class="form-grid two">
        ${detailInfo("Type", device.type || "—")}
        ${detailInfo("Brand / model", device.brandModel || "—")}
        ${detailInfo("Capacity", device.capacity || "—")}
        ${detailInfo("Serial", device.serial || "—")}
        ${detailInfo("Condition at intake", snapshot.conditionAtIntake || device.condition || "—")}
        ${detailInfo("Problem", device.problem || "—")}
      </div>
      ${isOps() ? `<button class="secondary" style="margin-top:12px" data-upload-device-photos="${esc(device.deviceId || "")}">${icon("camera",16)} Add condition photos</button>` : ""}
    </div>`;
}


async function submitJobRecord(job) {
  if (!workerOwnsJob(job) || jobIsSubmitted(job)) return;

  const body = `
    <div class="notice warning">
      Submitting locks this worker record into the audit process. You can still correct it later, but every later edit will require a written reason.
    </div>
    <div style="margin-top:12px">
      ${detailInfo("Device owner", job.ownerName || jobCustomer(job)?.fullName || "—")}
      ${detailInfo("Customer", jobCustomer(job)?.fullName || "—")}
      ${detailInfo("Assigned worker", profileDisplay())}
    </div>`;

  openModal({
    title: "Submit job record",
    subtitle: job.jobId || job.key,
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="confirmSubmitJob">${icon("shield",17)} Submit & lock audit trail</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("confirmSubmitJob").onclick = async event => {
    const button = event.currentTarget;
    setBusy(button, true, "Submitting…");
    try {
      await update(ref(db, `jobs/${job.key}`), {
        recordState: "submitted",
        submittedAt: now(),
        submittedBy: state.user.uid,
        updatedAt: now(),
        updatedBy: state.user.uid
      });
      await recordAudit("submitted", "job", job.jobId || job.key, "Worker submitted job record into auditable state");
      closeModal();
      toast("Job submitted. Future worker edits require a written reason.", "success");
    } catch (error) {
      console.error(error);
      toast("Job could not be submitted.", "error");
      setBusy(button, false);
    }
  };
}

async function saveJobControls(job) {
  if (!canControlJob(job)) {
    toast("This job is read-only for your role.", "error");
    return;
  }

  let editReason = "";
  if (workerOwnsJob(job) && jobIsSubmitted(job)) {
    editReason = await requestSubmittedEditReason(job);
    if (!editReason) return;
  }

  const button = document.getElementById("saveJobControls");
  setBusy(button, true, "Saving…");

  try {
    const newQuote = safeNumber(document.getElementById("jobRecoveryQuote").value);
    const quoteChanged = newQuote !== safeNumber(job.recoveryQuote);
    const patch = {
      status: document.getElementById("jobStatus").value,
      assessmentResult: document.getElementById("jobAssessmentResult").value,
      recoveryQuote: newQuote,
      ...(quoteChanged ? { quoteApproval: null } : {}),
      ...(isAdmin() ? {
        discount: safeNumber(document.getElementById("jobDiscount")?.value),
        assignedTo: document.getElementById("jobAssignedTo")?.value || "",
        assignedToName: document.getElementById("jobAssignedTo")?.value ? staffName(document.getElementById("jobAssignedTo")?.value) : ""
      } : {}),
      staffNotes: document.getElementById("jobStaffNotes").value.trim(),
      updatedAt: now(),
      updatedBy: state.user.uid,
      ...(editReason ? {
        lastEditReason: editReason,
        lastEditedAt: now(),
        lastEditedBy: state.user.uid,
        lastEditedByName: profileDisplay()
      } : {})
    };

    const previousStatus = job.status;
    const assignmentChanged = isAdmin() && (job.assignedTo || "") !== (patch.assignedTo || "");
    if (assignmentChanged) {
      patch.assignedAt = now();
      patch.assignedBy = state.user.uid;
    }

    if (editReason) {
      const editRef = push(ref(db, `jobEdits/${job.key}`));
      await set(editRef, {
        reason: editReason,
        actorUid: state.user.uid,
        actorName: profileDisplay(),
        before: {
          status: job.status || "",
          assessmentResult: job.assessmentResult || "",
          recoveryQuote: safeNumber(job.recoveryQuote),
          staffNotes: job.staffNotes || ""
        },
        after: {
          status: patch.status,
          assessmentResult: patch.assessmentResult,
          recoveryQuote: patch.recoveryQuote,
          staffNotes: patch.staffNotes
        },
        createdAt: now()
      });
    }

    await update(ref(db, `jobs/${job.key}`), patch);

    if (previousStatus !== patch.status && job.customerId) {
      const communicationRef = push(ref(db, `communications/${job.customerId}`));
      await set(communicationRef, {
        type: "Job milestone",
        jobKey: job.key,
        jobId: job.jobId || job.key,
        milestone: patch.status,
        note: `Customer-facing milestone reached: ${patch.status}`,
        deliveryStatus: "pending-email-service",
        createdAt: now(),
        createdBy: state.user.uid,
        createdByName: profileDisplay()
      });
    }

    if (isAdmin() && (job.assignedTo || "") !== (patch.assignedTo || "")) {
      await recordAudit(
        "reassigned",
        "job",
        job.jobId || job.key,
        `${staffName(job.assignedTo) || "Unassigned"} → ${staffName(patch.assignedTo) || "Unassigned"}`
      );
    }
    await recordAudit(editReason ? "edited submitted job" : "updated", "job", job.jobId || job.key, `${editReason ? `Reason: ${editReason} · ` : ""}Status: ${patch.status}; assessment: ${patch.assessmentResult}`);
    toast("Job updated.", "success");
  } catch (error) {
    console.error(error);
    toast("Job changes could not be saved.", "error");
    setBusy(button, false);
  }
}

function renderPayments(payments) {
  if (!payments.length) return emptyState("finance", "No payments recorded", "Record assessment, deposit or recovery payments here.");

  return `<div class="list">${payments.map(payment => `
    <div class="list-row">
      <div class="list-icon">${icon("finance",18)}</div>
      <div class="list-main">
        <strong>${formatMoney(payment.amount)} · ${esc(payment.category || "Payment")}</strong>
        <span>${esc(payment.method || "—")} ${payment.reference ? `· ${esc(payment.reference)}` : ""} · ${formatDate(payment.createdAt, true)}</span>
      </div>
      <div class="list-side">
        <span class="payment-pill ${payment.status === "void" ? "tone-danger" : "tone-brand-4"}">${payment.status === "void" ? "Voided" : "Confirmed"}</span>
        ${(isAdmin() || state.staff?.role === "finance") && payment.status !== "void" ? `<button class="ghost danger" data-void-payment="${payment.key}">Void</button>` : ""}
      </div>
    </div>`).join("")}</div>`;
}

function openPaymentModal(job) {
  const body = `
    <form id="paymentForm">
      <div class="form-grid">
        <label class="field"><span>Amount (₦) *</span><input name="amount" type="number" min="1" required></label>
        <label class="field"><span>Payment type</span>
          <select name="category">
            <option>Assessment fee</option>
            <option>Recovery payment</option>
            <option>Deposit</option>
            ${isFinance() ? `<option>Refund</option>` : ""}
            <option>Other</option>
          </select>
        </label>
        <label class="field"><span>Method</span>
          <select name="method">
            <option>Moniepoint Transfer</option>
            <option>POS</option>
            <option>Cash</option>
            <option>Bank Transfer</option>
            <option>Other</option>
          </select>
        </label>
        <label class="field"><span>Reference</span><input name="reference"></label>
      </div>
      <label class="field"><span>Note</span><textarea name="note"></textarea></label>
      <div class="notice info">The person recording this payment becomes the confirming staff member in the audit trail.</div>
    </form>`;

  openModal({
    title: "Record payment",
    subtitle: job.jobId,
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="savePaymentBtn">${icon("check",17)} Confirm payment</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("savePaymentBtn").onclick = async () => {
    const form = document.getElementById("paymentForm");
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const button = document.getElementById("savePaymentBtn");
    setBusy(button, true);

    try {
      await createPayment({
        jobKey: job.key,
        customerId: job.customerId || "",
        amount: data.get("category") === "Refund" ? -safeNumber(data.get("amount")) : safeNumber(data.get("amount")),
        category: data.get("category"),
        method: data.get("method"),
        reference: String(data.get("reference") || "").trim(),
        note: String(data.get("note") || "").trim()
      });
      closeModal();
      toast("Payment recorded and confirmed.", "success");
    } catch {
      toast("Payment could not be saved.", "error");
      setBusy(button, false);
    }
  };
}

async function createPayment(payment, audit = true) {
  const paymentRef = push(ref(db, "payments"));

  await set(paymentRef, {
    ...payment,
    status: "confirmed",
    reconciledAt: null,
    reconciledBy: "",
    confirmedBy: state.user.uid,
    confirmedByName: profileDisplay(),
    createdAt: now(),
    createdBy: state.user.uid
  });

  if (payment.category === "Assessment fee" && payment.jobKey) {
    try {
      await update(ref(db, `jobs/${payment.jobKey}`), {
        assessmentPaymentConfirmed: true,
        assessmentPaymentMethod: payment.method,
        assessmentPaymentReference: payment.reference || "",
        assessmentPaymentConfirmedBy: state.user.uid,
        assessmentPaymentConfirmedAt: now(),
        updatedAt: now()
      });
      await recomputeJobReadiness(payment.jobKey);
    } catch {}
  }

  if (audit) {
    await recordAudit("recorded payment", "job", payment.jobKey, `${formatMoney(payment.amount)} · ${payment.method}`);
  }

  return paymentRef.key;
}

async function recomputeJobReadiness(jobKey) {
  const snap = await get(ref(db, `jobs/${jobKey}`));
  if (!snap.exists()) return;

  const job = snap.val();
  if (!["Intake Pending", "Ready for Assessment"].includes(job.status)) return;

  const payment = job.assessmentPaymentConfirmed || job.assessmentFeeWaived || safeNumber(job.assessmentFee) === 0;
  const signature = Boolean(job.signatureCollected);
  const photos = !job.intakePhotosRequired || job.intakePhotosComplete;
  const ready = payment && signature && photos;

  await update(ref(db, `jobs/${jobKey}`), {
    status: ready ? "Ready for Assessment" : "Intake Pending",
    updatedAt: now()
  });
}

function quickDocButton(type, iconName, label) {
  return `
    <button class="quick-action" data-generate-doc="${type}">
      <span class="qa-icon">${icon(iconName,18)}</span>
      <div><strong>${label}</strong><span>Branded WISCODE document</span></div>
    </button>`;
}

function renderDocumentsList(documents, job) {
  if (!documents.length) {
    return `<div class="quick-actions">
      ${quickDocButton("agreement","signature","Generate agreement")}
      ${quickDocButton("invoice","receipt","Generate invoice")}
    </div>`;
  }

  return `<div class="list">${documents
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
    .map(document => `
      <div class="list-row">
        <div class="list-icon">${icon(document.type === "agreement" ? "signature" : document.type === "receipt" ? "receipt" : "file",18)}</div>
        <div class="list-main">
          <strong>${esc(document.number || document.documentId)} · ${esc(document.type || "Document")}</strong>
          <span>${formatDate(document.createdAt, true)} · ${document.clientVisible ? "Client-visible" : "Internal"}</span>
        </div>
        <div class="list-side"><button class="secondary" data-document-id="${document.documentId}">View</button></div>
      </div>`).join("")}</div>`;
}

async function generateDocument(job, type) {
  if (!canControlJob(job)) {
    toast("Only an Administrator or the worker assigned to this job can generate legal/commercial documents.", "error");
    return;
  }

  const customer = jobCustomer(job);
  const devices = jobDevices(job);
  const payments = paymentsForJob(job.key);

  try {
    const prefix = type === "invoice" ? "INV" : type === "receipt" ? "RCT" : "AGR";
    const number = await nextNumber(prefix, type);
    const documentId = number;

    const snapshot = {
      company: company(),
      customer,
      job: { ...job, key: job.key },
      devices,
      payments
    };

    const record = {
      number,
      type,
      jobKey: job.key,
      jobId: job.jobId || job.key,
      customerId: job.customerId || "",
      clientVisible: true,
      immutable: true,
      ownerName: job.ownerName || customer?.fullName || "",
      assignedWorkerUid: job.assignedTo || "",
      assignedWorkerName: staffName(job.assignedTo) || "",
      snapshot,
      createdAt: now(),
      createdBy: state.user.uid
    };

    await set(ref(db, `documents/${documentId}`), record);
    await set(ref(db, `jobs/${job.key}/documentIds/${documentId}`), true);
    await recordAudit("generated", "document", number, `${type} for ${job.jobId || job.key}`);

    openPrintableDocument({ type, number, ...snapshot });
  } catch (error) {
    console.error(error);
    toast("Document could not be generated.", "error");
  }
}

function openDocumentRecord(documentId, fallbackJob = null) {
  const record = state.data.documents?.[documentId];

  if (!record) {
    toast("Document record is not available.", "error");
    return;
  }

  const snapshot = record.snapshot || {};
  const job = snapshot.job || fallbackJob;

  openPrintableDocument({
    type: record.type,
    number: record.number || documentId,
    company: snapshot.company || company(),
    customer: snapshot.customer || jobCustomer(job),
    job,
    devices: snapshot.devices || jobDevices(job),
    payments: snapshot.payments || paymentsForJob(job?.key)
  });
}

function renderAttachments(attachments, job) {
  if (!attachments.length) {
    return emptyState("image", "No attachments yet", "Device photos and signed paperwork will appear here.");
  }

  return `<div class="attachment-grid">${attachments
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
    .map(attachment => `
      <button class="attachment-card" data-attachment-preview="${attachment.key}">
        <span class="attachment-icon">${icon(attachment.contentType === "application/pdf" ? "file" : "image",19)}</span>
        <div>
          <strong>${esc(attachment.fileName || attachment.category || "Attachment")}</strong>
          <span>${esc(attachment.category || "")} · ${attachment.clientVisible ? "Client-visible" : "Staff only"} · ${formatDate(attachment.createdAt)}</span>
        </div>
      </button>`).join("")}</div>`;
}

function openAttachmentModal(job, category = "device-intake", deviceId = "") {
  if (!isOps() && !isAdmin()) return;

  const signed = category === "signed-agreement";

  const body = `
    <form id="attachmentForm">
      <div class="notice ${state.services.firestore === false ? "warning" : "info"}">
        ${state.services.firestore === false
          ? "Firebase Storage access control is not configured yet. You can still keep the physical signed copy; uploads activate after Blaze + Firestore + Storage setup."
          : "Images are compressed before upload. RecoveryDesk does not use this storage for recovered customer files."}
      </div>

      <label class="field" style="margin-top:14px"><span>${signed ? "Signed agreement photo/PDF" : "Device condition photo(s)"}</span>
        <input id="attachmentFiles" type="file" ${signed ? `accept="image/*,application/pdf"` : `accept="image/*" capture="environment" multiple`} required>
      </label>

      ${deviceId ? `<input type="hidden" name="deviceId" value="${esc(deviceId)}">` : ""}

      <label class="check-row">
        <input id="attachmentClientVisible" type="checkbox" ${signed ? "checked" : ""}>
        <div>
          <strong>Client-visible</strong>
          <span>${signed
            ? "Recommended for the exact signed agreement so the authorized customer can see what was signed."
            : "Leave device intake photos staff-only unless there is a reason to share them."}</span>
        </div>
      </label>
    </form>`;

  openModal({
    title: signed ? "Attach signed agreement" : "Add device photos",
    subtitle: job.jobId,
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="uploadAttachmentBtn">${icon("upload",17)} Upload</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("uploadAttachmentBtn").onclick = async () => {
    const input = document.getElementById("attachmentFiles");

    if (!input.files.length) {
      toast("Choose a file first.", "error");
      return;
    }

    const button = document.getElementById("uploadAttachmentBtn");
    setBusy(button, true, "Uploading…");

    const ok = await uploadFilesForJob({
      jobKey: job.key,
      job,
      customerId: job.customerId,
      files: [...input.files],
      category,
      deviceId,
      clientVisible: document.getElementById("attachmentClientVisible").checked
    });

    if (ok) {
      closeModal();
      toast("Attachment uploaded.", "success");
    } else {
      setBusy(button, false);
    }
  };
}

async function loadImageForCompression(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close?.() };
    } catch {}
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      cleanup: () => URL.revokeObjectURL(url)
    });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image could not be decoded")); };
    image.src = url;
  });
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) return file;
  if (file.size < 900 * 1024) return file;

  const loaded = await loadImageForCompression(file);
  try {
    const maxDimension = 1800;
    const ratio = Math.min(1, maxDimension / Math.max(loaded.width, loaded.height));
    const width = Math.max(1, Math.round(loaded.width * ratio));
    const height = Math.max(1, Math.round(loaded.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(loaded.source, 0, 0, width, height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    loaded.cleanup?.();
  }
}

function uploadTask(uploadTaskRef) {
  return new Promise((resolve, reject) => {
    uploadTaskRef.on(
      "state_changed",
      () => {},
      reject,
      () => resolve(uploadTaskRef.snapshot)
    );
  });
}

async function uploadFilesForJob({
  jobKey,
  job,
  customerId,
  files,
  category,
  deviceId = "",
  clientVisible = false,
  silentFailure = false
}) {
  if (!customerId) {
    if (!silentFailure) toast("This legacy job must be migrated before attachments can be stored.", "error");
    return false;
  }

  try {
    await ensureFirestoreAccessMirror();

    let uploadedAny = false;

    for (const originalFile of files) {
      const file = originalFile.type.startsWith("image/")
        ? await compressImage(originalFile)
        : originalFile;

      const safeName = file.name.replace(/[^\w.\-]+/g, "-");
      const path = `jobs/${customerId}/${job.jobId || jobKey}/${category}/${Date.now()}-${safeName}`;
      const fileRef = storageRef(storage, path);

      const task = uploadBytesResumable(fileRef, file, {
        contentType: file.type,
        customMetadata: {
          clientVisible: String(Boolean(clientVisible)),
          customerId,
          jobId: job.jobId || jobKey,
          category,
          deviceId: deviceId || ""
        }
      });

      await uploadTask(task);

      const attachmentRef = push(ref(db, `attachments/${jobKey}`));
      const attachmentId = attachmentRef.key;

      const metadata = {
        attachmentId,
        customerId,
        jobKey,
        jobId: job.jobId || jobKey,
        deviceId: deviceId || "",
        category,
        storagePath: path,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
        clientVisible: Boolean(clientVisible),
        uploadedBy: state.user.uid,
        uploadedByName: profileDisplay(),
        createdAt: now()
      };

      await set(attachmentRef, metadata);
      await set(ref(db, `jobs/${jobKey}/attachmentIds/${attachmentId}`), true);
      await recordAudit("uploaded", "attachment", attachmentId, `${category} · ${file.name}`);
      uploadedAny = true;
    }

    state.services.storage = uploadedAny ? true : state.services.storage;
    return uploadedAny;
  } catch (error) {
    console.error("Upload failed", error);
    state.services.storage = false;

    if (!silentFailure) {
      toast("Upload is not available yet. Enable Blaze + Firestore + Firebase Storage, then publish the included rules.", "error");
    }
    return false;
  }
}

async function previewAttachment(jobKey, attachmentId) {
  const attachment = state.data.attachments?.[jobKey]?.[attachmentId]
    || state.portal.attachments.find(item => item.jobKey === jobKey && item.attachmentId === attachmentId);

  if (!attachment?.storagePath) {
    toast("Attachment path is unavailable.", "error");
    return;
  }

  try {
    const url = await getDownloadURL(storageRef(storage, attachment.storagePath));
    window.open(url, "_blank", "noopener");
  } catch (error) {
    console.error(error);
    toast("This attachment cannot be opened. Storage access may not be configured yet.", "error");
  }
}



function postPriorityRank(priority) {
  return priority === "Critical" ? 0 : priority === "Urgent" ? 1 : 2;
}

function renderJobBoard(host) {
  const posts = values(state.data.jobPosts)
    .map(post => ({ ...post, effectiveStatus: effectivePostStatus(post) }))
    .sort((a,b) => postPriorityRank(a.priority) - postPriorityRank(b.priority) || String(a.deadlineAt || "9999").localeCompare(String(b.deadlineAt || "9999")));

  const available = posts.filter(post => post.effectiveStatus === "available");
  const mine = posts.filter(post => post.claimedBy === state.user.uid && post.effectiveStatus === "claimed");
  const history = posts.filter(post => !["available","claimed"].includes(post.effectiveStatus)).slice(0,40);

  host.innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow">Team work queue</span><h1>Job Board</h1><p>Post work with a deadline, or claim available work when you are ready to own it.</p></div>
      <div class="head-actions">${isAdmin() ? `<button class="primary" id="postWorkBtn">${icon("plus",17)} Post work</button>` : ""}</div>
    </div>

    ${state.staff?.role === "worker" ? `<div class="notice info">Claim only work you can responsibly complete before its deadline. The first successful claim wins.</div>` : ""}

    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <div class="panel-head"><div><h2>Available</h2><p>${available.length} open post${available.length===1?"":"s"}</p></div></div>
        ${available.length ? available.map(post => jobPostCard(post)).join("") : emptyState("jobs","No available work","Nothing is currently open for claiming.")}
      </section>

      <section class="panel">
        <div class="panel-head"><div><h2>${state.staff?.role === "worker" ? "My claimed work" : "Claimed"}</h2><p>Work already taken by a worker</p></div></div>
        ${(state.staff?.role === "worker" ? mine : posts.filter(p=>p.effectiveStatus==="claimed")).length
          ? (state.staff?.role === "worker" ? mine : posts.filter(p=>p.effectiveStatus==="claimed")).map(post=>jobPostCard(post)).join("")
          : emptyState("check","Nothing claimed","Claimed work will appear here.")}
      </section>
    </div>

    ${isAdmin() ? `<section class="panel"><div class="panel-head"><div><h2>Closed / expired</h2><p>Cancelled, expired and completed board posts</p></div></div>${history.length ? history.map(post=>jobPostCard(post)).join("") : emptyState("clock","No history yet","Closed board posts will appear here.")}</section>` : ""}
  `;

  document.getElementById("postWorkBtn")?.addEventListener("click", openPostWorkModal);
  host.querySelectorAll("[data-claim-post]").forEach(button => button.onclick = () => claimJobPost(button.dataset.claimPost));
  host.querySelectorAll("[data-cancel-post]").forEach(button => button.onclick = () => cancelJobPost(button.dataset.cancelPost));
  host.querySelectorAll("[data-edit-post]").forEach(button => button.onclick = () => openPostWorkModal(state.data.jobPosts?.[button.dataset.editPost] ? {key: button.dataset.editPost, ...state.data.jobPosts[button.dataset.editPost]} : null));
  host.querySelectorAll("[data-delete-post]").forEach(button => button.onclick = async () => {
    const post = state.data.jobPosts?.[button.dataset.deletePost];
    if (!post) return;
    const reason = await managementReasonModal({
      title: "Delete closed board post",
      subtitle: post.title || button.dataset.deletePost,
      warning: "This is intended for disposable/closed board housekeeping. Recovery job history is not deleted.",
      label: "Reason for deletion *",
      confirmText: "Delete post"
    });
    if (!reason) return;
    try {
      await remove(ref(db, `jobPosts/${button.dataset.deletePost}`));
      await recordAudit("deleted", "job board", button.dataset.deletePost, reason);
      toast("Board post deleted.", "success");
    } catch (error) {
      console.error(error);
      toast("Board post could not be deleted.", "error");
    }
  });
  host.querySelectorAll("[data-open-post-job]").forEach(button => button.onclick = () => navigate("job-detail", { jobKey: button.dataset.openPostJob }));
}

function jobPostCard(post) {
  const status = post.effectiveStatus || effectivePostStatus(post);
  const deadlineText = post.deadlineAt ? formatDate(post.deadlineAt, true) : "No deadline";
  return `
    <div class="board-card ${status}">
      <div class="panel-head" style="margin-bottom:8px">
        <div><strong>${esc(post.title || "Work item")}</strong><p>${esc(post.priority || "Normal")} priority · Deadline ${esc(deadlineText)}</p></div>
        <span class="status-pill ${status === "available" ? "tone-brand-1" : status === "claimed" ? "tone-brand-3" : status === "cancelled" ? "tone-danger" : "tone-warning"}">${esc(status)}</span>
      </div>
      <p>${esc(post.instructions || "No additional instructions")}</p>
      ${post.relatedJobKey ? `<p class="tiny muted">Linked recovery job: ${esc(post.relatedJobId || post.relatedJobKey)}</p>` : ""}
      ${post.claimedBy ? `<p class="tiny"><strong>Claimed by:</strong> ${esc(post.claimedByName || staffName(post.claimedBy))}</p>` : ""}
      <div class="head-actions" style="justify-content:flex-start;margin-top:10px">
        ${state.staff?.role === "worker" && status === "available" ? `<button class="primary" data-claim-post="${post.key}">${icon("check",16)} Claim job</button>` : ""}
        ${post.relatedJobKey && (post.claimedBy === state.user.uid || isAdmin()) ? `<button class="secondary" data-open-post-job="${esc(post.relatedJobKey)}">Open linked job</button>` : ""}
        ${isAdmin() && status === "available" ? `<button class="secondary" data-edit-post="${post.key}">${icon("edit",15)} Edit</button>` : ""}
        ${isAdmin() && ["available","claimed"].includes(status) ? `<button class="secondary danger" data-cancel-post="${post.key}">${icon("close",15)} Cancel</button>` : ""}
        ${isOwner() && ["cancelled","expired"].includes(status) ? `<button class="ghost danger" data-delete-post="${post.key}">${icon("trash",15)} Delete</button>` : ""}
      </div>
    </div>`;
}

function openPostWorkModal(existingPost = null) {
  if (!isAdmin()) return;
  const isEdit = Boolean(existingPost);
  const jobs = values(state.data.jobs)
    .map(job => ({...job, key:job.key || job.jobId}))
    .filter(job => !["Completed","Closed"].includes(job.status) && !job.assignedTo);
  const body = `
    <form id="postWorkForm">
      <label class="field"><span>Work title *</span><input name="title" required value="${esc(existingPost?.title || "")}" placeholder="e.g. Assess customer drive and report findings"></label>
      <label class="field"><span>Instructions *</span><textarea name="instructions" required>${esc(existingPost?.instructions || "")}</textarea></label>
      <div class="form-grid three">
        <label class="field"><span>Deadline *</span><input name="deadlineAt" type="datetime-local" value="${esc(existingPost?.deadlineAt || "")}" required></label>
        <label class="field"><span>Priority</span><select name="priority">${["Normal","Urgent","Critical"].map(p=>`<option ${existingPost?.priority===p?"selected":""}>${p}</option>`).join("")}</select></label>
        <label class="field"><span>Link recovery job</span><select name="relatedJobKey"><option value="">No linked job</option>${jobs.map(job=>`<option value="${job.key}">${esc(job.jobId || job.key)} · ${esc(jobDisplayName(job))}</option>`).join("")}</select></label>
      </div>
      <div class="notice info">If linked to a recovery job, the worker who claims this post becomes that job's assigned worker.</div>
    </form>`;
  openModal({title:isEdit ? "Edit available work" : "Post available work", subtitle:"Visible to active workers", body, actions:`<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="saveWorkPost">${icon("check",17)} ${isEdit ? "Save changes" : "Post work"}</button>`});
  modalHost.querySelector("[data-modal-cancel]").onclick=closeModal;
  document.getElementById("saveWorkPost").onclick=async()=>{
    const form=document.getElementById("postWorkForm"); if(!form.reportValidity()) return;
    const data=new FormData(form); const relatedJobKey=data.get("relatedJobKey") || ""; const relatedJob=relatedJobKey ? jobByKey(relatedJobKey) : null;
    const deadline = new Date(data.get("deadlineAt"));
    if (deadline.getTime() <= now()) return toast("Choose a deadline in the future.","error");
    const postRef = isEdit ? ref(db,`jobPosts/${existingPost.key}`) : push(ref(db,"jobPosts"));
    try{
      const patch = {title:data.get("title").trim(),instructions:data.get("instructions").trim(),deadlineAt:data.get("deadlineAt"),deadlineMs:deadline.getTime(),priority:data.get("priority"),relatedJobKey,relatedJobId:relatedJob?.jobId||"",status:"available",updatedAt:now(),updatedBy:state.user.uid};
      if (!isEdit) Object.assign(patch,{createdAt:now(),createdBy:state.user.uid,createdByName:profileDisplay()});
      await update(postRef,patch);
      await recordAudit(isEdit ? "updated" : "posted","job board",postRef.key,data.get("title").trim()); closeModal(); toast(isEdit ? "Work post updated." : "Work posted to the team.","success");
    }catch(error){console.error(error);toast("Work could not be posted.","error");}
  };
}

async function claimJobPost(postKey) {
  const postRef = ref(db, `jobPosts/${postKey}`);
  try {
    const result = await runTransaction(postRef, current => {
      if (!current || current.status !== "available") return;
      if ((safeNumber(current.deadlineMs) || (current.deadlineAt ? new Date(current.deadlineAt).getTime() : 0)) < now()) return;
      return {...current,status:"claimed",claimedBy:state.user.uid,claimedByName:profileDisplay(),claimedAt:now()};
    });
    if (!result.committed) return toast("That work is no longer available. Another worker may have claimed it.","error");
    const post=result.snapshot.val();
    if(post.relatedJobKey){
      const jobSnap=await get(ref(db,`jobs/${post.relatedJobKey}`));
      if(jobSnap.exists()){
        const job=jobSnap.val();
        if(job.assignedTo && job.assignedTo !== state.user.uid){
          toast("The board post was claimed, but the linked job is already assigned. Ask Admin to resolve it.","error");
        }else{
          await update(ref(db,`jobs/${post.relatedJobKey}`),{assignedTo:state.user.uid,assignedToName:profileDisplay(),assignedAt:now(),assignedBy:state.user.uid,claimPostId:postKey,updatedAt:now()});
        }
      }
    }
    await recordAudit("claimed","job board",postKey,post.title||"Work item"); toast("Job claimed. It is now your responsibility.","success");
  } catch(error){console.error(error);toast("The job could not be claimed.","error");}
}

function cancelJobPost(postKey) {
  if(!isAdmin()) return;
  const post=state.data.jobPosts?.[postKey]; if(!post) return;
  const body=`<form id="cancelPostForm"><div class="notice warning">Cancelling removes this work from the active board. If it was claimed, the linked job will be unassigned when appropriate.</div><label class="field" style="margin-top:12px"><span>Reason for cancellation *</span><textarea id="cancelPostReason" minlength="5" required></textarea></label></form>`;
  openModal({title:"Cancel posted work",subtitle:post.title||postKey,body,actions:`<button class="secondary" data-modal-cancel>Keep post</button><button class="primary danger" id="confirmCancelPost">Cancel work</button>`});
  modalHost.querySelector("[data-modal-cancel]").onclick=closeModal;
  document.getElementById("confirmCancelPost").onclick=async()=>{
    const form=document.getElementById("cancelPostForm");if(!form.reportValidity())return;const reason=document.getElementById("cancelPostReason").value.trim();
    try{
      await update(ref(db,`jobPosts/${postKey}`),{status:"cancelled",cancelledAt:now(),cancelledBy:state.user.uid,cancelledByName:profileDisplay(),cancelReason:reason});
      if(post.relatedJobKey && post.claimedBy){const job=jobByKey(post.relatedJobKey);if(job?.assignedTo===post.claimedBy){await update(ref(db,`jobs/${post.relatedJobKey}`),{assignedTo:"",assignedToName:"",assignedAt:now(),assignedBy:state.user.uid,updatedAt:now()});}}
      await recordAudit("cancelled","job board",postKey,reason);closeModal();toast("Posted work cancelled.","success");
    }catch(error){console.error(error);toast("Work could not be cancelled.","error");}
  };
}

function renderTasks(host) {
  const showArchivedTasks = state.ui?.showArchivedTasks === true;
  const allTasks = values(state.data.tasks)
    .filter(task => isAdmin() || task.assignedTo === state.user.uid)
    .filter(task => showArchivedTasks || activeRecord(task))
    .sort((a,b)=>(a.dueAt||"9999").localeCompare(b.dueAt||"9999"));

  const groups = {
    overdue: allTasks.filter(task => taskDueState(task) === "overdue"),
    today: allTasks.filter(task => taskDueState(task) === "today"),
    upcoming: allTasks.filter(task => taskDueState(task) === "upcoming" && task.status !== "completed"),
    completed: allTasks.filter(task => task.status === "completed")
  };

  host.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">To-do & reminders</span>
        <h1>Tasks</h1>
        <p>RecoveryDesk reminds you inside the app; background push reminders are intentionally deferred.</p>
      </div>
      <div class="head-actions">
        ${isAdmin() ? `<button class="secondary" id="toggleArchivedTasks">${icon("archive",17)} ${showArchivedTasks ? "Hide archived" : "Show archived"}</button>` : ""}
        <button class="primary" id="newTaskBtn">${icon("plus",17)} New task</button>
      </div>
    </div>

    <div class="grid two">
      ${taskGroupPanel("Overdue", groups.overdue, "alert")}
      ${taskGroupPanel("Due today", groups.today, "clock")}
    </div>

    <div class="grid two">
      ${taskGroupPanel("Upcoming", groups.upcoming, "tasks")}
      ${taskGroupPanel("Completed", groups.completed.slice(0,25), "check")}
    </div>`;

  document.getElementById("newTaskBtn").onclick = () => openTaskModal();
  document.getElementById("toggleArchivedTasks")?.addEventListener("click", () => {
    state.ui ||= {};
    state.ui.showArchivedTasks = !state.ui.showArchivedTasks;
    render();
  });
  bindTaskChecks(host);
  bindTaskManagement(host);
}

function taskGroupPanel(title, tasks, iconName) {
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h2>${icon(iconName,17)} ${title}</h2><p>${tasks.length} task${tasks.length === 1 ? "" : "s"}</p></div>
      </div>
      ${tasks.length
        ? tasks.map(taskRowHtml).join("")
        : emptyState(iconName, `No ${title.toLowerCase()} tasks`, "Nothing to show here.")}
    </section>`;
}

function profileDisplayName(profile) {
  return profile?.displayName || profile?.realName || profile?.name || profile?.email || profile?.uid || "Staff";
}

function profileNameForSort(profile) {
  return profile.displayName || profile.realName || profile.name || profile.email || "";
}

function openTaskModal(job = null, existingTask = null) {
  const isEdit = Boolean(existingTask);
  if (isEdit && !canManageTask(existingTask)) return;

  const staffOptions = values(state.data.users)
    .filter(profile => profile.active !== false)
    .map(profile => ({ uid: profile.key, ...profile }))
    .sort((a,b)=>profileNameForSort(a).localeCompare(profileNameForSort(b)));

  const selectedJob = job || (existingTask?.jobKey ? jobByKey(existingTask.jobKey) : null);
  const selectedAssignee = existingTask?.assignedTo ?? state.user.uid;

  const body = `
    <form id="taskForm">
      <label class="field"><span>Task *</span><input name="title" required value="${esc(existingTask?.title || "")}" placeholder="e.g. Call customer with assessment result"></label>
      <label class="field"><span>Description</span><textarea name="description">${esc(existingTask?.description || "")}</textarea></label>

      <div class="form-grid three">
        <label class="field"><span>Assigned to</span>
          <select name="assignedTo" ${isAdmin() ? "" : "disabled"}>
            <option value="">Unassigned</option>
            ${staffOptions.map(profile => `
              <option value="${profile.uid}" ${selectedAssignee === profile.uid ? "selected" : ""}>
                ${esc(profileDisplayName(profile))}
              </option>`).join("")}
          </select>
        </label>

        <label class="field"><span>Due date</span><input name="dueAt" type="date" value="${esc(existingTask?.dueAt || "")}"></label>

        <label class="field"><span>Priority</span>
          <select name="priority">
            ${["Normal","Medium","High"].map(p => `<option ${existingTask?.priority === p ? "selected" : ""}>${p}</option>`).join("")}
          </select>
        </label>

        ${isEdit ? `<label class="field"><span>Status</span>
          <select name="status">
            ${["open","blocked","completed"].map(s => `<option value="${s}" ${existingTask?.status === s ? "selected" : ""}>${s[0].toUpperCase()+s.slice(1)}</option>`).join("")}
          </select>
        </label>` : ""}
      </div>

      ${selectedJob ? `<div class="notice info">Linked to ${esc(selectedJob.jobId || selectedJob.key)}.</div>` : ""}
      ${isEdit && isArchived(existingTask) ? `<div class="notice warning">This task is archived. Restore it before returning it to normal task queues.</div>` : ""}
    </form>`;

  openModal({
    title: isEdit ? "Manage task" : "New task",
    subtitle: selectedJob ? (selectedJob.jobId || selectedJob.key) : "Personal / operational task",
    body,
    actions: `
      <button class="secondary" data-modal-cancel>Cancel</button>
      ${isEdit && isAdmin() ? `<button class="secondary" id="archiveTaskBtn">${isArchived(existingTask) ? "Restore" : "Archive"}</button>` : ""}
      ${isEdit && isAdmin() ? `<button class="secondary danger" id="deleteTaskBtn">Delete</button>` : ""}
      <button class="primary" id="saveTaskBtn">${isEdit ? "Save task" : `${icon("check",17)} Create task`}</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("archiveTaskBtn")?.addEventListener("click", async () => {
    closeModal();
    await archiveRecord(`tasks/${existingTask.key}`, "task", existingTask.key, existingTask.title, !isArchived(existingTask));
  });

  document.getElementById("deleteTaskBtn")?.addEventListener("click", async () => {
    const reason = await managementReasonModal({
      title: "Delete task",
      subtitle: existingTask.title || existingTask.key,
      warning: "Task deletion is permanent. Completed business-history tasks should usually be archived instead.",
      label: "Reason for deletion *",
      confirmText: "Delete task"
    });
    if (!reason) return;
    try {
      await remove(ref(db, `tasks/${existingTask.key}`));
      await recordAudit("deleted", "task", existingTask.key, reason);
      toast("Task deleted.", "success");
    } catch (error) {
      console.error(error);
      toast("Task could not be deleted.", "error");
    }
  });

  document.getElementById("saveTaskBtn").onclick = async () => {
    const form = document.getElementById("taskForm");
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const assignedTo = isAdmin()
      ? String(data.get("assignedTo") || "")
      : (existingTask?.assignedTo || state.user.uid);
    const taskKey = existingTask?.key || push(ref(db, "tasks")).key;
    const button = document.getElementById("saveTaskBtn");
    setBusy(button, true);

    try {
      const patch = {
        title: data.get("title").trim(),
        description: String(data.get("description") || "").trim(),
        assignedTo,
        assignedToName: assignedTo ? staffName(assignedTo) : "",
        jobKey: selectedJob?.key || existingTask?.jobKey || "",
        jobId: selectedJob?.jobId || existingTask?.jobId || "",
        customerId: selectedJob?.customerId || existingTask?.customerId || "",
        dueAt: data.get("dueAt") || "",
        priority: data.get("priority") || "Normal",
        status: isEdit ? (data.get("status") || existingTask?.status || "open") : "open",
        updatedAt: now(),
        updatedBy: state.user.uid
      };

      if (!isEdit) {
        patch.createdBy = state.user.uid;
        patch.createdAt = now();
      }

      await update(ref(db, `tasks/${taskKey}`), patch);
      await recordAudit(isEdit ? "updated" : "created", "task", taskKey, patch.title);
      closeModal();
      toast(isEdit ? "Task updated." : "Task created.", "success");
    } catch (error) {
      console.error(error);
      toast("Task could not be saved.", "error");
      setBusy(button, false);
    }
  };
}

function bindTaskManagement(scope = document) {
  scope.querySelectorAll("[data-task-manage]").forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const key = button.dataset.taskManage;
      const task = state.data.tasks?.[key];
      if (!task) return;
      openTaskModal(
        task.jobKey ? jobByKey(task.jobKey) : null,
        { key, ...task }
      );
    };
  });
}


function financeCard(label, amount, cls, foot) {
  return `
    <div class="stat-card">
      <span class="stat-label">${esc(label)}</span>
      <div>
        <div class="finance-number ${cls}">${formatMoney(amount)}</div>
        <div class="stat-foot">${esc(foot)}</div>
      </div>
    </div>`;
}

function renderOutstandingJobs(jobs) {
  if (!jobs.length) return emptyState("check","Nothing outstanding","All expected charges currently have matching recorded payments.");

  return `<div class="list">${jobs.slice(0,20).map(job => `
    <div class="list-row clickable" data-job-key="${job.key}">
      <div class="list-icon">${icon("jobs",18)}</div>
      <div class="list-main">
        <strong>${esc(job.jobId || job.key)} · ${esc(jobDisplayName(job))}</strong>
        <span>Expected ${formatMoney(expectedForJob(job))} · Paid ${formatMoney(paidForJob(job.key))}</span>
      </div>
      <div class="list-side"><strong>${formatMoney(outstandingForJob(job))}</strong>${icon("chevron",15)}</div>
    </div>`).join("")}</div>`;
}


function allWorkerLedgerEntries() {
  if (state.staff?.role === "worker") {
    return values(state.data.workerLedger).map(entry => ({...entry, ledgerOwnerUid: state.user.uid}));
  }
  const out = [];
  Object.entries(state.data.workerLedger || {}).forEach(([uid, node]) => {
    values(node || {}).forEach(entry => out.push({...entry, ledgerOwnerUid: uid}));
  });
  return out;
}

function ledgerEntriesForCurrentView() {
  return allWorkerLedgerEntries().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}

function ledgerReview(entryId, ownerUid = "") {
  if (state.staff?.role === "worker") return state.data.workerLedgerReviews?.[entryId] || {};
  return state.data.workerLedgerReviews?.[ownerUid]?.[entryId] || {};
}

function renderWorkerLedger(host) {
  const entries=ledgerEntriesForCurrentView();
  const pending=entries.filter(entry=>!ledgerReview(entry.key, entry.ledgerOwnerUid).reconciledAt);
  host.innerHTML=`
    <div class="page-head">
      <div><span class="eyebrow">Immutable money declarations</span><h1>${state.staff?.role === "worker" ? "My Expenses & Money" : "Worker Expenses & Money"}</h1><p>Original worker declarations stay unchanged; Finance/Admin reconcile them separately.</p></div>
      <div class="head-actions">${state.staff?.role === "worker" ? `<button class="primary" id="newLedgerEntry">${icon("plus",17)} Record expense / money</button>` : ""}</div>
    </div>
    <div class="notice warning">Customer payments should normally go through the company/Finance channel. Use a personal-money declaration only when a worker actually handled the funds. Never record passwords, PINs, OTPs or full card details.</div>
    <div class="grid three" style="margin-top:14px">
      ${statCard("Entries",entries.length,"receipt","Immutable declarations")}
      ${statCard("Awaiting reconciliation",pending.length,"clock","Finance/Admin review")}
      ${statCard("Reconciled",entries.length-pending.length,"check","Reviewed separately")}
    </div>
    <section class="panel" style="margin-top:14px">
      <div class="panel-head"><div><h2>Declarations</h2><p>${state.staff?.role === "worker" ? "Your submitted records" : "All worker-submitted records"}</p></div></div>
      ${entries.length ? `<div class="list">${entries.map(ledgerRowHtml).join("")}</div>` : emptyState("receipt","No declarations yet","Worker expenses or personally received customer money will appear here.")}
    </section>`;
  document.getElementById("newLedgerEntry")?.addEventListener("click", openWorkerLedgerModal);
  host.querySelectorAll("[data-review-ledger]").forEach(button=>button.onclick=()=>openLedgerReviewModal(button.dataset.reviewLedger, button.dataset.reviewOwner));
}

function ledgerRowHtml(entry){
  const review=ledgerReview(entry.key, entry.ledgerOwnerUid); const type=entry.type === "customer-money" ? "Customer money received" : "Worker expense";
  return `<div class="list-row">
    <div class="list-icon">${icon(entry.type === "customer-money" ? "finance" : "receipt",18)}</div>
    <div class="list-main"><strong>${formatMoney(entry.amount)} · ${esc(type)}</strong><span>${esc(entry.item || entry.description || "")}${entry.jobId ? ` · ${esc(entry.jobId)}` : ""} · ${esc(entry.createdByName || staffName(entry.createdBy))} · ${formatDate(entry.transactionDate || entry.createdAt)}</span></div>
    <div class="list-side">${review.reconciledAt ? `<span class="status-pill tone-brand-4">${esc(review.status || "Reconciled")}</span>` : `<span class="status-pill tone-warning">Pending</span>`}${(isAdmin() || state.staff?.role === "finance") ? `<button class="secondary" data-review-ledger="${entry.key}" data-review-owner="${esc(entry.ledgerOwnerUid || entry.createdBy || "")}">${review.reconciledAt ? "Review" : "Reconcile"}</button>` : ""}</div>
  </div>`;
}

function openWorkerLedgerModal(){
  if(state.staff?.role !== "worker") return;
  const jobs=values(state.data.jobs).map(job=>({...job,key:job.key||job.jobId})).filter(job=>job.assignedTo===state.user.uid || (!job.assignedTo && job.createdBy===state.user.uid));
  const body=`<form id="workerLedgerForm">
    <label class="field"><span>What are you recording? *</span><select name="type" id="ledgerType"><option value="expense">Expense I paid</option><option value="customer-money">Customer money I personally received</option></select></label>
    <div class="form-grid three">
      <label class="field"><span>Item / purpose *</span><input name="item" required placeholder="e.g. courier fee, replacement cable"></label>
      <label class="field"><span>Amount (₦) *</span><input name="amount" type="number" min="1" required></label>
      <label class="field"><span>Transaction date *</span><input name="transactionDate" type="date" required></label>
      <label class="field"><span>Payment method</span><select name="method"><option>Bank Transfer</option><option>Cash</option><option>POS</option><option>Other</option></select></label>
      <label class="field"><span>Related job</span><select name="jobKey"><option value="">Not linked to a job</option>${jobs.map(job=>`<option value="${job.key}">${esc(job.jobId||job.key)} · ${esc(jobDisplayName(job))}</option>`).join("")}</select></label>
      <label class="field"><span>Reference</span><input name="reference" placeholder="Transaction/reference ID if available"></label>
    </div>
    <div id="personalAccountFields" style="display:none">
      <div class="form-grid two"><label class="field"><span>Receiving account label</span><input name="accountLabel" placeholder="e.g. Samuel personal account"></label><label class="field"><span>Account last 4 digits</span><input name="accountLast4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234"></label></div>
      <div class="notice warning">Do not store a full card number, PIN, password, CVV or OTP in RecoveryDesk.</div>
    </div>
    <label class="field"><span>Explanation *</span><textarea name="description" required placeholder="Explain why you personally handled this money and what it was used for."></textarea></label>
    <div class="notice info">Once submitted, you cannot edit or delete this original declaration. Finance/Admin will reconcile it separately.</div>
  </form>`;
  openModal({title:"Record worker money",subtitle:profileDisplay(),body,actions:`<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="submitLedgerEntry">${icon("shield",17)} Submit immutable record</button>`});
  modalHost.querySelector("[data-modal-cancel]").onclick=closeModal;
  const type=document.getElementById("ledgerType"), account=document.getElementById("personalAccountFields");
  type.onchange=()=>account.style.display=type.value==="customer-money"?"block":"none";
  document.getElementById("submitLedgerEntry").onclick=async()=>{
    const form=document.getElementById("workerLedgerForm");if(!form.reportValidity())return;const data=new FormData(form);const jobKey=data.get("jobKey")||"";const job=jobKey?jobByKey(jobKey):null;const entryRef=push(ref(db,`workerLedger/${state.user.uid}`));
    try{await set(entryRef,{type:data.get("type"),item:data.get("item").trim(),amount:safeNumber(data.get("amount")),transactionDate:data.get("transactionDate"),method:data.get("method"),jobKey,jobId:job?.jobId||"",customerId:job?.customerId||"",reference:String(data.get("reference")||"").trim(),accountLabel:data.get("type")==="customer-money"?String(data.get("accountLabel")||"").trim():"",accountLast4:data.get("type")==="customer-money"?String(data.get("accountLast4")||"").trim():"",description:data.get("description").trim(),createdAt:now(),createdBy:state.user.uid,createdByName:profileDisplay(),immutable:true,testRecord:Boolean(job?.testRecord)});await recordAudit("declared worker money","worker ledger",entryRef.key,`${data.get("type")} · ${formatMoney(data.get("amount"))}`);closeModal();toast("Declaration submitted. The original is now locked.","success");}catch(error){console.error(error);toast("Declaration could not be submitted.","error");}
  };
}

function openLedgerReviewModal(entryId, ownerUid){
  if(!(isAdmin() || state.staff?.role === "finance")) return;
  const entry=state.data.workerLedger?.[ownerUid]?.[entryId]; if(!entry)return; const existing=ledgerReview(entryId, ownerUid);
  const body=`<div class="grid two">${detailTile("Worker",entry.createdByName||staffName(entry.createdBy))}${detailTile("Amount",formatMoney(entry.amount))}</div><div class="notice info" style="margin-top:12px">This review does not rewrite the worker's original declaration.</div><form id="ledgerReviewForm" style="margin-top:12px"><label class="field"><span>Review status</span><select id="ledgerReviewStatus"><option ${existing.status==="Reconciled"?"selected":""}>Reconciled</option><option ${existing.status==="Needs clarification"?"selected":""}>Needs clarification</option><option ${existing.status==="Rejected"?"selected":""}>Rejected</option></select></label><label class="field"><span>Finance/Admin note *</span><textarea id="ledgerReviewNote" required>${esc(existing.note||"")}</textarea></label></form>`;
  openModal({title:"Review worker declaration",subtitle:entry.item||entryId,body,actions:`<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="saveLedgerReview">${icon("check",17)} Save review</button>`}); modalHost.querySelector("[data-modal-cancel]").onclick=closeModal;
  document.getElementById("saveLedgerReview").onclick=async()=>{const form=document.getElementById("ledgerReviewForm");if(!form.reportValidity())return;try{await set(ref(db,`workerLedgerReviews/${ownerUid}/${entryId}`),{status:document.getElementById("ledgerReviewStatus").value,note:document.getElementById("ledgerReviewNote").value.trim(),reconciledAt:now(),reconciledBy:state.user.uid,reconciledByName:profileDisplay()});await recordAudit("reviewed worker money","worker ledger",entryId,document.getElementById("ledgerReviewStatus").value);closeModal();toast("Worker declaration reviewed.","success");}catch{toast("Review could not be saved.","error");}};
}

function renderFinance(host) {
  const payments = values(state.data.payments).filter(payment => payment.status !== "void");
  const expenses = values(state.data.expenses).filter(expense => expense.status !== "void");
  const income = payments.reduce((sum,payment)=>sum+safeNumber(payment.amount),0);
  const expenseTotal = expenses.reduce((sum,expense)=>sum+safeNumber(expense.amount),0);
  const jobs = values(state.data.jobs).map(job => ({ ...job, key: job.key || job.jobId }));
  const outstanding = jobs.reduce((sum,job)=>sum+outstandingForJob(job),0);
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1).getTime();
  const todayIncome = payments.filter(p => safeNumber(p.createdAt) >= todayStart.getTime()).reduce((sum,p)=>sum+safeNumber(p.amount),0);
  const monthIncome = payments.filter(p => safeNumber(p.createdAt) >= monthStart).reduce((sum,p)=>sum+safeNumber(p.amount),0);
  const monthExpenses = expenses.filter(e => safeNumber(e.createdAt) >= monthStart).reduce((sum,e)=>sum+safeNumber(e.amount),0);

  host.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">Operational finance</span>
        <h1>Finance</h1>
        <p>RecoveryDesk tracks service money. Formal accounting can still live in dedicated accounting software later.</p>
      </div>
      <div class="head-actions"><button class="primary" id="addExpenseBtn">${icon("plus",17)} Add expense</button></div>
    </div>

    <div class="grid four">
      ${financeCard("Income today", todayIncome, todayIncome >= 0 ? "positive" : "negative", "Confirmed payments less refunds")}
      ${financeCard("Income this month", monthIncome, monthIncome >= 0 ? "positive" : "negative", "Month-to-date")}
      ${financeCard("Expenses this month", monthExpenses, "negative", "Month-to-date operational expenses")}
      ${financeCard("Outstanding", outstanding, "", "Expected charges not yet recorded paid")}
    </div>

    <section class="panel" style="margin-top:14px">
      <div class="panel-head"><div><h2>Worker money awaiting review</h2><p>Immutable worker declarations that Finance/Admin should reconcile separately.</p></div><button class="secondary" id="openWorkerExpenses">Open expenses</button></div>
      ${pendingLedgerCount() ? `<div class="notice warning">${pendingLedgerCount()} worker declaration${pendingLedgerCount()===1?" is":"s are"} awaiting review.</div>` : `<div class="notice success">No worker money declarations are waiting for review.</div>`}
    </section>

    <section class="panel" style="margin-top:14px">
      <div class="panel-head"><div><h2>All-time operational summary</h2><p>Recorded in RecoveryDesk since V2 finance tracking began.</p></div></div>
      <div class="grid three">
        ${detailTile("Total income", formatMoney(income))}
        ${detailTile("Total expenses", formatMoney(expenseTotal))}
        ${detailTile("Net operational", formatMoney(income-expenseTotal))}
      </div>
    </section>

    <div class="grid two">
      <section class="panel">
        <div class="panel-head"><div><h2>Recent payments</h2><p>Workers confirm job payments; Finance/Admin sees the company view.</p></div></div>
        ${payments.length ? `<div class="list">${payments
          .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
          .slice(0,20)
          .map(payment => `
            <div class="list-row">
              <div class="list-icon">${icon("finance",18)}</div>
              <div class="list-main">
                <strong>${formatMoney(payment.amount)} · ${esc(payment.category || "Payment")}</strong>
                <span>${esc(payment.jobKey || "")} · ${esc(payment.method || "")} · ${staffName(payment.confirmedBy)}</span>
              </div>
              <div class="list-side"><span class="tiny muted">${formatDate(payment.createdAt)}</span>${payment.reconciledAt ? `<span class="status-pill tone-brand-4">Reconciled</span>` : `<button class="secondary" data-reconcile-payment="${payment.key}">Reconcile</button>`}</div>
            </div>`).join("")}</div>` : emptyState("finance","No payments","Payments recorded on jobs will appear here.")}
      </section>

      <section class="panel">
        <div class="panel-head"><div><h2>Expenses</h2><p>Finance/Admin-only operational expenses</p></div></div>
        ${expenses.length ? `<div class="list">${expenses
          .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
          .slice(0,20)
          .map(expense => `
            <div class="list-row">
              <div class="list-icon">${icon("receipt",18)}</div>
              <div class="list-main">
                <strong>${formatMoney(expense.amount)} · ${esc(expense.category || "Expense")}</strong>
                <span>${esc(expense.description || "")}</span>
              </div>
              <div class="list-side"><span class="tiny muted">${formatDate(expense.createdAt)}</span>${(isAdmin() || state.staff?.role === "finance") && expense.status !== "void" ? `<button class="ghost danger" data-void-expense="${expense.key}">Void</button>` : ""}</div>
            </div>`).join("")}</div>` : emptyState("receipt","No expenses","Add operational expenses here.")}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><div><h2>Outstanding jobs</h2><p>Charges minus payments currently recorded in RecoveryDesk</p></div></div>
      ${renderOutstandingJobs(
        jobs
          .filter(job => outstandingForJob(job) > 0)
          .sort((a,b)=>outstandingForJob(b)-outstandingForJob(a))
      )}
    </section>`;

  document.getElementById("addExpenseBtn").onclick = openExpenseModal;
  host.querySelectorAll("[data-void-expense]").forEach(button => {
    button.onclick = async () => {
      const expense = state.data.expenses?.[button.dataset.voidExpense];
      if (!expense) return;
      const reason = await managementReasonModal({
        title: "Void expense",
        subtitle: `${formatMoney(expense.amount)} · ${expense.category || "Expense"}`,
        warning: "Voiding preserves finance history while removing the expense from active totals.",
        label: "Reason for void *",
        confirmText: "Void expense"
      });
      if (!reason) return;
      try {
        await update(ref(db, `expenses/${button.dataset.voidExpense}`), {
          status: "void",
          voidReason: reason,
          voidedAt: now(),
          voidedBy: state.user.uid,
          voidedByName: profileDisplay()
        });
        await recordAudit("voided", "expense", button.dataset.voidExpense, reason);
        toast("Expense voided.", "success");
      } catch (error) {
        console.error(error);
        toast("Expense could not be voided.", "error");
      }
    };
  });
  document.getElementById("openWorkerExpenses")?.addEventListener("click", () => navigate("expenses"));
  host.querySelectorAll("[data-reconcile-payment]").forEach(button => {
    button.onclick = async () => {
      const key = button.dataset.reconcilePayment;
      try {
        await update(ref(db, `payments/${key}`), {
          reconciledAt: now(),
          reconciledBy: state.user.uid,
          reconciledByName: profileDisplay()
        });
        await recordAudit("reconciled payment", "payment", key, "Matched against finance records");
        toast("Payment reconciled.", "success");
      } catch {
        toast("Payment could not be reconciled.", "error");
      }
    };
  });
  bindJobRowClicks(host);
}

function openExpenseModal() {
  if (!isFinance()) return;

  const body = `
    <form id="expenseForm">
      <div class="form-grid">
        <label class="field"><span>Amount (₦) *</span><input name="amount" type="number" min="1" required></label>
        <label class="field"><span>Category</span>
          <select name="category">
            <option>Operations</option>
            <option>Parts / supplies</option>
            <option>Transport</option>
            <option>Utilities</option>
            <option>Other</option>
          </select>
        </label>
      </div>
      <label class="field"><span>Description *</span><textarea name="description" required></textarea></label>
      <label class="field"><span>Reference / receipt number</span><input name="reference"></label>
    </form>`;

  openModal({
    title: "Add expense",
    subtitle: "Finance record",
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="saveExpenseBtn">${icon("check",17)} Save expense</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("saveExpenseBtn").onclick = async () => {
    const form = document.getElementById("expenseForm");
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const expenseRef = push(ref(db,"expenses"));
    const button = document.getElementById("saveExpenseBtn");
    setBusy(button,true);

    try {
      await set(expenseRef,{
        amount:safeNumber(data.get("amount")),
        category:data.get("category"),
        description:data.get("description").trim(),
        reference:String(data.get("reference")||"").trim(),
        status:"confirmed",
        createdBy:state.user.uid,
        createdByName:profileDisplay(),
        createdAt:now()
      });

      await recordAudit(
        "recorded expense",
        "expense",
        expenseRef.key,
        `${formatMoney(data.get("amount"))} · ${data.get("category")}`
      );

      closeModal();
      toast("Expense recorded.","success");
    } catch {
      toast("Expense could not be saved.","error");
      setBusy(button,false);
    }
  };
}

function renderStaff(host) {
  const profiles = values(state.data.users)
    .map(profile => ({ uid: profile.key, ...profile }))
    .sort((a,b)=>profileNameForSort(a).localeCompare(profileNameForSort(b)));

  const requests = values(state.data.staffRequests)
    .filter(request => request.status !== "approved" && request.status !== "rejected")
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  host.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">People & permissions</span>
        <h1>Staff</h1>
        <p>Signing in is not enough. An Administrator approves the person and assigns their RecoveryDesk role.</p>
      </div>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Pending access requests</h2><p>Review real identity, display name and job role before approval.</p></div>
        <span class="status-pill ${requests.length ? "tone-warning" : "tone-neutral"}">${requests.length}</span>
      </div>

      ${requests.length ? `<div class="list">${requests.map(request => `
        <div class="list-row">
          <div class="avatar">${esc(initials(request.realName || request.email))}</div>
          <div class="list-main">
            <strong>${esc(request.realName || request.email || "Applicant")}</strong>
            <span>${esc(request.email || "")} · wants to be called ${esc(request.displayName || "—")} · ${esc(request.requestedJobTitle || "No title supplied")}</span>
          </div>
          <div class="list-side"><button class="primary" data-approve-staff="${request.key}">${icon("shield",16)} Review</button></div>
        </div>`).join("")}</div>` : emptyState("check","No pending staff","No new staff access requests are waiting.")}
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Authorized staff</h2><p>Real names remain underneath; display names can change.</p></div>
        <span class="status-pill tone-neutral">${profiles.length}</span>
      </div>

      <div class="list">${profiles.map(profile => `
        <div class="list-row">
          ${avatarMarkup(profile.displayName || profile.realName || profile.name, profile)}
          <div class="list-main">
            <strong>${esc(profile.displayName || profile.realName || profile.name || "Staff")}</strong>
            <span>${esc(profile.realName || profile.name || "")} · ${esc(profile.jobTitle || roleLabel(profile.role))} · ${esc(profile.email || "")}</span>
          </div>
          <div class="list-side">
            ${rolePill(profile.role)}
            <span class="status-pill ${profile.active === false ? "tone-danger" : "tone-brand-4"}">${profile.active === false ? "Inactive" : "Active"}</span>
            <button class="secondary" data-edit-staff="${profile.uid}">${icon("edit",15)} Edit</button>
          </div>
        </div>`).join("")}</div>
    </section>`;

  host.querySelectorAll("[data-approve-staff]").forEach(button => {
    button.onclick = () => openStaffApprovalModal(
      button.dataset.approveStaff,
      state.data.staffRequests[button.dataset.approveStaff]
    );
  });

  host.querySelectorAll("[data-edit-staff]").forEach(button => {
    const profile = {
      uid: button.dataset.editStaff,
      ...state.data.users[button.dataset.editStaff]
    };
    button.onclick = () => openStaffEditModal(profile);
  });
}

function openStaffApprovalModal(uid, request) {
  const body = `
    <form id="staffApprovalForm">
      <div class="form-grid">
        <label class="field"><span>Real name *</span><input name="realName" value="${esc(request.realName || "")}" required></label>
        <label class="field"><span>Initial display name *</span><input name="displayName" value="${esc(request.displayName || request.realName || "")}" required></label>
        <label class="field"><span>Job title</span><input name="jobTitle" value="${esc(request.requestedJobTitle || "")}" placeholder="e.g. Recovery Technician"></label>
        <label class="field"><span>System role *</span>
          <select name="role">
            <option value="worker">Worker</option>
            <option value="finance">Finance</option>
            <option value="subadmin">Sub-Administrator</option>
            ${isOwner() ? `<option value="admin">Administrator</option>` : ""}
          </select>
        </label>
      </div>

      <div class="notice warning">
        Administrator can manage staff and business-wide settings. Finance sees operational finance. Worker handles customers, devices and recovery work.
      </div>
    </form>`;

  openModal({
    title: "Approve staff",
    subtitle: request.email || uid,
    body,
    actions: `<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="approveStaffBtn">${icon("shield",17)} Approve staff</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick = closeModal;

  document.getElementById("approveStaffBtn").onclick = async () => {
    const form = document.getElementById("staffApprovalForm");
    if (!form.reportValidity()) return;
    const data = new FormData(form);

    const profile = {
      realName: data.get("realName").trim(),
      displayName: data.get("displayName").trim(),
      name: data.get("realName").trim(),
      email: request.email || "",
      jobTitle: String(data.get("jobTitle") || "").trim(),
      role: data.get("role"),
      active: true,
      approvedBy: state.user.uid,
      approvedAt: now(),
      createdAt: request.createdAt || now()
    };

    const button = document.getElementById("approveStaffBtn");
    setBusy(button,true);

    try {
      await set(ref(db,`users/${uid}`),profile);
      await update(ref(db,`staffRequests/${uid}`),{
        status:"approved",
        approvedBy:state.user.uid,
        approvedAt:now(),
        approvedRole:profile.role
      });

      const mirrored = await syncStaffAccessMirror(uid,profile);
      await recordAudit("approved staff","staff",uid,`${profile.realName} · ${profile.role}`);
      closeModal();

      toast(
        `Staff approved.${mirrored ? "" : " Storage access mirror will be completed after Firestore setup."}`,
        "success"
      );
    } catch (error) {
      console.error(error);
      toast("Staff approval could not be saved.","error");
      setBusy(button,false);
    }
  };
}

function openStaffEditModal(profile) {
  const body = `
    <form id="staffEditForm">
      <div class="form-grid">
        <label class="field"><span>Real name</span><input name="realName" value="${esc(profile.realName || profile.name || "")}" required></label>
        <label class="field"><span>Display name</span><input name="displayName" value="${esc(profile.displayName || profile.realName || profile.name || "")}" required></label>
        <label class="field"><span>Job title</span><input name="jobTitle" value="${esc(profile.jobTitle || "")}"></label>
        <label class="field"><span>Role</span>
          <select name="role">
            ${["worker","finance","subadmin","admin","owner"].filter(role => isOwner() || !["admin","owner"].includes(role)).map(role => `<option value="${role}" ${profile.role===role?"selected":""}>${roleLabel(role)}</option>`).join("")}
          </select>
        </label>
      </div>

      <label class="check-row">
        <input type="checkbox" name="active" ${profile.active === false ? "" : "checked"}>
        <div><strong>Account active</strong><span>Turning this off blocks RecoveryDesk staff access without deleting their history.</span></div>
      </label>
    </form>`;

  openModal({
    title:"Edit staff",
    subtitle:profile.email || profile.uid,
    body,
    actions:`<button class="secondary" data-modal-cancel>Cancel</button><button class="primary" id="saveStaffEdit">${icon("check",17)} Save changes</button>`
  });

  modalHost.querySelector("[data-modal-cancel]").onclick=closeModal;

  document.getElementById("saveStaffEdit").onclick=async()=>{
    const form=document.getElementById("staffEditForm");
    if(!form.reportValidity()) return;
    const data=new FormData(form);

    const patch={
      realName:data.get("realName").trim(),
      name:data.get("realName").trim(),
      displayName:data.get("displayName").trim(),
      jobTitle:String(data.get("jobTitle")||"").trim(),
      role:data.get("role"),
      active:data.get("active")==="on",
      updatedAt:now(),
      updatedBy:state.user.uid
    };

    const button=document.getElementById("saveStaffEdit");
    setBusy(button,true);

    try {
      await update(ref(db,`users/${profile.uid}`),patch);
      await syncStaffAccessMirror(profile.uid,{...profile,...patch});
      await recordAudit("updated","staff",profile.uid,`${patch.realName} · ${patch.role} · ${patch.active?"active":"inactive"}`);
      closeModal();
      toast("Staff profile updated.","success");
    } catch {
      toast("Staff changes could not be saved.","error");
      setBusy(button,false);
    }
  };
}

function renderAudit(host) {
  const entries = values(state.data.audit)
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
    .slice(0,150);

  host.innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow">Accountability</span><h1>Audit trail</h1><p>Who changed what, and when.</p></div>
    </div>

    <section class="panel">
      ${entries.length ? `<div class="timeline">${entries.map(entry => `
        <div class="timeline-item">
          <div class="timeline-dot">${icon("audit",15)}</div>
          <div>
            <strong>${esc(entry.actorName || "Staff")} ${esc(entry.action || "changed")} ${esc(entry.entityType || "record")}</strong>
            <span>${esc(entry.entityId || "")}${entry.summary ? ` · ${esc(entry.summary)}` : ""} · ${formatDate(entry.createdAt,true)}</span>
          </div>
        </div>`).join("")}</div>` : emptyState("audit","No audit entries","Activity recorded by V2 will appear here.")}
    </section>`;
}

function serviceTile(label, status, text) {
  const ready = status === true;
  const unknown = status === null;

  return `
    <div class="service-tile">
      <strong>${ready ? icon("check",15) : unknown ? icon("clock",15) : icon("alert",15)} ${esc(label)}</strong>
      <span>${esc(text)}</span>
    </div>`;
}


function looksLikeTestText(value="") {
  return /\b(test|dummy|sample)\b/i.test(String(value));
}

function collectTestData() {
  const customerIds = new Set(values(state.data.customers).filter(c => c.testRecord === true || looksLikeTestText(c.fullName) || looksLikeTestText(c.email) || looksLikeTestText(c.address) || ["08000000000","00000000000"].includes(normalizePhone(c.phone))).map(c=>c.key));
  const jobs = values(state.data.jobs).filter(j => j.testRecord === true || customerIds.has(j.customerId) || looksLikeTestText(j.customerNameSnapshot) || looksLikeTestText(j.clientName));
  const jobKeys = new Set(jobs.map(j=>j.key));
  const deviceIds = new Set(values(state.data.devices).filter(d => d.testRecord === true || customerIds.has(d.customerId)).map(d=>d.key));
  const documentIds = new Set(values(state.data.documents).filter(d => d.testRecord === true || customerIds.has(d.customerId) || jobKeys.has(d.jobKey)).map(d=>d.key));
  const paymentIds = new Set(values(state.data.payments).filter(p => customerIds.has(p.customerId) || jobKeys.has(p.jobKey) || p.testRecord === true).map(p=>p.key));
  const taskIds = new Set(values(state.data.tasks).filter(t => customerIds.has(t.customerId) || jobKeys.has(t.jobKey) || t.testRecord === true).map(t=>t.key));
  const ledgerIds = new Set(allWorkerLedgerEntries().filter(e => e.testRecord === true || customerIds.has(e.customerId) || jobKeys.has(e.jobKey)).map(e=>`${e.ledgerOwnerUid}:${e.key}`));
  const postIds = new Set(values(state.data.jobPosts).filter(p => p.testRecord === true || jobKeys.has(p.relatedJobKey) || looksLikeTestText(p.title)).map(p=>p.key));
  return {customerIds,jobKeys,deviceIds,documentIds,paymentIds,taskIds,ledgerIds,postIds};
}

function testDataCount(bundle=collectTestData()) {
  return bundle.customerIds.size + bundle.jobKeys.size + bundle.deviceIds.size + bundle.documentIds.size + bundle.paymentIds.size + bundle.taskIds.size + bundle.ledgerIds.size + bundle.postIds.size;
}

function openTestDataCleanup() {
  if(!isOwner()) return;
  const bundle=collectTestData(); const count=testDataCount(bundle);
  if(!count) return toast("No obvious test/dummy records were detected.","success");
  const names=[...bundle.customerIds].map(id=>`${id} · ${state.data.customers[id]?.fullName||"Customer"}`);
  const body=`<div class="notice danger"><strong>Owner-only destructive action.</strong> RecoveryDesk detected records marked as test/dummy or clearly named Test/Dummy/Sample. Real records are not selected automatically.</div><div class="panel flat" style="margin-top:12px"><strong>${count} linked test record${count===1?"":"s"}</strong><p class="tiny muted">Customers: ${bundle.customerIds.size} · Jobs: ${bundle.jobKeys.size} · Devices: ${bundle.deviceIds.size} · Documents: ${bundle.documentIds.size} · Payments: ${bundle.paymentIds.size} · Tasks: ${bundle.taskIds.size} · Worker money: ${bundle.ledgerIds.size}</p>${names.length?`<p class="tiny">${names.map(esc).join("<br>")}</p>`:""}</div><label class="field"><span>Type DELETE TEST DATA to confirm *</span><input id="cleanupPhrase" autocomplete="off"></label>`;
  openModal({title:"Delete test/dummy data",subtitle:"Owner Administrator",body,actions:`<button class="secondary" data-modal-cancel>Cancel</button><button class="primary danger" id="confirmTestCleanup">Delete test data</button>`});modalHost.querySelector("[data-modal-cancel]").onclick=closeModal;
  document.getElementById("confirmTestCleanup").onclick=async()=>{if(document.getElementById("cleanupPhrase").value.trim()!=="DELETE TEST DATA")return toast("Confirmation phrase does not match.","error");const button=document.getElementById("confirmTestCleanup");setBusy(button,true,"Deleting test data…");try{await deleteTestDataBundle(bundle);closeModal();toast("Test/dummy records removed.","success");}catch(error){console.error(error);toast(`Cleanup stopped: ${error?.code || error?.message || "unknown error"}. No additional records will be deleted.`,"error");setBusy(button,false);}};
}

async function deleteTestDataBundle(bundle){
  if (!isOwner()) throw new Error("Owner access required");

  const cleanupAuthPath = `cleanupAuthorizations/${state.user.uid}`;
  const cleanupAuthorization = {documents:{}, attachments:{}};

  // Mark selected parents first so linked immutable-child rules can verify test cleanup.
  for(const id of bundle.customerIds){await update(ref(db,`customers/${id}`),{testRecord:true});}
  for(const key of bundle.jobKeys){await update(ref(db,`jobs/${key}`),{testRecord:true});}

  // Older generated documents do not all carry consistent jobKey/customerId fields.
  // Authorize ONLY the exact document IDs that the Owner reviewed in this cleanup bundle.
  for (const id of bundle.documentIds) cleanupAuthorization.documents[id] = true;
  for (const key of bundle.jobKeys) cleanupAuthorization.attachments[key] = true;

  let cleanupAuthorizationCreated = false;
  try {
    if (bundle.documentIds.size || bundle.jobKeys.size) {
      await set(ref(db, cleanupAuthPath), cleanupAuthorization);
      cleanupAuthorizationCreated = true;
    }

    for(const id of bundle.documentIds){await remove(ref(db,`documents/${id}`));}
    for(const key of bundle.jobKeys){
      await remove(ref(db,`jobEdits/${key}`));
      await remove(ref(db,`attachments/${key}`));
    }
    for(const compound of bundle.ledgerIds){const [uid,id]=compound.split(":");await remove(ref(db,`workerLedgerReviews/${uid}/${id}`));await remove(ref(db,`workerLedger/${uid}/${id}`));}
    for(const id of bundle.postIds){await remove(ref(db,`jobPosts/${id}`));}
    for(const id of bundle.paymentIds){await remove(ref(db,`payments/${id}`));}
    for(const id of bundle.taskIds){await remove(ref(db,`tasks/${id}`));}
    for(const customerId of bundle.customerIds){await remove(ref(db,`communications/${customerId}`));await remove(ref(db,`customerJobs/${customerId}`));await remove(ref(db,`customerDevices/${customerId}`));}
    for(const id of bundle.deviceIds){await remove(ref(db,`devices/${id}`));}
    for(const key of bundle.jobKeys){await remove(ref(db,`jobs/${key}`));}
    for(const id of bundle.customerIds){await remove(ref(db,`customers/${id}`));}
    await recordAudit("deleted test data","system","test-cleanup",`${testDataCount(bundle)} linked test records removed by Owner`);
  } finally {
    // Never leave a cleanup authorization behind when one was actually created.
    if (cleanupAuthorizationCreated) {
      try { await remove(ref(db, cleanupAuthPath)); }
      catch (cleanupError) { console.error("Could not clear cleanup authorization", cleanupError); }
    }
  }
}

function renderSettings(host) {
  const c = company();
  const legacy = values(state.data.jobs).filter(job => !job.customerId);
  const theme = localStorage.getItem("rd-theme") || "system";

  host.innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow">Preferences & system</span>
        <h1>Settings</h1>
        <p>Your display identity is separate from the real name kept underneath.</p>
      </div>
    </div>

    <div class="grid two">
      <section class="panel form-section">
        <div class="panel-head">
          <div><h2>Your profile</h2><p>Real name is controlled by Admin; display name is yours to change.</p></div>
          ${avatarMarkup(profileDisplay(), state.staff)}
        </div>

        <label class="field"><span>Real name</span><input value="${esc(profileRealName())}" readonly></label>
        <label class="field"><span>Display name</span><input id="profileDisplayName" value="${esc(profileDisplay())}"></label>
        <label class="field"><span>Job title</span><input value="${esc(state.staff.jobTitle || roleLabel())}" readonly></label>

        <button class="primary" id="saveProfileDisplay">${icon("check",17)} Save display name</button>
      </section>

      <section class="panel form-section">
        <div class="panel-head"><div><h2>Appearance</h2><p>RecoveryDesk follows your preference on this device.</p></div></div>

        <label class="field"><span>Theme</span>
          <select id="themePreference">
            <option value="system" ${theme==="system"?"selected":""}>Follow device</option>
            <option value="light" ${theme==="light"?"selected":""}>Light</option>
            <option value="dark" ${theme==="dark"?"selected":""}>Dark</option>
          </select>
        </label>

        <div class="notice info">
          Status colors use green shades for forward progress, while amber/red are reserved for attention and blocked work. Labels and icons always accompany color.
        </div>
      </section>
    </div>

      <section class="panel form-section">
        <div class="panel-head"><div><h2>Password & sign-in</h2><p>Email/password users can change their password here. Google sign-in remains managed by Google.</p></div></div>
        ${state.user?.providerData?.some(provider => provider.providerId === "password") ? `
          <div class="notice success">Password sign-in is enabled for this account.</div>
          <label class="field"><span>Current password</span><input id="currentPassword" type="password" autocomplete="current-password"></label>
          <label class="field"><span>New password</span><input id="newPassword" type="password" minlength="6" autocomplete="new-password"></label>
          <label class="field"><span>Confirm new password</span><input id="confirmNewPassword" type="password" minlength="6" autocomplete="new-password"></label>
          <button class="primary" id="changePasswordBtn">${icon("shield",17)} Change password</button>
        ` : `
          <div class="notice info">
            This account currently signs in with Google only. Add a password to the same Firebase account so you can use either Google or email/password without changing your RecoveryDesk UID or role.
          </div>
          <label class="field"><span>New password</span><input id="linkPassword" type="password" minlength="6" autocomplete="new-password"></label>
          <label class="field"><span>Confirm password</span><input id="linkPasswordConfirm" type="password" minlength="6" autocomplete="new-password"></label>
          <button class="primary" id="enablePasswordSignInBtn">${icon("shield",17)} Enable password sign-in</button>
        `}
      </section>

    ${canManageCriticalSettings() ? `
      <section class="panel form-section">
        <div class="panel-head">
          <div><h2>Company documents</h2><p>Printed invoices, receipts and agreements use these details.</p></div>
          <img src="./logo.png" alt="" style="width:50px;height:50px;border-radius:12px">
        </div>

        <div class="form-grid three">
          <label class="field"><span>Company name</span><input id="companyName" value="${esc(c.name)}"></label>
          <label class="field"><span>Registration number</span><input id="companyRC" value="${esc(c.registrationNumber)}"></label>
          <label class="field"><span>Default assessment fee (₦)</span><input id="defaultAssessmentFee" type="number" min="0" value="${esc(c.defaultAssessmentFee)}"></label>
          <label class="field"><span>Phone</span><input id="companyPhone" value="${esc(c.phone)}"></label>
          <label class="field"><span>Email</span><input id="companyEmail" type="email" value="${esc(c.email)}"></label>
          <label class="field"><span>Address</span><input id="companyAddress" value="${esc(c.address)}"></label>
        </div>

        <label class="check-row">
          <input id="requireIntakePhotos" type="checkbox" ${c.requireIntakePhotos?"checked":""}>
          <div>
            <strong>Require intake photos before assessment</strong>
            <span>Turn this on only after Firebase Storage is configured and tested.</span>
          </div>
        </label>

        <button class="primary" id="saveCompanySettings">${icon("check",17)} Save company settings</button>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>File-storage readiness</h2>
            <p>Business data stays in Realtime Database. Firestore is only the access-control mirror for secure Storage rules.</p>
          </div>
        </div>

        <div class="service-status">
          ${serviceTile("Realtime Database", true, "Customers, jobs, tasks & finance")}
          ${serviceTile("Firestore access mirror", state.services.firestore, state.services.firestore === false ? "Not configured / unavailable" : "Used for Storage authorization")}
          ${serviceTile("Firebase Storage", state.services.storage, state.services.storage === false ? "Enable Blaze + Storage to activate uploads" : "Photos & signed paperwork")}
        </div>

        <div class="head-actions" style="justify-content:flex-start;margin-top:14px">
          <button class="secondary" id="testAccessMirror">${icon("shield",17)} Test / sync my access</button>
          <button class="secondary" id="syncAllAccessMirrors">${icon("staff",17)} Sync all approved access</button>
        </div>
      </section>


      <section class="panel">
        <div class="panel-head"><div><h2>Required training</h2><p>First visit to each tab requires a short role-specific lesson. It cannot be skipped.</p></div></div>
        <button class="secondary" id="replayTrainingBtn">${icon("audit",17)} Replay all my training</button>
      </section>

      ${isOwner() ? `
      <section class="panel">
        <div class="panel-head"><div><h2>Test Data Cleanup</h2><p>Owner-only cleanup for records explicitly marked test/dummy or clearly named Test/Dummy/Sample.</p></div><span class="status-pill ${testDataCount()?"tone-warning":"tone-brand-4"}">${testDataCount()}</span></div>
        <div class="notice warning">This is deliberately protected. RecoveryDesk will show the detected linked records and require the exact phrase DELETE TEST DATA before removal.</div>
        <button class="primary danger" style="margin-top:12px" id="cleanupTestDataBtn" ${testDataCount()?"":"disabled"}>${icon("trash",17)} Delete detected test data</button>
      </section>` : ""}

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Legacy V1 jobs</h2>
            <p>V2 can convert old single-device jobs into Customer → Job → Device records without deleting the original fields.</p>
          </div>
          <span class="status-pill ${legacy.length?"tone-warning":"tone-brand-4"}">${legacy.length}</span>
        </div>

        ${legacy.length
          ? `<div class="notice warning">${legacy.length} legacy job${legacy.length===1?"":"s"} detected. Migration creates customer/device links while preserving the job ID.</div>
             <button class="primary" style="margin-top:12px" id="migrateLegacyJobs">${icon("audit",17)} Migrate legacy jobs</button>`
          : `<div class="notice success">No unmigrated V1 jobs detected.</div>`}
      </section>
    ` : ""}
  `;

  document.getElementById("saveProfileDisplay").onclick = async () => {
    const name = document.getElementById("profileDisplayName").value.trim();
    if (!name) return;

    try {
      await set(ref(db, `users/${state.user.uid}/displayName`), name);
      toast("Display name updated.", "success");
    } catch {
      toast("Display name could not be saved.", "error");
    }
  };

  document.getElementById("enablePasswordSignInBtn")?.addEventListener("click", async event => {
    const password = document.getElementById("linkPassword")?.value || "";
    const confirm = document.getElementById("linkPasswordConfirm")?.value || "";
    if (!state.user?.email) return toast("This account has no email address to link.", "error");
    if (password.length < 6) return toast("Use a password with at least 6 characters.", "error");
    if (password !== confirm) return toast("The passwords do not match.", "error");

    const button = event.currentTarget;
    setBusy(button, true, "Enabling…");
    try {
      const credential = EmailAuthProvider.credential(state.user.email, password);
      const result = await linkWithCredential(state.user, credential);
      state.user = result.user;
      toast("Password sign-in enabled. You can now use Google or email/password.", "success");
      renderCurrentView();
    } catch (error) {
      console.error(error);
      const code = error?.code || "";
      const message =
        code === "auth/email-already-in-use" || code === "auth/credential-already-in-use"
          ? "That email/password credential is already attached to another Firebase account. Do not create another account; contact the Owner to reconcile it."
          : code === "auth/requires-recent-login"
            ? "For security, sign out and sign back in with Google, then enable password sign-in again."
            : `Password sign-in could not be enabled${code ? ` (${code})` : ""}.`;
      toast(message, "error");
      setBusy(button, false);
    }
  });

  document.getElementById("changePasswordBtn")?.addEventListener("click", async () => {
    const current = document.getElementById("currentPassword").value;
    const next = document.getElementById("newPassword").value;
    const confirm = document.getElementById("confirmNewPassword").value;
    if (!current || !next) return toast("Enter your current and new password.", "error");
    if (next !== confirm) return toast("The new passwords do not match.", "error");
    try {
      const credential = EmailAuthProvider.credential(state.user.email, current);
      await reauthenticateWithCredential(state.user, credential);
      await updatePassword(state.user, next);
      toast("Password changed.", "success");
    } catch {
      toast("Password change failed. Check the current password and try again.", "error");
    }
  });

  document.getElementById("themePreference").onchange = event => {
    localStorage.setItem("rd-theme", event.target.value);
    applyTheme();
    toast("Theme preference saved.", "success");
  };

  document.getElementById("saveCompanySettings")?.addEventListener("click", async () => {
    const payload = {
      name: document.getElementById("companyName").value.trim() || DEFAULT_COMPANY.name,
      registrationNumber: document.getElementById("companyRC").value.trim() || DEFAULT_COMPANY.registrationNumber,
      defaultAssessmentFee: safeNumber(document.getElementById("defaultAssessmentFee").value),
      phone: document.getElementById("companyPhone").value.trim(),
      email: document.getElementById("companyEmail").value.trim(),
      address: document.getElementById("companyAddress").value.trim(),
      requireIntakePhotos: document.getElementById("requireIntakePhotos").checked,
      updatedAt: now(),
      updatedBy: state.user.uid
    };

    try {
      await set(ref(db,"settings/company"),payload);
      await recordAudit("updated","settings","company","Company document settings");
      toast("Company settings saved.","success");
    } catch {
      toast("Company settings could not be saved.","error");
    }
  });

  document.getElementById("testAccessMirror")?.addEventListener("click", async event => {
    setBusy(event.currentTarget,true,"Testing…");
    const ok=await ensureFirestoreAccessMirror();

    toast(
      ok
        ? "Firestore access mirror is ready."
        : "Firestore is not ready yet. Enable Blaze/create Firestore when you are ready for attachments.",
      ok ? "success" : "error"
    );

    renderCurrentView();
  });

  document.getElementById("syncAllAccessMirrors")?.addEventListener("click", syncAllAccessMirrors);
  document.getElementById("replayTrainingBtn")?.addEventListener("click", async () => {
    try {
      await remove(ref(db, `training/${state.user.uid}`));
      state.data.training = {};
      state.trainingLoaded = true;
      toast("Training reset. The required lessons will play again as you open each tab.", "success");
      navigate("dashboard");
    }
    catch { toast("Training could not be reset.", "error"); }
  });
  document.getElementById("cleanupTestDataBtn")?.addEventListener("click", openTestDataCleanup);
  document.getElementById("migrateLegacyJobs")?.addEventListener("click", migrateLegacyJobs);
}

async function syncAllAccessMirrors(event) {
  if (!isAdmin()) return;
  const button = event?.currentTarget;
  setBusy(button, true, "Syncing…");
  try {
    let staffCount = 0;
    for (const [uid, profile] of Object.entries(state.data.users || {})) {
      if (await syncStaffAccessMirror(uid, profile)) staffCount++;
    }

    const accessSnap = await get(ref(db, "customerAccess"));
    const customerAccess = accessSnap.val() || {};
    let customerCount = 0;
    for (const [uid, access] of Object.entries(customerAccess)) {
      if (access?.active !== false && access?.customerId && await syncCustomerAccessMirror(uid, access)) customerCount++;
    }

    state.services.firestore = true;
    toast(`Synced ${staffCount} staff and ${customerCount} customer access record${customerCount===1?"":"s"}.`, "success");
  } catch (error) {
    console.error(error);
    state.services.firestore = false;
    toast("Firestore access sync is not ready yet. Complete the Firestore setup first.", "error");
  } finally {
    if (button) setBusy(button, false);
    renderCurrentView();
  }
}

async function migrateLegacyJobs() {
  if (!isAdmin()) return;

  const legacy = values(state.data.jobs).filter(job => !job.customerId);
  if (!legacy.length) return;

  const button = document.getElementById("migrateLegacyJobs");
  setBusy(button,true,"Migrating…");

  try {
    for (const legacyJob of legacy) {
      const jobKey = legacyJob.key;

      let customer = values(state.data.customers)
        .map(item=>({customerId:item.key,...item}))
        .find(item =>
          normalizePhone(item.phone) &&
          normalizePhone(item.phone) === normalizePhone(legacyJob.phone)
        );

      if (!customer) {
        const customerId = await nextNumber("CUS","customer");

        customer = {
          customerId,
          fullName: legacyJob.clientName || legacyJob.customerNameSnapshot || "Legacy customer",
          phone: legacyJob.phone || "",
          email: legacyJob.email || "",
          address: legacyJob.address || ""
        };

        await set(ref(db,`customers/${customerId}`),{
          fullName:customer.fullName,
          phone:customer.phone,
          email:customer.email,
          address:customer.address,
          active:true,
          createdAt:legacyJob.createdAt || now(),
          createdBy:legacyJob.createdBy || state.user.uid,
          updatedAt:now(),
          migratedFromV1:true
        });
      }

      const deviceId = await nextNumber("DEV","device");

      await set(ref(db,`devices/${deviceId}`),{
        customerId:customer.customerId,
        type:legacyJob.deviceType || "Storage device",
        brandModel:legacyJob.brandModel || "",
        capacity:legacyJob.capacity || "",
        serial:legacyJob.serial || "",
        condition:legacyJob.condition || "",
        problem:legacyJob.problem || "",
        requestedData:legacyJob.requestedData || "",
        previousAttempt:legacyJob.previousAttempt || "Unknown",
        createdAt:legacyJob.createdAt || now(),
        createdBy:legacyJob.createdBy || state.user.uid,
        lastSeenAt:legacyJob.createdAt || now(),
        updatedAt:now(),
        migratedFromV1:true
      });

      await set(ref(db,`customerDevices/${customer.customerId}/${deviceId}`),true);

      const legacyPaymentMethod = legacyJob.assessmentPayment || "Not Paid";
      const legacyPaymentConfirmed = !["", "Not Paid", "Waived"].includes(legacyPaymentMethod) && safeNumber(legacyJob.assessmentFee) > 0;
      const legacyFeeWaived = legacyPaymentMethod === "Waived";

      await update(ref(db,`jobs/${jobKey}`),{
        customerId:customer.customerId,
        customerNameSnapshot:customer.fullName,
        ownerName:customer.fullName,
        submitterName:customer.fullName,
        signerName:legacyJob.confirmationName || customer.fullName,
        deviceIds:{[deviceId]:true},
        deviceSnapshots:{
          [deviceId]:{
            conditionAtIntake:legacyJob.condition||"",
            returning:false,
            capturedAt:legacyJob.createdAt||now()
          }
        },
        assessmentPaymentConfirmed:legacyPaymentConfirmed,
        assessmentPaymentMethod:legacyPaymentMethod,
        assessmentPaymentConfirmedBy:legacyPaymentConfirmed ? (legacyJob.createdBy || state.user.uid) : "",
        assessmentPaymentConfirmedAt:legacyPaymentConfirmed ? (legacyJob.createdAt || now()) : null,
        assessmentFeeWaived:legacyFeeWaived,
        signatureCollected:false,
        intakePhotosRequired:false,
        intakePhotosComplete:true,
        status:legacyJob.status === "Received" ? "Intake Pending" : (legacyJob.status || "Intake Pending"),
        migratedV2:true,
        updatedAt:now()
      });

      await set(ref(db,`customerJobs/${customer.customerId}/${jobKey}`),true);

      if (legacyPaymentConfirmed && !paymentsForJob(jobKey).length) {
        const paymentRef = push(ref(db, "payments"));
        await set(paymentRef, {
          jobKey,
          customerId: customer.customerId,
          amount: safeNumber(legacyJob.assessmentFee),
          category: "Assessment fee",
          method: legacyPaymentMethod,
          reference: legacyJob.paymentReference || "",
          note: "Migrated from V1 intake",
          status: "confirmed",
          confirmedBy: legacyJob.createdBy || state.user.uid,
          confirmedByName: staffName(legacyJob.createdBy),
          createdAt: legacyJob.createdAt || now(),
          createdBy: legacyJob.createdBy || state.user.uid,
          migratedFromV1: true
        });
      }

      await recordAudit("migrated","job",legacyJob.jobId || jobKey,"V1 single-device job migrated to V2 model");
    }

    toast(`${legacy.length} legacy job${legacy.length===1?"":"s"} migrated.`,"success");
  } catch (error) {
    console.error(error);
    toast("Legacy migration stopped because an error occurred. Existing records were not deleted.","error");
  } finally {
    renderCurrentView();
  }
}


function renderCustomerPortal() {
  const customer = state.portal.customer;
  const jobs = state.portal.jobs;
  const docs = state.portal.documents;
  const attachments = state.portal.attachments;

  app.innerHTML = `
    <div class="customer-portal">
      <header class="topbar">
        <div class="brand-lockup" style="padding:0">
          <img src="./logo.png" alt="">
          <div><strong>RecoveryDesk</strong><span>Customer portal</span></div>
        </div>

        <div class="topbar-right">
          <span class="online-dot ${state.services.online?"":"offline"}" data-online-dot></span>
          <span class="tiny muted" data-online-label>${state.services.online?"Online":"Offline"}</span>
          <button class="ghost" id="portalSignOut">${icon("logout",17)} Sign out</button>
        </div>
      </header>

      <main class="content">
        <section class="hero">
          <span class="eyebrow">Customer portal</span>
          <h1>${greeting()}, ${esc(customer?.fullName || "there")}.</h1>
          <p>Your name and customer identity are controlled by WISCODE. This portal shows your approved job status and client-visible documents.</p>
        </section>

        <div class="grid three">
          ${statCard("Your jobs",jobs.length,"jobs","Recovery history")}
          ${statCard("Active",jobs.filter(job=>!["Completed","Closed"].includes(job.status)).length,"devices","Currently open")}
          ${statCard("Documents",docs.length,"file","Invoices, receipts & agreements")}
        </div>

        <section class="panel" style="margin-top:14px">
          <div class="panel-head">
            <div><h2>Your recovery jobs</h2><p>Only records linked to your customer account are shown.</p></div>
          </div>

          ${jobs.length
            ? jobs.map(portalJobHtml).join("")
            : emptyState("jobs","No jobs linked","Ask WISCODE staff to verify the customer account linking.")}
        </section>

        <div class="grid two">
          <section class="panel">
            <div class="panel-head"><div><h2>Documents</h2><p>Client-visible generated documents</p></div></div>

            ${docs.length ? `<div class="list">${docs.map(document=>`
              <div class="list-row">
                <div class="list-icon">${icon(document.type==="agreement"?"signature":"file",18)}</div>
                <div class="list-main">
                  <strong>${esc(document.number || document.documentId)}</strong>
                  <span>${esc(document.type || "Document")} · ${formatDate(document.createdAt)}</span>
                </div>
                <div class="list-side"><button class="secondary" data-portal-document="${document.documentId}">View</button></div>
              </div>`).join("")}</div>` : emptyState("file","No documents yet","Documents shared with you will appear here.")}
          </section>

          <section class="panel">
            <div class="panel-head"><div><h2>Signed copies</h2><p>Exact signed paperwork shared by WISCODE</p></div></div>

            ${attachments.length ? `<div class="attachment-grid">${attachments.map(attachment=>`
              <button class="attachment-card" data-portal-attachment="${attachment.attachmentId}" data-portal-job="${attachment.jobKey}">
                <span class="attachment-icon">${icon(attachment.contentType==="application/pdf"?"file":"image",19)}</span>
                <div>
                  <strong>${esc(attachment.fileName||"Signed document")}</strong>
                  <span>${formatDate(attachment.createdAt)}</span>
                </div>
              </button>`).join("")}</div>` : emptyState("signature","No signed copies shared","Once WISCODE uploads a client-visible signed agreement, it will appear here.")}
          </section>
        </div>

        <section class="panel">
          <span class="eyebrow">Customer identity</span>
          <h2 style="margin:7px 0">${esc(customer?.fullName || "—")}</h2>
          <p class="muted">
            Customer ID: ${esc(customer?.customerId || state.customerAccess?.customerId || "—")}.
            Customers cannot change the registered name from the portal yet.
          </p>
        </section>
      </main>
    </div>`;

  document.getElementById("portalSignOut").onclick=()=>signOut(auth);

  document.querySelectorAll("[data-portal-document]").forEach(button=>{
    button.onclick=()=>{
      const record=state.portal.documents.find(item=>item.documentId===button.dataset.portalDocument);
      if(!record) return;

      const snapshot=record.snapshot||{};

      openPrintableDocument({
        type:record.type,
        number:record.number||record.documentId,
        company:snapshot.company||DEFAULT_COMPANY,
        customer:snapshot.customer||state.portal.customer,
        job:snapshot.job||state.portal.jobs.find(job=>job.key===record.jobKey),
        devices:snapshot.devices||[],
        payments:snapshot.payments||[]
      });
    };
  });

  document.querySelectorAll("[data-portal-attachment]").forEach(button=>{
    button.onclick=()=>previewAttachment(
      button.dataset.portalJob,
      button.dataset.portalAttachment
    );
  });

  document.querySelectorAll("[data-customer-approve-quote]").forEach(button => {
    button.onclick = async () => {
      const job = state.portal.jobs.find(item => item.key === button.dataset.customerApproveQuote);
      if (!job) return;
      const original = button.innerHTML;
      button.disabled = true;
      button.textContent = "Approving…";
      try {
        await confirmQuoteApproval(job, "customer-portal");
      } finally {
        button.disabled = false;
        button.innerHTML = original;
      }
    };
  });
}

function portalJobHtml(job) {
  const stages=[
    "Intake Pending",
    "Ready for Assessment",
    "Assessment",
    "Awaiting Approval",
    "Recovery In Progress",
    "Ready for Collection",
    "Completed"
  ];

  let index=stages.indexOf(job.status);
  if(index<0) index=job.status==="Closed" ? stages.length-1 : 0;

  return `
    <div class="portal-job">
      <div class="panel-head" style="margin-bottom:0">
        <div>
          <strong>${esc(job.jobId||job.key)}</strong>
          <p>${esc(jobDeviceSummary(job))}</p>
        </div>
        ${statusPill(job.status)}
      </div>
      ${safeNumber(job.recoveryQuote) > 0 ? `<div class="notice ${job.quoteApproval?.approved ? "success" : "info"}" style="margin-top:10px">
        Recovery quote: <strong>${formatMoney(job.recoveryQuote)}</strong>.
        ${job.quoteApproval?.approved
          ? ` Approved on ${formatDate(job.quoteApproval.approvedAt, true)}.`
          : job.status === "Awaiting Approval"
            ? `<button class="primary" style="margin-top:9px" data-customer-approve-quote="${esc(job.key)}">${icon("check",16)} Approve recovery quote</button>`
            : ""}
      </div>` : ""}
      <div class="portal-progress">
        ${stages.map((_,i)=>`<span class="${i<=index?"done":""}"></span>`).join("")}
      </div>
    </div>`;
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  });
}
