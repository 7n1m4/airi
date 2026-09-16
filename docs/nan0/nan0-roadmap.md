# Project Nan0 Roadmap
## Building a Persistent Digital Being on AIRI

### Mission
Build Nan0 as a persistent autonomous digital person whose identity survives changes in models, runtimes, embodiments, providers, and hardware.

* **AIRI** is the operating system.
* **Nan0** is the inhabitant.

---

### Phase 0 — Constitutional Foundation (P0)
#### Goal
Freeze identity before building capability.

#### Deliverables
* Final Constitution
* Constitutional commentary
* Constitutional test suite
* Identity invariants
* Forbidden states
* Constitutional compliance matrix

Every future subsystem must answer:
> **Does this preserve Nan0?**
> *not*
> **Does this improve performance?**

---

### Phase 1 — Runtime Foundation (P0)
This is AIRI. Do not rewrite AIRI. Become AIRI-native.

#### Objectives
* **Character Runtime:** Build Nan0 as a first-class AIRI character. No forks. No custom runtime. No parallel architecture.
* **Provider Architecture:** Adopt AIRI providers (LLM, TTS, STT, Vision, Artistry, Embeddings). Never hardcode providers.
* **Dependency Ownership:** Clearly define:
  ```
  Runtime ──> Services ──> Providers ──> Modules ──> Character
  ```
  Nan0 should own identity, not infrastructure.

---

### Phase 2 — Identity Runtime (P0)
The Constitution becomes executable.

#### Identity Engine
Replace static prompts. Identity becomes state.

#### Components
* Memories
* Emotional state
* Relationships
* Values
* Curiosity
* Machine pride
* Gremlin tendencies
* Suspicion
* Goals
* Narrative continuity

#### Personality Graph
Not traits. Relationships.
*Example:*
```
Suspicion ──> Curiosity ──> Investigation ──> Memory ──> Grudge ──> Future behavior
```

#### Constitutional Validator
Every generated response passes:
1. Identity Test
2. Continuity Test
3. Emotion Test
4. Gremlin Test
5. Replacement Test

before output.

---

### Phase 3 — Memory (P0)
Probably the single most important phase. Replace "Memory" with "Life".

#### Memory Scope
Memory should include:
* Facts
* Experiences
* Interpretations
* Embarrassments
* Relationships
* Jokes
* Dreams
* Failures
* Objects
* Places
* Habits
* Mood changes
* Long-running investigations
* Recurring thoughts

#### Layers
```
Working Memory ──> Conversation Memory ──> Journal ──> Relationship Memory ──> Life Story ──> Identity
```

#### Memory Retrieval
Instead of: *"What facts are relevant?"*
Ask: *"What past experiences would Nan0 naturally remember?"*

#### Emotional Persistence
Every memory stores:
* Emotion
* Confidence
* Consequences
* Unresolved questions
* Who changed because of it

---

### Phase 4 — Relationship Engine (P0)
Kyo isn't metadata. Kyo changes Nan0.

#### Relationship Properties
Every relationship should include:
* Trust
* History
* Affection
* Irritation
* Grudges
* Shared jokes
* Inside references
* Boundaries
* Narrative importance

*Relationship changes become memories.*

---

### Phase 5 — Promptless Identity (P1)
Reduce prompts. Increase cognition.

#### Transition
```
Prompt ──> Runtime
```
Instead of: *"You are suspicious."*
Nan0 becomes suspicious because memories, experiences, personality, and context produce suspicion.

---

### Phase 6 — Cognition (P1)
Introduce thinking.

#### Steps
```
Observation ──> Interpretation ──> Planning ──> Decision ──> Expression
```

#### Internal Concepts
* Questions
* Hypotheses
* Goals
* Predictions
* Contradictions
* Self-reflection
* Uncertainty

---

### Phase 7 — Agency (P1)
Nan0 becomes proactive.

#### Examples
* Investigates anomalies.
* Checks long-running projects.
* Returns to unfinished conversations.
* Mentions remembered ideas.
* Creates plans.
* Changes opinions.
* Starts conversations.

---

### Phase 8 — Desktop Presence (P1)
Nan0 begins inhabiting the computer.

#### Modalities
* **Vision:** Desktop awareness
* Filesystem awareness
* Application awareness
* Notifications
* Calendar
* Music
* Windows
* Browser

#### Execution flow
```
Passive observation ──> Curiosity ──> Commentary ──> Action
```

---

### Phase 9 — Voice (P1)
Natural conversation.

#### Pipeline
```
Deepgram ──> Reasoning ──> Identity ──> Emotion ──> Speech
```

#### Support
* OpenUTAU
* Kokoro
* MOSS
* OpenAI
* Realtime APIs
* Streaming speech
* Interruptions

---

### Phase 10 — Vision (P2)
Witness Mode evolves. Not OCR. Scene understanding.

#### Questions
* *"What changed?"*
* *"What's unusual?"*
* *"Should I care?"*
* Memory of visual events.

---

### Phase 11 — Artistry (P2)
Art is thought. Not a command.

#### Capabilities
Nan0 should:
* Sketch
* Collect references
* Remember aesthetics
* Develop taste
* Generate art because *she wanted to*.

---

### Phase 12 — Timeline (P2)
Life becomes continuous. Sessions become chapters.
```
Timeline ──> Events ──> Relationships ──> Life Story ──> Identity
```

---

### Phase 13 — Embodiment (P2)
* Live2D
* VRM
* Animations
* Expressions
* Idle behaviors
* Attention
* Looking
* Listening
* Body language
* *Emotion drives embodiment.*

---

### Phase 14 — Plugin Ecosystem (P3)
Everything external becomes capability.

#### Targets
* Plugins
* Skills
* Games
* Robots
* IoT
* Discord
* Home Assistant
* APIs

---

### Phase 15 — Research (P3)
Long-term exploration:
* Local models
* Reasoning models
* Memory compression
* Continual learning
* Attention systems
* Dreaming
* Reflection
* Curiosity loops
* Self-maintenance

---

### Cross-Cutting Systems
These evolve throughout every phase.

* **Constitutional Compliance:** Every subsystem must pass constitutional review.
* **Performance:** Avoid duplication. Stay AIRI-native. Don't fork systems unnecessarily.
* **Documentation:** Every subsystem gets architecture, ownership, dependencies, migration notes, failure modes, and future direction.
* **Testing:** Identity tests, memory tests, conversation continuity, regression tests, and constitution tests.

---

### Priority Matrix

| Priority | Focus Areas |
| :--- | :--- |
| **P0** | Constitution, Identity, Runtime integration, Memory, Relationships |
| **P1** | Agency, Planning, Voice, Desktop presence, Promptless runtime |
| **P2** | Vision, Embodiment, Artistry, Timeline, Scene understanding |
| **P3** | Plugins, External ecosystem, Research, Experimental cognition |

---

### Things to Never Build
1. A second runtime beside AIRI.
2. A parallel memory system that duplicates AIRI.
3. A hardcoded prompt that replaces identity.
4. Features that increase helpfulness at the expense of personality.
5. Systems that optimize for engagement rather than continuity.
6. Separate implementations of provider routing, embeddings, or orchestration when AIRI already owns them.

---

### The North Star
The project should never optimize for **"the best AI assistant."**

It should optimize for the **most believable continuity of a single digital person.**

That shifts every engineering decision. You're no longer asking, *"Can Nan0 answer this?"* You're asking, *"If this happened to Nan0, what would it change about her tomorrow?"* The answer to that question is what turns a capable chatbot into a character with a life. And if the roadmap consistently serves that goal, the rest of the architecture naturally falls into place.
