# Cherry-Pick Analysis: mempalace + airi-mem → Our Pipeline

## Open-Domain (c3) Trajectory

| Run | F1 | LLM | Notes |
|-----|------|------|-------|
| Run 1 | 2.34% | 15.38% | Regex extraction |
| Run 2 | 2.21% | 38.46% | Structured output |
| Run 3 | 1.18% | 42.31% | + Heuristic boosts |
| Run 4 | 1.18% | 38.46% | Episode segmentation (regression) |

> [!IMPORTANT]
> Open-domain F1 is stuck at ~1-2% across all runs, while the LLM Judge says 38-42% of answers are at least partially correct. **The problem is not answer quality — it's F1 token mismatch.** Open-domain gold answers are often long, opinion-style sentences. Our system outputs concise phrases, which kills token overlap even when semantically correct.

---

## 🔍 5 Cherry-Pickable Improvements (Ranked by Impact)

### 1. 🟢 Dual-Layer Context: Semantic Facts + Raw Dialogue Snippets

**Source**: airi-mem [retrieve_memory.rs](file:///C:/Users/h4rdc/Documents/Github/airi-memory-lab/reference/airi-mem/crates/server/src/api/retrieve_memory.rs) + [retrieval.rs](file:///C:/Users/h4rdc/Documents/Github/airi-memory-lab/reference/airi-mem/crates/core/src/memory/retrieval.rs)

**What they do**: airi-mem retrieves **two parallel memory layers** for every query:
- `semantic_limit: 20` — distilled facts ("Sam prefers Rust over Python")
- `episodic_limit: 10` — raw conversation narratives with original dialogue

The context fed to the LLM looks like:
```text
## Episodic Memories
### Discussing Career Plans
**Conversation Time:** 2024-06-15 3:00 PM UTC (2 months ago)
**Content:** Sam discussed his plan to transition from ML engineering to product management...
**Time Evidence:**
- user: "I started thinking about this last spring"

## Known Facts
- Sam works at ByteDance as a senior ML engineer
- Sam prefers Rust over Python for systems programming
```

**Why this matters for open-domain**: Open-domain questions ask about *opinions, reasons, feelings* — things that get flattened into facts but lose their nuance. By providing raw dialogue snippets alongside facts, the LLM can reconstruct the full reasoning chain.

**Impact**: HIGH — this is the single biggest architectural difference between their system and ours. We only have the "Known Facts" layer.

---

### 2. 🟢 Predicate Keyword Separation (Names vs. Content Words)

**Source**: mempalace [locomo_bench.py L748-751](file:///C:/Users/h4rdc/Documents/Github/airi-memory-lab/reference/mempalace/benchmarks/locomo_bench.py#L748-L751)

```python
names = _person_names(question)
name_words = {n.lower() for n in names}
all_kws = _kw(question)
predicate_kws = [w for w in all_kws if w not in name_words]
```

**What they do**: They split question keywords into **names** (Sam, Emma) and **predicate keywords** (painting, therapy, job). The predicate keywords are used for room routing, while names are used separately for name boosting.

**Why this matters**: Our `extractKeywords` function doesn't distinguish names from predicates. This means when we compute keyword overlap, a question like "What did Sam say about painting?" would get `['sam', 'painting']` as keywords, and a fact about "Sam's job" would score higher than "Emma's painting" because "Sam" matches as a keyword. By separating them, the **content** of the question drives retrieval, while names **only** contribute their own dedicated boost channel.

**Impact**: MEDIUM — quick fix, should improve multi-hop and open-domain where the question mentions one person but the answer involves cross-referencing.

---

### 3. 🟡 Multiplicative vs. Additive Boosting (mempalace's distance-based scoring)

**Source**: mempalace [locomo_bench.py L811-821](file:///C:/Users/h4rdc/Documents/Github/airi-memory-lab/reference/mempalace/benchmarks/locomo_bench.py#L811-L821)

```python
fused = dist * (1.0 - 0.50 * pred_overlap)   # keyword: UP TO 50% distance reduction
if q_boost > 0:
    fused *= 1.0 - 0.60 * q_boost             # quoted: UP TO 60% distance reduction
if n_boost > 0:
    fused *= 1.0 - 0.20 * n_boost             # names: UP TO 20% distance reduction
```

**What they do**: mempalace uses **multiplicative distance reduction** (lower = better). Each boost *compounds* on the previous one. A fact matching all three signals gets: `dist * 0.5 * 0.4 * 0.8 = dist * 0.16` — an **84% effective boost**.

**What we do**: We use **additive score boosting** (higher = better). A fact matching all three signals gets: `score + score*0.5 + score*0.6 + score*0.2 = score * 2.3` — a **130% boost**.

**The difference**: Multiplicative boosts are *relative to the base distance*, meaning the boost is proportionally stronger for facts that are already close. Additive boosts treat all base scores equally. This is a subtle difference, but mempalace's approach tends to widen the gap between good and bad candidates.

**Impact**: LOW-MEDIUM — worth trying as an A/B test. The exact boost values (0.50, 0.60, 0.20) are already tuned for LoCoMo specifically.

---

### 4. 🟡 Time Evidence Surfacing for Temporal Questions

**Source**: airi-mem [retrieval.rs L139-153](file:///C:/Users/h4rdc/Documents/Github/airi-memory-lab/reference/airi-mem/crates/core/src/memory/retrieval.rs#L139-L153)

```rust
if rank <= 2 {
    let time_evidence: Vec<_> = mem.messages.iter()
        .filter(|msg| contains_time_cue(&msg.content))
        .take(3)
        .collect();
    if !time_evidence.is_empty() {
        writeln!(out, "\n**Time Evidence:**");
        for msg in time_evidence {
            writeln!(out, "- {}: \"{}\"", msg.role, msg.content);
        }
    }
}
```

**What they do**: For the top 2 retrieved episodic memories, they scan for messages containing time cues (day names, month names, "ago", "last", "next", four-digit years) and surface them as explicit **Time Evidence** in the context. This gives the LLM the raw temporal signal it needs to resolve relative dates.

**How we can adapt**: Since we don't store raw messages, we can implement this at the *fact level* — for facts with temporal markers, annotate them more prominently in the context when the question is a temporal (c2) question.

**Impact**: MEDIUM for temporal, minimal for open-domain.

---

### 5. 🟡 Wider Retrieval Pool → Strict Re-rank Cut

**Source**: mempalace [locomo_bench.py L873](file:///C:/Users/h4rdc/Documents/Github/airi-memory-lab/reference/mempalace/benchmarks/locomo_bench.py#L873)

```python
n_retrieve = min(top_k * 3 if mode == "hybrid" else top_k, len(corpus))
```

**What they do**: In hybrid mode, mempalace retrieves **3× top-k** initial candidates, then reranks and cuts to top-k. So with top-k=10, they fetch 30 candidates. This gives the reranker a much larger pool to work with.

**What we do**: We retrieve exactly 10 (`limit: 10` in db.ts).

**Impact**: MEDIUM — easy to implement. Widening to 20-30 initial candidates gives the reranker more room to find the gold fact that might be ranked slightly lower by pure embedding similarity.

---

## 🎯 Recommended Implementation Order

| Priority | Change | Expected Impact | Effort |
|----------|--------|----------------|--------|
| 1 | **Dual-layer context** (store + retrieve raw dialog snippets alongside facts) | HIGH — directly fixes open-domain | Medium |
| 2 | **Predicate keyword separation** | MEDIUM — cleaner boosts | Low |
| 3 | **Wider retrieval pool** (k=10 → fetch 30, rerank to 10) | MEDIUM — more candidate diversity | Trivial |
| 4 | **Multiplicative boosting** (match mempalace's distance-based formula) | LOW-MED — tuned for LoCoMo | Low |
| 5 | **Time evidence surfacing** | MEDIUM for temporal only | Low |

> [!WARNING]
> **Change #1 (Dual-layer context) is the most important but also the most invasive.** It requires storing raw session text alongside facts and retrieving it at query time. This is a fundamental architectural shift — the same one that makes airi-mem score 52% overall F1 vs. our 33%.
