# LoCoMo conv-47 TypeSafe Jev Benchmark Report

**Target Benchmark**: LoCoMo `conv-47` (31 Sessions, 689 Turns, 150 non-adversarial QA pairs)
**Date**: 2026-09-21T04:47:50.094Z
**System-1 Architecture**: TypeSafe Jev Cloud (`typesafe/jev-latest`) + Needle 2 WASM + BGE/BM25 Hybrid RRF
**Duration**: 300.96s

---

## 1. Scorecard: Baseline vs Laya vs TypeSafe Jev

| Metric | Baseline (Regex+BM25) | Laya Coprocessor (Pass 1) | TypeSafe Jev (Pass 2B) | Jev vs Laya Lift |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **44.33%** | **+-0.99%** |
| **Overall Token F1** | 6.63% | 8.29% | **13.58%** | **+5.29%** 🚀 |
| **Overall BLEU-1** | 4.90% | 5.71% | **11.09%** | **+5.38%** 🚀 |
| **C1 Multi-Hop F1** | 6.52% | 5.36% | **22.55%** | **+17.19%** 📈 |
| **C2 Temporal F1** | 0.85% | 1.34% | **4.61%** | **+3.28%** 📈 |
| **C3 Detective F1** | 3.69% | 1.37% | **18.39%** | **+17.02%** 📈 |
| **C4 Literal F1** | 9.49% | 12.93% | **14.33%** | **+1.40%** |
