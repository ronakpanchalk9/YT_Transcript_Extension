const urlInput = document.querySelector("#video-url");
const questionInput = document.querySelector("#question");
const askButton = document.querySelector("#ask");
const status = document.querySelector("#status");
const answerBox = document.querySelector("#answer");
const answerMeta = document.querySelector("#answer-meta");
const answerText = document.querySelector("#answer-text");

let isRestoring = true;
let isAsking = false;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function saveDraft() {
  if (isRestoring) return;
  await chrome.storage.local.set({
    draftUrl: urlInput.value,
    draftQuestion: questionInput.value,
  });
}

function showSavedAnswer(state) {
  if (!state.lastAnswer) {
    answerBox.hidden = true;
    return;
  }
  answerMeta.textContent = state.lastAnswerMeta || "Saved answer";
  answerText.textContent = state.lastAnswer;
  answerBox.hidden = false;
}

async function restoreState() {
  const state = await chrome.storage.local.get([
    "draftUrl", "draftQuestion", "lastAnswer", "lastAnswerMeta", "lastStatus", "isAsking",
  ]);
  urlInput.value = state.draftUrl || "";
  questionInput.value = state.draftQuestion || "";
  showSavedAnswer(state);
  isAsking = Boolean(state.isAsking);
  askButton.disabled = isAsking;
  setStatus(isAsking ? "Still working… You can come back to this popup." : (state.lastStatus || ""));
  isRestoring = false;
  if (!urlInput.value) await fillCurrentTabUrl();
}

async function fillCurrentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /(^https?:\/\/)?([^/]+\.)?youtube\.com\/|youtu\.be\//i.test(tab.url)) {
      urlInput.value = tab.url;
      await saveDraft();
    }
  } catch {
    // The URL field remains available for manual entry.
  }
}

askButton.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  const question = questionInput.value.trim();
  status.classList.remove("error");

  if (!url || !question) {
    setStatus("Enter a YouTube URL and a question.", true);
    return;
  }

  askButton.disabled = true;
  isAsking = true;
  setStatus("Reading captions and finding relevant passages… You can close this popup and come back.");
  const savePromise = chrome.storage.local.set({ draftUrl: url, draftQuestion: question });
  try {
    await Promise.all([
      savePromise,
      chrome.runtime.sendMessage({ type: "ask-video", url, question }),
    ]);
  } catch (error) {
    const message = error.message.includes("Failed to fetch")
      ? "Could not reach the local server. Start it with the instructions in README.md."
      : error.message;
    isAsking = false;
    askButton.disabled = false;
    setStatus(message, true);
    await chrome.storage.local.set({ isAsking: false, lastStatus: message });
  } finally {
    const state = await chrome.storage.local.get(["isAsking", "lastAnswer", "lastAnswerMeta", "lastStatus"]);
    isAsking = Boolean(state.isAsking);
    askButton.disabled = isAsking;
    if (!isAsking && state.lastStatus) setStatus(state.lastStatus, state.lastStatus.startsWith("Could not") || state.lastStatus.startsWith("The question"));
    showSavedAnswer(state);
  }
});

urlInput.addEventListener("input", saveDraft);
questionInput.addEventListener("input", saveDraft);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.lastAnswer || changes.lastAnswerMeta) {
    chrome.storage.local.get(["lastAnswer", "lastAnswerMeta"]).then(showSavedAnswer);
  }
  if (changes.lastStatus) {
    const message = changes.lastStatus.newValue || "";
    const isError = message.startsWith("Could not") || message.startsWith("The question");
    setStatus(message, isError);
  }
  if (changes.isAsking) {
    isAsking = Boolean(changes.isAsking.newValue);
    askButton.disabled = isAsking;
  }
});

restoreState();
