# LoCoMo conv-47 Pass 2 Benchmark Report: System-1 Entity Ledger

**Target Benchmark**: LoCoMo `conv-47` (31 Sessions, 689 Turns, 150 non-adversarial QA pairs)
**Date**: 2026-09-21T04:36:40.958Z
**Architecture**: System-1 Ingestion & Entity Ledger (Needle 2 WASM + Convai Laya ONNX + Dual Searcher + Answer Head)
**Cost**: $0.00 (100% Offline / Local Execution on CPU)
**Duration**: 376.05s

---

## 1. Comparative Scorecard

| Metric | Baseline (Regex+BM25) | Pass 1 (Laya Coprocessor) | Pass 2 (Entity Ledger) | Pass 2 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **44.33%** | **+-0.99%** 🚀 |
| **Overall Token F1** | 6.63% | 8.29% | **12.29%** | **+4.00%** 📈 |
| **Overall BLEU-1** | 4.90% | 5.71% | **9.80%** | **+4.09%** |
| **C1 Multi-Hop F1** | 6.52% | 5.36% | **17.89%** | **+12.52%** |
| **C2 Temporal F1** | 0.85% | 1.34% | **4.61%** | **+3.28%** |
| **C3 Detective F1** | 3.69% | 1.37% | **10.70%** | **+9.33%** |
| **C4 Literal F1** | 9.49% | 12.93% | **14.33%** | **+1.40%** |

---

## 2. Key Architectural Breakthroughs

1. **Context-Aware Turn Ingestion (3-Turn Window)**:
   - Needle WASM extracts mentions, temporal phrases, and claims over a 3-turn sliding window (`target + 2 prior turns`), successfully capturing multi-turn context such as `D1:12-D1:14` (dog ownership + names).
2. **Contextual Coreference & Role Modeling**:
   - Reconciles within-turn references (`"it"`, `"pup"` -> `Ned`) without destructive global alias merging. `dog` and `pup` are preserved as species attributes, while `Max`, `Daisy`, and `Ned` remain distinct individual entities.
3. **Additive Dual Search & Provenance Deduplication**:
   - Queries the Entity Ledger for structured operations (`list`, `set_union`, `event_date`) while concurrently executing hybrid BGE/BM25 text search.
   - Eliminates duplicate provenance across raw turns and STMM observations by deduplicating on `refDiaId || id`.
4. **Deterministic Temporal Anchoring**:
   - Anchors relative time expressions (`"last week"`) to source session timestamps (`2022-04-12`), resolving calendar intervals (`first week of April 2022`).
