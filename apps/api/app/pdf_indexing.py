"""Deterministic, page-aware text extraction for approved PDF evidence."""

import re
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Callable


MAX_CHUNK_CHARACTERS = 1200
MAX_EXTRACTED_CHARACTERS = 5_000_000
MAX_CHUNKS = 5_000
MIN_READABLE_CHARACTERS = 20


class PdfIndexingFailure(Exception):
    """Safe PDF indexing failure represented by a non-sensitive code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class DocumentChunk:
    page_number: int
    chunk_index: int
    content: str


@dataclass(frozen=True)
class PdfExtractionResult:
    readable_page_count: int
    chunks: list[DocumentChunk]


def load_pdf_reader() -> Callable[[BytesIO], Any]:
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise PdfIndexingFailure("dependency_unavailable") from error
    return PdfReader


def normalize_extracted_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\x00", " ")).strip()


def chunk_page_text(
    text: str,
    page_number: int,
    *,
    max_characters: int = MAX_CHUNK_CHARACTERS,
) -> list[DocumentChunk]:
    normalized = normalize_extracted_text(text)
    if not normalized:
        return []

    chunks: list[DocumentChunk] = []
    start = 0
    while start < len(normalized):
        end = min(start + max_characters, len(normalized))
        if end < len(normalized):
            minimum_break = start + int(max_characters * 0.55)
            sentence_break = normalized.rfind(". ", minimum_break, end)
            clause_break = normalized.rfind("; ", minimum_break, end)
            word_break = normalized.rfind(" ", minimum_break, end)
            boundary = max(sentence_break + 1, clause_break + 1, word_break)
            if boundary >= minimum_break:
                end = boundary

        content = normalized[start:end].strip()
        if content:
            chunks.append(
                DocumentChunk(
                    page_number=page_number,
                    chunk_index=len(chunks),
                    content=content,
                )
            )
        start = end
        while start < len(normalized) and normalized[start].isspace():
            start += 1
    return chunks


def extract_pdf_chunks(
    content: bytes,
    *,
    reader_factory: Callable[[BytesIO], Any] | None = None,
) -> PdfExtractionResult:
    factory = reader_factory or load_pdf_reader()
    try:
        reader = factory(BytesIO(content))
        if getattr(reader, "is_encrypted", False):
            decrypt = getattr(reader, "decrypt", None)
            if not callable(decrypt) or not decrypt(""):
                raise PdfIndexingFailure("encrypted_pdf")

        chunks: list[DocumentChunk] = []
        readable_pages = 0
        extracted_characters = 0
        for page_number, page in enumerate(reader.pages, start=1):
            raw_text = page.extract_text() or ""
            normalized = normalize_extracted_text(raw_text)
            if sum(character.isalnum() for character in normalized) < MIN_READABLE_CHARACTERS:
                continue
            extracted_characters += len(normalized)
            if extracted_characters > MAX_EXTRACTED_CHARACTERS:
                raise PdfIndexingFailure("extracted_text_too_large")
            page_chunks = chunk_page_text(normalized, page_number)
            chunks.extend(page_chunks)
            readable_pages += 1
            if len(chunks) > MAX_CHUNKS:
                raise PdfIndexingFailure("too_many_chunks")
    except PdfIndexingFailure:
        raise
    except Exception as error:
        raise PdfIndexingFailure("pdf_parse_failed") from error

    return PdfExtractionResult(
        readable_page_count=readable_pages,
        chunks=chunks,
    )
