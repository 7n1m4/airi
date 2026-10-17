/// <reference types="@histoire/plugin-vue/components.d.ts" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  // NOTICE: Single File Components are compiled by the bundler, so this ambient
  // declaration is a shape placeholder and must not restrict the exported type.
  const component: DefineComponent<Record<string, any>, Record<string, any>, any>
  export default component
}
