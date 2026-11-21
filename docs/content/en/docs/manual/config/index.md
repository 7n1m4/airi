---
title: Configuration Guide
description: Detailed instructions for setting up and managing Anima.
---

# Configuration Guide

Welcome to the Anima Configuration Guide. This manual provides a deep dive into every aspect of the application's behavior, from your character's personality to global system settings.

## Getting Started

To customize your companion, open the **Settings** menu from the system tray (desktop version) or the side navigation (web version).

<br />

<video autoplay loop muted>
 <source src="/assets/tutorial-basic-open-settings.mp4" type="video/mp4">
</video>

## Configuration Categories

Select a category below to learn more:

<div flex="~ gap-6 wrap" mt-8>
  <a href="./settings-overview" flex="~ col 1" min-w-64 p-6 rounded-2xl border="1 $border-color" hover:bg="$bg-secondary-color" transition-all no-underline>
    <div text-2xl mb-2 i-lucide:rocket />
    <h3 m-0 mb-2>Settings Overview</h3>
    <p m-0 text-sm opacity-70>High-level map of the Anima configuration system.</p>
  </a>

  <a href="./character-card" flex="~ col 1" min-w-64 p-6 rounded-2xl border="1 $border-color" hover:bg="$bg-secondary-color" transition-all no-underline>
    <div text-2xl mb-2 i-lucide:user />
    <h3 m-0 mb-2>Character & Card</h3>
    <p m-0 text-sm opacity-70>Configure personality, behavior, and visual representation.</p>
  </a>

  <a href="./modules" flex="~ col 1" min-w-64 p-6 rounded-2xl border="1 $border-color" hover:bg="$bg-secondary-color" transition-all no-underline>
    <div text-2xl mb-2 i-lucide:cpu />
    <h3 m-0 mb-2>Intelligence & Modules</h3>
    <p m-0 text-sm opacity-70>Manage LLM providers, speech, hearing, and integrations.</p>
  </a>

  <a href="./system-data" flex="~ col 1" min-w-64 p-6 rounded-2xl border="1 $border-color" hover:bg="$bg-secondary-color" transition-all no-underline>
    <div text-2xl mb-2 i-lucide:settings />
    <h3 m-0 mb-2>System & Data</h3>
    <p m-0 text-sm opacity-70>Managing global app settings, memory, and data lifecycle.</p>
  </a>
</div>

---

### Tips for Customization

- **Start Small**: Use the default Anima preset cards to get a feel for the interaction before creating your own from scratch.
- **Provider Performance**: If you notice slow responses, try different LLM providers or adjust the context window in the Short-Term Memory settings.
- **Proactivity**: Fine-tune the proactivity settings to ensure the character feels alive without becoming overwhelming.
