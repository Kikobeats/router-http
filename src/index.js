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

const ALL_METHODS = HTTP_METHODS.map(method => method.toUpperCase())

const SLASH_CHAR_CODE = 47
const QUESTION_MARK_CHAR_CODE = 63
const HASH_CHAR_CODE = 35
const SEMICOLON_CHAR_CODE = 59
const SYNC_ITERATION_LIMIT = 100

const EMPTY_HANDLERS = []
const EMPTY_MOUNTS = []

const identity = value => value

const earlierIndex = (a, b) => (a === -1 ? b : b === -1 || a < b ? a : b)

const requiredFinalHandler = () => {
  throw new TypeError('You should to provide a final handler')
}

const ensureLeadingSlash = route =>
  route.charCodeAt(0) === SLASH_CHAR_CODE ? route : `/${route}`

// Mounts bucket by first decoded segment. An empty first segment (`//admin`)
// must still bucket to `/` for both mounts and request paths; returning the
// whole path would put them in separate buckets that never meet.
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
  return withSlash.substring(0, end)
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
  // First decoded segment -> mounts under it, in registration order. The index
  // earns its keep at scale: scanning every mount instead measured +12.8% at 8
  // mounts and +223% at 128, against a request hitting the last one.
  const mountsByFirstSegment = new NullProtoObj()
  // Deriving the bucket key costs a substring and a cold hash, which is the
  // whole cost the scan was avoiding. While every mount shares one first
  // segment there is nothing to discriminate, so skip it and scan that bucket.
  let soleBucket = null
  // The most recently registered mount, for the consecutive-same-path case.
  let lastMount = null
  let mountCount = 0

  // Every mount that prefixes the path, not just the longest: each one gets its
  // own frame, the way Express runs every matching `app.use` layer.
  const matchMounts = pathname => {
    if (mountCount === 0) return EMPTY_MOUNTS

    const decoded = normalizeLookupKey(pathname)
    const mounts =
      soleBucket !== null
        ? soleBucket
        : mountsByFirstSegment[getFirstPathSegment(decoded)]
    if (mounts === undefined) return EMPTY_MOUNTS

    // One match is the common case and reuses the mount's own single-element
    // array, so matching allocates nothing until mounts actually overlap.
    let first
    let matched
    for (let i = 0; i < mounts.length; i++) {
      const mountPath = mounts[i].path
      const mountLen = mountPath.length
      if (
        decoded === mountPath ||
        (decoded.length > mountLen &&
          decoded.charCodeAt(mountLen) === SLASH_CHAR_CODE &&
          decoded.startsWith(mountPath))
      ) {
        if (first === undefined) first = mounts[i]
        else {
          if (matched === undefined) matched = [first]
          matched.push(mounts[i])
        }
      }
    }

    if (matched !== undefined) return matched
    return first === undefined ? EMPTY_MOUNTS : first.solo
  }

  const addRoute = (methods, path, ...handlers) => {
    const fns = handlers.flat().filter(Boolean)
    if (fns.length === 0) return handler

    const routeHandler = () => {}
    routeHandler.handlers = fns
    router.on(methods, path, routeHandler)

    return handler
  }

  const handler = (req, res, next) => {
    const urlInfo = parseUrl(req.url)
    const pathname = urlInfo.path

    req.path = pathname
    if (req.originalUrl === undefined) req.originalUrl = req.url

    let match = router.find(req.method, pathname)
    if (match === null && req.method === 'HEAD') {
      match = router.find('GET', pathname)
    }

    const matchedMounts = matchMounts(pathname)
    const matchedCount = matchedMounts.length
    let routeHandlers = EMPTY_HANDLERS

    if (match !== null) {
      // onBadUrl / onMaxParamLength are plain find-my-way handlers without our
      // `.handlers` wrapper; run them as a single middleware.
      const wrapped = match.handler.handlers
      routeHandlers = wrapped === undefined ? [match.handler] : wrapped
      req.params =
        req.params !== undefined
          ? { ...req.params, ...match.params }
          : match.params
    } else {
      req.params = req.params || {}
    }

    // One decision for the pair, not two: setting them independently lets a
    // caller who supplied only one end up with the other describing a
    // different query string. Falsy rather than undefined, because an outer
    // router that parsed a url with no query stores null, and a handler may
    // rewrite req.url before delegating.
    if (!req.query && !req.search) {
      req.query = urlInfo.query
      req.search = urlInfo.search
    }

    const entryUrl = req.url
    const entryBaseUrl = req.baseUrl === undefined ? '' : req.baseUrl
    req.baseUrl = entryBaseUrl

    // What the frame removed, so leaving it can put it back rather than
    // reinstating a snapshot and discarding whatever middleware wrote since.
    let framePrefix = ''
    let frameUrl = ''
    let frameSourceUrl = entryUrl
    let frameSourcePath = pathname

    const globalCount = globalMiddlewares.length

    let syncCount = 0
    let mountIndex = 0
    let globalIndex = 0
    let routeStarted = false
    let frameEntered = false
    let current = EMPTY_HANDLERS
    let cursor = 0
    let limit = 0

    const leaveFrame = () => {
      frameEntered = false
      req.baseUrl = entryBaseUrl
      if (req.url === frameUrl) {
        req.url = frameSourceUrl
        req.path = frameSourcePath
        return
      }
      // A middleware rewrote the url inside the frame. Express re-prepends
      // what it removed, so the edit survives instead of being reverted.
      req.url = framePrefix + (req.url === '/' ? '' : req.url)
      req.path = parseUrl(req.url).path
    }

    // Both exits abandon the remaining middleware and undo the frame, so the
    // parent router and the error handler see what the client actually sent.
    // Truthiness, not `!== undefined`: `next(null)` is the ordinary callback
    // idiom for success and must not be read as a failure.
    const handleNext = err => {
      if (err) {
        // 'route' abandons the rest of the current layer only.
        // Express only lets 'route' skip a route's own handler stack; from
        // middleware it continues to the next layer like a plain next().
        if (err === 'route') {
          if (routeStarted) cursor = limit
          return executeLoop()
        }
        mountIndex = matchedCount
        globalIndex = globalCount
        routeStarted = true
        cursor = 0
        limit = 0
        if (frameEntered) leaveFrame()
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

    // Globals and mount frames interleave by registration order, which is what
    // `globalsBefore` records. Only a mount runs on a stripped request, so
    // every other layer restores first: a global sitting between two mounts
    // belongs to the router, not to whichever frame happened to precede it.
    const executeLoop = () => {
      if (res.writableEnded) return

      while (cursor >= limit) {
        if (
          mountIndex < matchedCount &&
          globalIndex >= matchedMounts[mountIndex].globalsBefore
        ) {
          // Leave the previous frame first: each mount strips its prefix off
          // the whole request, not off what the mount before it left behind.
          if (frameEntered) leaveFrame()
          const mount = matchedMounts[mountIndex++]
          const segments = mount.segments
          // Derived from the url as it stands, not from a request-entry
          // snapshot: an earlier middleware may have rewritten it, and the
          // frame has to strip the prefix off what is actually there.
          frameSourceUrl = req.url
          frameSourcePath = req.path
          const originUrl = toOriginForm(frameSourceUrl)
          const urlPrefixEnd = getSegmentEnd(originUrl, segments)
          framePrefix = originUrl.substring(0, urlPrefixEnd)
          req.baseUrl = entryBaseUrl + framePrefix
          req.url = ensureLeadingSlash(originUrl.substring(urlPrefixEnd))
          frameUrl = req.url
          // Without collapsing, the path is the url's path half and both walks
          // stop at the same delimiter, so the second one is derivable.
          const pathPrefixEnd = ignoreDuplicateSlashes
            ? getSegmentEnd(frameSourcePath, segments)
            : urlPrefixEnd < frameSourcePath.length
              ? urlPrefixEnd
              : frameSourcePath.length
          req.path = frameSourcePath.substring(pathPrefixEnd) || '/'
          frameEntered = true
          current = mount.mw
          cursor = 0
          limit = mount.mw.length
          continue
        }

        if (globalIndex < globalCount) {
          if (frameEntered) leaveFrame()
          current = globalMiddlewares
          cursor = globalIndex
          globalIndex =
            mountIndex < matchedCount
              ? matchedMounts[mountIndex].globalsBefore
              : globalCount
          limit = globalIndex
          continue
        }

        if (!routeStarted) {
          routeStarted = true
          if (frameEntered) leaveFrame()
          current = routeHandlers
          cursor = 0
          limit = routeHandlers.length
          continue
        }

        if (next !== undefined) return next()
        return finalhandler(undefined, req, res, handleNext)
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

  // Segment count rather than key length: a lowercased or percent-encoded
  // request differs in bytes from the key it matched.
  const registerMount = mountPath => {
    const segment = getFirstPathSegment(mountPath)
    let bucket = mountsByFirstSegment[segment]
    if (bucket === undefined) {
      bucket = []
      mountsByFirstSegment[segment] = bucket
      soleBucket = mountCount === 0 ? bucket : null
    }

    // One layer per `.use()` call rather than one per distinct path: appending
    // to an earlier layer would run this middleware at that layer's position,
    // ahead of anything registered in between.
    // Consecutive registrations of the same path have nothing in between to
    // jump ahead of, so they still share a layer and keep matching allocation-free.
    if (
      lastMount !== null &&
      lastMount.path === mountPath &&
      lastMount.globalsBefore === globalMiddlewares.length
    ) {
      return lastMount.mw
    }

    const mount = {
      path: mountPath,
      segments: countSegments(mountPath),
      globalsBefore: globalMiddlewares.length,
      mw: [],
      solo: null
    }
    // Preallocated so a single match, the common case, allocates nothing.
    mount.solo = [mount]
    bucket.push(mount)
    lastMount = mount
    mountCount++

    return mount.mw
  }

  handler.use = (path = '/', ...fns) => {
    const pathIsMiddleware = typeof path !== 'string'
    const middlewares = (pathIsMiddleware ? [path, ...fns] : fns).filter(Boolean)
    if (middlewares.length === 0) return handler

    // Normalize before deciding: `//` and `/` are the same mount, and only a
    // mount that is not the root can strip a prefix.
    const mountPath = pathIsMiddleware ? '/' : normalizeMountKey(path)
    const target =
      mountPath === '/' ? globalMiddlewares : registerMount(mountPath)

    for (let i = 0; i < middlewares.length; i++) {
      target.push(middlewares[i])
    }

    return handler
  }

  handler.all = addRoute.bind(null, ALL_METHODS)

  for (let i = 0; i < HTTP_METHODS.length; i++) {
    handler[HTTP_METHODS[i]] = addRoute.bind(null, [ALL_METHODS[i]])
  }

  handler.prettyPrint = router.prettyPrint.bind(router)

  Object.defineProperty(handler, 'routes', {
    get: () => router.routes,
    enumerable: true
  })

  return handler
}
