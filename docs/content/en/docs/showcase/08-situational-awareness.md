# Situational Awareness & Conversational Pacing

![Situational Awareness & Pacing](/showcase/hero-08-situational-awareness.avif)

The **Situational Awareness & Pacing** engine grants characters continuous peripheral perception of your digital workspace. Rather than waiting passively for typed prompts, characters observe your active windows, monitor system telemetry, track idle periods, and engage in natural conversational pacing with contextual spoken fillers.

---

## Desktop Perception & Environmental Sensors

![Situational Awareness Telemetry](/showcase/hero-08-situational-awareness.avif)

AIRI gathers environmental telemetry without compromising user privacy:
- **Active Window Telemetry**: Tracks active application titles (IDE, browser tabs, media players) to generate relevant conversational banter.
- **Hardware Load Sensors**: Measures CPU, GPU, and RAM utilization to react with concern or amusement during heavy gaming or rendering workloads.
- **AFK & Idle Detection**: Distinguishes between active typing, brief reading pauses, and extended away-from-keyboard states.

---

## Continuous Screen Perception & Vision Simulator

![Vision Simulator Interactive](/showcase/settings-vision-simulator-interactive.avif)

- **Cascaded Salience Gate**: Background screen capture pipeline with perceptual hashing (pHash) and OCR filtering to only send meaningful screen changes to the Vision LLM.
- **Interactive Vision Simulator**: Test and calibrate screen perception sensitivity, OCR confidence thresholds, and application exclusion lists inside settings.
- **Privacy Exclusions**: Automatically blanks out password managers, private messaging apps, and banking windows from screen perception.

---

## Conversational Pacing & Dynamic Spoken Fillers

![Conversational Pacing & Audio Fillers](/showcase/pacing-audio-fillers.avif)

Natural conversations include brief verbal pauses, thinking fillers, and emotional affirmations:
- **Dynamic Spoken Fillers**: During long LLM inference turns, AIRI speaks brief contextual fillers (*"Hmm, let me see..."*, *"Give me a second..."*) to eliminate awkward silence.
- **Prewarming & Audio Caching**: Pre-synthesizes high-probability filler phrases into an in-memory PCM cache for instantaneous playback.
- **Seamless Answer Handoff**: Smoothly transitions from thinking filler audio into the generated main response without audio pops or clipping.

---

## Key Capabilities

- **Active-Window Awareness**: Contextual reactions based on current desktop software and tasks.
- **System Telemetry Sensing**: Live awareness of CPU/GPU utilization and system idle status.
- **Cascaded Salience Gate**: Intelligent vision filter preventing redundant VLM API calls.
- **Privacy Exclusions**: Excludes sensitive windows and applications from screen capture.
- **Dynamic Spoken Fillers**: Eliminates inference silence with natural vocal thinking sounds.
- **Zero-Latency Audio Prewarming**: Cached acoustic buffers ensuring instant vocal feedback.
