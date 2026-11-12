/* ============================================================
   content.js — Minimal YouTube v4.2
   ============================================================ */

const OVERLAY_ID = "myt-overlay";
const EXPLORE_KEY = "myt-explored"; // per tab: the user pressed "Explore Feed"
const RECENT_KEY = "recent"; // chrome.storage.local: last searches
const RECENT_MAX = 5;
const HOME_URL = "https://www.youtube.com/";

let enabled = true; // master switch, set from the popup
let lastUrl = location.href;
let refocusBtn = null;
let activeIndex = -1; // keyboard nav in the open panel
let debounceTimer = null;
let suggestReq = 0; // ignores out-of-order suggestion replies
let injecting = false;
let fullscreenListenerAdded = false;
let outsideClickHandler = null;
let pollTimer = 0;
let recentMode = false; // the history button is "armed"
const ROOT = document.documentElement; // the focus class lives here so it can be set before <body> exists

/* Quick actions: typing a word jumps straight to a YouTube page. */
const ACTIONS = [
  { label: "Go to Subscriptions", path: "/feed/subscriptions", keys: ["subscriptions", "subscription", "subs", "sub"] },
  { label: "Open Watch Later", path: "/playlist?list=WL", keys: ["watch later", "watchlater", "later", "wl"] },
  { label: "Open History", path: "/feed/history", keys: ["history", "hist"] },
  { label: "Liked videos", path: "/playlist?list=LL", keys: ["liked videos", "liked", "likes"] },
  { label: "Your Library", path: "/feed/library", keys: ["library", "lib"] },
  { label: "Trending", path: "/feed/trending", keys: ["trending", "trend"] },
];

function matchActions(q) {
  const s = q.toLowerCase().trim();
  if (s.length < 2) return [];
  return ACTIONS
    .filter((a) => a.keys.some((k) => k.startsWith(s) || s.startsWith(k)))
    .slice(0, 3);
}

/* After the extension is reloaded or updated, this old script is orphaned:
   chrome.* stops working. Detect that and clean everything up. */
function alive() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

function shutdown() {
  clearInterval(pollTimer);
  ROOT.classList.remove("myt-focus");
  document.getElementById(OVERLAY_ID)?.remove();
  refocusBtn?.remove();
  refocusBtn = null;
  removeOutsideClick();
  document.removeEventListener("yt-navigate-finish", onNavigate);
}

function removeOutsideClick() {
  if (outsideClickHandler) {
    document.removeEventListener("click", outsideClickHandler);
    outsideClickHandler = null;
  }
}

/* ── HELPERS ── */
function isHomepage() {
  return location.pathname === "/" && !location.search;
}

function exploredThisTab() {
  try { return sessionStorage.getItem(EXPLORE_KEY) === "1"; } catch { return false; }
}

function setExplored(on) {
  try {
    if (on) sessionStorage.setItem(EXPLORE_KEY, "1");
    else sessionStorage.removeItem(EXPLORE_KEY);
  } catch { }
}

/* ── ENTRY ── */
function init() {
  if (!alive()) return shutdown();
  if (!document.body) return;
  ensureRefocusBtn();
  setupFullscreenWatcher();
  updateRefocusVisibility();
  if (enabled && isHomepage() && !exploredThisTab()) activateFocusMode();
  else deactivateFocusMode(true);
}

/* ── FOCUS ON / OFF ──
   The feed itself is hidden by CSS (body.myt-focus), so nothing flashes
   and nothing is removed from the page. */
function activateFocusMode() {
  ROOT.classList.add("myt-focus");
  // An overlay that is still fading out (after "Explore Feed") must not block a new one.
  document.querySelector(`#${OVERLAY_ID}.myt-exit`)?.remove();
  if (!document.getElementById(OVERLAY_ID)) injectOverlay();
}

function deactivateFocusMode(removeOverlay = false) {
  ROOT.classList.remove("myt-focus");
  if (removeOverlay) {
    document.getElementById(OVERLAY_ID)?.remove();
    removeOutsideClick();
  }
}

/* ── INJECT OVERLAY ── */
async function injectOverlay() {
  if (injecting) return;
  injecting = true;
  try {
    const res = await fetch(chrome.runtime.getURL("inject.html"));
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const overlay = doc.getElementById(OVERLAY_ID);
    // The page may have changed while we were fetching.
    if (!overlay || document.getElementById(OVERLAY_ID)) return;
    if (!ROOT.classList.contains("myt-focus")) return;
    document.body.appendChild(overlay);
    fillGreeting();
    setupSearch();
    setupExploreButton();
  } catch (e) {
    // No overlay means no focus mode: never leave the feed hidden with nothing on top.
    ROOT.classList.remove("myt-focus");
    console.warn("[MinimalYT]", e);
  } finally {
    injecting = false;
  }
}

/* ── GREETING (time of day) ── */
function fillGreeting() {
  const el = document.getElementById("myt-greet");
  if (!el) return;
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  el.textContent = `${part} — search for what you came for.`;
}

/* ── SEARCH ── */
function setupSearch() {
  const input = document.getElementById("myt-search");
  const searchBtn = document.getElementById("myt-search-btn");
  const histBtn = document.getElementById("myt-history-btn");
  const list = document.getElementById("myt-suggestions");
  const recent = document.getElementById("myt-recent");
  if (!input || !list || !recent) return;

  setTimeout(() => input.focus(), 80);

  let typed = ""; // what the user actually typed, restored when leaving the list

  function openPanel() { return recent.classList.contains("visible") ? recent : list; }

  function closeAll() {
    recentMode = false;
    syncHistBtn(histBtn);
    hideSuggestions(input, list);
    hideRecent(recent);
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    typed = input.value;
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    list.querySelectorAll("li.myt-active").forEach((li) => li.classList.remove("myt-active"));
    const q = input.value.trim();
    if (!q) {
      hideSuggestions(input, list);
      if (recentMode) showRecent(input, recent); // clearing the box brings recent back
      return;
    }
    // Typing hands off from recent to suggestions: swap instantly, no close animation.
    hideRecent(recent, true);
    const acts = matchActions(q);
    if (acts.length) renderPanel(q, typed, input, list, []); // show actions right away
    else if (!list.classList.contains("visible")) { /* wait for suggestions */ }
    debounceTimer = setTimeout(() => fetchSuggestions(q, typed, input, list), 220);
  });

  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return; // IME is choosing characters: keys belong to it
    const panel = openPanel();
    const items = [...panel.querySelectorAll("li[role=option]")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!items.length) {
        const q = input.value.trim();
        if (q) { hideRecent(recent, true); fetchSuggestions(q, typed, input, list); }
        else if (recentMode) showRecent(input, recent);
        return;
      }
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlightItem(items, input, typed);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      activeIndex = Math.max(activeIndex - 1, -1);
      highlightItem(items, input, typed);
    } else if (e.key === "Enter") {
      const active = items[activeIndex];
      if (active && active.dataset.url) { location.href = active.dataset.url; return; }
      performSearch(input.value.trim());
    } else if (e.key === "Escape") {
      if (panel === list && items.length) input.value = typed; // give back what was typed
      closeAll();
    }
  });


  // History button is a toggle: open on click, close on a second click.
  histBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    recentMode = !recentMode;
    syncHistBtn(histBtn);
    if (recentMode) { hideSuggestions(input, list); showRecent(input, recent); }
    else hideRecent(recent);
    input.focus();
  });

  // Escape from the buttons, and Tab out of the search, close the panels.
  const wrapper = document.getElementById("myt-search-wrapper");
  wrapper?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target !== input) { closeAll(); input.focus(); }
  });
  wrapper?.addEventListener("focusout", (e) => {
    if (!wrapper.contains(e.relatedTarget)) closeAll();
  });

  // Click outside closes everything. One listener at a time, removed with the overlay.
  if (outsideClickHandler) document.removeEventListener("click", outsideClickHandler);
  outsideClickHandler = (e) => {
    if (!wrapper?.contains(e.target)) closeAll();
  };
  document.addEventListener("click", outsideClickHandler);

  searchBtn?.addEventListener("click", () => performSearch(input.value.trim()));
}

function syncHistBtn(histBtn) {
  if (!histBtn) return;
  histBtn.classList.toggle("on", recentMode);
  histBtn.setAttribute("aria-pressed", String(recentMode));
}

/* ── SUGGESTIONS + QUICK ACTIONS ──
   Suggestions come from the background worker (outside the page's CSP). */
function fetchSuggestions(query, typed, input, list) {
  const id = ++suggestReq;
  try {
    chrome.runtime.sendMessage({ type: "SUGGEST", query }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) return;
      if (id !== suggestReq || input.value.trim() !== query) return; // stale reply
      renderPanel(query, typed, input, list, resp.suggestions);
    });
  } catch { /* extension was reloaded; ignore until the page refreshes */ }
}

function makeOption(id, label, data) {
  const li = document.createElement("li");
  li.id = id;
  li.setAttribute("role", "option");
  li.dir = "auto";
  li.textContent = label;
  Object.assign(li.dataset, data);
  return li;
}

function renderPanel(query, typed, input, list, suggestions) {
  const actions = matchActions(query);
  list.innerHTML = "";
  let n = 0;

  if (actions.length) {
    list.appendChild(sectionLabel("QUICK ACTIONS"));
    actions.forEach((a) => {
      const li = makeOption(`myt-opt-${n++}`, a.label, { url: HOME_URL.replace(/\/$/, "") + a.path });
      li.classList.add("myt-action");
      li.addEventListener("mousedown", (e) => { e.preventDefault(); location.href = li.dataset.url; });
      list.appendChild(li);
    });
  }

  if (suggestions && suggestions.length) {
    if (actions.length) list.appendChild(sectionLabel("SEARCH"));
    suggestions.forEach((text) => {
      const li = makeOption(`myt-opt-${n++}`, text, { q: text });
      li.addEventListener("mousedown", (e) => { e.preventDefault(); performSearch(text); });
      list.appendChild(li);
    });
  }

  if (!n) { hideSuggestions(input, list); return; }

  activeIndex = -1;
  input.removeAttribute("aria-activedescendant");
  list.classList.remove("myt-closing");
  list.classList.add("visible");
  input.classList.add("has-suggestions");
  input.setAttribute("aria-expanded", "true");
  const parts = [];
  if (actions.length) parts.push(`${actions.length} action${actions.length === 1 ? "" : "s"}`);
  if (suggestions && suggestions.length) parts.push(`${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}`);
  announce(parts.join(", "));
}

function sectionLabel(text) {
  const li = document.createElement("li");
  li.className = "myt-sec";
  li.setAttribute("aria-hidden", "true");
  li.textContent = text;
  return li;
}

function announce(text) {
  const el = document.getElementById("myt-status");
  if (el) el.textContent = text;
}

function hideSuggestions(input, list) {
  clearTimeout(debounceTimer); // a pending or in-flight reply must not reopen the list
  suggestReq++;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  activeIndex = -1;
  announce("");
  animateClose(list, () => {
    list.innerHTML = "";
    input.classList.remove("has-suggestions"); // keep the joined seam until the panel has left
  });
}

/* Play a short exit animation, then run finalize (unless the panel reopened). */
function animateClose(el, finalize) {
  el.classList.remove("visible");
  const done = once(() => {
    el.classList.remove("myt-closing");
    if (!el.classList.contains("visible")) finalize();
  });
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm) { done(); return; }
  el.classList.add("myt-closing");
  el.addEventListener("animationend", function h(e) {
    if (e.target === el) { el.removeEventListener("animationend", h); done(); }
  });
  setTimeout(done, 280); // fallback if animationend never fires
}

/* ── RECENT SEARCHES ── */
function showRecent(input, recent) {
  try {
    chrome.storage.local.get({ [RECENT_KEY]: [] }, (r) => {
      if (chrome.runtime.lastError) return;
      const arr = Array.isArray(r[RECENT_KEY]) ? r[RECENT_KEY] : [];
      recent.innerHTML = "";
      const label = document.createElement("div");
      label.className = "myt-sec";
      label.setAttribute("aria-hidden", "true");
      label.textContent = "RECENT SEARCHES";
      recent.appendChild(label);

      if (!arr.length) {
        const empty = document.createElement("div");
        empty.className = "myt-empty";
        empty.textContent = "No recent searches yet.";
        recent.appendChild(empty);
      } else {
        arr.slice(0, RECENT_MAX).forEach((text, i) => {
          const li = makeOption(`myt-opt-${i}`, text, { q: text });
          li.addEventListener("mousedown", (e) => { e.preventDefault(); performSearch(text); });
          recent.appendChild(li);
        });
      }
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      recent.hidden = false;
      recent.classList.remove("myt-closing");
      recent.classList.add("visible");
      input.setAttribute("aria-expanded", "true");
      announce(arr.length ? `${Math.min(arr.length, RECENT_MAX)} recent searches` : "No recent searches");
        });
  } catch { /* orphaned */ }
}

function hideRecent(recent, instant = false) {
  const finalize = () => { recent.hidden = true; recent.innerHTML = ""; };
  if (instant) {
    recent.classList.remove("visible", "myt-closing");
    finalize();
    return;
  }
  animateClose(recent, finalize);
}

function highlightItem(items, input, typed) {
  items.forEach((li, i) => {
    li.classList.toggle("myt-active", i === activeIndex);
    li.setAttribute("aria-selected", String(i === activeIndex));
  });
  const active = items[activeIndex];
  if (active) {
    // Suggestions and recent fill the box; quick actions keep what was typed.
    if (active.dataset.q != null) input.value = active.dataset.q;
    else input.value = typed;
    input.setAttribute("aria-activedescendant", active.id);
  } else {
    input.value = typed; // ArrowUp past the first row: back to what was typed
    input.removeAttribute("aria-activedescendant");
  }
}

/* Save the query, then navigate (storage set is fired before leaving). */
function performSearch(q) {
  if (!q) return;
  const go = once(() => {
    location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  });
  try {
    chrome.storage.local.get({ [RECENT_KEY]: [] }, (r) => {
      if (!chrome.runtime.lastError) {
        const prev = Array.isArray(r[RECENT_KEY]) ? r[RECENT_KEY] : [];
        const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
        chrome.storage.local.set({ [RECENT_KEY]: next }, go);
      }
      setTimeout(go, 200); // navigate even if the callback is slow
    });
  } catch { go(); }
  setTimeout(go, 250); // last-resort fallback
}

function once(fn) {
  let done = false;
  return () => { if (!done) { done = true; fn(); } };
}

/* ── EXPLORE BUTTON ──
   Remembers the choice for this tab, so going back to Home does not
   bring the overlay back until the user presses "Focus Mode". */
function setupExploreButton() {
  document.getElementById("myt-explore-btn")?.addEventListener("click", () => {
    setExplored(true);
    const overlay = document.getElementById(OVERLAY_ID);
    deactivateFocusMode(false);
    removeOutsideClick();
    if (overlay) {
      overlay.classList.add("myt-exit");
      const remove = () => overlay.remove();
      overlay.addEventListener("animationend", (e) => {
        if (e.target === overlay && e.animationName === "myt-fade-out") remove();
      });
      setTimeout(remove, 600); // safety net
    }
    // Keyboard focus was on the removed button: hand it to the feed.
    const feed = document.querySelector("ytd-page-manager");
    if (feed) {
      feed.setAttribute("tabindex", "-1");
      feed.focus({ preventScroll: true });
    }
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" }), 80);
  });
}

/* ── REFOCUS PILL ── */
function ensureRefocusBtn() {
  if (refocusBtn || !document.body) return;
  const btn = document.createElement("button");
  btn.id = "myt-refocus-btn";
  const dot = document.createElement("span");
  dot.className = "myt-dot";
  dot.setAttribute("aria-hidden", "true");
  btn.append(dot, "Focus Mode");
  btn.setAttribute("aria-label", "Go to Home in Focus Mode");
  btn.addEventListener("click", () => {
    setExplored(false);
    if (isHomepage()) activateFocusMode();
    else location.assign(HOME_URL); // assign keeps the Back button working
  });
  document.body.appendChild(btn);
  refocusBtn = btn; // only after the append succeeded
}

function updateRefocusVisibility() {
  if (!refocusBtn) return;
  refocusBtn.hidden = isFullscreen() || !enabled;
}

function setupFullscreenWatcher() {
  if (fullscreenListenerAdded) return;
  fullscreenListenerAdded = true;
  document.addEventListener("fullscreenchange", updateRefocusVisibility);
  document.addEventListener("webkitfullscreenchange", updateRefocusVisibility);
}

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

/* ── SPA NAVIGATION ── */
function onNavigate() {
  if (!alive()) return shutdown();
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  init();
}
document.addEventListener("yt-navigate-finish", onNavigate);
pollTimer = setInterval(onNavigate, 1500); // safety net if the event is ever missed

/* ── SETTINGS (popup switch) ── */
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    enabled = changes.enabled.newValue !== false;
    if (enabled) setExplored(false);
    if (document.body) init();
  });
} catch { }

function runInit() {
  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
}

/* Hide the feed from the very first moment (document_start) so it never flashes.
   init() confirms or undoes this once the settings are known. */
if (isHomepage() && !exploredThisTab()) ROOT.classList.add("myt-focus");

try {
  chrome.storage.local.get({ enabled: true }, (r) => {
    enabled = !chrome.runtime.lastError && r.enabled !== false;
    runInit();
  });
} catch {
  runInit();
}
