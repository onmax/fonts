export default defineNuxtConfig({
  modules: ['@nuxt/fonts', '@nuxtjs/tailwindcss', '@unocss/nuxt'],
  unocss: {
    disableNuxtInlineStyle: false,
  },
  fonts: {
    providers: {
      custom: '~/providers/custom'
    },
    families: [
      { name: 'Abel', provider: 'bunny' },
      { name: 'Satoshi', provider: 'fontshare' },
      { name: 'Kode Mono', provider: 'none' },
      { name: 'MyCustom', src: '/custom-font.woff2' },
      { name: 'CustomGlobal', global: true, src: '/font-global.woff2' },
      { name: 'Oswald', fallbacks: ['Times New Roman'] },
    ],
    defaults: {
      fallbacks: {
        monospace: ['Tahoma']
      }
    }
  },
})
