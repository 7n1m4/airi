# Port Manifest — Electron BrowserWindow Surfaces

Generated from `apps/stage-tamagotchi/src/main/windows/**/index.ts`.
The 13 named surfaces map onto this inventory; RPC helper files (`*/rpc/index.electron.ts`) are grouped under each window entry.

Total window definitions: **15**

- [ ] **about** — `apps/stage-tamagotchi/src/main/windows/about/index.ts`
  - detected flags: width, height, show, resizable, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI — About', width: 670, height: 730, show: false, resizable: true, maximizable: false, minimizable: false, icon, webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.cjs'), sandbox: true,`

- [ ] **beat-sync** — `apps/stage-tamagotchi/src/main/windows/beat-sync/index.ts`
  - detected flags: show, webPreferences
  - ready-to-show handling: no
  - constructor: `show: false, webPreferences: { preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.cjs'), sandbox: true,`

- [ ] **caption** — `apps/stage-tamagotchi/src/main/windows/caption/index.ts`
  - detected flags: width, height, x, y, show, resizable, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `not found (created via shared helper)`

- [ ] **chat** — `apps/stage-tamagotchi/src/main/windows/chat/index.ts`
  - detected flags: width, height, x, y, show, backgroundColor, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI — Chat', width: initialWidth, height: initialHeight, x: initialX, y: initialY, show: false, backgroundColor: '#121212', icon, webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.cjs'), sandbox: true,`

- [ ] **customizer** — `apps/stage-tamagotchi/src/main/windows/customizer/index.ts`
  - detected flags: width, height, show, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `not found (created via shared helper)`

- [ ] **dashboard** — `apps/stage-tamagotchi/src/main/windows/dashboard/index.ts`
  - detected flags: width, height, x, y, show, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI Dashboard', width: windowConfig?.width ?? 1200.0, height: windowConfig?.height ?? 600.0, x: windowConfig?.x, y: windowConfig?.y, show: false, icon, webPreferences: { preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.cjs'), sandbox: true,`

- [ ] **devtools** — `apps/stage-tamagotchi/src/main/windows/devtools/index.ts`
  - detected flags: width, height, show, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI — Devtools', width: 1020, height: 720, minWidth: 640, minHeight: 480, show: false, icon, webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.cjs'), // Preload exposes Electron APIs and needs Node access. sandbox: true,`

- [ ] **inlay** — `apps/stage-tamagotchi/src/main/windows/inlay/index.ts`
  - detected flags: width, height, x, y, show, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI — Inlay', width: 450, height: 150, show: false, icon, webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.cjs'), sandbox: true,`

- [ ] **main** — `apps/stage-tamagotchi/src/main/windows/main/index.ts`
  - detected flags: width, height, x, y, alwaysOnTop, show, backgroundColor, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI', width, height, x, y, show: false, icon, webPreferences: { preload: resolve(dirname(fileURLToPath(import.meta.url)), '../preload/index.cjs'), sandbox: true,`

- [ ] **notice** — `apps/stage-tamagotchi/src/main/windows/notice/index.ts`
  - detected flags: width, height, show, title, webPreferences
  - ready-to-show handling: no
  - constructor: `not found (created via shared helper)`

- [ ] **onboarding** — `apps/stage-tamagotchi/src/main/windows/onboarding/index.ts`
  - detected flags: width, height, frame, transparent, show, resizable, backgroundColor, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI - Companion Wizard', width: 1200, height: 760, minWidth: 400, minHeight: 600, show: false, icon, resizable: true, frame: false, titleBarStyle: 'hidden', transparent: false, backgroundColor: '#0f0f0f', webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.cjs'), sandbox: true, webviewTag: true,`

- [ ] **settings** — `apps/stage-tamagotchi/src/main/windows/settings/index.ts`
  - detected flags: width, height, show, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `title: 'AIRI — Settings', width: 600.0, height: 800.0, show: false, icon, webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.cjs'), sandbox: true, webviewTag: true,`

- [ ] **splash** — `apps/stage-tamagotchi/src/main/windows/splash/index.ts`
  - detected flags: x, y, alwaysOnTop, skipTaskbar, show, resizable, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `not found (created via shared helper)`

- [ ] **stage** — `apps/stage-tamagotchi/src/main/windows/stage/index.ts`
  - detected flags: width, height, x, y, alwaysOnTop, show, title, webPreferences
  - ready-to-show handling: yes
  - constructor: `not found (created via shared helper)`

- [ ] **widgets** — `apps/stage-tamagotchi/src/main/windows/widgets/index.ts`
  - detected flags: width, height, x, y, frame, transparent, skipTaskbar, show, resizable, backgroundColor, title, webPreferences, hasShadow
  - ready-to-show handling: yes
  - constructor: `not found (created via shared helper)`
