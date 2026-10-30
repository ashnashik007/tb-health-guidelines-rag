import sys
import json
import requests

# Ensure console supports UTF-8 on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from rag_service import answer_question

# 5 Sample questions testing both in-guideline facts and out-of-guideline strictness
SAMPLE_QUESTIONS = [
    "What are the common symptoms and clinical signs of tuberculosis?",
    "What are the recommended treatment regimens for drug-susceptible tuberculosis?",
    "How should patient-centered care and support be provided for people with TB?",
    "What role does digital adherence technologies or video-observed treatment play in TB care?",
    "Who was the first president of the United States and what is quantum computing?"  # Out of domain test
]

API_URL = "http://localhost:8000/ask"


def run_tests():
    print("=" * 80)
    print("HEALTH GUIDELINES RAG - SAMPLE QUESTIONS TEST SUITE")
    print("=" * 80)

    # Check if the FastAPI server is running
    server_online = False
    try:
        health_resp = requests.get("http://localhost:8000/health", timeout=2)
        if health_resp.status_code == 200:
            server_online = True
            print("Detected active FastAPI server at http://localhost:8000. Testing via REST API.")
    except Exception:
        print("FastAPI server not detected at http://localhost:8000. Testing directly via Python service.")

    for i, question in enumerate(SAMPLE_QUESTIONS, start=1):
        print(f"\n[{i}/5] Question: {question}")
        print("-" * 80)

        try:
            if server_online:
                response = requests.post(API_URL, json={"question": question}, timeout=30)
                if response.status_code == 200:
                    result = response.json()
                else:
                    result = {"error": f"HTTP {response.status_code}: {response.text}"}
            else:
                result = answer_question(question)

            if "error" in result:
                print(f"Error: {result['error']}")
                continue

            print(f"Answer:\n{result.get('answer')}\n")
            sources = result.get("sources", [])
            print(f"Sources Found ({len(sources)}):")
            for idx, src in enumerate(sources, start=1):
                print(f"  [{idx}] File: {src.get('file')} | Page: {src.get('page')}")
                print(f"      Snippet: {src.get('snippet')}")

        except Exception as e:
            print(f"Error running test for question: {e}")

        print("=" * 80)


if __name__ == "__main__":
    run_tests()
