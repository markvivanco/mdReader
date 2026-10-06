export function desktopPlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform) {
  if (/mac/i.test(platform)) return 'macos'
  if (/win/i.test(platform)) return 'windows'
  return 'other'
}

type Modifiers = { metaKey: boolean; ctrlKey: boolean; altKey: boolean }

export function primaryModifier(event: Modifiers, platform = desktopPlatform()) {
  // AltGr is reported as Ctrl+Alt on Windows; never turn typing into an app action.
  return !event.altKey && (platform === 'macos' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
}

export function shortcutLabel(key: string, platform = desktopPlatform()) {
  return `${platform === 'macos' ? '⌘' : 'Ctrl+'}${key.toUpperCase()}`
}

export const trashName = desktopPlatform() === 'windows' ? 'Recycle Bin' : 'Trash'
