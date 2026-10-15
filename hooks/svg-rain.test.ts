import { expect, test } from 'claude-code/testing'

import { BuildRainSvg, TICK_SECONDS } from './svg-rain'

const WIDTHS: ReadonlyArray<number> = [40, 300, 820, 1400, 2400]

test('the rain changes only through <set>s, never a per-frame animation', async () => {
  for (const width of WIDTHS) {
    const source: string = BuildRainSvg(7, width)
    expect(source).not.toMatch(/<animate|<animateTransform|<animateMotion|@keyframes|animation:/)
    expect((source.match(/<set /g) ?? []).length).toBeGreaterThan(0)
  }
})

test('every change lands on a tick of the shared clock', async () => {
  const source: string = BuildRainSvg(7, 1400)
  const times: number[] = [...source.matchAll(/(?:begin|dur)="([^"]*)"/g)].flatMap(match =>
    match[1]!.split(';').flatMap(part => [...part.matchAll(/(\d+(?:\.\d+)?)s/g)].map(time => Number(time[1]))),
  )
  expect(times.length).toBeGreaterThan(0)
  for (const time of times) {
    const ticks: number = time / TICK_SECONDS
    expect(Math.abs(ticks - Math.round(ticks))).toBeLessThan(1e-6)
  }
})

test('no step waits for another to end, so a rarely drawn band still shows the moment', async () => {
  const source: string = BuildRainSvg(7, 1400)
  for (const set of source.match(/<set [^>]*>/g) ?? []) {
    const id: string | undefined = set.match(/ id="([^"]*)"/)?.[1]
    for (const reference of set.match(/[\w]+(?=\.end)/g) ?? []) expect(reference).toBe(id)
  }
})

test('the rain fits the Svg element at every width, as markup a strict parser reads', async () => {
  for (const width of WIDTHS) {
    const source: string = BuildRainSvg(12345, width)
    expect(source.length).toBeLessThanOrEqual(131072)
    // Glyphs like < are escaped: every < opens a tag.
    expect(source).not.toMatch(/<(?![a-zA-Z/])/)
  }
})

test('the same seed draws the same rain', async () => {
  expect(BuildRainSvg(99, 820)).toBe(BuildRainSvg(99, 820))
  expect(BuildRainSvg(99, 820)).not.toBe(BuildRainSvg(100, 820))
})
