/**
 * Declaration for the upstream emscripten glue that drives the Spine
 * skeleton converter.
 *
 * The glue ships as untyped JavaScript: projects whose `include` covers it as a
 * real source file (e.g. this package's own tsconfig with `allowJs`) infer the
 * factory type from the `.js` file, but consumers that resolve the package
 * through `node_modules` get no JS inference at all and would otherwise report
 * TS7016 against the import. Declaring the factory explicitly gives both
 * programs the same type without any per-site suppression.
 *
 * Only the surface actually exercised by `converter.ts` is described; the
 * instantiated module is cast there to the narrow `SpineConverterModule` type.
 */
interface SpineConverterGlueOptions {
  /** Emscripten hook that resolves a runtime file (e.g. the `.wasm`) to a URL. */
  locateFile?: (path: string, scriptDirectory: string) => string
  [key: string]: unknown
}

declare const initModule: (moduleArg?: SpineConverterGlueOptions) => Promise<unknown>

export default initModule
