<script setup lang="ts">
import type { ProcessSpawnerInstance } from '../../composables/use-process-spawner'

import { FieldInput } from '@proj-airi/ui'

const props = withDefaults(defineProps<{
  spawner: ProcessSpawnerInstance
  title?: string
  description?: string
  placeholderSpawn?: string
  placeholderStop?: string
  spawnButtonLabel?: string
  stopButtonLabel?: string
  icon?: string
}>(), {
  title: 'Server Lifecycle & Process Spawner',
  description: 'Execute local startup commands, background daemons, or remote SSH one-liners directly from AIRI.',
  placeholderSpawn: 'e.g. npx airi-audio-server or ./start_server.sh or ssh user@host "command"',
  placeholderStop: 'e.g. killall airi-audio-server or ./stop_server.sh or ssh user@host "command"',
  spawnButtonLabel: 'Spawn Server',
  stopButtonLabel: 'Stop Server',
  icon: 'i-solar:server-square-bold-duotone',
})
</script>

<template>
  <div class="shadow-xs border border-neutral-200/80 rounded-2xl bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/60">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2.5">
        <div class="h-9 w-9 flex items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
          <span :class="[props.icon, 'text-lg']" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h3 class="text-sm text-neutral-900 font-bold dark:text-neutral-100">
              {{ props.title }}
            </h3>
            <span
              :class="[
                'px-2 py-0.5 text-[10px] font-semibold rounded-full border',
                props.spawner.isElectron.value
                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400'
                  : 'bg-neutral-100 text-neutral-500 border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400',
              ]"
            >
              {{ props.spawner.isElectron.value ? 'Desktop IPC Ready' : 'Web Browser Mode' }}
            </span>
          </div>
          <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
            {{ props.description }}
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-wrap items-center self-start gap-2 sm:self-auto">
        <button
          v-if="props.spawner.lastResult.value"
          type="button"
          class="dark:border-neutral-750 dark:hover:bg-neutral-750 inline-flex cursor-pointer items-center gap-1.5 border border-neutral-200 rounded-xl bg-neutral-50 px-3 py-1.5 text-xs text-neutral-700 font-medium transition-all active:scale-95 dark:bg-neutral-800 hover:bg-neutral-100 dark:text-neutral-300"
          @click="props.spawner.showLogs.value = !props.spawner.showLogs.value"
        >
          <span class="i-solar:terminal-linear text-xs" />
          <span>{{ props.spawner.showLogs.value ? 'Hide Logs' : 'Terminal Logs' }}</span>
          <span
            :class="[
              'ml-1 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold',
              props.spawner.lastResult.value.success
                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/20 text-red-600 dark:text-red-400',
            ]"
          >
            {{ props.spawner.lastResult.value.exitCode === 0 ? '0' : props.spawner.lastResult.value.exitCode ?? '!' }}
          </span>
        </button>

        <button
          v-if="props.spawner.stopCommand.value.trim()"
          type="button"
          :disabled="props.spawner.isExecuting.value"
          class="shadow-xs inline-flex cursor-pointer items-center gap-1.5 border border-red-200 rounded-xl bg-red-50 px-3.5 py-1.5 text-xs text-red-700 font-semibold transition-all active:scale-95 dark:border-red-900/50 dark:bg-red-950/40 hover:bg-red-100 dark:text-red-300 disabled:opacity-50 dark:hover:bg-red-900/60"
          @click="props.spawner.handleStop"
        >
          <span
            :class="[
              'text-xs',
              props.spawner.isExecuting.value && props.spawner.executingAction.value === 'stop' ? 'i-solar:restart-bold animate-spin' : 'i-solar:stop-bold',
            ]"
          />
          <span>{{ props.spawner.isExecuting.value && props.spawner.executingAction.value === 'stop' ? 'Stopping...' : props.stopButtonLabel }}</span>
        </button>

        <button
          type="button"
          :disabled="props.spawner.isExecuting.value || !props.spawner.spawnCommand.value.trim()"
          class="shadow-xs inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-1.5 text-xs text-white font-semibold transition-all active:scale-95 hover:bg-amber-600 disabled:opacity-50"
          @click="props.spawner.handleSpawn"
        >
          <span
            :class="[
              'text-xs',
              props.spawner.isExecuting.value && props.spawner.executingAction.value === 'spawn' ? 'i-solar:restart-bold animate-spin' : 'i-solar:play-bold',
            ]"
          />
          <span>{{ props.spawner.isExecuting.value && props.spawner.executingAction.value === 'spawn' ? 'Spawning...' : props.spawnButtonLabel }}</span>
        </button>
      </div>
    </div>

    <!-- Command Configuration Form -->
    <div class="grid grid-cols-1 mt-4 gap-3 lg:grid-cols-2">
      <FieldInput
        v-model="props.spawner.spawnCommand.value"
        label="Spawn Command"
        description="Command to start or spawn the server process (local executable, script, or remote SSH command)."
        :placeholder="props.placeholderSpawn"
      />

      <FieldInput
        v-model="props.spawner.stopCommand.value"
        label="Stop Command (Optional)"
        description="Optional command to terminate or stop the server process."
        :placeholder="props.placeholderStop"
      />
    </div>

    <!-- Auto-spawn Switch & Hints -->
    <div class="mt-3 flex flex-col justify-between gap-2 border-t border-neutral-100 pt-3 sm:flex-row sm:items-center dark:border-neutral-800/80">
      <label class="flex cursor-pointer select-none items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
        <input
          v-model="props.spawner.autoSpawnOnLaunch.value"
          type="checkbox"
          class="h-4 w-4 border-neutral-300 rounded text-amber-500 accent-amber-500 dark:border-neutral-700 focus:ring-amber-500"
        >
        <span class="font-medium">Auto-spawn server on launch if unreachable</span>
      </label>

      <span class="text-[11px] text-neutral-400">
        <template v-if="props.spawner.isElectron.value">
          Commands execute securely within Electron's local host environment.
        </template>
        <template v-else>
          Running in browser: clicking Spawn will copy the command for external terminal execution.
        </template>
      </span>
    </div>

    <!-- Collapsible Terminal Execution Logs Drawer -->
    <div
      v-if="props.spawner.showLogs.value && props.spawner.lastResult.value"
      class="mt-3 border border-neutral-800 rounded-xl bg-neutral-950 p-3.5 text-xs text-neutral-200 font-mono"
    >
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <div class="flex items-center gap-2">
          <div class="flex gap-1.5">
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-red-500/80" />
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-amber-500/80" />
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <span class="text-[11px] text-neutral-400">
            Terminal Output ({{ props.spawner.lastResult.value.action.toUpperCase() }} at {{ props.spawner.lastResult.value.timestamp }})
          </span>
        </div>

        <div class="flex items-center gap-2">
          <span
            :class="[
              'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
              props.spawner.lastResult.value.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400',
            ]"
          >
            Exit Code: {{ props.spawner.lastResult.value.exitCode ?? 'N/A' }}
          </span>
          <button
            type="button"
            class="cursor-pointer text-[11px] text-neutral-400 hover:text-white"
            @click="props.spawner.copyLogs"
          >
            {{ props.spawner.copiedLogs.value ? 'Copied!' : 'Copy' }}
          </button>
          <button
            type="button"
            class="cursor-pointer text-[11px] text-neutral-400 hover:text-white"
            @click="props.spawner.showLogs.value = false"
          >
            Close
          </button>
        </div>
      </div>

      <div class="mt-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed">
        <div v-if="props.spawner.lastResult.value.stdout" class="text-neutral-300">
          {{ props.spawner.lastResult.value.stdout }}
        </div>
        <div v-if="props.spawner.lastResult.value.stderr" class="text-amber-400">
          {{ props.spawner.lastResult.value.stderr }}
        </div>
        <div v-if="props.spawner.lastResult.value.error && !props.spawner.lastResult.value.stderr.includes(props.spawner.lastResult.value.error)" class="text-red-400">
          Error: {{ props.spawner.lastResult.value.error }}
        </div>
        <div v-if="!props.spawner.lastResult.value.stdout && !props.spawner.lastResult.value.stderr && !props.spawner.lastResult.value.error" class="text-neutral-500 italic">
          (Command finished with no output)
        </div>
      </div>
    </div>
  </div>
</template>
