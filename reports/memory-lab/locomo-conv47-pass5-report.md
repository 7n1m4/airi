# LoCoMo conv-47 Pass 5: Autonomous Dual-Process Architecture (System-1 Jev + System-2 DeepSeek Flash) Benchmark Report

- **Date**: 2026-09-21T14:58:00.802Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 215.85s
- **Architecture**:
  - **Span Extraction**: Needle 2 WASM (Cactus SAN 45M on CPU)
  - **Triage & Reranking**: TypeSafe Jev System-1 API (`jev-latest`, batched 10 candidates / call)
  - **Span Reading**: TypeSafe Jev System-1 Choice Reader with Sentence Boundary Isolation (`span-reader.mjs`)
  - **Evidence Grounding**: Verbatim Dialogue Turn Hydration (strips synthetic observation noise)
  - **Temporal Arithmetic**: Session-Anchored Calendar Arithmetic with 'Last Year' Support (`date-fns`)
  - **Deductive Synthesis (System-2)**: Label-Blind Batched DeepSeek Flash via OpenCode Go (`system2-batch-resolver.mjs`)
  - **Entity Hierarchy**: Jev Hierarchical Place Resolution Tree (Real vs Fictional -> Country -> State)
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 1 (Laya Coprocessor) | Pass 5 (Autonomous Dual-Process) | Pass 5 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **56.65%** | **+11.33%** |
| **Official Upstream F1** | 6.43% | 8.71% | **44.27%** | **+35.56%** |
| **Legacy Token F1** | 6.63% | 8.29% | **45.65%** | **+37.36%** |
| **Overall BLEU-1** | 4.90% | 5.71% | **39.85%** | **+34.14%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 6.52% | **37.17%** | **+30.66%** |
| **Temporal (C2) Upstream F1** | 0.74% | 1.43% | **49.59%** | **+48.16%** |
| **Detective (C3) Upstream F1** | 3.86% | 1.28% | **40.17%** | **+38.89%** |
| **Literal (C4) Upstream F1** | 9.92% | 13.38% | **44.44%** | **+31.06%** |
