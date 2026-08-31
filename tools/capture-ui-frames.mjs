/**
 * Drive the running quote UI in headless Chrome and write PNG frames.
 *
 *     node tools/capture-ui-frames.mjs <out-dir> [base-url]
 *
 * Companion to render-ui-gif.py, which assembles the frames. Split in two
 * because the browser has to be driven from Node and the GIF is assembled with
 * Pillow, and neither half is worth a dependency to avoid.
 *
 * Speaks the Chrome DevTools Protocol directly over Node's built-in WebSocket.
 * That is the whole reason there is no Playwright or Puppeteer in this repo yet:
 * capturing a demo needs a browser, not a test framework, and the roadmap wants
 * Playwright introduced with the E2E suite that justifies it.
 *
 * Every frame is a real screenshot of the real app talking to the real API, so
 * the GIF cannot drift from what the system does — the same guarantee
 * render-demo-gifs.py gives the terminal GIFs.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [outDir = 'frames', baseUrl = 'http://localhost:5173'] = process.argv.slice(2)
const DEBUG_PORT = process.env['CDP_PORT'] ?? '9333'

// 990 is measured, not guessed: the tallest scene (California, five components
// plus the provenance banner) renders 966px, so nothing clips and nothing
// scrolls. A shorter viewport cuts the disclaimer off the bottom, which is the
// one element the requirements say must stay next to the number.
const VIEWPORT = { width: 1180, height: 990 }

let nextId = 1
let socket
const pending = new Map()

async function connect() {
  const response = await fetch(`http://localhost:${DEBUG_PORT}/json/version`)
  const { webSocketDebuggerUrl } = await response.json()

  socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const settle = pending.get(message.id)
    if (settle === undefined) return
    pending.delete(message.id)
    if (message.error) settle.reject(new Error(JSON.stringify(message.error)))
    else settle.resolve(message.result)
  })
}

function send(method, params = {}, sessionId) {
  const id = nextId++
  const payload = { id, method, params }
  if (sessionId !== undefined) payload.sessionId = sessionId
  socket.send(JSON.stringify(payload))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

/** Attach to a fresh tab and return a bound `call(method, params)`. */
async function newPage() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

  const call = (method, params) => send(method, params, sessionId)

  await call('Page.enable')
  await call('Runtime.enable')
  await call('Emulation.setDeviceMetricsOverride', {
    ...VIEWPORT,
    deviceScaleFactor: 2, // Retina frames; the GIF is downscaled once, cleanly.
    mobile: false,
  })

  return call
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function evaluate(call, expression) {
  const { result, exceptionDetails } = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed')
  return result.value
}

let frameIndex = 0
const manifest = []

async function shot(call, label, holdMs) {
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const name = `frame-${String(frameIndex).padStart(3, '0')}.png`
  writeFileSync(join(outDir, name), Buffer.from(data, 'base64'))
  manifest.push({ name, holdMs, label })
  frameIndex += 1
  process.stdout.write(`  ${name}  ${String(holdMs).padStart(5)}ms  ${label}\n`)
}

/**
 * React does not see a programmatic `.value =`; its onChange listens for the
 * event. Setting the value through the native setter and then dispatching is
 * the documented way to drive a controlled input from outside React.
 */
const setControlled = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (el === null) throw new Error('missing ' + ${JSON.stringify(selector)})
  const proto = el instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return el.value
})()`

const clickCheckbox = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (el === null) throw new Error('missing ' + ${JSON.stringify(selector)})
  el.click()
  return el.checked
})()`

const totalText = `document.querySelector('.total')?.textContent ?? '(no total)'`

/** Type into a controlled input one character at a time, capturing frames. */
async function typeInto(call, selector, text, { everyMs = 90, chunk = 2 } = {}) {
  for (let n = chunk; n < text.length; n += chunk) {
    await evaluate(call, setControlled(selector, text.slice(0, n)))
    await shot(call, `type ${text.slice(0, n)}`, everyMs)
  }
  await evaluate(call, setControlled(selector, text))
}

async function quote(call, { hold = 1500 } = {}) {
  await evaluate(call, `document.querySelector('button[type="submit"]').click()`)
  await sleep(450)
  const total = await evaluate(call, totalText)
  await shot(call, `→ ${total}`, hold)
  return total
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  await connect()
  const call = await newPage()

  await call('Page.navigate', { url: baseUrl })
  // Wait for the jurisdiction list to arrive from the API before the first frame.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await evaluate(
      call,
      `document.querySelectorAll('#jurisdiction option').length === 6`,
    ).catch(() => false)
    if (ready === true) break
    await sleep(250)
  }
  await sleep(400)

  const observed = {}

  // ── Scene 1: England, exactly at the first-time-buyer threshold ──────────
  await evaluate(call, setControlled('#jurisdiction', 'GB-ENG'))
  await shot(call, 'England selected — pack asks one question', 900)

  await typeInto(call, '#consideration', '425000.00')
  await shot(call, 'consideration 425000.00', 500)

  await evaluate(call, clickCheckbox('#attr-firstTimeBuyer'))
  await shot(call, 'first-time buyer ticked', 700)
  observed.gbEngAtThreshold = await quote(call, { hold: 1900 })

  // ── Scene 2: one minor unit more ─────────────────────────────────────────
  await evaluate(call, setControlled('#consideration', '425000.01'))
  await shot(call, 'one penny more', 900)
  observed.gbEngOnePennyOver = await quote(call, { hold: 2200 })

  // ── Scene 3: Japan — a zero-decimal currency, and no pack questions ──────
  await evaluate(call, setControlled('#jurisdiction', 'JP'))
  await shot(call, 'Japan — pack needs no extra details', 1100)
  await typeInto(call, '#consideration', '50000000')
  await shot(call, 'consideration 50000000', 500)
  observed.japan = await quote(call, { hold: 2000 })

  // ── Scene 4: California — a county sub-schedule inside one pack ──────────
  await evaluate(call, setControlled('#jurisdiction', 'US-CA'))
  await shot(call, 'California — county and document count appear', 1200)
  await typeInto(call, '#consideration', '850000')
  await evaluate(call, setControlled('#attr-county', 'Los Angeles'))
  await evaluate(call, setControlled('#attr-documentCount', '3'))
  await shot(call, 'Los Angeles, 3 documents', 800)
  observed.losAngeles = await quote(call, { hold: 2000 })

  await evaluate(call, setControlled('#attr-county', 'Alameda'))
  await shot(call, 'same value, different county', 900)
  observed.alameda = await quote(call, { hold: 2300 })

  writeFileSync(
    join(outDir, 'manifest.json'),
    `${JSON.stringify({ viewport: VIEWPORT, frames: manifest, observed }, null, 2)}\n`,
  )

  process.stdout.write(`\n  ${frameIndex} frames → ${outDir}\n`)
  process.stdout.write(`  observed: ${JSON.stringify(observed, null, 2)}\n`)

  socket.close()
}

await main()
