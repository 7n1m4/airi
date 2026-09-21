# LoCoMo conv-47 Pass 10 (Turn-1 Windowed Anaphora + Jev + Monolithic System-2) Benchmark Report

- **Date**: 2026-09-21T21:17:30.129Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 148.41s
- **Architecture**:
  - **Conversational Window Indexing (Turn-1)**: Prepend immediate prior turn (`${prevTurn.speaker}: ${prevTurn.text}\n`) to resolve anaphora in BM25 tokens and BGE embeddings
  - **System-1 Coprocessor**: TypeSafe Jev Cloud (`typesafe/jev-latest`) for Zero-Shot Triage, In-Session Distillation, and Batched Cross-Encoder Reranking
  - **Polar Query Guard**: Prevents yes/no queries from being answered with calendar dates; escalates cleanly to System-2
  - **Temporal Date-Range Hook**: Anima-inspired automatic date/month extraction and session turn injection
  - **Strict Distillation Abstention**: Jev System-1 (`choice: 'none'`) abstains cleanly without forcing irrelevant raw turns
  - **Strict Ledger Verification**: Only unambiguous graph matches bypass System-2; unverified graph hypotheses escalate
  - **Casual Spoken Query Expansion**: Canonical aliases bridge conversational phrasing
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go with unforced output token ceiling
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 8 (Jev Chunked) | Pass 9 (Jev Chunked) | Pass 9 (Laya Mono) | Pass 10 (Anaphora + Jev + Mono) | Delta vs Pass 9 Jev |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 41.87% | 66.50% | 67.49% | 41.38% | **65.52%** | **-1.97%** |
| **Official Upstream F1** | 6.04% | 70.20% | 69.29% | 69.12% | **74.23%** | **+4.93%** |
| **Legacy Token F1** | 6.13% | 69.60% | 68.48% | 68.29% | **73.52%** | **+5.04%** |
| **Overall BLEU-1** | 4.47% | 64.39% | 62.09% | 62.83% | **67.63%** | **+5.54%** |
| **Multi-Hop (C1) Upstream F1** | 4.67% | 65.42% | 67.80% | 77.24% | **81.07%** | **+13.27%** |
| **Temporal (C2) Upstream F1** | 1.20% | 60.14% | 57.53% | 62.19% | **62.64%** | **+5.11%** |
| **Detective (C3) Upstream F1** | 2.99% | 44.62% | 44.62% | 44.62% | **52.31%** | **+7.69%** |
| **Literal (C4) Upstream F1** | 8.83% | 79.49% | 78.34% | 73.85% | **80.76%** | **+2.42%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | 85/150 (56.7%) | 86/150 (57.3%) | **92/150 (61.3%)** | **+7** |
