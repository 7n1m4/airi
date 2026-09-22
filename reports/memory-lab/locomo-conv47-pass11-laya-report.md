# LoCoMo conv-47 Pass 11 Laya Benchmark Report

- **Date**: 2026-09-21T22:32:20.487Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 1110.54s
- **Architecture**:
  - **Conversational Window Indexing (Turn-1)**: Prepend immediate prior turn (`${prevTurn.speaker}: ${prevTurn.text}\n`)
  - **System-1 Coprocessor**: Local Convai Laya ONNX on CPU
  - **Fix A (Reranker Snippet Context)**: Retains preceding turn context through reranking cross-encoder
  - **Fix B (Date Hook Pool Budgeting)**: Guarantees injected candidates reach the reranking pool
  - **Fix C (Temporal Event Binding)**: Supports "day after tomorrow" and requires content token overlap before accepting dates/durations
  - **Fix D (Graph Fail-Closed)**: Unbound third-party subjects fail closed and escalate to System-2
  - **Response Validation**: finish_reason inspection, selective retries for missing IDs, rejected malformed statuses
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 9 (Laya Mono) | Pass 10 (Jev Mono) | Pass 11 (Jev Mono) | Pass 11 (Laya Mono Hardened) | Delta vs Pass 9 Laya | Delta vs Pass 11 Jev |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 41.87% | 41.38% | 65.52% | 64.04% | **38.92%** | **-2.46%** | **-25.12%** |
| **Official Upstream F1** | 6.04% | 69.12% | 74.23% | 75.97% | **72.74%** | **+3.62%** | **-3.23%** |
| **Legacy Token F1** | 6.13% | 68.29% | 73.52% | 75.43% | **72.42%** | **+4.13%** | **-3.01%** |
| **Overall BLEU-1** | 4.47% | 62.83% | 67.63% | 70.58% | **68.27%** | **+5.44%** | **-2.31%** |
| **Multi-Hop (C1) Upstream F1** | 4.67% | 77.24% | 81.07% | 74.08% | **71.16%** | **-6.08%** | **-2.92%** |
| **Temporal (C2) Upstream F1** | 1.20% | 62.19% | 62.64% | 68.87% | **65.64%** | **+3.45%** | **-3.23%** |
| **Detective (C3) Upstream F1** | 2.99% | 44.62% | 52.31% | 51.93% | **41.91%** | **-2.71%** | **-10.02%** |
| **Literal (C4) Upstream F1** | 8.83% | 73.85% | 80.76% | 83.11% | **80.86%** | **+7.01%** | **-2.25%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 86/150 (57.3%) | 92/150 (61.3%) | 94/150 (62.7%) | **91/150 (60.7%)** | **+5** | **-3** |
