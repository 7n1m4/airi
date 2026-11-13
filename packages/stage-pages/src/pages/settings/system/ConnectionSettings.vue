<script setup lang="ts">
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { FieldInput } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  // Server-channel apply failure, surfaced by the desktop renderer; web leaves this unset.
  applyError?: string | null
}>(), {
  applyError: null,
})

const { t } = useI18n()

const derivedExample = 'ws://localhost:6121/ws'
// Empty = derive from the daemon-reported gateway settings (tls/hostname/port).
const websocketUrl = useLocalStorageManualReset('settings/connection/websocket-url', '')
const authToken = useLocalStorageManualReset('settings/connection/auth-token', '')
const hfToken = useLocalStorageManualReset('settings/connection/hf-token', '')
</script>

<template>
  <div :class="['rounded-lg', 'bg-neutral-50', 'p-4', 'dark:bg-neutral-800', 'flex flex-col', 'gap-4']">
    <!-- // TODO: Make this array, support to connect to multiple WebSocket server -->
    <FieldInput
      v-model="websocketUrl"
      :label="t('settings.pages.connection.websocket-url.label')"
      :description="t('settings.pages.connection.websocket-url.description')"
      :placeholder="derivedExample"
    />
    <FieldInput
      v-model="authToken"
      :label="t('settings.pages.connection.auth-token.label')"
      :description="t('settings.pages.connection.auth-token.description')"
      :placeholder="t('settings.pages.connection.auth-token.placeholder')"
      type="password"
    />
    <FieldInput
      v-model="hfToken"
      :label="t('settings.pages.connection.hf-token.label')"
      :description="t('settings.pages.connection.hf-token.description')"
      :placeholder="t('settings.pages.connection.hf-token.placeholder')"
      type="password"
    />
    <p v-if="$props.applyError" role="alert" :class="['text-sm', 'text-red-600', 'dark:text-red-400']">
      {{ $props.applyError }}
    </p>
    <slot name="platform-specific" />
  </div>
</template>
