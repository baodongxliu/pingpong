import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

/* ---------- State ---------- */
const state = {
  purchases: [],
  usages: [],
  unsubscribers: [],
};

/* ---------- Firebase init ---------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Keep the user signed in across tab closes and browser restarts.
// (This is Firebase's web default, but we set it explicitly for clarity.)
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Could not set auth persistence:", err.code);
});

enableIndexedDbPersistence(db).catch((err) => {
  // Harmless: happens when another tab already owns the cache, or Safari private mode.
  console.warn("Offline persistence unavailable:", err.code);
});

/* ---------- Helpers ---------- */
function todayISO() {
  // en-CA returns YYYY-MM-DD in local time. Avoids the UTC shift of toISOString().
  return new Date().toLocaleDateString("en-CA");
}

function dowFromISO(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

function updateDateHint(inputId, hintId) {
  const hint = document.getElementById(hintId);
  if (!hint) return;
  const v = document.getElementById(inputId).value;
  hint.textContent = dowFromISO(v);
}

function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden", "error");
  if (isError) t.classList.add("error");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

function sum(arr, key) {
  return arr.reduce((acc, x) => acc + (Number(x[key]) || 0), 0);
}

function fmtHours(n) {
  // Keep "10" not "10.0"; keep "1.5" as-is.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/* ---------- Auth wiring ---------- */
function showAuthScreen() {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

function showApp() {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    showApp();
    subscribeAll();
  } else {
    teardownSubscriptions();
    state.purchases = [];
    state.usages = [];
    renderDashboard();
    renderHistory();
    showAuthScreen();
  }
});

document.getElementById("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errEl = document.getElementById("signin-error");
  errEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
  }
});

document.getElementById("signout-btn").addEventListener("click", async () => {
  await signOut(auth);
});

function friendlyAuthError(err) {
  const code = err && err.code ? err.code : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Wrong email or password.";
  }
  if (code.includes("too-many-requests")) {
    return "Too many attempts. Try again in a minute.";
  }
  if (code.includes("network-request-failed")) {
    return "Network error. Check your connection.";
  }
  return "Sign-in failed. " + (err.message || "");
}

/* ---------- Subscriptions ---------- */
function subscribeAll() {
  teardownSubscriptions();
  state.unsubscribers.push(
    onSnapshot(collection(db, "purchases"), (snap) => {
      state.purchases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderDashboard();
      renderHistory();
    }, (err) => {
      console.error("purchases snapshot error", err);
      showToast("Failed to load purchases", true);
    })
  );
  state.unsubscribers.push(
    onSnapshot(collection(db, "usages"), (snap) => {
      state.usages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderDashboard();
      renderHistory();
    }, (err) => {
      console.error("usages snapshot error", err);
      showToast("Failed to load usages", true);
    })
  );
}

function teardownSubscriptions() {
  state.unsubscribers.forEach((u) => { try { u(); } catch {} });
  state.unsubscribers = [];
}

/* ---------- Writes ---------- */
async function addPurchase({ date, hours, notes }) {
  await addDoc(collection(db, "purchases"), {
    date,
    hours: Number(hours),
    notes: notes || "",
    createdAt: serverTimestamp(),
  });
}

async function addUsage({ date, hours, child, notes }) {
  await addDoc(collection(db, "usages"), {
    date,
    hours: Number(hours),
    child,
    notes: notes || "",
    createdAt: serverTimestamp(),
  });
}

async function deleteEntry(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
}

/* ---------- Compute ---------- */
function computeBalance() {
  const purchasedTotal = sum(state.purchases, "hours");
  const sonUsed = sum(state.usages.filter((u) => u.child === "son"), "hours");
  const daughterUsed = sum(state.usages.filter((u) => u.child === "daughter"), "hours");
  const totalUsed = sonUsed + daughterUsed;
  return {
    total: purchasedTotal - totalUsed,
    purchasedTotal,
    sonUsed,
    daughterUsed,
    totalUsed,
  };
}

function filterHistory({ from, to, child }) {
  const purchases = state.purchases.map((p) => ({
    ...p, kind: "purchase", sortDate: p.date,
  }));
  const usages = state.usages
    .filter((u) => child === "all" || !child || u.child === child)
    .map((u) => ({ ...u, kind: "usage", sortDate: u.date }));

  // When a child filter is active, exclude purchases (they aren't attributed to a child).
  const combined = child && child !== "all"
    ? usages
    : [...purchases, ...usages];

  return combined
    .filter((x) => (!from || x.date >= from) && (!to || x.date <= to))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      // Tiebreak by createdAt when available
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
}

/* ---------- Render ---------- */
function renderDashboard() {
  const b = computeBalance();
  document.getElementById("balance-number").textContent = fmtHours(b.total);
  document.getElementById("balance-sub").textContent =
    b.purchasedTotal === 0 && b.totalUsed === 0
      ? "No lessons logged yet."
      : `Purchased ${fmtHours(b.purchasedTotal)}h · Used ${fmtHours(b.totalUsed)}h`;
  document.getElementById("bd-purchased").textContent = fmtHours(b.purchasedTotal) + "h";
  document.getElementById("bd-son").textContent = fmtHours(b.sonUsed) + "h";
  document.getElementById("bd-daughter").textContent = fmtHours(b.daughterUsed) + "h";
}

function renderHistory() {
  const from = document.getElementById("f-from").value || null;
  const to = document.getElementById("f-to").value || null;
  const child = document.getElementById("f-child").value || "all";
  const items = filterHistory({ from, to, child });

  const list = document.getElementById("history-list");
  const emptyEl = document.getElementById("history-empty");
  list.innerHTML = "";

  if (items.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.dataset.id = item.id;
    li.dataset.kind = item.kind;

    const isPurchase = item.kind === "purchase";
    const tagClass = isPurchase ? "purchase" : "usage-" + item.child;
    const tagText = isPurchase ? "Purchase" : item.child === "son" ? "Son" : "Daughter";
    const hoursText = (isPurchase ? "+" : "−") + fmtHours(item.hours) + "h";
    const hoursClass = isPurchase ? "positive" : "negative";

    li.innerHTML = `
      <div class="hi-top">
        <span class="hi-date"><span class="hi-dow">${dowFromISO(item.date)}</span>${item.date}</span>
        <span class="hi-tag ${tagClass}">${tagText}</span>
      </div>
      <div class="hi-hours ${hoursClass}">${hoursText}</div>
      ${item.notes ? `<div class="hi-notes">${escapeHtml(item.notes)}</div>` : ""}
    `;

    li.addEventListener("click", async () => {
      const label = isPurchase
        ? `Delete purchase of ${fmtHours(item.hours)}h on ${item.date}?`
        : `Delete ${tagText}'s ${fmtHours(item.hours)}h lesson on ${item.date}?`;
      if (!confirm(label)) return;
      try {
        await deleteEntry(isPurchase ? "purchases" : "usages", item.id);
        showToast("Deleted");
      } catch (err) {
        console.error(err);
        showToast("Delete failed", true);
      }
    });

    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConfirm(elId, { kind, date, hours, child, notes, newBalance }) {
  const el = document.getElementById(elId);
  if (!el) return;
  const isPurchase = kind === "purchase";
  const tagClass = isPurchase ? "purchase" : "usage-" + child;
  const tagText = isPurchase ? "Purchase" : child === "son" ? "Son" : "Daughter";
  const hoursText = (isPurchase ? "+" : "−") + fmtHours(hours) + "h";
  const hoursClass = isPurchase ? "positive" : "negative";
  const headText = isPurchase ? "Purchase added" : "Lesson logged";

  el.innerHTML = `
    <div class="confirm-head">
      <span class="confirm-check">✓</span>
      <span>${headText}</span>
    </div>
    <div class="confirm-entry">
      <div class="hi-top">
        <span class="hi-date"><span class="hi-dow">${dowFromISO(date)}</span>${date}</span>
        <span class="hi-tag ${tagClass}">${tagText}</span>
      </div>
      <div class="hi-hours ${hoursClass}">${hoursText}</div>
      ${notes ? `<div class="hi-notes">${escapeHtml(notes)}</div>` : ""}
    </div>
    <div class="confirm-balance">
      <strong>${fmtHours(newBalance)}</strong> hours remaining
    </div>
  `;
  el.classList.remove("hidden");
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- Tab switching ---------- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === "tab-" + target);
    });
  });
});

/* ---------- Form wiring ---------- */
// Default dates to today
document.getElementById("p-date").value = todayISO();
document.getElementById("u-date").value = todayISO();

// Day-of-week hints under each date input
const dateHints = [
  ["p-date", "p-date-dow"],
  ["u-date", "u-date-dow"],
  ["f-from", "f-from-dow"],
  ["f-to", "f-to-dow"],
];
dateHints.forEach(([inputId, hintId]) => {
  document.getElementById(inputId).addEventListener("change", () => updateDateHint(inputId, hintId));
  updateDateHint(inputId, hintId);
});

document.getElementById("purchase-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("p-date").value;
  const hours = parseFloat(document.getElementById("p-hours").value);
  const notes = document.getElementById("p-notes").value.trim();
  if (!date || !(hours > 0)) {
    showToast("Enter a valid date and hours", true);
    return;
  }
  const newBalance = computeBalance().total + hours;
  try {
    await addPurchase({ date, hours, notes });
    renderConfirm("purchase-confirm", { kind: "purchase", date, hours, notes, newBalance });
    e.target.reset();
    document.getElementById("p-date").value = todayISO();
    document.getElementById("p-hours").value = 10;
    updateDateHint("p-date", "p-date-dow");
  } catch (err) {
    console.error(err);
    showToast("Could not save purchase", true);
  }
});

document.getElementById("usage-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = document.getElementById("u-date").value;
  const hours = parseFloat(document.getElementById("u-hours").value);
  const notes = document.getElementById("u-notes").value.trim();
  const childInput = document.querySelector('input[name="child"]:checked');
  if (!date || !(hours > 0) || !childInput) {
    showToast("Fill date, child, and hours", true);
    return;
  }
  const newBalance = computeBalance().total - hours;
  try {
    await addUsage({ date, hours, child: childInput.value, notes });
    renderConfirm("usage-confirm", {
      kind: "usage", date, hours, child: childInput.value, notes, newBalance,
    });
    e.target.reset();
    document.getElementById("u-date").value = todayISO();
    document.getElementById("u-hours").value = 1;
    updateDateHint("u-date", "u-date-dow");
  } catch (err) {
    console.error(err);
    showToast("Could not save usage", true);
  }
});

/* ---------- Filter wiring ---------- */
["f-from", "f-to", "f-child"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderHistory);
});
document.getElementById("f-today").addEventListener("click", () => {
  const t = todayISO();
  document.getElementById("f-from").value = t;
  document.getElementById("f-to").value = t;
  updateDateHint("f-from", "f-from-dow");
  updateDateHint("f-to", "f-to-dow");
  renderHistory();
});
document.getElementById("f-clear").addEventListener("click", () => {
  document.getElementById("f-from").value = "";
  document.getElementById("f-to").value = "";
  document.getElementById("f-child").value = "all";
  updateDateHint("f-from", "f-from-dow");
  updateDateHint("f-to", "f-to-dow");
  renderHistory();
});
