try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

import os
import shutil
import csv
import json
import math
import secrets
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Header, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

EVALUATION_DIR = Path(__file__).resolve().parent.parent / "evaluation"
EVALUATION_REPORT_PATH = EVALUATION_DIR / "evaluation_report.csv"
EVALUATION_DATASET_PATH = EVALUATION_DIR / "dataset.json"
EVALUATION_REQUIRED_COLUMNS = {
    "Test_ID", "Question_Category", "Question", "Expected_Behavior",
    "Expected_Source_Doc", "Verified_Page_or_Passage", "Actual_Answer",
    "Retrieved_Sources", "Citation_Match", "Evaluation_Status",
    "Needs_Clinical_Verification", "Response_Time_Sec",
}
PASSED_EVALUATION_STATUSES = {
    "PASSED_STRICT_FALLBACK",
    "PASSED_EXPECTED_SOURCE_MATCH",
    "PASSED_SOURCE_MATCH_REQUIRES_CLINICAL_AUDIT",
    # Accept older reports generated before the status names were made explicit.
    "PASSED_GROUNDED_WITH_CITATION",
    "PASSED_REQUIRES_CLINICAL_AUDIT",
}


def _latest_evaluation_report_path() -> Path:
    """Use a newer lock-safe report if Excel prevented replacing the standard CSV."""
    candidates = [EVALUATION_REPORT_PATH]
    if EVALUATION_DIR.exists():
        candidates.extend(EVALUATION_DIR.glob("evaluation_report.fresh_*.csv"))
    existing = [candidate for candidate in candidates if candidate.is_file()]
    return max(existing, key=lambda candidate: candidate.stat().st_mtime) if existing else EVALUATION_REPORT_PATH

# Import our modular RAG service
from rag_service import (
    DATA_DIR,
    ingest_documents,
    add_document,
    list_indexed_documents,
    answer_question,
    prepare_data_directory,
)

# Step 1: Initialize FastAPI application
app = FastAPI(
    title="Health Guidelines Q&A API",
    description="A Retrieval-Augmented Generation (RAG) backend for querying WHO health guidelines.",
    version="1.0.0"
)

# Step 2: Configure CORS middleware so our React frontend can communicate with FastAPI
frontend_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Document-Admin-Key"],
)


@app.on_event("startup")
def prepare_persistent_data():
    prepare_data_directory()


def require_document_admin_key(provided_key: str | None) -> None:
    """Require a separately configured secret for public document write routes."""
    expected_key = os.getenv("DOCUMENT_ADMIN_KEY", "")
    if not expected_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Document administration is not configured on this service.",
        )
    if not provided_key or not secrets.compare_digest(provided_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid document administration key is required.",
        )


# Step 3: Define Request and Response schemas with validation
class QuestionRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=3,
        description="The health-guideline question to ask. Must be at least 3 characters long.",
        example="What are the main symptoms of active tuberculosis?"
    )


# Step 4: Define Endpoints

@app.get("/health", tags=["Status"])
def health_check():
    """
    Check if the API service is up and running.
    """
    return {
        "status": "healthy",
        "service": "Health Guidelines Q&A API",
        "version": "1.0.0"
    }


@app.get("/documents", tags=["Documents"])
def get_documents():
    """
    List all PDF guideline documents available in the data folder.
    """
    try:
        docs = list_indexed_documents()
        return {
            "count": len(docs),
            "documents": docs
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve document list: {str(e)}"
        )


@app.get("/evaluation", tags=["Evaluation"])
def get_evaluation_results():
    """Read the existing evaluation CSV and return its rows and summaries."""
    report_path = _latest_evaluation_report_path()
    if not report_path.exists():
        return {
            "available": False,
            "reason": "report_missing",
            "message": "No evaluation report was found. Run evaluation/evaluate.py to generate one.",
            "generated_at": None,
            "summary": None,
            "status_counts": {},
            "category_counts": [],
            "citation_counts": {},
            "response_time_distribution": [],
            "test_cases": [],
        }

    try:
        with report_path.open("r", encoding="utf-8-sig", newline="") as report_file:
            reader = csv.DictReader(report_file)
            columns = set(reader.fieldnames or [])
            if not columns and report_path.stat().st_size == 0:
                return {
                    "available": False,
                    "reason": "empty_report",
                    "message": "The evaluation report is empty. Run evaluation/evaluate.py to generate results.",
                    "generated_at": datetime.fromtimestamp(report_path.stat().st_mtime, timezone.utc).isoformat(),
                    "summary": None,
                    "status_counts": {},
                    "category_counts": [],
                    "citation_counts": {},
                    "response_time_distribution": [],
                    "test_cases": [],
                }
            missing_columns = sorted(EVALUATION_REQUIRED_COLUMNS - columns)
            if missing_columns:
                raise ValueError(f"Evaluation CSV is missing required columns: {', '.join(missing_columns)}")
            csv_rows = list(reader)

        dataset_by_id = {}
        if EVALUATION_DATASET_PATH.exists():
            with EVALUATION_DATASET_PATH.open("r", encoding="utf-8-sig") as dataset_file:
                dataset = json.load(dataset_file)
            if isinstance(dataset, list):
                dataset_by_id = {str(case.get("id")): case for case in dataset if isinstance(case, dict)}

        if not csv_rows:
            available = False
            reason = "empty_report"
            message = "The evaluation report has headers but no test-case rows. Run evaluation/evaluate.py to generate results."
        else:
            available = True
            reason = None
            message = None

        cases = []
        status_counts = {}
        category_counts = {}
        citation_counts = {"pass": 0, "fail": 0, "not_applicable": 0, "other": 0}
        response_times = []
        for row in csv_rows:
            test_id = row.get("Test_ID", "")
            dataset_case = dataset_by_id.get(str(test_id), {})
            raw_status = (row.get("Evaluation_Status") or "").strip() or "STATUS_MISSING"
            status_counts[raw_status] = status_counts.get(raw_status, 0) + 1
            category = (row.get("Question_Category") or "").strip() or "Category unavailable"
            bucket = category_counts.setdefault(category, {"category": category, "total": 0, "passed": 0, "failed": 0})
            bucket["total"] += 1
            if raw_status in PASSED_EVALUATION_STATUSES:
                bucket["passed"] += 1
            else:
                # Unknown statuses remain visible and are never treated as passed.
                bucket["failed"] += 1

            citation = (row.get("Citation_Match") or "").strip()
            if citation.upper() == "PASS" or citation.upper().startswith("PASS "):
                citation_counts["pass"] += 1
            elif citation.upper().startswith("FAIL"):
                citation_counts["fail"] += 1
            elif citation.upper().startswith("N/A") or not citation:
                citation_counts["not_applicable"] += 1
            else:
                citation_counts["other"] += 1

            response_time = None
            try:
                response_time = float(row.get("Response_Time_Sec", ""))
                if math.isfinite(response_time) and response_time >= 0:
                    response_times.append(response_time)
                else:
                    response_time = None
            except (TypeError, ValueError):
                pass

            cases.append({
                "test_id": test_id,
                "category": category,
                "question": row.get("Question", ""),
                "expected_behavior": row.get("Expected_Behavior", ""),
                "expected_answer": dataset_case.get("expected_answer", ""),
                "expected_source_document": row.get("Expected_Source_Doc", ""),
                "verified_page_or_passage": row.get("Verified_Page_or_Passage", ""),
                "guideline_version": dataset_case.get("guideline_version_or_date", ""),
                "actual_answer": row.get("Actual_Answer", ""),
                "retrieved_sources": row.get("Retrieved_Sources", ""),
                "citation_match": citation,
                "evaluation_status": raw_status,
                "needs_clinical_verification": row.get("Needs_Clinical_Verification", ""),
                "response_time_sec": response_time,
                "error_detail": row.get("Actual_Answer", "") if (row.get("Actual_Answer", "").startswith("ERROR:") or raw_status == "EXECUTION_ERROR") else "",
            })

        total = len(cases)
        passed = sum(count for status_name, count in status_counts.items() if status_name in PASSED_EVALUATION_STATUSES)
        failed = total - passed
        citation_denominator = citation_counts["pass"] + citation_counts["fail"]
        citation_pass_rate = (citation_counts["pass"] / citation_denominator * 100) if citation_denominator else None
        distribution_bounds = [(0, 1, "< 1 s"), (1, 3, "1–3 s"), (3, 5, "3–5 s"), (5, 10, "5–10 s"), (10, float("inf"), "10+ s")]
        distribution = [{"label": label, "count": sum(1 for value in response_times if lower <= value < upper)} for lower, upper, label in distribution_bounds]

        return {
            "available": available,
            "reason": reason,
            "message": message,
            "generated_at": datetime.fromtimestamp(report_path.stat().st_mtime, timezone.utc).isoformat(),
            "summary": {
                "total_test_cases": total,
                "passed_test_cases": passed,
                "failed_test_cases": failed,
                "pass_rate_percent": (passed / total * 100) if total else None,
                "grounded_answer_rate_percent": None,
                "grounded_answer_rate_reason": "The evaluator checks expected source-document presence, not semantic entailment of each answer claim.",
                "citation_pass_rate_percent": citation_pass_rate,
                "citation_pass_count": citation_counts["pass"],
                "citation_fail_count": citation_counts["fail"],
                "average_response_time_sec": (sum(response_times) / len(response_times)) if response_times else None,
            } if total else None,
            "status_counts": status_counts,
            "category_counts": list(category_counts.values()),
            "citation_counts": citation_counts,
            "response_time_distribution": distribution,
            "test_cases": cases,
        }
    except (OSError, csv.Error, json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not read evaluation report: {exc}",
        )


@app.post("/ingest", tags=["Indexing"])
def ingest_all_guidelines(x_document_admin_key: str | None = Header(default=None)):
    """
    Loads all PDFs from the /data directory, splits them into chunks,
    generates embeddings, and saves them to local ChromaDB.
    """
    require_document_admin_key(x_document_admin_key)
    try:
        result = ingest_documents()
        return result
    except FileNotFoundError as fnf_err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(fnf_err)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Document ingestion failed: {str(e)}"
        )


@app.post("/upload", tags=["Documents"])
async def upload_pdf(
    file: UploadFile = File(...),
    x_document_admin_key: str | None = Header(default=None),
):
    """
    Accepts an uploaded PDF guideline file, saves it to /data,
    and indexes its chunks into ChromaDB.
    """
    require_document_admin_key(x_document_admin_key)
    # Validate file extension
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are supported. Please upload a file ending with .pdf."
        )

    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        safe_filename = Path(file.filename).name
        if safe_filename != file.filename or safe_filename in {".", ".."}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid PDF filename.")
        saved_file_path = DATA_DIR / safe_filename

        # Write uploaded contents to disk
        with open(saved_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Index the new file into the vector store
        index_result = add_document(saved_file_path)

        return {
            "message": f"Successfully uploaded and indexed '{file.filename}'.",
            "file": file.filename,
            "details": index_result
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload and indexing failed: {str(e)}"
        )


@app.post("/ask", tags=["Q&A"])
def ask_question(request: QuestionRequest):
    """
    Ask a question against indexed guidelines.
    Retrieves top 4 matching chunks and generates a strictly grounded answer with sources.
    """
    cleaned_question = request.question.strip()
    if not cleaned_question:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Question cannot be empty or only whitespace."
        )

    try:
        result = answer_question(cleaned_question)
        return result
    except ValueError as ve:
        # e.g., Missing GROQ_API_KEY
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(ve)
        )
    except RuntimeError as re:
        # e.g., Vector database not yet indexed
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(re)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate answer: {str(e)}"
        )
