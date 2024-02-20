import { createUnplugin } from 'unplugin'
import { parse, walk, type Declaration } from 'css-tree'
import MagicString from 'magic-string'
import { extname } from 'pathe'
import { hasProtocol } from 'ufo'

import type { Awaitable, FontFaceData, FontSource } from '../types'

interface FontFamilyInjectionPluginOptions {
  resolveFontFace: (fontFamily: string) => Awaitable<FontFaceData | FontFaceData[] | undefined>
}

// TODO: support shared chunks of CSS
export const FontFamilyInjectionPlugin = (options: FontFamilyInjectionPluginOptions) => createUnplugin(() => {
  return {
    name: 'nuxt:fonts:font-family-injection',
    transformInclude (id) {
      return isCSS(id)
    },
    async transform (code) {
      // Early return if no font-family is used in this CSS
      if (!code.includes('font-family:')) { return }

      const s = new MagicString(code)

      const processedFontFamilies = new Set<string>()
      const injectedDeclarations = new Set<string>()

      const promises = [] as any[]
      async function addFontFaceDeclaration (fontFamily: string) {
        const result = await options.resolveFontFace(fontFamily)
        if (!result) return

        for (const declaration of generateFontFaces(fontFamily, result)) {
          if (!injectedDeclarations.has(declaration)) {
            injectedDeclarations.add(declaration)
            s.prepend(declaration + '\n')
          }
        }
      }

      const ast = parse(code)

      // Collect existing `@font-face` declarations (to skip adding them)
      const existingFontFamilies = new Set<string>()
      walk(ast, {
        visit: 'Declaration',
        enter (node) {
          if (this.atrule?.name === 'font-face' && node.property === 'font-family') {
            for (const family of extractFontFamilies(node)) {
              existingFontFamilies.add(family)
            }
          }
        }
      })

      // TODO: handle CSS custom properties
      walk(ast, {
        visit: 'Declaration',
        enter (node) {
          if (node.property !== 'font-family' || this.atrule?.name === 'font-face') { return }

          for (const fontFamily of extractFontFamilies(node)) {
            if (processedFontFamilies.has(fontFamily) || existingFontFamilies.has(fontFamily)) continue
            processedFontFamilies.add(fontFamily)
            promises.push(addFontFaceDeclaration(fontFamily))
          }
          // TODO: Add font fallback metrics via @font-face
          // TODO: Add fallback font for font metric injection
        }
      })

      await Promise.all(promises)

      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap({ hires: true })
        }
      }
    },
  }
})

// Copied from vue-bundle-renderer utils
const IS_CSS_RE = /\.(?:css|scss|sass|postcss|pcss|less|stylus|styl)(\?[^.]+)?$/

function isCSS (id: string) {
  return IS_CSS_RE.test(id)
}

// https://developer.mozilla.org/en-US/docs/Web/CSS/font-family
const genericCSSFamilies = new Set([
  /* A generic family name only */
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',

  /* Global values */
  'inherit',
  'initial',
  'revert',
  'revert-layer',
  'unset',
])

export function generateFontFaces (family: string, source: FontFaceData | FontFaceData[]) {
  const sources = Array.isArray(source) ? source : [source]
  const declarations: string[] = []
  for (const font of sources) {
    const src = Array.isArray(font.src) ? font.src : [font.src]
    const sources = src.map(s => typeof s === 'string' ? parseFont(s) : s)

    declarations.push([
      '@font-face {',
      `  font-family: '${family}';`,
      `  src: ${renderFontSrc(sources)};`,
      `  font-display: ${font.display || 'swap'};`,
      font.unicodeRange && `  unicode-range: ${font.unicodeRange};`,
      font.weight && `  font-weight: ${font.weight};`,
      font.style && `  font-style: ${font.style};`,
      font.featureSettings && `  font-feature-settings: ${font.featureSettings};`,
      font.variationSettings && `  font-variation-settings: ${font.variationSettings};`,
      `}`
    ].filter(Boolean).join('\n'))
  }

  return declarations
}

const formatMap: Record<string, string> = {
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
  ttf: 'truetype',
  eot: 'embedded-opentype',
  svg: 'svg',
}

function parseFont (font: string) {
  // render as `url("url/to/font") format("woff2")`
  if (font.startsWith('/') || hasProtocol(font)) {
    const extension = extname(font).slice(1)
    const format = formatMap[extension]

    return {
      url: font,
      format
    }
  }

  // render as `local("Font Name")`
  return { name: font }
}

function renderFontSrc (sources: Exclude<FontSource, string>[]) {
  return sources.map(src => {
    if ('url' in src) {
      let rendered = `url("${src.url}")`
      for (const key of ['format', 'tech'] as const) {
        if (key in src) {
          rendered += ` ${key}(${src[key]})`
        }
      }
      return rendered
    }
    return `local("${src.name}")`
  }).join(', ')
}

function extractFontFamilies (node: Declaration) {
  if (node.value.type == 'Raw') {
    return [node.value.value]
  }

  const families = [] as string[]
  for (const child of node.value.children) {
    if (child.type === 'Identifier' && !genericCSSFamilies.has(child.name)) {
      families.push(child.name)
    }
    if (child.type === 'String') {
      families.push(child.value)
    }
  }

  return families
}
