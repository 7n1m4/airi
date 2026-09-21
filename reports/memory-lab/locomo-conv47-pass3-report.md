# LoCoMo conv-47 Pass 3: Full TypeSafe Jev Architecture Benchmark Report

- **Date**: 2026-09-21T05:37:06.302Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 128.37s
- **Architecture**:
  - **Span Extraction**: Needle 2 WASM (Cactus SAN 45M on CPU)
  - **Triage & Reranking**: TypeSafe Jev System-1 API (`jev-latest`, batched 10 candidates / call)
  - **Entity Hierarchy**: Jev Hierarchical Place Resolution Tree (Real vs Fictional -> Country -> State)
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 1 (Laya Coprocessor) | Pass 3 (Full Jev) | Pass 3 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **57.14%** | **+11.82%** |
| **Overall Token F1** | 6.63% | 8.29% | **18.95%** | **+10.66%** |
| **Overall BLEU-1** | 4.90% | 5.71% | **14.61%** | **+8.90%** |
| **Multi-Hop (C1) F1** | 6.52% | 5.36% | **30.05%** | **+24.68%** |
| **Temporal (C2) F1** | 0.85% | 1.34% | **8.16%** | **+6.83%** |
| **Detective (C3) F1** | 3.69% | 1.37% | **19.62%** | **+18.26%** |
| **Literal (C4) F1** | 9.49% | 12.93% | **20.59%** | **+7.67%** |
