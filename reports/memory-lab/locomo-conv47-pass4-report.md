# LoCoMo conv-47 Pass 4: Cognitive Dual-Process Architecture (System-1 Jev + System-2 DeepSeek Flash) Benchmark Report

- **Date**: 2026-09-21T07:44:41.670Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 127.06s
- **Architecture**:
  - **Span Extraction**: Needle 2 WASM (Cactus SAN 45M on CPU)
  - **Triage & Reranking**: TypeSafe Jev System-1 API (`jev-latest`, batched 10 candidates / call)
  - **Span Reading**: TypeSafe Jev System-1 Choice Reader (`span-reader.mjs`)
  - **Temporal Arithmetic**: Session-Anchored Calendar Arithmetic (`date-fns`)
  - **Deductive Synthesis (System-2)**: Batched DeepSeek Flash via OpenCode Go (`system2-batch-resolver.mjs`)
  - **Entity Hierarchy**: Jev Hierarchical Place Resolution Tree (Real vs Fictional -> Country -> State)
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 1 (Laya Coprocessor) | Pass 4 (Dual-Process Jev+DeepSeek) | Pass 4 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **56.65%** | **+11.33%** |
| **Official Upstream F1** | 8.94% | 12.32% | **43.93%** | **+31.61%** |
| **Legacy Token F1** | 6.63% | 8.29% | **42.30%** | **+34.00%** |
| **Overall BLEU-1** | 4.90% | 5.71% | **35.94%** | **+30.23%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 6.52% | **28.43%** | **+21.91%** |
| **Temporal (C2) Upstream F1** | 0.74% | 3.83% | **50.73%** | **+46.91%** |
| **Detective (C3) Upstream F1** | 3.49% | 1.64% | **46.06%** | **+44.41%** |
| **Literal (C4) Upstream F1** | 14.51% | 18.87% | **44.55%** | **+25.68%** |
