import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopPlatform, primaryModifier, shortcutLabel } from './platform.ts'

test('all supported desktop platforms use their native modifier and labels', () => {
  const command = { metaKey: true, ctrlKey: false, altKey: false }
  const control = { metaKey: false, ctrlKey: true, altKey: false }
  for (const platform of ['Win32', 'Win64', 'Windows']) {
    assert.equal(desktopPlatform(platform), 'windows')
    assert.equal(primaryModifier(control, desktopPlatform(platform)), true)
    assert.equal(primaryModifier(command, desktopPlatform(platform)), false)
    assert.equal(shortcutLabel('s', desktopPlatform(platform)), 'Ctrl+S')
  }
  assert.equal(desktopPlatform('MacIntel'), 'macos')
  assert.equal(primaryModifier(command, 'macos'), true)
  assert.equal(primaryModifier(control, 'macos'), false)
  assert.equal(shortcutLabel('n', 'macos'), '⌘N')
  assert.equal(primaryModifier(control, desktopPlatform('Linux x86_64')), true)
})

test('AltGr and unmodified text do not trigger app shortcuts', () => {
  for (const platform of ['windows', 'macos', 'other'] as const) {
    assert.equal(primaryModifier({ metaKey: false, ctrlKey: true, altKey: true }, platform), false)
    assert.equal(primaryModifier({ metaKey: false, ctrlKey: false, altKey: false }, platform), false)
    assert.equal(primaryModifier({ metaKey: true, ctrlKey: true, altKey: false }, platform), false)
  }
})
