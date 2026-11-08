<script setup lang="ts">
import type { MountedWidget, PersistedWidget } from '../../../libs/sandbox'

import { useTheme } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import MicroAppCatalog from '../widgets/MicroAppCatalog.vue'

import { useSandbox } from '../../../composables/use-sandbox'
import {
  buildWidgetIframeSrcdoc,
  BUNDLED_STARTER_WIDGETS,
  handleWidgetMcpMessage,
} from '../../../libs/sandbox'

const props = withDefaults(defineProps<{
  fillContainer?: boolean
}>(), {
  fillContainer: false,
})

const { isDark } = useTheme()
const {
  isReady,
  mountedWidgets,
  unmountWidget,
  clearWidgets,
  setWidgetSurface,
  readFile,
  importWidget,
} = useSandbox()

const selectedWidgetId = useLocalStorage<string>('airi:widgets:selected-id', '')
const isLoading = ref(false)
const errorMessage = ref<string | null>(null)
const iframeRef = ref<HTMLIFrameElement | null>(null)
const iframeKey = ref(0)
const iframeHeight = ref(240)

// Micro-App Library State
const isLibraryOpen = ref(false)

const activeWidget = computed<MountedWidget | null>(() => {
  if (mountedWidgets.value.length === 0)
    return null
  const found = mountedWidgets.value.find(w => w.id === selectedWidgetId.value)
  return found || mountedWidgets.value[mountedWidgets.value.length - 1]
})

// Auto-select newly added widget on mount or when a new widget arrives
const previousWidgetIds = ref<Set<string>>(new Set())

watch(() => mountedWidgets.value, (list) => {
  if (list.length > 0) {
    const hasCurrent = list.some(w => w.id === selectedWidgetId.value)
    const newWidget = list.find(w => !previousWidgetIds.value.has(w.id))

    if (newWidget && previousWidgetIds.value.size > 0) {
      selectedWidgetId.value = newWidget.id
    }
    else if (!hasCurrent) {
      selectedWidgetId.value = list[list.length - 1].id
    }
  }
  else if (isReady.value) {
    selectedWidgetId.value = ''
  }
  previousWidgetIds.value = new Set(list.map(w => w.id))
}, { immediate: true, deep: true })

function openLibrary() {
  isLibraryOpen.value = true
}

function closeLibrary() {
  isLibraryOpen.value = false
}

async function handleInstallStarter(starter: any) {
  const found = mountedWidgets.value.find(m => m.id === starter.id || m.title === starter.title || m.path === starter.sourcePath?.replace(/\.ts$/, '.js'))
  if (found) {
    selectedWidgetId.value = found.id
    closeLibrary()
    return
  }
  try {
    const imported = await importWidget(starter)
    selectedWidgetId.value = imported.id
    closeLibrary()
    toast.success(`Mounted "${starter.title}"`)
  }
  catch (err: any) {
    toast.error(`Failed to mount starter: ${err.message}`)
  }
}

const importFileInputRef = ref<HTMLInputElement | null>(null)
const isDraggingOver = ref(false)

function triggerImportFilePicker() {
  importFileInputRef.value?.click()
}

async function handleImportFiles(files: FileList | File[]) {
  if (!files || files.length === 0)
    return
  let lastImported: PersistedWidget | null = null
  let successCount = 0
  for (const file of Array.from(files)) {
    if (!file.name.endsWith('.json') && file.type !== 'application/json')
      continue
    try {
      const text = await file.text()
      const imported = await importWidget(text, { mount: true })
      lastImported = imported
      successCount++
    }
    catch (err: any) {
      console.error('[WidgetsPanel] Failed to import widget file:', file.name, err)
      toast.error(`Failed to import "${file.name}": ${err.message || 'Invalid format'}`)
    }
  }
  if (lastImported) {
    selectedWidgetId.value = lastImported.id
    if (isLibraryOpen.value) {
      closeLibrary()
    }
    if (successCount === 1) {
      toast.success(`Imported and mounted "${lastImported.title}"`)
    }
    else {
      toast.success(`Successfully imported ${successCount} widgets`)
    }
  }
}

async function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    await handleImportFiles(input.files)
    input.value = ''
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDraggingOver.value = true
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  isDraggingOver.value = false
}

async function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDraggingOver.value = false
  if (e.dataTransfer?.files) {
    await handleImportFiles(e.dataTransfer.files)
  }
}

async function toggleActiveWidgetSurface() {
  if (!activeWidget.value)
    return
  const nextSurface = activeWidget.value.surface === 'widget' ? 'panel' : 'widget'
  await setWidgetSurface(activeWidget.value.id, nextSurface)
}

const iframeSrcdoc = ref('')

async function refreshActiveWidget() {
  if (!activeWidget.value) {
    iframeSrcdoc.value = ''
    return
  }
  // Floated widgets render in FloatingWidgetsLayer; keep panel srcdoc empty.
  if (activeWidget.value.surface === 'widget') {
    iframeSrcdoc.value = ''
    return
  }
  isLoading.value = true
  errorMessage.value = null
  try {
    iframeSrcdoc.value = await buildWidgetIframeSrcdoc({
      ...activeWidget.value,
      isDark: isDark.value,
    }, readFile)
    iframeKey.value++
  }
  catch (err: any) {
    errorMessage.value = err.message || 'Failed to render widget'
  }
  finally {
    isLoading.value = false
  }
}

watch(isDark, (val) => {
  iframeRef.value?.contentWindow?.postMessage({
    type: 'theme-change',
    isDark: val,
  }, '*')
})

function handleIframeMessage(e: MessageEvent) {
  if (e.data?.type === 'widget-resize' && typeof e.data.height === 'number') {
    if (!props.fillContainer) {
      const targetHeight = Math.max(160, Math.min(Math.ceil(e.data.height), 520))
      if (Math.abs(iframeHeight.value - targetHeight) > 2) {
        iframeHeight.value = targetHeight
      }
    }
    return
  }

  void handleWidgetMcpMessage(e)
}

watch([activeWidget, selectedWidgetId], () => {
  void refreshActiveWidget()
}, { immediate: true })

onMounted(() => {
  window.addEventListener('message', handleIframeMessage)
  void refreshActiveWidget()
})

onUnmounted(() => {
  window.removeEventListener('message', handleIframeMessage)
})
</script>

<template>
  <div
    :class="[
      'relative flex flex-col overflow-hidden text-neutral-800 dark:text-neutral-100 transition-all',
      props.fillContainer
        ? 'h-full w-full flex-1 min-h-0 bg-transparent'
        : 'border border-neutral-200/60 dark:border-primary-500/20 rounded-2xl bg-white/70 dark:bg-neutral-900/80 backdrop-blur-md shadow-xl p-2 gap-1',
    ]"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Hidden file input for widget JSON import -->
    <input
      ref="importFileInputRef"
      type="file"
      accept=".json,application/json"
      multiple
      class="hidden"
      @change="handleImportFileChange"
    >

    <!-- Drag overlay indicator -->
    <div
      v-if="isDraggingOver"
      class="backdrop-blur-xs pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-primary-500 rounded-2xl border-dashed bg-primary-500/10"
    >
      <div class="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-primary-600 font-bold shadow-lg dark:bg-neutral-900 dark:text-primary-300">
        <span class="i-solar:import-bold-duotone text-lg" />
        <span>Drop .json manifest to import</span>
      </div>
    </div>
    <!-- Active Widgets Header / Tabs & Action Bar -->
    <div
      :class="[
        'flex items-center justify-between gap-1 select-none shrink-0',
        props.fillContainer
          ? 'px-3 py-2 border-b border-neutral-200/40 dark:border-white/5 bg-transparent'
          : 'border-b border-neutral-200/40 dark:border-neutral-800/40 pb-1.5',
      ]"
    >
      <!-- Widget switcher pills -->
      <div class="no-scrollbar min-w-0 flex flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
        <template v-if="mountedWidgets.length > 0">
          <button
            v-for="w in mountedWidgets"
            :key="w.id"
            type="button"
            :class="[
              'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all shrink-0 cursor-pointer select-none',
              (selectedWidgetId === w.id || (!selectedWidgetId && activeWidget?.id === w.id))
                ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300 font-bold border border-primary-500/30 shadow-xs'
                : 'bg-neutral-100 hover:bg-neutral-200/60 dark:bg-neutral-800/40 dark:hover:bg-neutral-800/70 text-neutral-600 dark:text-neutral-400 border border-transparent',
            ]"
            @click="selectedWidgetId = w.id"
          >
            <span class="i-solar:widget-5-bold-duotone shrink-0 text-xs" />
            <span class="max-w-[180px] truncate sm:max-w-[220px]">{{ w.title || w.path.split('/').pop() }}</span>
            <span
              v-if="w.surface === 'widget'"
              class="ml-0.5 rounded bg-primary-500/20 px-1 py-0.2 text-[8px] text-primary-600 font-bold dark:text-primary-300"
              title="Floating on stage"
            >
              FLOAT
            </span>
          </button>
        </template>
        <span
          v-else
          class="flex items-center gap-1.5 px-1 text-xs text-neutral-500 font-medium dark:text-neutral-400"
        >
          <span class="i-solar:widget-2-bold-duotone shrink-0 text-xs text-primary-500/80" />
          <span>Widgets Sandbox</span>
        </span>
      </div>

      <!-- Action buttons -->
      <div class="flex shrink-0 items-center gap-1">
        <button
          title="Browse widget library"
          type="button"
          :class="[
            'flex items-center justify-center rounded-lg p-1.5 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
            'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer',
          ]"
          @click="openLibrary"
        >
          <span class="i-solar:widget-add-bold-duotone text-sm" />
        </button>

        <button
          v-if="activeWidget"
          title="Reload widget canvas"
          type="button"
          :class="[
            'flex items-center justify-center rounded-lg p-1.5 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
            'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer',
          ]"
          @click="refreshActiveWidget"
        >
          <span class="i-solar:refresh-linear text-sm" :class="{ 'animate-spin': isLoading }" />
        </button>

        <button
          v-if="activeWidget"
          :title="activeWidget.surface === 'widget' ? 'Dock back to panel' : 'Pop out into floating widget'"
          type="button"
          :class="[
            'flex items-center justify-center rounded-lg p-1.5 transition-colors cursor-pointer',
            activeWidget.surface === 'widget'
              ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300 hover:bg-primary-500/25 border border-primary-500/30'
              : 'text-neutral-500 hover:text-primary-600 dark:text-neutral-400 dark:hover:text-primary-400 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50',
          ]"
          @click="toggleActiveWidgetSurface"
        >
          <span :class="activeWidget.surface === 'widget' ? 'i-solar:minimize-square-3-bold-duotone text-sm' : 'i-solar:square-top-down-broken text-sm'" />
        </button>

        <button
          v-if="activeWidget"
          title="Unmount this widget"
          type="button"
          :class="[
            'flex items-center justify-center rounded-lg p-1.5 text-neutral-500 hover:text-rose-600 dark:text-neutral-400 dark:hover:text-rose-400',
            'hover:bg-rose-500/10 dark:hover:bg-rose-950/30 transition-colors cursor-pointer',
          ]"
          @click="unmountWidget(activeWidget.id)"
        >
          <span class="i-solar:close-circle-bold-duotone text-sm" />
        </button>

        <button
          v-if="mountedWidgets.length > 1"
          title="Clear all widgets"
          type="button"
          :class="[
            'flex items-center justify-center rounded-lg p-1.5 text-neutral-500 hover:text-rose-600 dark:text-neutral-400 dark:hover:text-rose-400',
            'hover:bg-rose-500/10 dark:hover:bg-rose-950/30 transition-colors cursor-pointer',
          ]"
          @click="clearWidgets"
        >
          <span class="i-solar:trash-bin-trash-bold-duotone text-sm" />
        </button>
      </div>
    </div>

    <!-- Active Widget Viewport -->
    <div
      v-if="mountedWidgets.length > 0 && activeWidget"
      :class="[
        'relative overflow-hidden transition-all',
        props.fillContainer
          ? 'flex-1 min-h-0 w-full flex flex-col p-2'
          : 'w-full border border-neutral-200/60 dark:border-neutral-800/50 rounded-lg',
      ]"
    >
      <!-- NOTICE: floated widgets render in FloatingWidgetsLayer, not here.
        Without this guard the same widget renders twice (panel iframe + floating
        card), which showed as a black box with a FLOAT tag and no floating div. -->
      <div
        v-if="activeWidget.surface === 'widget'"
        class="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center"
      >
        <span class="i-solar:widget-5-bold-duotone text-xl text-primary-500" />
        <p class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
          Floating on stage
        </p>
        <p class="max-w-[280px] text-[11px] text-neutral-500 leading-normal dark:text-neutral-400">
          {{ activeWidget.title || activeWidget.path.split('/').pop() }} is popped out. Close the Workspace sheet to see it.
        </p>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 border border-primary-500/30 rounded-xl bg-primary-500/15 px-3 py-1.5 text-xs text-primary-600 font-semibold transition-all hover:bg-primary-500/25 dark:text-primary-300"
          @click="toggleActiveWidgetSurface"
        >
          <span class="i-solar:minimize-square-3-bold-duotone text-sm" />
          <span>Dock back to panel</span>
        </button>
      </div>

      <template v-else>
        <div
          :class="[
            'relative w-full overflow-hidden rounded-xl border border-neutral-200/60 dark:border-white/5 bg-white/40 dark:bg-neutral-950/40 backdrop-blur-md',
            props.fillContainer ? 'flex-1 h-full min-h-0' : '',
          ]"
        >
          <iframe
            ref="iframeRef"
            :key="iframeKey"
            :srcdoc="iframeSrcdoc"
            allowtransparency="true"
            sandbox="allow-scripts allow-forms allow-same-origin"
            :class="[
              'block w-full border-0 bg-transparent transition-[height] duration-200',
              props.fillContainer ? 'h-full' : '',
            ]"
            :style="props.fillContainer ? { backgroundColor: 'transparent' } : { height: `${iframeHeight}px`, backgroundColor: 'transparent' }"
          />
        </div>

        <div
          v-if="errorMessage"
          class="mt-2 flex items-center gap-2 border border-rose-500/30 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400"
        >
          <span class="i-solar:danger-triangle-bold-duotone shrink-0 text-sm" />
          <span class="truncate">{{ errorMessage }}</span>
        </div>
      </template>
    </div>

    <!-- Empty State -->
    <div
      v-else
      :class="[
        'flex flex-col items-center justify-center text-center transition-colors cursor-pointer group',
        props.fillContainer
          ? 'flex-1 min-h-0 m-3 p-6 border border-dashed border-neutral-300/80 dark:border-neutral-700/60 rounded-2xl bg-neutral-50/40 dark:bg-neutral-900/20 hover:border-primary-500/40 space-y-3'
          : 'border border-dashed border-neutral-300/80 dark:border-neutral-800/50 rounded-lg bg-neutral-50/50 dark:bg-neutral-950/40 px-4 py-6 space-y-3 hover:border-neutral-400 dark:hover:border-neutral-700/70',
      ]"
      @click="openLibrary"
    >
      <div class="h-10 w-10 flex items-center justify-center border border-primary-500/20 rounded-2xl bg-primary-500/10 text-primary-600 transition-transform group-hover:scale-105 dark:text-primary-400">
        <span class="i-solar:widget-5-bold-duotone text-xl" />
      </div>
      <div class="space-y-1">
        <p class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
          No Active Micro-App
        </p>
        <p class="max-w-[280px] text-[11px] text-neutral-500 leading-normal dark:text-neutral-400">
          Click to browse saved widgets, or run <code class="border border-neutral-200 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-primary-600 font-mono dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-primary-300">mount_widget &lt;file.ts|file.js&gt;</code> in the terminal.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          :class="[
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer',
            'bg-primary-500/15 text-primary-600 dark:text-primary-300 hover:bg-primary-500/25 border border-primary-500/30',
            'transition-all duration-200 shadow-xs',
          ]"
          @click.stop="openLibrary"
        >
          <span class="i-solar:widget-add-bold-duotone text-sm" />
          <span>Browse Library</span>
        </button>

        <button
          type="button"
          :class="[
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer',
            'bg-neutral-100 hover:bg-neutral-200/80 text-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-800 dark:text-neutral-300',
            'border border-neutral-200 dark:border-neutral-700/60 transition-all duration-200 shadow-xs',
          ]"
          @click.stop="triggerImportFilePicker"
        >
          <span class="i-solar:import-bold-duotone text-sm text-primary-500" />
          <span>Import (.json)</span>
        </button>
      </div>

      <!-- Quick Starters -->
      <div class="max-w-[280px] flex flex-wrap items-center justify-center gap-1.5 pt-1">
        <span class="text-[10px] text-neutral-400 font-medium">Starters:</span>
        <button
          v-for="starter in BUNDLED_STARTER_WIDGETS"
          :key="starter.id"
          type="button"
          class="shadow-2xs inline-flex cursor-pointer items-center gap-1 border border-neutral-200/80 rounded-lg bg-white/80 px-2 py-0.5 text-[10px] text-neutral-700 font-medium transition-colors dark:border-neutral-800 hover:border-primary-500/50 dark:bg-neutral-800/80 dark:text-neutral-300"
          @click.stop="handleInstallStarter(starter)"
        >
          <span>{{ starter.title }}</span>
        </button>
      </div>
    </div>

    <!-- Micro-App Library Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="isLibraryOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          @click.self="closeLibrary"
        >
          <div
            :class="[
              'relative max-w-xl w-full rounded-3xl',
              'bg-[#fcfbf9] dark:bg-[#16181d] border border-neutral-200/80 dark:border-neutral-800 shadow-2xl',
              'flex flex-col h-[85vh] max-h-[85vh] text-neutral-800 dark:text-neutral-100 overflow-hidden',
            ]"
          >
            <MicroAppCatalog
              :show-header="true"
              :show-close-button="true"
              @close="closeLibrary"
              @select="(id) => { selectedWidgetId = id; closeLibrary(); }"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
