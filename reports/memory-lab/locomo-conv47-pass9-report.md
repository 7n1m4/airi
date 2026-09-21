# LoCoMo conv-47 Pass 9: Polar Guard, Anima Date-Range Hooks, Strict Distillation & Corrected Dual Process Benchmark Report

- **Date**: 2026-09-21T19:39:09.314Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 272.69s
- **Architecture**:
  - **Polar Query Guard**: Prevents yes/no queries from being answered with calendar dates; escalates cleanly to System-2
  - **Temporal Date-Range Hook**: Anima-inspired automatic date/month extraction and session turn injection
  - **Strict Distillation Abstention**: Jev System-1 (`choice: 'none'`) abstains cleanly without forcing irrelevant raw turns; widened 380-char context
  - **Strict Ledger Verification**: Only unambiguous graph matches bypass System-2; unverified graph hypotheses escalate
  - **Elimination of Session Date Fallback**: "When" queries no longer default to session timestamp without verified event binding
  - **Casual Spoken Query Expansion**: Canonical aliases (e.g. Canada -> Toronto/Vancouver) bridge conversational phrasing
  - **Uncapped System-2 Context**: 6000-char evidence budget with explicit turn IDs and session dates
  - **Deductive Synthesis (System-2)**: Ultra-Concise Batched DeepSeek Flash via OpenCode Go with strict token/polar constraints
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 8 (Verified Milestone) | Pass 9 (Polar Guard + Anima) | Pass 9 vs Pass 8 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 66.50% | **67.49%** | **+0.99%** |
| **Official Upstream F1** | 6.43% | 70.20% | **69.29%** | **-0.91%** |
| **Legacy Token F1** | 6.63% | 69.60% | **68.48%** | **-1.12%** |
| **Overall BLEU-1** | 4.90% | 64.39% | **62.09%** | **-2.30%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 65.42% | **67.80%** | **+2.38%** |
| **Temporal (C2) Upstream F1** | 0.74% | 60.14% | **57.53%** | **-2.61%** |
| **Detective (C3) Upstream F1** | 3.86% | 44.62% | **44.62%** | **+0.00%** |
| **Literal (C4) Upstream F1** | 9.92% | 79.49% | **78.34%** | **-1.15%** |
| **High-Scoring Answers (F1 ≥ 0.8)** | - | 84/150 (56.0%) | **85/150 (56.7%)** | **+1** |
