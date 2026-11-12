const switchEl = document.getElementById("switch");
const statusEl = document.getElementById("status");
const versionEl = document.getElementById("version");

versionEl.textContent = `Version ${chrome.runtime.getManifest().version}`;

function render(enabled) {
  switchEl.setAttribute("aria-checked", String(enabled));
  statusEl.textContent = enabled
    ? "On. Home shows search only."
    : "Off. YouTube looks normal.";
}

chrome.storage.local.get({ enabled: true }, (r) => render(r.enabled !== false));

switchEl.addEventListener("click", () => {
  const next = switchEl.getAttribute("aria-checked") !== "true";
  render(next);
  chrome.storage.local.set({ enabled: next }, () => {
    if (chrome.runtime.lastError) {
      render(!next);
      statusEl.textContent = "Couldn't save. Try again.";
    }
  });
});
