import messages from '../packages/i18n/src/locales/index.ts'

import { createI18n } from '../apps/stage-tamagotchi/src/main/libs/i18n/index.ts'

const i18n = createI18n({ messages, locale: 'en' })
console.info('Testing resolution from SOURCE:')
console.info('tamagotchi.electron.tray.menu.labels.label.show:', i18n.t('tamagotchi.electron.tray.menu.labels.label.show'))
console.info('Full object for tamagotchi.electron.tray:', JSON.stringify(messages.en.tamagotchi.electron.tray, null, 2))
