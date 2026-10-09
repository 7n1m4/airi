<script setup lang="ts">
import { ref } from 'vue'

import ProviderAccountIdInput from './provider-account-id-input.vue'

const emptyAccountId = ref('')
const filledAccountId = ref('1234567890abcdef1234567890abcdef')
</script>

<template>
  <Story
    title="Account ID Input"
    group="providers"
    :layout="{ type: 'grid', width: '100%' }"
  >
    <template #controls>
      <ThemeColorsHueControl />
    </template>

    <Variant
      id="empty"
      title="Empty"
    >
      <div>
        <ProviderAccountIdInput
          v-model="emptyAccountId"
          placeholder="Your Account ID"
        />
      </div>
    </Variant>

    <Variant
      id="filled"
      title="Filled"
    >
      <div>
        <ProviderAccountIdInput
          v-model="filledAccountId"
          placeholder="Your Account ID"
        />
      </div>
    </Variant>

    <Variant
      id="custom-label"
      title="Custom Label"
    >
      <div>
        <ProviderAccountIdInput
          v-model="emptyAccountId"
          label="Account ID"
          description="The ID of your provider account"
          placeholder="Your Account ID"
        />
      </div>
    </Variant>

    <Variant
      id="not-required"
      title="Not Required"
    >
      <div>
        <ProviderAccountIdInput
          v-model="emptyAccountId"
          :required="false"
          placeholder="Your Account ID"
        />
      </div>
    </Variant>
  </Story>
</template>
