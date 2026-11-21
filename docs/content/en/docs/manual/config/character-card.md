---
title: Character, Scenes & Models
description: How to configure your AI's identity, visual model, and environment.
---

# Character & Visuals

This section covers the core aspects of your Anima's identity, from its personality (Airi Card) to its visual representation (Models) and the environment it lives in (Scenes).

## Airi Card

The **Airi Card** is the main tab for configuring your AI’s personality and core behavior.

### Creating a New Card

1.  Click **Create New Card** in the settings menu.
2.  **Identity (Required)**
    - **Name**: Formal or project name.
    - **Description**: What your AI is and how it behaves.
    - **System Prompt**: Core instructions defining behavior and communication style.
    - **Post-History Instructions**: Background or past context.
    - **Version**: Current version of the card.
3.  **Identity (Optional)**
    - **Nickname**: Preferred name for interaction.
    - **Creator Notes**: Internal notes or extra details.
4.  **Behavior**
    - **Personality**: Defines character traits (e.g., shy, curious, aggressive).
    - **Scenario**: Current environment and surroundings.
5.  **Generation (Required)**
    - Select an **LLM Provider** (must be configured in [Modules](./modules) first).
    - Choose a **Model** (e.g., `qwen3:8B`).
    - *Tip*: Larger models typically produce more natural and nuanced responses.
    - *Recommendation*: Limit **Max Tokens** for non-local models to control costs.
    - *Recommendation*: Adjust **Temperature** to control creativity vs. stability.
6.  **Acting**
    - Set **Idle Loops** for movement.
    - Define **ACT / Model Expressions**.
    - Optional: Add **vocal tags** and mannerisms for more expressive speech.
7.  **Modeling Overrides**
    - Override default configurations for specific cards: LLM, STT, TTS, Scene, and Avatar.
8.  **Proactivity**
    - **Interaction Intervals**: How often the AI speaks without a direct prompt.
    - **Trigger Ratios**: Probability of a proactive response.
    - **Heartbeat Events**: Context injected into the AI's internal state.
    - **Stealth Prompts**: Instructions for spontaneous messages.
    - **`NO_REPLY`**: Keyword used to suppress unintentional responses.

---

## Scenes

**Scenes** allow you to manage the visual environment and backgrounds for your character.

- **Upload & Switch**: Use the gallery to upload new backgrounds and switch between them instantly.
- **Background Support**: Supports most standard image formats.

---

## Models

**Models** define the visual representation of your AI.

- **Supported Formats**:
    - **Live2D**: Upload as a `.zip` file containing the model definition.
    - **VRM**: 3D models in the `.vrm` format (standard for characters like those from VRoid Studio).
- **Customization**: You can adjust the scale, position, and specific animations/expressions for each model within the settings.
