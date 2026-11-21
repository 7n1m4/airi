<script setup lang="ts">
import { useLocalStorageManualReset } from '@proj-anima/stage-shared/composables'
import { resolveWebSocketUrl } from '@proj-anima/stage-ui/stores/mods/api/channel-server'
import { FieldInput } from '@proj-anima/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  // Server-channel apply failure, surfaced by the desktop renderer; web leaves this unset.
  applyError?: string | null
}>(), {
  applyError: null,
})

const { t } = useI18n()

// Same derivation the channel store uses, so first paint matches daemon-mirrored gateway keys.
const derivedExample = computed(() => resolveWebSocketUrl(key => localStorage.getItem(key)))
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
