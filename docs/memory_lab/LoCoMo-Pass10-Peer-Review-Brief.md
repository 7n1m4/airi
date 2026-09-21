# LoCoMo Pass 10 Peer Review Brief: Turn-1 Conversational Window Anaphora Resolution & Monolithic System-2

- **Dataset**: `conv-47` (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Evaluated System**: Pass 10 System-1 Coprocessor (TypeSafe Jev Cloud) + Turn-1 Conversational Windowing + Monolithic System-2 (DeepSeek Flash via OpenCode Go)
- **Date**: 2026-09-21
- **Primary Trace**: `reports/memory-lab/locomo-conv47-pass10-anaphora-trace.json`
- **Report**: `reports/memory-lab/locomo-conv47-pass10-anaphora-report.md`

---

## 1. Verified Results & Cross-Pass Comparison

| Metric | Baseline (Regex) | Pass 8 (Jev Chunked) | Pass 9 (Jev Chunked) | Pass 9 (Laya Mono) | **Pass 10 (Anaphora + Jev + Mono)** | Delta vs Pass 9 Jev |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Official Upstream F1** | 6.04% | 70.20% | 69.29% | 69.12% | **74.23%** 🚀 | **+4.94%** |
| **Legacy Token F1** | 6.13% | 69.60% | 68.48% | 68.29% | **73.52%** 🚀 | **+5.04%** |
| **Overall BLEU-1** | 4.47% | 64.39% | 62.09% | 62.83% | **67.63%** 🚀 | **+5.54%** |
| **Multi-Hop (C1) Upstream F1** | 4.67% | 65.42% | 67.80% | 77.24% | **81.07%** 🚀 | **+13.27%** |
| **Temporal (C2) Upstream F1** | 1.20% | 60.14% | 57.53% | 62.19% | **62.64%** 📈 | **+5.11%** |
| **Detective (C3) Upstream F1** | 2.99% | 44.62% | 44.62% | 44.62% | **52.31%** 📈 | **+7.69%** |
| **Literal (C4) Upstream F1** | 8.83% | 79.49% | 78.34% | 73.85% | **80.76%** 📈 | **+2.42%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | 85/150 (56.7%) | 86/150 (57.3%) | **92/150 (61.3%)** 🏆 | **+7 questions** |
| **Evidence Recall@3** | 41.87% | 66.50% | 67.49% | 41.38% | **65.52%** | -1.97% |
| **System-2 Monolithic Latency** | - | 154.1s (13 batches) | 182.2s (13 batches) | 76.2s (1 batch) | **66.33s (1 batch)** ⚡ | **2.7x faster** |
| **Total Benchmark Wall Clock** | - | 264.4s | 312.8s | 1348.2s | **148.41s** ⚡ | **Fastest run** |

---

## 2. Core Architectural Interventions

### A. Turn-1 Conversational Window Anaphora Resolution
- **Root Cause Identified**: Prior passes embedded and tokenized isolated single turns. In turns like `D13:5` (*"Thank you! ! I'm starting next month."*), the subject (*"job offer"*) lived in `D13:4`. As an isolated vector and BM25 document, `D13:5` had zero lexical overlap and a raw vector rank of #210, completely starving retrieval.
- **Implementation** (`scripts/tests/locomo-benchmark/locomo-index.mjs`): Dialogue turns are now indexed with their immediate preceding turn prepended (`${prevTurn.speaker}: ${prevTurn.text}\n${turn.speaker}: ${turn.text}`) while preserving `rawText` as the pristine turn string.
- **Empirical Validation**:
  - `D13:5` BM25 rank jumped from `-1` (unranked in top 30) to **#2 overall**.
  - `D13:5` landed at **rank #1 in final top evidence**, resolving *"When will John start his new job?"* to `"July 2022"` (F1 = 0.80, up from 0.00).
  - In-session distillation (`scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs`) was updated to score and format criteria using `turn.text`, allowing Jev to inspect the full prompt-response dialogue pair.

### B. Unforced Monolithic System-2 Resolution
- **Root Cause Identified**: DeepSeek Flash generates ~21k internal reasoning tokens for a 120+ question batch. Hardcoding 8,192 caps or chunking into 10–12 questions caused mid-thought length cutoffs or cross-session blindness.
- **Implementation** (`scripts/tests/locomo-benchmark/system2-batch-resolver.mjs`):
  - Removed arbitrary `max_tokens` request payloads, allowing the provider/environment to define ceilings naturally.
  - Enabled one-shot monolithic resolution across the 121 escalated questions (`batchSize: system2Queue.length`).
  - System-2 latency plunged from 182s down to **66.33s**, while Multi-Hop (C1) leaped to an all-time record of **81.07%**.

### C. Polymorphic System-1 Coprocessor Adapter
- Implemented `scripts/tests/locomo-benchmark/system1-adapter.mjs` unifying Local Convai Laya ONNX (`@receptron/laya`) and TypeSafe Jev Cloud under a polymorphic `systemOne(state, questions)` contract.

---

## 3. Verification & Parity
- All 19 tests in `scripts/tests/locomo-benchmark/evaluator-parity.test.mjs` pass.
- Saved Pass 10 trace (`reports/memory-lab/locomo-conv47-pass10-anaphora-trace.json`) records exact question-by-question metrics, triage decisions, routing reasons, and predictions.
