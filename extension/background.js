const API_URL = "http://127.0.0.1:8765/api/ask";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ask-video") return;

  (async () => {
    try {
      await chrome.storage.local.set({
        draftUrl: message.url,
        draftQuestion: message.question,
        isAsking: true,
        lastStatus: "Reading captions and finding relevant passages…",
      });
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: message.url, question: message.question }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Local server returned ${response.status}.`);

      const meta = `Video ${data.video_id} · captions: ${data.transcript_language} (${data.transcript_language_code})`;
      const status = `Answered from video ${data.video_id} · captions: ${data.transcript_language} (${data.transcript_language_code}).`;
      await chrome.storage.local.set({
        lastAnswer: data.answer,
        lastAnswerMeta: meta,
        lastAnsweredQuestion: message.question,
        lastStatus: status,
        isAsking: false,
      });
      sendResponse({ ok: true });
    } catch (error) {
      const detail = error.message.includes("Failed to fetch")
        ? "Could not reach the local server. Start it with the instructions in README.md."
        : error.message;
      const status = detail.startsWith("Could not") || detail.startsWith("The question") ? detail : `The question could not be answered: ${detail}`;
      await chrome.storage.local.set({ lastStatus: status, isAsking: false });
      sendResponse({ ok: false, error: status });
    }
  })();

  // The service worker owns the request so it can finish even after Chrome closes the popup.
  return true;
});
