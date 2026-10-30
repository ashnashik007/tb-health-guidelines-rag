import os
import sys
import os
import subprocess
import json
import csv
import time
from datetime import datetime
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Path references
EVAL_DIR = Path(__file__).resolve().parent
ROOT_DIR = EVAL_DIR.parent
BACKEND_DIR = ROOT_DIR / "backend"
DATASET_PATH = EVAL_DIR / "dataset.json"
REPORT_CSV_PATH = EVAL_DIR / "evaluation_report.csv"
VENV_PYTHON = BACKEND_DIR / ("venv/Scripts/python.exe" if os.name == "nt" else "venv/bin/python")

# A direct invocation under global Python must switch to the backend environment
# before importing rag_service and its installed dependencies.
if __name__ == "__main__":
    if not VENV_PYTHON.is_file():
        raise SystemExit(
            f"Backend virtual-environment interpreter not found: {VENV_PYTHON}. "
            f"Install it with: {sys.executable} -m pip install -r {BACKEND_DIR / 'requirements.txt'}"
        )
    running_python = os.path.normcase(str(Path(sys.executable).resolve()))
    venv_python = os.path.normcase(str(VENV_PYTHON.resolve()))
    if running_python != venv_python:
        completed = subprocess.run(
            [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
            cwd=str(ROOT_DIR),
            check=False,
        )
        raise SystemExit(completed.returncode)

# Add backend directory to sys.path so we can reuse the existing RAG pipeline directly
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Import the existing answer_question pipeline
try:
    from rag_service import answer_question
except ImportError as e:
    print(f"Error importing rag_service: {e}")
    sys.exit(1)


def load_dataset():
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Dataset file not found at: {DATASET_PATH}")
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def evaluate_single_case(case):
    test_id = case.get("id")
    question = case.get("question")
    category = case.get("question_category")
    expected_doc = case.get("expected_source_document")
    expected_behavior = case.get("expected_behavior")
    verified_ref = case.get("verified_page_number_or_passage", "")
    needs_clinical_verification = "YES" if "[Needs Clinical Verification]" in verified_ref or "[Needs Clinical Verification]" in case.get("expected_answer", "") else "NO"

    start_time = time.time()
    try:
        response = answer_question(question)
        elapsed_sec = round(time.time() - start_time, 2)
        actual_answer = response.get("answer", "").strip()
        sources = response.get("sources", [])
    except Exception as err:
        elapsed_sec = round(time.time() - start_time, 2)
        error_text = str(err)
        secret = os.getenv("GROQ_API_KEY", "")
        if secret:
            error_text = error_text.replace(secret, "[REDACTED]")
        lowered_error = error_text.casefold()
        status_code = getattr(err, "status_code", None)
        if "error querying vector database" in lowered_error or "have you indexed documents" in lowered_error:
            evaluation_status = "RETRIEVAL_ERROR"
        elif status_code == 403 or ("403" in lowered_error and any(term in lowered_error for term in ("forbidden", "access denied", "network"))):
            evaluation_status = "PROVIDER_ACCESS_ERROR"
        else:
            evaluation_status = "EXECUTION_ERROR"
        return {
            "Test_ID": test_id,
            "Question_Category": category,
            "Question": question,
            "Expected_Behavior": expected_behavior,
            "Expected_Source_Doc": expected_doc,
            "Verified_Page_or_Passage": verified_ref,
            "Actual_Answer": f"ERROR: {error_text}",
            "Retrieved_Sources": "NONE",
            "Citation_Match": "N/A (Request Error)",
            "Evaluation_Status": evaluation_status,
            "Needs_Clinical_Verification": needs_clinical_verification,
            "Response_Time_Sec": elapsed_sec
        }

    # Format retrieved sources string
    source_entries = []
    retrieved_files = set()
    for s in sources:
        f_name = s.get("file", "unknown")
        p_num = s.get("page", "?")
        retrieved_files.add(f_name)
        source_entries.append(f"{f_name} (p.{p_num})")
    sources_summary = "; ".join(source_entries) if source_entries else "None"

    normalized_answer = " ".join(actual_answer.casefold().split())
    is_fallback = normalized_answer in {
        "i couldn't find this in the provided guidelines.",
        "i couldn't find this in the provided guidelines",
        "the provided guidelines do not contain enough information to answer this question.",
        "the provided guidelines do not contain enough information to answer this question",
    }

    # Determine Citation Match and Evaluation Status
    if expected_behavior == "STRICT_FALLBACK":
        if is_fallback:
            citation_match = "N/A (Out of Guidelines)"
            eval_status = "PASSED_STRICT_FALLBACK"
        else:
            citation_match = "FAIL (Unsupported Answer)"
            eval_status = "FAILED_HALLUCINATION_DETECTED"
    else:
        # In-guidelines question
        matched_doc = expected_doc in retrieved_files
        if is_fallback:
            if matched_doc:
                citation_match = "PASS (Expected Source Document; Answer Declined)"
                eval_status = "FALSE_NEGATIVE_AFTER_EXPECTED_SOURCE_RETRIEVED"
            else:
                citation_match = "FAIL (Retrieval Miss)"
                eval_status = "FALSE_NEGATIVE_RETRIEVAL_MISS"
        elif not sources:
            citation_match = "FAIL (Missing Citation)"
            eval_status = "MISSING_CITATION"
        elif matched_doc:
            citation_match = "PASS (Expected Source Document)"
            if needs_clinical_verification == "YES":
                eval_status = "PASSED_SOURCE_MATCH_REQUIRES_CLINICAL_AUDIT"
            else:
                eval_status = "PASSED_EXPECTED_SOURCE_MATCH"
        else:
            citation_match = "FAIL (Wrong Source)"
            eval_status = "CITATION_MISMATCH"

    return {
        "Test_ID": test_id,
        "Question_Category": category,
        "Question": question,
        "Expected_Behavior": expected_behavior,
        "Expected_Source_Doc": expected_doc,
        "Verified_Page_or_Passage": verified_ref,
        "Actual_Answer": actual_answer,
        "Retrieved_Sources": sources_summary,
        "Citation_Match": citation_match,
        "Evaluation_Status": eval_status,
        "Needs_Clinical_Verification": needs_clinical_verification,
        "Response_Time_Sec": elapsed_sec
    }


def run_evaluation():
    print("=" * 80)
    print("TB HEALTH GUIDELINES RAG - SYSTEMATIC EVALUATION SUITE")
    print("Educational Guideline Evaluation Framework (Not Professional Medical Advice)")
    print("=" * 80)

    dataset = load_dataset()
    total_cases = len(dataset)
    print(f"Loaded {total_cases} test cases from evaluation/dataset.json.\n")

    results = []
    status_counts = {}

    for idx, case in enumerate(dataset, start=1):
        print(f"[{idx:02d}/{total_cases:02d}] Evaluating {case.get('id')} ({case.get('question_category')})...", end=" ", flush=True)
        res = evaluate_single_case(case)
        results.append(res)
        status = res["Evaluation_Status"]
        status_counts[status] = status_counts.get(status, 0) + 1
        print(f"[{status}] ({res['Response_Time_Sec']}s)")

    # Write CSV Report
    fieldnames = [
        "Test_ID",
        "Question_Category",
        "Question",
        "Expected_Behavior",
        "Expected_Source_Doc",
        "Verified_Page_or_Passage",
        "Actual_Answer",
        "Retrieved_Sources",
        "Citation_Match",
        "Evaluation_Status",
        "Needs_Clinical_Verification",
        "Response_Time_Sec"
    ]

    try:
        with open(REPORT_CSV_PATH, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)
    except PermissionError:
        # Excel or another viewer may hold the last report open on Windows.
        # Preserve the complete run instead of discarding its results.
        fresh_report_path = REPORT_CSV_PATH.with_name(
            f"{REPORT_CSV_PATH.stem}.fresh_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}{REPORT_CSV_PATH.suffix}"
        )
        with open(fresh_report_path, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)
        print(f"The standard report is open or locked. Fresh report saved to: {fresh_report_path.resolve()}")
        report_output_path = fresh_report_path
    else:
        report_output_path = REPORT_CSV_PATH

    print("\n" + "=" * 80)
    print("EVALUATION SUMMARY REPORT")
    print("=" * 80)
    print(f"Total Test Cases: {total_cases}")
    for st, count in sorted(status_counts.items()):
        pct = (count / total_cases) * 100
        print(f" - {st:<35}: {count:2d} ({pct:5.1f}%)")

    print("-" * 80)
    print(f"CSV Report generated at: {report_output_path.resolve()}")
    print("=" * 80)


if __name__ == "__main__":
    run_evaluation()
