'use strict'

const NullProtoObj = require('null-prototype-object')
const FindMyWay = require('find-my-way')

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
  'connect'
]

const SLASH_CHAR_CODE = 47
const QUESTION_MARK_CHAR_CODE = 63
const HASH_CHAR_CODE = 35
const SEMICOLON_CHAR_CODE = 59
const SYNC_ITERATION_LIMIT = 100

const EMPTY_HANDLERS = []

const identity = value => value

const earlierIndex = (a, b) => (a === -1 ? b : b === -1 || a < b ? a : b)

const requiredFinalHandler = () => {
  throw new TypeError('You should to provide a final handler')
}

const ensureLeadingSlash = route =>
  route.charCodeAt(0) === SLASH_CHAR_CODE ? route : `/${route}`

// An empty first segment (`//admin`) must still bucket to `/` for both mounts
// and request paths; returning the whole path would put them in separate
// buckets that never meet.
const getFirstPathSegment = pathname => {
  const secondSlashIndex = pathname.indexOf('/', 1)
  return secondSlashIndex === -1
    ? pathname
    : pathname.substring(0, secondSlashIndex)
}

const normalizeMountPath = path => {
  const withSlash = ensureLeadingSlash(path)
  let end = withSlash.length
  while (end > 1 && withSlash.charCodeAt(end - 1) === SLASH_CHAR_CODE) {
    end--
  }
  return end === withSlash.length ? withSlash : withSlash.substring(0, end)
}

// decodeURI (not decodeURIComponent): leave %2F encoded so it cannot invent
// path segments and desync mount match from raw segment stripping.
// Differs from find-my-way's safeDecodeURI on %25, which it re-encodes to
// survive decoding. Unreachable: find-my-way matches no route whose path
// contains %25, so no route under such a mount can run either.
const decodePathname = pathname => {
  if (pathname.indexOf('%') === -1) return pathname
  try {
    return decodeURI(pathname)
  } catch {
    return pathname
  }
}

const countSegments = mountPath => {
  let count = 0
  for (let i = 0; i < mountPath.length; i++) {
    if (mountPath.charCodeAt(i) === SLASH_CHAR_CODE) count++
  }
  return count
}

// RFC 7230 §5.3.2 absolute-form targets; same rewrite find-my-way applies.
const ABSOLUTE_FORM_REGEXP = /^https?:\/\/.*?\//

const toOriginForm = pathname =>
  pathname.charCodeAt(0) === SLASH_CHAR_CODE
    ? pathname
    : pathname.replace(ABSOLUTE_FORM_REGEXP, '/')

module.exports = (finalhandler = requiredFinalHandler(), options = {}) => {
  const router = FindMyWay({
    ...options,
    defaultRoute: (req, res) => finalhandler(undefined, req, res)
  })

  // Mirror find-my-way lookup normalization so .use() mounts cannot be skipped
  // after the router still matches a route (auth bypass).
  const caseSensitive =
    options.caseSensitive === undefined ? true : options.caseSensitive
  // find-my-way lowercases stored routes on `!caseSensitive` but lowercases the
  // lookup path on `caseSensitive === false`; mirror each side separately.
  const lowercaseMountPath = !caseSensitive
  const lowercaseLookupPath = caseSensitive === false
  const ignoreDuplicateSlashes = !!options.ignoreDuplicateSlashes
  const useSemicolonDelimiter = !!options.useSemicolonDelimiter

  const ignoreTrailingSlash = !!options.ignoreTrailingSlash

  const collapseSlashes = ignoreDuplicateSlashes
    ? FindMyWay.removeDuplicateSlashes
    : identity
  const trimTrailingSlash = ignoreTrailingSlash
    ? FindMyWay.trimLastSlash
    : identity
  const normalizePath = path => trimTrailingSlash(collapseSlashes(path))

  // The two sides of the mirror: a mount key that is not derived the same way
  // as the lookup key stops matching a route find-my-way still resolves.
  const normalizeMountKey = lowercaseMountPath
    ? path => normalizeMountPath(collapseSlashes(path)).toLowerCase()
    : path => normalizeMountPath(collapseSlashes(path))

  const normalizeLookupKey = lowercaseLookupPath
    ? pathname => decodePathname(pathname).toLowerCase()
    : decodePathname

  // The path ends at the first `?`, `#`, or (opt-in) `;`, exactly where
  // find-my-way's safeDecodeURI stops. Normalization applies to that half
  // only: collapsing slashes in the query would rewrite `https://` targets.
  const parseUrl = url => {
    const originForm = toOriginForm(url)
    const questionIndex = originForm.indexOf('?', 1)
    const hashIndex = originForm.indexOf('#', 1)

    let delimiterIndex = earlierIndex(questionIndex, hashIndex)
    if (useSemicolonDelimiter) {
      delimiterIndex = earlierIndex(delimiterIndex, originForm.indexOf(';', 1))
    }

    const path = normalizePath(
      delimiterIndex === -1 ? originForm : originForm.substring(0, delimiterIndex)
    )

    // The query is what sits between `?` and `#`. A `?` after a `#` is
    // fragment content, and a `#` after a `?` ends the query.
    const hasQuery =
      questionIndex !== -1 && (hashIndex === -1 || questionIndex < hashIndex)
    const search = hasQuery
      ? originForm.substring(
        questionIndex,
        hashIndex === -1 ? originForm.length : hashIndex
      )
      : null

    return {
      path,
      query: search === null ? null : search.substring(1),
      search
    }
  }

  const isPathEnd = charCode =>
    charCode === QUESTION_MARK_CHAR_CODE ||
    charCode === HASH_CHAR_CODE ||
    (charCode === SEMICOLON_CHAR_CODE && useSemicolonDelimiter)

  // Where a mount's segments end. The raw url and the normalized path are
  // walked by this one function so they cannot disagree: `//` is a run to skip
  // only when the path it is compared against had its slashes collapsed too.
  const getSegmentEnd = (value, segmentCount) => {
    const length = value.length
    let count = 0
    let i = 0

    while (i < length) {
      if (ignoreDuplicateSlashes) {
        while (i < length && value.charCodeAt(i) === SLASH_CHAR_CODE) i++
      } else if (value.charCodeAt(i) === SLASH_CHAR_CODE) {
        i++
      }

      while (i < length) {
        const charCode = value.charCodeAt(i)
        if (charCode === SLASH_CHAR_CODE) break
        if (isPathEnd(charCode)) return i
        i++
      }

      if (++count === segmentCount) return i
    }

    return length
  }

  const globalMiddlewares = []
  const middlewaresByPath = new NullProtoObj()
  // First decoded segment → mounts under that segment, in registration order.
  const mountsByFirstSegment = new NullProtoObj()
  const EMPTY_MOUNTS = []
  let pathMountCount = 0

  // Every mount that prefixes the path, not just the longest: each one gets its
  // own frame, the way Express runs every matching `app.use` layer.
  const matchMounts = pathname => {
    if (pathMountCount === 0) return EMPTY_MOUNTS

    const decoded = normalizeLookupKey(pathname)
    const candidates = mountsByFirstSegment[getFirstPathSegment(decoded)]
    if (candidates === undefined) return EMPTY_MOUNTS

    // One match is the common case and reuses the mount's own single-element
    // array, so matching allocates nothing until mounts actually overlap.
    let first
    let matched
    for (let i = 0; i < candidates.length; i++) {
      const mountPath = candidates[i].path
      const mountLen = mountPath.length
      if (
        decoded === mountPath ||
        (decoded.length > mountLen &&
          decoded.charCodeAt(mountLen) === SLASH_CHAR_CODE &&
          decoded.startsWith(mountPath))
      ) {
        if (first === undefined) first = candidates[i]
        else {
          if (matched === undefined) matched = [first]
          matched.push(candidates[i])
        }
      }
    }

    if (matched !== undefined) return matched
    return first === undefined ? EMPTY_MOUNTS : first.solo
  }

  const findRoute = (method, path, constraints) => {
    const result = router.find(method, path, constraints)
    if (result === null) return { params: {}, handlers: EMPTY_HANDLERS }
    // onBadUrl / onMaxParamLength are plain find-my-way handlers without
    // our `.handlers` wrapper; run them as a single middleware.
    const wrapped = result.handler.handlers
    return {
      params: result.params,
      handlers: wrapped === undefined ? [result.handler] : wrapped
    }
  }

  const registerRoute = (method, path, handlers) => {
    const routeHandler = () => {}
    routeHandler.handlers = handlers
    router.on(method, path, routeHandler)
  }

  const addRoute = (method, path, ...handlers) => {
    const fns = handlers.flat().filter(Boolean)
    if (fns.length === 0) return handler

    const methods = method === '' ? HTTP_METHODS : [method]

    for (let i = 0; i < methods.length; i++) {
      registerRoute(methods[i].toUpperCase(), path, fns)
    }

    return handler
  }

  const handler = (req, res, next) => {
    const urlInfo = parseUrl(req.url)
    const pathname = urlInfo.path

    req.path = pathname
    if (req.originalUrl === undefined) req.originalUrl = req.url

    let route = findRoute(req.method, pathname)

    if (route.handlers.length === 0 && req.method === 'HEAD') {
      route = findRoute('GET', pathname)
    }

    const mounts = matchMounts(pathname)
    const mountCount = mounts.length
    const routeHandlers = route.handlers

    if (routeHandlers.length > 0) {
      req.params =
        req.params !== undefined
          ? { ...req.params, ...route.params }
          : route.params
    } else {
      req.params = req.params || {}
    }

    // Falsy rather than undefined: an outer router that parsed a url with no
    // query stores null, and a handler may rewrite req.url before delegating.
    req.search = req.search || req.query || urlInfo.search
    req.query = req.query || urlInfo.query

    const entryUrl = req.url
    const entryBaseUrl = req.baseUrl === undefined ? '' : req.baseUrl

    const originUrl = mountCount > 0 ? toOriginForm(entryUrl) : entryUrl

    let syncCount = 0
    let stage = 0
    let cursor = 0
    let current = globalMiddlewares

    // Both exits abandon the remaining middleware and undo the frame, so the
    // parent router and the error handler see what the client actually sent.
    const handleNext = err => {
      if (err !== undefined) {
        stage = mountCount + 1
        cursor = 0
        current = EMPTY_HANDLERS
        if (mountCount > 0) {
          req.url = entryUrl
          req.path = pathname
          req.baseUrl = entryBaseUrl
        }
        if (err !== 'router') return finalhandler(err, req, res, next)
        if (next !== undefined) return next()
        return executeLoop()
      }
      if (++syncCount > SYNC_ITERATION_LIMIT) {
        syncCount = 0
        return setImmediate(executeLoop)
      }
      executeLoop()
    }

    // stage 0 is the global list, 1..mountCount are the mount frames, and
    // mountCount + 1 is the route, which runs on the unstripped request. A
    // mount sees the request rooted at itself; every frame is measured from
    // the entry values, so mounts stay independent of each other.
    const executeLoop = () => {
      if (res.writableEnded) return

      while (cursor >= current.length) {
        stage++
        cursor = 0

        if (stage <= mountCount) {
          const mount = mounts[stage - 1]
          const segments = mount.segments
          const urlPrefixEnd = getSegmentEnd(originUrl, segments)
          const prefix = originUrl.substring(0, urlPrefixEnd)
          req.baseUrl = entryBaseUrl === '' ? prefix : entryBaseUrl + prefix
          req.url = ensureLeadingSlash(originUrl.substring(urlPrefixEnd))
          req.path =
            pathname.substring(getSegmentEnd(pathname, segments)) || '/'
          current = mount.mw
        } else if (stage === mountCount + 1) {
          if (mountCount > 0) {
            req.url = entryUrl
            req.path = pathname
            req.baseUrl = entryBaseUrl
          }
          current = routeHandlers
        } else {
          if (next !== undefined) return next()
          return finalhandler(undefined, req, res, handleNext)
        }
      }

      const middleware = current[cursor++]

      try {
        const result = middleware(req, res, handleNext)
        if (
          result !== null &&
          result !== undefined &&
          typeof result.then === 'function'
        ) {
          result.then(undefined, handleNext)
        }
      } catch (err) {
        handleNext(err)
      }
    }

    executeLoop()
  }

  handler.use = (path = '/', ...fns) => {
    if (typeof path === 'function' || typeof path === 'boolean') {
      const middlewares = [path, ...fns].filter(Boolean)
      for (let i = 0; i < middlewares.length; i++) {
        globalMiddlewares.push(middlewares[i])
      }
      return handler
    }

    // Normalize before deciding: `//` and `/` are the same mount, and only a
    // mount that is not the root can strip a prefix.
    const normalizedPath = normalizeMountKey(path)

    if (normalizedPath === '/') {
      const middlewares = fns.filter(Boolean)
      for (let i = 0; i < middlewares.length; i++) {
        globalMiddlewares.push(middlewares[i])
      }
    } else {
      const middlewares = fns.filter(Boolean)

      if (middlewares.length > 0) {
        let pathMiddlewares = middlewaresByPath[normalizedPath]

        if (pathMiddlewares === undefined) {
          pathMiddlewares = []
          middlewaresByPath[normalizedPath] = pathMiddlewares
          pathMountCount++

          const segment = getFirstPathSegment(normalizedPath)
          let candidates = mountsByFirstSegment[segment]
          if (candidates === undefined) {
            candidates = []
            mountsByFirstSegment[segment] = candidates
          }
          // Registration order, the order Express runs its layers in. Segment
          // count rather than key length: a lowercased or percent-encoded
          // request differs in bytes from the key it matched.
          const mount = {
            path: normalizedPath,
            segments: countSegments(normalizedPath),
            mw: pathMiddlewares,
            solo: null
          }
          mount.solo = [mount]
          candidates.push(mount)
        }

        for (let i = 0; i < middlewares.length; i++) {
          pathMiddlewares.push(middlewares[i])
        }
      }
    }
    return handler
  }

  handler.all = addRoute.bind(null, '')

  for (let i = 0; i < HTTP_METHODS.length; i++) {
    const method = HTTP_METHODS[i]
    handler[method] = addRoute.bind(null, method)
  }

  handler.prettyPrint = (...args) => router.prettyPrint(...args)

  Object.defineProperty(handler, 'routes', {
    get: () => router.routes,
    enumerable: true
  })

  return handler
}
