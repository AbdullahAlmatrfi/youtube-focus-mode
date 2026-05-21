/* ============================================================
   content.js — Minimal YouTube v3
   ============================================================ */

const DISTRACTION_SELECTORS = [
  "ytd-rich-grid-renderer",
  "ytd-reel-shelf-renderer",
  "ytd-rich-section-renderer",
  "ytd-guide-renderer",
  "ytd-mini-guide-renderer",
  "tp-yt-app-drawer",
  "#chips-wrapper",
  "ytd-feed-nudge-renderer",
  "ytd-browse[page-subtype='home'] #header",
];

const OVERLAY_ID = "myt-overlay";
let lastUrl = location.href;
let focusModeActive = false;
let refocusBtn = null;
let activeIndex = -1;   // keyboard nav in suggestions
let debounceTimer = null;
let fullscreenListenerAdded = false;

/* ── ENTRY ── */
function init() {
  ensureRefocusBtn();
  setupFullscreenWatcher();
  updateRefocusVisibility();
  if (isHomepage()) activateFocusMode();
  else deactivateFocusMode(true);
}

function isHomepage() {
  return location.pathname === "/" && !location.search;
}

/* ── FOCUS ON ── */
function activateFocusMode() {
  focusModeActive = true;
  document.body.classList.add("myt-focus");
  if (!document.getElementById(OVERLAY_ID)) injectOverlay();
  hideDistractions();
}

/* ── FOCUS OFF ── */
function deactivateFocusMode(removeOverlay = false) {
  focusModeActive = false;
  document.body.classList.remove("myt-focus");
  restoreDistractions();
  if (removeOverlay) {
    document.getElementById(OVERLAY_ID)?.remove();
  }
}

/* ── INJECT OVERLAY ── */
async function injectOverlay() {
  try {
    const res = await fetch(chrome.runtime.getURL("inject.html"));
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const overlay = doc.getElementById(OVERLAY_ID);
    if (!overlay) return;
    document.body.appendChild(overlay);
    injectCinematicBg(overlay);
    setupSearch();
    setupExploreButton();
  } catch (e) {
    console.warn("[MinimalYT]", e);
  }
}

/* ── CINEMATIC BACKGROUND ── */
function injectCinematicBg(overlay) {
  // Light ray
  const ray = document.createElement("div");
  ray.className = "myt-ray";
  overlay.insertBefore(ray, overlay.firstChild);

  // Film grain
  const grain = document.createElement("div");
  grain.className = "myt-grain";
  overlay.insertBefore(grain, overlay.firstChild);

  // 3 floating orbs
  for (let i = 0; i < 3; i++) {
    const orb = document.createElement("div");
    orb.className = "myt-orb";
    overlay.insertBefore(orb, overlay.firstChild);
  }
}

/* ── SEARCH ── */
function setupSearch() {
  const input = document.getElementById("myt-search");
  const btn = document.getElementById("myt-search-btn");
  const list = document.getElementById("myt-suggestions");
  if (!input || !list) return;

  setTimeout(() => input.focus(), 80);

  // Typing → fetch suggestions
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) { hideSuggestions(input, list); return; }
    debounceTimer = setTimeout(() => fetchSuggestions(q, input, list), 220);
  });

  // Keyboard navigation
  input.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll("li")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlightItem(items, input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      highlightItem(items, input);
    } else if (e.key === "Enter") {
      const hit = list.querySelector("li.myt-active");
      performSearch(hit ? hit.dataset.q : input.value.trim());
    } else if (e.key === "Escape") {
      hideSuggestions(input, list);
    }
  });

  // Click outside → close
  document.addEventListener("click", (e) => {
    if (!document.getElementById("myt-search-wrapper")?.contains(e.target))
      hideSuggestions(input, list);
  });

  btn?.addEventListener("click", () => performSearch(input.value.trim()));
}

/*
 * Fetch suggestions via the background service worker.
 * The background worker lives outside the page's CSP so it can
 * freely fetch from suggestqueries.google.com.
 */
function fetchSuggestions(query, input, list) {
  chrome.runtime.sendMessage({ type: "SUGGEST", query }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) return;
    renderSuggestions(resp.suggestions, input, list);
  });
}

function renderSuggestions(suggestions, input, list) {
  list.innerHTML = "";
  activeIndex = -1;

  if (!suggestions.length) { hideSuggestions(input, list); return; }

  suggestions.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    li.dataset.q = text;
    // mousedown instead of click so it fires before input blur hides the list
    li.addEventListener("mousedown", e => { e.preventDefault(); performSearch(text); });
    list.appendChild(li);
  });

  list.classList.add("visible");
  input.classList.add("has-suggestions");
}

function hideSuggestions(input, list) {
  list.classList.remove("visible");
  list.innerHTML = "";
  input.classList.remove("has-suggestions");
  activeIndex = -1;
}

function highlightItem(items, input) {
  items.forEach((li, i) => li.classList.toggle("myt-active", i === activeIndex));
  if (activeIndex >= 0 && items[activeIndex]) {
    input.value = items[activeIndex].dataset.q;
  }
}

function performSearch(q) {
  if (!q) return;
  location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/* ── EXPLORE BUTTON ── */
function setupExploreButton() {
  document.getElementById("myt-explore-btn")?.addEventListener("click", () => {
    if (!goHomeForFocus()) return;
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.classList.add("myt-exit");
      overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
    }
    deactivateFocusMode(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 80);
    ensureRefocusBtn();
    updateRefocusVisibility();
  });
}

/* ── REFOCUS PILL ── */
function ensureRefocusBtn() {
  if (refocusBtn) return;
  refocusBtn = document.createElement("button");
  refocusBtn.id = "myt-refocus-btn";
  refocusBtn.textContent = "⬤ Focus Mode";
  refocusBtn.addEventListener("click", () => {
    if (!goHomeForFocus()) return;
    activateFocusMode();
  });
  document.body.appendChild(refocusBtn);
}

function goHomeForFocus() {
  const target = "https://www.youtube.com/";
  if (location.href === target) return true;
  location.replace(target);
  setTimeout(() => {
    if (location.href !== target) location.assign(target);
  }, 150);
  return false;
}

function updateRefocusVisibility() {
  if (!refocusBtn) return;
  refocusBtn.hidden = isFullscreen();
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

/* ── HIDE / RESTORE ── */
function hideDistractions() {
  DISTRACTION_SELECTORS.forEach(sel => {
    try { document.querySelectorAll(sel).forEach(el => el.classList.add("myt-hidden")); }
    catch { }
  });
}

function restoreDistractions() {
  document.querySelectorAll(".myt-hidden").forEach(el => el.classList.remove("myt-hidden"));
}

/* ── SPA OBSERVER ── */
const titleObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(init, 150); }
});

function startObserver() {
  const t = document.querySelector("title");
  if (t) {
    titleObserver.observe(t, { childList: true });
  } else {
    new MutationObserver((_, obs) => {
      const t2 = document.querySelector("title");
      if (t2) { titleObserver.observe(t2, { childList: true }); obs.disconnect(); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
}

function poll() {
  if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(init, 150); }
}
setInterval(poll, 800);

/* ── BOOT ── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { startObserver(); init(); });
} else {
  startObserver();
  init();
}
