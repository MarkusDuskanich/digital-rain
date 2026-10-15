// Writes the desktop rain of a svg-rain.ts to an .svg file, for bench.ps1:
//   node bench/render.js [svg-rain.ts] [out.svg] [width] [seed]
// Node runs no TypeScript, so this strips the few type annotations svg-rain.ts uses
// (enough for that file, not a general TypeScript compiler).
const fs = require('fs')
const path = require('path')
const os = require('os')

const [input = path.join(__dirname, '..', 'hooks', 'svg-rain.ts'), output = 'rain.svg', width = '1400', seed = '12345'] =
  process.argv.slice(2)

const TYPE = String.raw`(?:ReadonlyArray<[^>]*>|\(\) => number|string\[\]\[\]|number\[\]|string\[\]|number|string|boolean|void)`
let source = fs
  .readFileSync(input, 'utf8')
  .replace(new RegExp(String.raw`\)\s*:\s*${TYPE}\s*(=>|\{)`, 'g'), ') $1') // return types
  .replace(new RegExp(String.raw`(\w)\s*:\s*${TYPE}(\s*[,)=;])`, 'g'), '$1$2') // parameters and variables
  .replace(new RegExp(String.raw`(\w)\s*:\s*${TYPE}(\s*[,)=;])`, 'g'), '$1$2')
  .replace(/(\w|\]|\))!(?!=)/g, '$1') // non-null assertions
  .replace(/^export /gm, '')
source += '\nmodule.exports = { BuildRainSvg }\n'

const compiled = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rain-')), 'svg-rain.js')
fs.writeFileSync(compiled, source)
const svg = require(compiled).BuildRainSvg(Number(seed), Number(width))
fs.writeFileSync(output, svg)
console.log(`${output}: ${svg.length} characters`)
