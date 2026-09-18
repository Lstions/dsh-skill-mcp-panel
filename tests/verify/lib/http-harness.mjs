/**
 * A minimal WebServer stand-in that records the handlers the plugin registers,
 * so cases can invoke the REAL handlers with REAL request objects.
 *
 * This is deliberately not a copy of dsh-host-webserver's routing: it only has
 * to satisfy the `register({kind, path, handler})` contract, and the case
 * asserts on what the handler does with a request, not on how routing works.
 */

/** One fake request/response pair. */
export function makeRequest({ method = 'GET', host, origin, contentType, body = '' }) {
  const headers = {}
  if (host !== undefined) headers.host = host
  if (origin !== undefined) headers.origin = origin
  if (contentType !== undefined) headers['content-type'] = contentType
  if (body !== '') headers['content-length'] = String(Buffer.byteLength(body))

  const chunks = body === '' ? [] : [Buffer.from(body)]
  const req = {
    method,
    url: '/',
    headers,
    socket: { remoteAddress: '127.0.0.1', encrypted: false },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  // Some handlers use the event style instead of the async iterator.
  req.on = (event, handler) => {
    if (event === 'data') for (const chunk of chunks) handler(chunk)
    if (event === 'end') handler()
    return req
  }

  const res = {
    statusCode: undefined,
    headers: {},
    capturedBody: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
      return this
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()]
    },
    writeHead(code, extra) {
      this.statusCode = code
      if (extra) for (const [k, v] of Object.entries(extra)) this.headers[k.toLowerCase()] = v
      return this
    },
    write(chunk) {
      this.capturedBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    },
    end(chunk) {
      if (chunk !== undefined) this.write(chunk)
      if (this.statusCode === undefined) this.statusCode = 200
      return this
    },
    on() {
      return this
    },
    once() {
      return this
    },
    emit() {
      return true
    },
  }
  return { req, res }
}

/** A webServer whose register() keeps handlers addressable by path. */
export function createWebServerHarness() {
  const handlers = {}
  const registrations = []
  const webServer = {
    register(route) {
      if (handlers[route.path] !== undefined) throw new Error(`duplicate route ${route.path}`)
      handlers[route.path] = route.handler
      registrations.push(route)
      return () => {
        delete handlers[route.path]
      }
    },
    registerUpgrade() {
      return () => {}
    },
    registerFallback() {
      return () => {}
    },
  }

  // A ctx that satisfies what an http module typically injects. `provide` is
  // used rather than a plain property because the real Cordis Context requires
  // a provider before a service is readable.
  const disposers = []
  const ctx = {
    webServer,
    logger: { info() {}, warn() {}, error() {} },
    effect(callback) {
      const disposer = callback()
      disposers.push(typeof disposer === 'function' ? disposer : () => {})
      return () => {}
    },
    on() {
      return () => {}
    },
    get(name) {
      return name === 'webServer' ? webServer : undefined
    },
    inject(names, callback) {
      if (Array.isArray(names) && names.includes('webServer')) callback(ctx)
    },
  }

  return {
    ctx,
    webServer,
    handlers,
    registrations,
    /** Resolve a registered handler by its contract path suffix. */
    handlerFor(suffix) {
      const key = Object.keys(handlers).find((path) => path === suffix || path.endsWith(suffix))
      return key === undefined ? undefined : handlers[key]
    },
  }
}