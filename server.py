"""Local API for the YouTube transcript RAG Chrome extension."""

import os
import re
from functools import lru_cache
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from youtube_transcript_api import TranscriptsDisabled, YouTubeTranscriptApi
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate


app = FastAPI(title="Local YouTube Transcript Q&A")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

PROMPT = PromptTemplate(
    template=(
        "You are a helpful assistant. Answer in the same language as the question, "
        "using only the supplied YouTube transcript excerpts. If they do not contain enough information, "
        'reply exactly: "Humpe to hai hi no".\n\n'
        "Transcript excerpts:\n{context}\n\nQuestion: {question}"
    ),
    input_variables=["context", "question"],
)
SPLITTER = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=200)


class AskRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    question: str = Field(min_length=1, max_length=2000)


def extract_video_id(url: str) -> str:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    video_id = ""
    if host in {"youtu.be", "www.youtu.be"}:
        video_id = parsed.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith(("/shorts/", "/embed/", "/live/")):
            video_id = parsed.path.split("/")[2]
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise HTTPException(status_code=400, detail="Enter a valid YouTube video URL.")
    return video_id


@lru_cache(maxsize=8)
def index_video(video_id: str):
    try:
        transcript_api = YouTubeTranscriptApi()
        available_transcripts = list(transcript_api.list(video_id))
        if not available_transcripts:
            raise HTTPException(status_code=422, detail="No captions are available for this video.")

        preferred_languages = [
            code.strip()
            for code in os.getenv("PREFERRED_TRANSCRIPT_LANGUAGES", "hi,en").split(",")
            if code.strip()
        ]
        transcript = next(
            (
                item
                for language in preferred_languages
                for item in available_transcripts
                if item.language_code == language or item.language_code.startswith(f"{language}-")
            ),
            available_transcripts[0],
        )
        transcript_text = " ".join(snippet.text for snippet in transcript.fetch())
    except TranscriptsDisabled as exc:
        raise HTTPException(status_code=422, detail="Captions are disabled for this video.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        # Keep upstream transcript errors useful without exposing internal tracebacks.
        raise HTTPException(
            status_code=422,
            detail=f"Could not fetch video captions: {exc}",
        ) from exc

    if not transcript_text.strip():
        raise HTTPException(status_code=422, detail="No transcript text was returned for this video.")

    chunks = SPLITTER.create_documents([transcript_text])
    try:
        embeddings = OpenAIEmbeddings(model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
        return FAISS.from_documents(chunks, embeddings), transcript.language, transcript.language_code
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not create transcript embeddings. Check your OpenAI API key and network: {exc}",
        ) from exc


@app.get("/api/health")
def health():
    return {"ok": True, "api_key_configured": bool(os.getenv("OPENAI_API_KEY"))}


@app.post("/api/ask")
def ask(request: AskRequest):
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="Set OPENAI_API_KEY before starting the local server.")

    video_id = extract_video_id(request.url)
    vector_store, transcript_language, transcript_language_code = index_video(video_id)
    try:
        documents = vector_store.similarity_search(request.question, k=4)
        context = "\n\n".join(document.page_content for document in documents)
        model = os.getenv("OPENAI_CHAT_MODEL", "gpt-6-luna")
        answer = ChatOpenAI(
            model=model,
            reasoning_effort=os.getenv("OPENAI_REASONING_EFFORT", "medium"),
        ).invoke(PROMPT.invoke({"context": context, "question": request.question})).content
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"The question could not be answered: {exc}") from exc
    return {
        "video_id": video_id,
        "answer": str(answer),
        "transcript_language": transcript_language,
        "transcript_language_code": transcript_language_code,
    }
