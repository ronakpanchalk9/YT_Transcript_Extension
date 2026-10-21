# YouTube Transcript Q&A (local Chrome extension)

This project adapts the RAG flow in `1.rag_using_langchain.ipynb`: select available YouTube captions (Hindi and English are preferred by default, then any available language), split them into 800-character chunks with 200-character overlap, embed with `text-embedding-3-small`, retrieve the four closest chunks, and answer from those excerpts in the language of the question. The extension and API run on your computer; there is no deployment step.

## 1. Start the local API

Requirements: Python 3.10 or newer and an OpenAI API key. The key stays in the server process and is not placed in the extension.

From this folder, create an environment and install dependencies:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Set your key in the same terminal and start the API:

```sh
export OPENAI_API_KEY="your-api-key"
python -m uvicorn server:app --host 127.0.0.1 --port 8765
```

On Windows PowerShell, use `$env:OPENAI_API_KEY="your-api-key"` instead of `export`.

The default chat model is `gpt-6-luna`, matching the notebook. Override it if needed with `OPENAI_CHAT_MODEL`; `OPENAI_EMBEDDING_MODEL`, `OPENAI_REASONING_EFFORT`, and comma-separated `PREFERRED_TRANSCRIPT_LANGUAGES` (default `hi,en`) can also be set. The first question for a video fetches captions and builds its in-memory index; later questions reuse it until the server exits. Up to eight video indexes are cached.

## 2. Load the extension in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the `extension` subfolder inside this project.
4. Open a YouTube video, click the extension icon, enter a question, and choose **Ask question**. The URL field is prefilled from the current tab when possible.

You can also paste a video URL manually. The server needs internet access for YouTube captions and OpenAI API calls. Videos without available captions cannot be indexed; the selected caption language appears below each answer.

The popup saves your current URL, question, and most recent answer in Chrome extension storage. The request runs in the extension service worker, so closing the popup while it is working does not discard the request or its eventual answer. Reopen the popup to continue where you left off.

## Troubleshooting

- **Could not reach local server:** make sure the uvicorn command is still running on port 8765.
- **Set OPENAI_API_KEY:** export the key in the terminal before starting uvicorn.
- **Could not fetch video captions:** check that the video has captions and that YouTube is reachable.
- **OpenAI/model error:** check API account access and optionally set `OPENAI_CHAT_MODEL` to a model enabled for your API account.
