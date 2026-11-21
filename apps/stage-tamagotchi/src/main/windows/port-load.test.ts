import { describe, expect, it } from 'vitest'

/** Every wave-3 window module must load with a view-bound context, not an Electron one. */
describe('ported window modules', () => {
  it('loads each manager factory', async () => {
    const modules = await Promise.all([
      import('./about'),
      import('./beat-sync'),
      import('./caption'),
      import('./chat'),
      import('./customizer'),
      import('./devtools'),
      import('./notice'),
      import('./onboarding'),
      import('./settings'),
      import('./stage'),
      import('./widgets'),
    ])

    const factories = [
      modules[0].setupAboutWindowReusable,
      modules[1].setupBeatSync,
      modules[2].setupCaptionWindowManager,
      modules[3].setupChatWindowReusableFunc,
      modules[4].setupCustomizerWindowManager,
      modules[5].setupDevtoolsWindow,
      modules[6].setupNoticeWindowManager,
      modules[7].setupOnboardingWindowManager,
      modules[8].setupSettingsWindowReusableFunc,
      modules[9].setupActorStageWindowManager,
      modules[10].setupWidgetsWindowManager,
    ]
    for (const factory of factories)
      expect(typeof factory).toBe('function')
  })
})
