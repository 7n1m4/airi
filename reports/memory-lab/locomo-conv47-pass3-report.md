# LoCoMo conv-47 Pass 3.1: Full TypeSafe Jev Architecture Benchmark Report

- **Date**: 2026-09-21T06:54:37.423Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 107.07s
- **Architecture**:
  - **Span Extraction**: Needle 2 WASM (Cactus SAN 45M on CPU)
  - **Triage & Reranking**: TypeSafe Jev System-1 API (`jev-latest`, batched 10 candidates / call)
  - **Span Reading**: TypeSafe Jev System-1 Choice Reader (`span-reader.mjs`)
  - **Temporal Arithmetic**: Session-Anchored Calendar Arithmetic (`date-fns`)
  - **Entity Hierarchy**: Jev Hierarchical Place Resolution Tree (Real vs Fictional -> Country -> State)
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 1 (Laya Coprocessor) | Pass 3.1 (Full Jev) | Pass 3.1 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **56.65%** | **+11.33%** |
| **Official Upstream F1** | 8.94% | 12.32% | **41.78%** | **+29.46%** |
| **Legacy Token F1** | 6.63% | 8.29% | **40.15%** | **+31.86%** |
| **Overall BLEU-1** | 4.90% | 5.71% | **33.55%** | **+27.85%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 6.52% | **27.68%** | **+21.17%** |
| **Temporal (C2) Upstream F1** | 0.74% | 3.83% | **51.22%** | **+47.40%** |
| **Detective (C3) Upstream F1** | 3.49% | 1.64% | **17.89%** | **+16.25%** |
| **Literal (C4) Upstream F1** | 14.51% | 18.87% | **45.05%** | **+26.18%** |
