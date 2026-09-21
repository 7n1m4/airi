# LoCoMo conv-47 Pass 9 (Laya ONNX Coprocessor + Monolithic System-2) Benchmark Report

- **Date**: 2026-09-21T20:47:59.712Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 1348.24s
- **Architecture**:
  - **System-1 Coprocessor**: Local Convai Laya ONNX running on CPU (@receptron/laya)
  - **Polar Query Guard**: Prevents yes/no queries from being answered with calendar dates
  - **Temporal Date-Range Hook**: Anima-inspired automatic date/month extraction and session turn injection
  - **Strict Distillation Abstention**: Laya System-1 (`choice: 'none'`) abstains cleanly without forcing irrelevant raw turns
  - **Strict Ledger Verification**: Only unambiguous graph matches bypass System-2; unverified graph hypotheses escalate
  - **Casual Spoken Query Expansion**: Canonical aliases bridge conversational phrasing
  - **Deductive Synthesis (System-2)**: Monolithic One-Shot DeepSeek Flash via OpenCode Go with unforced output token ceiling
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 8 (Jev Chunked) | Pass 9 (Jev Chunked) | Pass 9 (Laya Monolithic) | Laya vs Pass 9 Jev Delta |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 66.50% | 67.49% | **41.38%** | **-26.11%** |
| **Official Upstream F1** | 6.43% | 70.20% | 69.29% | **69.12%** | **-0.17%** |
| **Legacy Token F1** | 6.63% | 69.60% | 68.48% | **68.29%** | **-0.20%** |
| **Overall BLEU-1** | 4.90% | 64.39% | 62.09% | **62.83%** | **+0.75%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 65.42% | 67.80% | **77.24%** | **+9.44%** |
| **Temporal (C2) Upstream F1** | 0.74% | 60.14% | 57.53% | **62.19%** | **+4.67%** |
| **Detective (C3) Upstream F1** | 3.86% | 44.62% | 44.62% | **44.62%** | **+0.00%** |
| **Literal (C4) Upstream F1** | 9.92% | 79.49% | 78.34% | **73.85%** | **-4.49%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | 85/150 (56.7%) | **86/150 (57.3%)** | **+1** |
