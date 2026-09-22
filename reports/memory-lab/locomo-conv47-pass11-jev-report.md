# LoCoMo conv-47 Pass 11 Jev Benchmark Report

- **Date**: 2026-09-21T22:13:22.349Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 161.34s
- **Architecture**:
  - **Conversational Window Indexing (Turn-1)**: Prepend immediate prior turn (`${prevTurn.speaker}: ${prevTurn.text}\n`)
  - **System-1 Coprocessor**: TypeSafe Jev Cloud (`typesafe/jev-latest`)
  - **Fix A (Reranker Snippet Context)**: Retains preceding turn context through reranking cross-encoder
  - **Fix B (Date Hook Pool Budgeting)**: Guarantees injected candidates reach the reranking pool
  - **Fix C (Temporal Event Binding)**: Supports "day after tomorrow" and requires content token overlap before accepting dates/durations
  - **Fix D (Graph Fail-Closed)**: Unbound third-party subjects fail closed and escalate to System-2
  - **Response Validation**: finish_reason inspection, selective retries for missing IDs, rejected malformed statuses
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 8 (Jev Chunked) | Pass 9 (Jev Chunked) | Pass 9 (Laya Mono) | Pass 10 (Jev Mono) | Pass 11 (Jev Mono Hardened) | Delta vs Pass 10 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 41.87% | 66.50% | 67.49% | 41.38% | 65.52% | **64.04%** | **-1.48%** |
| **Official Upstream F1** | 6.04% | 70.20% | 69.29% | 69.12% | 74.23% | **75.97%** | **+1.75%** |
| **Legacy Token F1** | 6.13% | 69.60% | 68.48% | 68.29% | 73.52% | **75.43%** | **+1.91%** |
| **Overall BLEU-1** | 4.47% | 64.39% | 62.09% | 62.83% | 67.63% | **70.58%** | **+2.96%** |
| **Multi-Hop (C1) Upstream F1** | 4.67% | 65.42% | 67.80% | 77.24% | 81.07% | **74.08%** | **-6.99%** |
| **Temporal (C2) Upstream F1** | 1.20% | 60.14% | 57.53% | 62.19% | 62.64% | **68.87%** | **+6.23%** |
| **Detective (C3) Upstream F1** | 2.99% | 44.62% | 44.62% | 44.62% | 52.31% | **51.93%** | **-0.39%** |
| **Literal (C4) Upstream F1** | 8.83% | 79.49% | 78.34% | 73.85% | 80.76% | **83.11%** | **+2.35%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | 85/150 (56.7%) | 86/150 (57.3%) | 92/150 (61.3%) | **94/150 (62.7%)** | **+2** |
