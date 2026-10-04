// Verification scaffolding: preloaded into the backend by `control-solopilot launch`
// (node --import). Refuses every outbound HTTP(S) call to a host other than
// localhost, so a verification run can never reach X, Reddit, Hacker News,
// GitHub Models / OpenRouter, Discord, Stripe or a calendar feed. Each refused
// call is appended to $SOLOPILOT_EGRESS_LOG as one JSON line;
// `control-solopilot doctor` reports the count.
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'

const LOG = process.env.SOLOPILOT_EGRESS_LOG
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function record(kind, target) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), kind, target: String(target).slice(0, 300) }) + '\n')
}
function hostOf(input) {
  try {
    if (typeof input === 'string') return new URL(input).hostname
    if (input instanceof URL) return input.hostname
    if (input && typeof input.url === 'string') return new URL(input.url).hostname
    if (input && (input.hostname || input.host)) return String(input.hostname || input.host).split(':')[0]
  } catch {}
  return ''
}

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const host = hostOf(input)
  if (host && !LOCAL.has(host)) {
    record('fetch', typeof input === 'string' ? input : input?.url ?? host)
    throw new TypeError(`egress blocked by verification harness: ${host}`)
  }
  return realFetch(input, init)
}

for (const mod of [http, https]) {
  for (const fn of ['request', 'get']) {
    const real = mod[fn]
    mod[fn] = function (...args) {
      const host = hostOf(args[0])
      if (host && !LOCAL.has(host)) {
        record(`${mod === https ? 'https' : 'http'}.${fn}`, host)
        throw new Error(`egress blocked by verification harness: ${host}`)
      }
      return real.apply(this, args)
    }
  }
}
