import os
import re
import ssl
import hashlib
import shutil
from difflib import SequenceMatcher
from pathlib import Path
from typing import List, Dict, Any, Tuple
from dotenv import load_dotenv
import httpx

# Ensure SSL trust on Windows systems using native OS certificates
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

def get_http_client() -> httpx.Client:
    """
    Configures an HTTP client with proper Windows certificate trust to prevent
    'SSL: CERTIFICATE_VERIFY_FAILED' and 'Connection error' when reaching Groq API.
    """
    try:
        import truststore
        ssl_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        return httpx.Client(verify=ssl_ctx, timeout=30.0)
    except Exception:
        # Keep httpx certificate verification enabled if truststore is unavailable.
        return httpx.Client(timeout=30.0)

# Load environment variables from backend/.env
# This keeps API keys safe and outside of version control
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

# LangChain and PDF loading imports
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Embedding import with fallback support for different LangChain versions
try:
    from langchain_huggingface import HuggingFaceEmbeddings
except ImportError:
    from langchain_community.embeddings import HuggingFaceEmbeddings

# Vector store import with fallback support
try:
    from langchain_chroma import Chroma
except ImportError:
    from langchain_community.vectorstores import Chroma

# Groq LLM integration
from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate

# Define file paths
BASE_DIR = Path(__file__).resolve().parent
BUNDLED_DATA_DIR = BASE_DIR.parent / "data"
DATA_DIR = Path(os.getenv("DATA_DIR", str(BUNDLED_DATA_DIR))).expanduser().resolve()
CHROMA_DIR = Path(os.getenv("CHROMA_PERSIST_DIR", str(BASE_DIR / "chroma_db"))).expanduser().resolve()
COLLECTION_NAME = "health_guidelines"
RETRIEVAL_CANDIDATE_COUNT = 20
RETRIEVAL_RESULT_COUNT = 4
MIN_RELEVANCE_SCORE = 0.25

# Global lazy references for vector store and embeddings
_embeddings = None
_vector_store = None


def prepare_data_directory() -> None:
    """Copy bundled PDFs to persistent DATA_DIR once, without overwriting uploads."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if DATA_DIR == BUNDLED_DATA_DIR.resolve() or not BUNDLED_DATA_DIR.exists():
        return
    for source in BUNDLED_DATA_DIR.glob("*.pdf"):
        target = DATA_DIR / source.name
        if not target.exists():
            shutil.copy2(source, target)


def _store_file_chunks(vector_store: Chroma, filename: str, chunks: list) -> int:
    """Use stable IDs and replace stale chunks only after new chunks are stored."""
    ids = [
        hashlib.sha256(
            f"{filename}\0{chunk.metadata.get('page', '')}\0{index}\0{chunk.page_content}".encode("utf-8")
        ).hexdigest()
        for index, chunk in enumerate(chunks)
    ]
    existing = vector_store._collection.get(where={"file": filename}, include=[]).get("ids", [])
    vector_store.add_documents(chunks, ids=ids)
    stale_ids = [record_id for record_id in existing if record_id not in set(ids)]
    if stale_ids:
        vector_store.delete(ids=stale_ids)
    return len(chunks)


def get_embeddings() -> HuggingFaceEmbeddings:
    """
    Step 1: Initialize local HuggingFace embedding model (all-MiniLM-L6-v2).
    This runs completely locally and free of charge.
    """
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    return _embeddings


def get_vector_store() -> Chroma:
    """
    Step 2: Connect to the local ChromaDB vector database.
    """
    global _vector_store
    if _vector_store is not None:
        return _vector_store
    embeddings = get_embeddings()
    _vector_store = Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=str(CHROMA_DIR)
    )
    return _vector_store


def ingest_documents() -> Dict[str, Any]:
    """
    Step 3: Load all PDFs from /data, chunk them, and store in ChromaDB.
    - Chunk size: ~800 characters with 100 character overlap.
    - Metadata: file name and 1-based page number.
    """
    prepare_data_directory()
    if not DATA_DIR.exists():
        raise FileNotFoundError(f"Data directory not found at: {DATA_DIR}")

    pdf_files = list(DATA_DIR.glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError(f"No PDF files found in {DATA_DIR}. Please add guideline PDFs.")

    vector_store = get_vector_store()
    total_chunks = 0
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100,
        separators=["\n\n", "\n", " ", ""]
    )

    processed_files = []

    # Iterate over each PDF and extract pages
    for pdf_path in pdf_files:
        loader = PyPDFLoader(str(pdf_path))
        pages = loader.load()
        processed_files.append(pdf_path.name)

        # Standardize metadata on each page before chunking
        for page_idx, page_doc in enumerate(pages):
            page_doc.metadata["file"] = pdf_path.name
            page_doc.metadata["page"] = page_idx + 1

        # Split pages into chunks
        chunks = text_splitter.split_documents(pages)
        _store_file_chunks(vector_store, pdf_path.name, chunks)
        total_chunks += len(chunks)

    return {
        "message": "Successfully indexed all guideline documents.",
        "documents": processed_files,
        "total_documents": len(processed_files),
        "total_chunks": total_chunks
    }


def add_document(pdf_path: Path) -> Dict[str, Any]:
    """
    Step 4: Load a single uploaded PDF and add its chunks to ChromaDB.
    """
    loader = PyPDFLoader(str(pdf_path))
    pages = loader.load()

    for page_idx, page_doc in enumerate(pages):
        page_doc.metadata["file"] = pdf_path.name
        page_doc.metadata["page"] = page_idx + 1

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100,
        separators=["\n\n", "\n", " ", ""]
    )
    chunks = text_splitter.split_documents(pages)

    vector_store = get_vector_store()
    _store_file_chunks(vector_store, pdf_path.name, chunks)

    return {
        "message": f"Successfully indexed {pdf_path.name}.",
        "file": pdf_path.name,
        "chunks_added": len(chunks)
    }


def list_indexed_documents() -> List[Dict[str, Any]]:
    """
    Step 5: List all PDF documents currently present in the data folder.
    """
    if not DATA_DIR.exists():
        return []

    pdf_files = list(DATA_DIR.glob("*.pdf"))
    docs = []
    for pdf in pdf_files:
        docs.append({
            "name": pdf.name,
            "size_kb": round(pdf.stat().st_size / 1024, 1)
        })
    return docs


def _normalized_passage(text: str) -> str:
    """Normalize whitespace and punctuation for reliable duplicate checks."""
    return " ".join(re.findall(r"\w+", text.casefold()))


def _passages_are_near_duplicates(first: str, second: str, threshold: float) -> bool:
    """Compare passage text without relying on generated or altered citations."""
    first_normalized = _normalized_passage(first)
    second_normalized = _normalized_passage(second)
    if not first_normalized or not second_normalized:
        return False
    if first_normalized == second_normalized:
        return True

    # Sequence matching catches overlapping chunks; token overlap catches small
    # edits or reflowed PDF text that changes character order slightly.
    sequence_ratio = SequenceMatcher(None, first_normalized, second_normalized).ratio()
    first_tokens = set(first_normalized.split())
    second_tokens = set(second_normalized.split())
    token_ratio = len(first_tokens & second_tokens) / max(1, len(first_tokens | second_tokens))
    return max(sequence_ratio, token_ratio) >= threshold


def answer_question(question: str) -> Dict[str, Any]:
    """
    Step 6: Retrieve relevant chunks from ChromaDB and answer via Groq LLM.
    Answer only from retrieved context; if evidence is insufficient, state so.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key or api_key.strip() == "" or api_key == "your_groq_api_key_here":
        raise ValueError(
            "GROQ_API_KEY is not configured. Please create backend/.env with your valid Groq API key."
        )

    # Retrieve a wider pool so duplicate removal and relevance filtering still
    # leave enough distinct evidence passages for the answer.
    vector_store = get_vector_store()
    try:
        scored_results = vector_store.similarity_search_with_relevance_scores(
            question, k=RETRIEVAL_CANDIDATE_COUNT
        )
    except Exception as e:
        raise RuntimeError(
            f"Error querying vector database. Have you indexed documents? Details: {str(e)}"
        )

    # Chroma returns relevance scores where larger values mean more relevant.
    # Sort explicitly so subsequent filtering always preserves best evidence.
    scored_results = sorted(scored_results, key=lambda item: item[1], reverse=True)
    selected_results = []
    for doc, relevance_score in scored_results:
        if relevance_score < MIN_RELEVANCE_SCORE:
            continue

        duplicate = False
        for selected_doc, _ in selected_results:
            same_page = (
                doc.metadata.get("file") == selected_doc.metadata.get("file")
                and doc.metadata.get("page") == selected_doc.metadata.get("page")
            )
            # Be more aggressive with overlapping chunks from one PDF page,
            # while also removing near-identical evidence across the corpus.
            threshold = 0.72 if same_page else 0.90
            if _passages_are_near_duplicates(
                doc.page_content, selected_doc.page_content, threshold
            ):
                duplicate = True
                break
        if duplicate:
            continue

        selected_results.append((doc, relevance_score))
        if len(selected_results) >= RETRIEVAL_RESULT_COUNT:
            break

    results = [doc for doc, _ in selected_results]
    if not results:
        return {
            "answer": "The provided guidelines do not contain enough information to answer this question.",
            "sources": []
        }

    # Format context and extract source metadata
    context_chunks = []
    sources = []
    for doc in results:
        context_chunks.append(doc.page_content)
        file_name = doc.metadata.get("file", "unknown")
        page_num = doc.metadata.get("page", 1)
        # Create a clean snippet (up to 200 characters)
        clean_text = " ".join(doc.page_content.split())
        snippet = clean_text[:200] + ("..." if len(clean_text) > 200 else "")

        sources.append({
            "file": file_name,
            "page": page_num,
            "snippet": snippet
        })

    combined_context = "\n\n---\n\n".join(context_chunks)

    # Prompt instructing the model to adhere strictly to the provided context
    prompt_template = PromptTemplate(
        input_variables=["context", "question"],
        template="""You are a medical guideline assistant. Treat the retrieved context below as the only evidence available.

Strict evidence rules:
1. Answer only using the retrieved context. Do not introduce medical facts from general knowledge.
2. Every treatment regimen, drug combination, duration, and recommendation must be directly supported by the retrieved passages.
3. If the retrieved context does not support a claim, omit that claim. Do not infer missing details or fill gaps.
4. Do not repeat duplicate evidence passages.
5. If evidence is insufficient to answer the question, respond with EXACTLY:
The provided guidelines do not contain enough information to answer this question.
6. Clearly distinguish guideline versions and patient eligibility criteria when the retrieved passages identify them. Do not merge versions or apply criteria across versions unless the passages explicitly support doing so.
7. Keep the answer direct and factual. Do not create citations, sources, page numbers, or guideline details that are absent from the context.

Context:
{context}

Question:
{question}

Answer:"""
    )

    # Initialize Groq client with a verified active model for this account
    model_name = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    
    # Attempt answer generation with selected model, with graceful fallback to qwen/qwen3.8-27b
    try:
        llm = ChatGroq(
            model=model_name,
            api_key=api_key,
            temperature=0.0,
            http_client=get_http_client()
        )
        chain = prompt_template | llm
        response = chain.invoke({
            "context": combined_context,
            "question": question
        })
    except Exception as model_err:
        if "model_not_found" in str(model_err).lower() and model_name != "qwen/qwen3.8-27b":
            # Fallback to secondary active chat model
            fallback_llm = ChatGroq(
                model="qwen/qwen3.8-27b",
                api_key=api_key,
                temperature=0.0,
                http_client=get_http_client()
            )
            chain = prompt_template | fallback_llm
            response = chain.invoke({
                "context": combined_context,
                "question": question
            })
        else:
            raise model_err

    answer_text = response.content.strip()

    # Normalize common model phrasings to the exact insufficient-evidence response.
    insufficient_evidence = "The provided guidelines do not contain enough information to answer this question."
    if any(phrase in answer_text.casefold() for phrase in (
        "do not contain enough information",
        "does not contain enough information",
        "couldn't find this in the provided guidelines",
        "cannot be found in the provided context",
        "not enough information to answer",
    )):
        answer_text = insufficient_evidence

    return {
        "answer": answer_text,
        "sources": sources
    }
