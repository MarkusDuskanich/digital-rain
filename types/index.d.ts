/** One run of same-styled characters within a row of the rain. */
export type Run = { text: string; color: string; bold: boolean }

/** The rain's rows, top to bottom, each a list of runs; null while no rain shows. */
export type Frame = Run[][]

/**
 * The desktop's SVG rain: off, raining, switching off like an old TV, or closing
 * (`closed` of the close's steps done so far); and the seed that draws it.
 */
export type SvgRain = { mode: 'off' | 'working' | 'switchingOff' | 'closing'; seed: number; closed: number }

declare module 'claude-code' {
  interface PluginState {
    'digital-rain': {
      frame: Frame | null
      svgRain: SvgRain
    }
  }
}
