const volarServiceUniPages = require('@uni-helper/volar-service-uni-pages')

module.exports = {
  services: [
    volarServiceUniPages({ path: './src/custom.d.ts' }),
  ],
}
