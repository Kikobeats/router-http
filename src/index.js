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
const SYNC_ITERATION_LIMIT = 100

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

// Encoded mounts differ in byte length from the registered path; take N raw segments.
const getRawMountPrefix = (pathname, segmentCount) => {
  let count = 0
  let i = 1
  while (i < pathname.length) {
    const next = pathname.indexOf('/', i)
    count++
    if (count === segmentCount) {
      return next === -1 ? pathname : pathname.substring(0, next)
    }
    if (next === -1) return pathname
    i = next + 1
  }
  return pathname
}

const QUESTION_MARK_CHAR_CODE = 63
const HASH_CHAR_CODE = 35
const SEMICOLON_CHAR_CODE = 59

// RFC 7230 §5.3.2 absolute-form targets; same rewrite find-my-way applies.
const ABSOLUTE_FORM_REGEXP = /^https?:\/\/.*?\//

const toOriginForm = pathname =>
  pathname.charCodeAt(0) === SLASH_CHAR_CODE
    ? pathname
    : pathname.replace(ABSOLUTE_FORM_REGEXP, '/')

const mutateRequestUrl = (prefix, req) => {
  const remainingUrl = req.url.substring(prefix.length)
  req.url =
    remainingUrl.charCodeAt(0) === SLASH_CHAR_CODE
      ? remainingUrl
      : `/${remainingUrl}`
  const remainingPath = req.path.substring(prefix.length)
  req.path = remainingPath || '/'
}

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

  // Same single scan find-my-way's safeDecodeURI runs: the path ends at the
  // first of these, so query and path can never disagree on where it stops.
  const findPathDelimiter = urlPath => {
    for (let i = 1; i < urlPath.length; i++) {
      const charCode = urlPath.charCodeAt(i)
      if (
        charCode === QUESTION_MARK_CHAR_CODE ||
        charCode === HASH_CHAR_CODE ||
        (charCode === SEMICOLON_CHAR_CODE && useSemicolonDelimiter)
      ) {
        return i
      }
    }
    return -1
  }

  const trimTrailingSlash = path =>
    ignoreTrailingSlash ? FindMyWay.trimLastSlash(path) : path

  const parseUrl = url => {
    const originForm = toOriginForm(url)
    const urlPath = ignoreDuplicateSlashes
      ? FindMyWay.removeDuplicateSlashes(originForm)
      : originForm

    const delimiterIndex = findPathDelimiter(urlPath)
    if (delimiterIndex === -1) {
      return { path: trimTrailingSlash(urlPath), urlPath, query: null, search: null }
    }

    const search = urlPath.substring(delimiterIndex)
    return {
      path: trimTrailingSlash(urlPath.substring(0, delimiterIndex)),
      urlPath,
      query: search.substring(1),
      search
    }
  }

  const globalMiddlewares = []
  const middlewaresByPath = new NullProtoObj()
  // First decoded segment → mounts under that segment, longest path first.
  const mountsByFirstSegment = new NullProtoObj()
  let pathMountCount = 0

  const matchPathMiddleware = pathname => {
    if (pathMountCount === 0) return undefined

    let decoded = decodePathname(pathname)
    if (lowercaseLookupPath) decoded = decoded.toLowerCase()
    const candidates = mountsByFirstSegment[getFirstPathSegment(decoded)]
    if (candidates === undefined) return undefined

    for (let i = 0; i < candidates.length; i++) {
      const mountPath = candidates[i].path
      const mountLen = mountPath.length
      if (
        decoded === mountPath ||
        (decoded.length > mountLen &&
          decoded.charCodeAt(mountLen) === SLASH_CHAR_CODE &&
          decoded.startsWith(mountPath))
      ) {
        return candidates[i].mw
      }
    }
    return undefined
  }

  const findRoute = (method, path, constraints) => {
    const result = router.find(method, path, constraints)
    if (result === null) {
      return { params: {}, handlers: [] }
    }
    // onBadUrl / onMaxParamLength are plain find-my-way handlers without
    // our `.handlers` wrapper; run them as a single middleware.
    const wrapped = result.handler.handlers
    if (wrapped === undefined) {
      return { params: result.params, handlers: [result.handler] }
    }
    return { params: result.params, handlers: wrapped }
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

  const selectMiddleware = (
    index,
    globalLen,
    pathLen,
    globalMw,
    pathMw,
    routeHandlers
  ) => {
    if (index < globalLen) return globalMw[index]
    if (index < globalLen + pathLen) return pathMw[index - globalLen]
    return routeHandlers[index - globalLen - pathLen]
  }

  const handler = (req, res, next) => {
    const urlInfo = parseUrl(req.url)
    const pathname = urlInfo.path

    req.path = pathname

    let route = findRoute(req.method, pathname)

    if (route.handlers.length === 0 && req.method === 'HEAD') {
      route = findRoute('GET', pathname)
    }

    const globalMw = globalMiddlewares
    const pathMw = matchPathMiddleware(pathname)
    const routeHandlers = route.handlers.length > 0 ? route.handlers : null

    // Only the mount middleware strips a prefix off req.url, so only it needs
    // req.url realigned with the normalized path. Rewriting unconditionally
    // would hand a rewritten url to a parent router we never matched for.
    if (pathMw !== undefined && urlInfo.urlPath !== req.url) {
      req.url = urlInfo.urlPath
    }

    if (routeHandlers !== null) {
      req.params =
        req.params !== undefined
          ? { ...req.params, ...route.params }
          : route.params
    } else {
      req.params = req.params || {}
    }

    if (req.search === undefined) req.search = req.query || urlInfo.search
    if (req.query === undefined) req.query = urlInfo.query

    let index = 0
    let syncCount = 0

    const globalLen = globalMw.length
    const pathLen = pathMw !== undefined ? pathMw.length : 0
    const routeLen = routeHandlers !== null ? routeHandlers.length : 0
    const totalMiddlewares = globalLen + pathLen + routeLen

    const handleNext = err => {
      if (err === 'router') {
        if (next !== undefined) return next()
        index = totalMiddlewares
        err = undefined
      }
      if (err !== undefined) return finalhandler(err, req, res, next)
      if (++syncCount > SYNC_ITERATION_LIMIT) {
        syncCount = 0
        return setImmediate(executeLoop)
      }
      executeLoop()
    }

    const executeLoop = () => {
      if (index < totalMiddlewares) {
        if (res.writableEnded) return

        const currentIndex = index++
        const middleware = selectMiddleware(
          currentIndex,
          globalLen,
          pathLen,
          globalMw,
          pathMw,
          routeHandlers
        )

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
        return
      }

      if (res.writableEnded) return
      if (next !== undefined) return next()
      finalhandler(undefined, req, res, handleNext)
    }

    executeLoop()
  }

  handler.use = (path = '/', ...fns) => {
    if (typeof path === 'function' || typeof path === 'boolean') {
      const middlewares = [path, ...fns].filter(Boolean)
      for (let i = 0; i < middlewares.length; i++) {
        globalMiddlewares.push(middlewares[i])
      }
    } else if (path === '/') {
      const middlewares = fns.filter(Boolean)
      for (let i = 0; i < middlewares.length; i++) {
        globalMiddlewares.push(middlewares[i])
      }
    } else {
      // Mirror find-my-way's `on` normalization, the registration-side twin of
      // the lookup normalization in parseUrl: a mount it does not collapse the
      // same way stops matching a route find-my-way still resolves.
      let normalizedPath = normalizeMountPath(
        ignoreDuplicateSlashes ? FindMyWay.removeDuplicateSlashes(path) : path
      )
      if (lowercaseMountPath) normalizedPath = normalizedPath.toLowerCase()
      const middlewares = fns.filter(Boolean)

      if (middlewares.length > 0) {
        let pathMiddlewares = middlewaresByPath[normalizedPath]

        if (pathMiddlewares === undefined) {
          pathMiddlewares = []
          let mountSegments = 1
          for (let i = 1; i < normalizedPath.length; i++) {
            if (normalizedPath.charCodeAt(i) === SLASH_CHAR_CODE) mountSegments++
          }
          pathMiddlewares.push((req, _, next) => {
            const reqPath = req.path
            // Case-insensitive mounts are stored lowercased; strip by segment
            // count so the raw request casing (and encodings) stay intact.
            mutateRequestUrl(
              !lowercaseMountPath && reqPath.indexOf('%') === -1
                ? normalizedPath
                : getRawMountPrefix(reqPath, mountSegments),
              req
            )
            next()
          })
          middlewaresByPath[normalizedPath] = pathMiddlewares
          pathMountCount++

          const segment = getFirstPathSegment(normalizedPath)
          let candidates = mountsByFirstSegment[segment]
          if (candidates === undefined) {
            candidates = []
            mountsByFirstSegment[segment] = candidates
          }
          candidates.push({ path: normalizedPath, mw: pathMiddlewares })
          if (candidates.length > 1) {
            candidates.sort((a, b) => b.path.length - a.path.length)
          }
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
