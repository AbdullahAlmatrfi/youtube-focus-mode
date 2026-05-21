/* ============================================================
   background.js — Service Worker
   Fetches suggestions outside the page's CSP restrictions.
   content.js sends a message here, we fetch, we reply.
   ============================================================ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "SUGGEST") return;

  const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(msg.query)}`;

  fetch(url)
    .then(r => r.text())
    .then(text => {
      // Response format: callback(["query", [["suggestion", 0], ...], ...])
      // Strip the callback wrapper to get raw JSON
      const json = text.replace(/^[^(]+\(/, "").replace(/\);?\s*$/, "");
      const data = JSON.parse(json);
      const suggestions = (data[1] || [])
        .map(item => Array.isArray(item) ? item[0] : item)
        .filter(Boolean)
        .slice(0, 6);
      sendResponse({ ok: true, suggestions });
    })
    .catch(err => sendResponse({ ok: false, suggestions: [] }));

  return true; // keep message channel open for async response
});
