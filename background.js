/* ============================================================
   background.js — Service Worker (Minimal YouTube v4.1)
   Fetches search suggestions outside the page's CSP restrictions.
   content.js sends a message here, we fetch, we reply.
   ============================================================ */

const MAX_QUERY_LENGTH = 100;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return; // only this extension's own pages/scripts
  if (!msg || msg.type !== "SUGGEST" || typeof msg.query !== "string") return;

  const query = msg.query.slice(0, MAX_QUERY_LENGTH);
  const url =
    "https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=" +
    encodeURIComponent(query);

  fetch(url)
    .then((r) => r.text())
    .then((text) => {
      // Response format: callback(["query", [["suggestion", 0], ...], ...])
      const json = text.replace(/^[^(]+\(/, "").replace(/\);?\s*$/, "");
      const data = JSON.parse(json);
      const suggestions = (data[1] || [])
        .map((item) => (Array.isArray(item) ? item[0] : item))
        .filter(Boolean)
        .slice(0, 6);
      sendResponse({ ok: true, suggestions });
    })
    .catch(() => sendResponse({ ok: false, suggestions: [] }));

  return true; // keep the message channel open for the async response
});
