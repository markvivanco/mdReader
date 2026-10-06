import { defaultSchema } from 'rehype-sanitize'

const driveLetters = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ']

export const markdownSchema = {
  ...defaultSchema,
  // Drive letters and file URLs are local references. The URL transform and
  // click handlers still reject other schemes; scripts/event attributes remain
  // subject to the default sanitizer rules.
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), 'file', ...driveLetters],
    src: [...(defaultSchema.protocols?.src || []), 'file', ...driveLetters],
  },
  tagNames: [...(defaultSchema.tagNames || []), 'u'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'id', 'title'],
    code: [...(defaultSchema.attributes?.code || []), ['className', /^language-/]],
  },
}
