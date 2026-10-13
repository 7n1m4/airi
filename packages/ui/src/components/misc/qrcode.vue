<script setup lang="ts">
import qrcode from 'qrcode-generator'

import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** Payload encoded into the QR code. */
  value: string
  /** Rendered edge length in pixels. */
  size?: number
  /** Quiet-zone width, expressed in QR modules. */
  margin?: number
  /** Error correction level; `M` tolerates ~15% damage. */
  level?: 'L' | 'M' | 'Q' | 'H'
  /** Module (dark square) color. */
  dark?: string
  /** Light module / background color. */
  light?: string
  /** Accessible label; when omitted the QR code is hidden from assistive tech. */
  label?: string
}>(), {
  size: 200,
  margin: 4,
  level: 'M',
  dark: '#000000',
  light: '#FFFFFF',
  label: undefined,
})

/**
 * `qrcode-generator` emits a fixed palette (`fill="black"` / `fill="white"`),
 * so the configured colors are substituted into the markup directly.
 */
const svg = computed(() => {
  if (!props.value)
    return ''

  try {
    const qr = qrcode(0, props.level)
    qr.addData(props.value)
    qr.make()

    return qr.createSvgTag({ cellSize: 4, margin: props.margin, scalable: true })
      .replace('<svg', `<svg width="${props.size}" height="${props.size}"`)
      .replaceAll('fill="white"', `fill="${props.light}"`)
      .replaceAll('fill="black"', `fill="${props.dark}"`)
  }
  catch {
    // An unencodable payload must not take the surrounding UI down with it.
    return ''
  }
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- the markup is produced locally by qrcode-generator. -->
  <div
    v-if="svg"
    class="[&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
    v-html="svg"
  />
</template>
