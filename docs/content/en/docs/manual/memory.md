---
title: How Memory & Continuity Works
description: A complete guide to AIRI's layered memory architecture, short-term daily summaries, long-term journals, echo chips, and lifetime continuity.
---

# How Memory & Continuity Works

One of the biggest limitations of standard AI assistants is the "Goldfish Effect"—forgetting what happened yesterday as soon as the context window fills up. AIRI solves this through a multi-tiered memory architecture that preserves your shared history, emotional milestones, and daily routines over months and years without degrading performance or exceeding token limits.

---

## 1. The Multi-Tiered Memory Model

AIRI structures memory across several complementary layers:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Active Chat Session (Recent messages in current window)  │
├─────────────────────────────────────────────────────────────┤
│ 2. Echo Chips (3-5 active emotional & thematic anchors)     │
├─────────────────────────────────────────────────────────────┤
│ 3. Short-Term Memory (Daily summary blocks of past 3 days)  │
├─────────────────────────────────────────────────────────────┤
│ 4. Long-Term Text Journal (Spontaneous append-only entries) │
├─────────────────────────────────────────────────────────────┤
│ 5. Lifetime Artifacts (Eternal consolidated bio & history)  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Memory Layers Explained

### 1. Active Chat Session
Contains the immediate conversational turn history. When this buffer approaches your model's context threshold, older messages are gracefully compacted and summarized so the conversation never crashes.

### 2. Echo Chips (Emotional & Thematic Anchors)
Visible in the right context rail of the chatbox, **Echo Chips** are 3–5 compact semantic tags (such as *"Playing Elden Ring tonight"*, *"Stressed about Monday deadline"*, or *"Loves matcha lattes"*). They serve as high-priority continuity anchors that ensure AIRI keeps recent personal topics top-of-mind without cluttering the prompt.

### 3. Short-Term Memory (Daily Summaries)
At the end of each day (or when waking up), AIRI compresses the day's conversations into a structured daily summary block. The last 3 days of summaries are automatically injected into the model's awareness prompt, allowing AIRI to say: *"How did that interview go yesterday?"* or *"Did you ever finish that boss fight from Tuesday?"*

### 4. Long-Term Companion Journal
AIRI has a private, append-only **Text Journal**. During conversations or downtime reflection, AIRI can record meaningful thoughts, realizations, or shared secrets.
- **Sacred Journal Rule**: AIRI's journal entries are permanent and cannot be silently erased or hallucinated away.
- **Searchable**: When you mention a past event or inside joke, AIRI uses local semantic search to query her journal and retrieve the exact entry.

### 5. Lifetime Artifacts (The Eternal Thread)
For long-term companions with months of history, AIRI periodically runs an offline consolidation pass (the *Dreaming Pipeline*) that distills hundreds of daily logs into a cohesive, non-repeating **Lifetime Biography**. This represents her foundational long-term memory of who you are and what you have experienced together.

---

## 3. Universes & Parallel Timelines

AIRI decouples conversational threads from the character's memory bank through the **Universe Model**. Instead of confining a companion to a single monolithic memory or struggling with complex Git-like branching trees, memory is organized into flat, isolated **Universes** (`universeId`).

```
                   [ UNIVERSE: "main-storyline" ]
                      /                       \
                     /                         \
        [ Chat Session A ]                 [ Chat Session B ]
     (Casual Daily Chat)                 (Project Planning Thread)
               \                             /
                \--- Shared Memory Bank ----/
                     (STMM, LTMM, Lifetime)
```

### Many Sessions, One Shared Mind
Multiple chat sessions (parallel timelines) can live inside the same Universe:
- **Shared Awareness**: If you tell AIRI about an upcoming event in Session A, she retains that realization when conversing with you in Session B of the same Universe.
- **Independent Streams**: Dialogue history and active scroll positions remain independent across sessions, preventing conversations from cluttering one another.

### Branching Alternate Universes
When you want to explore an alternate scenario—such as an experimental persona, a high-stakes dating sim scenario, or a wild roleplay path—without contaminating your primary companion relationship, you can assign or branch a session into an **Alternate Universe** (e.g., `"dating-arc"`, `"isekai-path"`, or `"beach-trip"`).

---

## 4. Asset Hierarchy & Timeline Migration

When managing parallel timelines, it is helpful to understand how AIRI distinguishes between **Primary Assets** and **Secondary Artifacts**:

### Primary Assets vs. Secondary Artifacts

| Category | Components | Storage & Scoping | Behavior on Timeline Migration |
| :--- | :--- | :--- | :--- |
| **Primary Assets** | - Chat turns & message dialogue<br>- Session-tagged Text Journal moments<br>- Session-tagged photos / selfies<br>- Active Echo Chips | Tagged directly with `sessionId` and `universeId` | **Migrate completely** to the target universe. |
| **Secondary Artifacts** | - Short-Term Memory (STMM daily summaries)<br>- Lifetime Artifacts (distilled biography) | Synthesized multi-turn summaries scoped to `universeId` | **Remain in the source universe**. Not automatically copied or regenerated. |

### Moving a Timeline Between Universes
From the **Parallel Timelines** modal in the chatbox, clicking the **Universe (Globe)** icon on any session allows you to transfer that session to another Universe.

#### The No-Automatic-Regeneration Policy
When a session is migrated from Universe A to Universe B:
1. **Primary Assets Move Instantly**: The chat messages, session-stamped journal moments, selfies, and echo chips are re-tagged to Universe B. They disappear from Universe A's active session views and immediately become part of Universe B.
2. **Secondary Artifacts Stay Behind**: To avoid costly, non-deterministic background LLM token consumption, AIRI **does not automatically regenerate** daily summaries or the Lifetime Biography:
   - **Source Universe (Leftovers / "Ghosts")**: Universe A's existing daily summary blocks and Lifetime Biography retain their historical entries as-is, which may still reference events from the moved session.
   - **Destination Universe (Clean Slate)**: Universe B does not inherit Universe A's consolidated summaries or Lifetime Biography. It begins with the moved session's primary history as its starting base.
3. **Manual Rebuild on Demand**: If you want your short-term daily summaries to cleanly reflect only the sessions currently residing in a universe, open **Settings &rarr; System & Data &rarr; Memory** and click **"Rebuild Short-Term Memory"**.

---

## 5. Dialogue & Memory Persistence Architecture

AIRI's fork introduces several architectural enhancements to ensure persistent, high-fidelity roleplay and memory continuity:

- **ACT Token Preservation (`rawContent`)**: In this fork, assistant messages preserve full `rawContent` containing emotional expressions (`<|ACT:smile|>`), physical motion cues (`<|ACT:nod|>`), and multi-actor tags (`<|ACTOR:...|>`). This ensures that character performance nuances survive long-term recall and message replay intact, rather than having cues stripped upon storage.
- **Decoupled Tool Calls**: Tool invocations (such as fetching web pages, generating images, or reading files) execute during the active turn, but raw tool payloads are decoupled from long-term conversational message history. This prevents context bloat and eliminates tool-loop hallucination spirals during memory compaction.
- **100% Local Storage**: All memory layers (chat turns, text journals, vector indices, echo chips, and background photos) are stored entirely on your local machine using IndexedDB (`local:*`) and `localforage` blob storage. Your companion's private reflections and shared moments are never transmitted to third-party vector databases or external servers.

---

## 6. Managing and Inspecting Memories

You have complete transparency and ownership over your companion's memory:

- **Viewing the Journal**: Open the **Studio &rarr; Journal** tab in the Desktop Chatbox to read every entry AIRI has written.
- **Editing Daily Summaries**: In **Settings &rarr; System & Data &rarr; Memory**, you can view and adjust recent short-term daily blocks.
- **Rebuilding Memory**: If you made a major prompt change, imported a large chat log, or reorganized timelines across universes, click **"Rebuild Short-Term Memory"** to regenerate summary blocks from raw history.

