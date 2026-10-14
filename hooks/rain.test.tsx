import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 20,
  bodyColumns: 40,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const END = { answer: '', durationMs: 2000, isAborted: false, reason: 'answer' } as const

// Stands for the engine beneath the plugin: its own (empty) band and the turn events.
function Engine(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

test('the terminal rains text while a turn runs and closes the moment it ends', async ($, on) => {
  const clock = mock.clock(on)
  Engine(on)
  const band = () => $.ui.mount({ plugin: 'digital-rain', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await (await band()).find({ type: 'Text' })).toBeUndefined()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(2000)
  expect((await (await band()).findAll({ type: 'Text' })).length).toBeGreaterThan(0)

  await $.turn.complete({ ...END, turnId: 't1' })
  expect(await (await band()).find({ type: 'Text' })).toBeUndefined()
})

test('the desktop rains an SVG while a turn runs and closes softly', async ($, on) => {
  const clock = mock.clock(on)
  Engine(on)
  const band = () => $.ui.mount({ plugin: 'digital-rain', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await (await band()).find({ type: 'Svg' })).toBeUndefined()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(2000)
  const raining = await (await band()).find({ type: 'Svg' })
  expect(raining).toBeDefined()

  await $.turn.complete({ ...END, turnId: 't1' })
  await clock.advance(100)
  // First it switches off like an old TV, at full height...
  const switchingOff = await (await band()).find({ type: 'Svg' })
  expect(switchingOff?.props.source).toContain('animateTransform attributeName="transform" type="scale"')
  expect(switchingOff?.props.height).toBe(raining?.props.height)

  await clock.advance(800)
  // ...then the band slides closed: an empty drawing (each size change reloads the frame), shrinking.
  const closing = await (await band()).find({ type: 'Svg' })
  expect(closing?.props.source).not.toContain('<text')
  expect(closing?.props.height).toBeLessThan(raining?.props.height as number)
  expect(closing?.props.height).toBeGreaterThan(0)

  await clock.advance(1500)
  expect(await (await band()).find({ type: 'Svg' })).toBeUndefined()
})

test('a turn that starts while the desktop band closes brings the rain back', async ($, on) => {
  const clock = mock.clock(on)
  Engine(on)
  const band = () => $.ui.mount({ plugin: 'digital-rain', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(2000)
  await $.turn.complete({ ...END, turnId: 't1' })
  await clock.advance(250)

  await $.turn.start({ text: 'again', turnId: 't2' })
  await clock.advance(2000)
  expect(await (await band()).find({ type: 'Svg' })).toBeDefined()
  expect((await (await band()).find({ type: 'Svg' }))?.props.height).toBe(160)
})

// What the engine stamps on a command the person typed.
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

test('/digital-rain on keeps the rain going between turns and sessions, and off returns to the default', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  Engine(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const band = () => $.ui.mount({ plugin: 'digital-rain', surface: 'desktop', component: 'AbovePrompt', props: BAND })

  const turnedOn = await $.command.run({ ...TYPED, command: 'digital-rain', args: 'on' })
  expect(turnedOn.text).toBe('Digital rain: always on.')
  await clock.advance(500)
  const raining = await (await band()).find({ type: 'Svg' })
  expect(raining).toBeDefined()

  // A turn neither restarts it (same source) nor closes it when it ends.
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(1000)
  await $.turn.complete({ ...END, turnId: 't1' })
  await clock.advance(3000)
  expect((await (await band()).find({ type: 'Svg' }))?.props.source).toBe(raining?.props.source)

  // The setting outlasts the session: a new one starts raining at once.
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(500)
  expect(await (await band()).find({ type: 'Svg' })).toBeDefined()

  const turnedOff = await $.command.run({ ...TYPED, command: 'digital-rain', args: 'off' })
  expect(turnedOff.text).toBe('Digital rain: only while Claude works.')
  await clock.advance(3000)
  expect(await (await band()).find({ type: 'Svg' })).toBeUndefined()
})

test('/digital-rain with a wrong argument says how to use it', async $ => {
  const result = await $.command.run({ ...TYPED, command: 'digital-rain', args: 'maybe' })
  expect(result.text).toContain('Usage')
})
