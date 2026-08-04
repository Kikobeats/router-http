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

const getFirstPathSegment = pathname => {
  const secondSlashIndex = pathname.indexOf('/', 1)
  return secondSlashIndex > 1
    ? pathname.substring(0, secondSlashIndex)
    : pathname
}

const normalizeMountPath = path => {
  const withSlash = ensureLeadingSlash(path)
  let end = withSlash.length
  while (end > 1 && withSlash.charCodeAt(end - 1) === SLASH_CHAR_CODE) {
    end--
  }
  return end === withSlash.length ? withSlash : withSlash.substring(0, end)
}

// Skip decodeURIComponent on the common unescaped path (no try/catch either).
const decodePathname = pathname => {
  if (pathname.indexOf('%') === -1) return pathname
  try {
    return decodeURIComponent(pathname)
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

const parseUrl = ({ url }) => {
  const queryIndex = url.indexOf('?', 1)
  if (queryIndex === -1) {
    return { pathname: url, query: null, search: null }
  }
  const search = url.substring(queryIndex)
  return {
    pathname: url.substring(0, queryIndex),
    query: search.substring(1),
    search
  }
}

const QUESTION_MARK_CHAR_CODE = 63

const mutateRequestUrl = (prefix, req) => {
  const remainingUrl = req.url.substring(prefix.length)
  req.url = !remainingUrl || remainingUrl.charCodeAt(0) === QUESTION_MARK_CHAR_CODE
    ? `/${remainingUrl}`
    : remainingUrl
  const remainingPath = req.path.substring(prefix.length)
  req.path = remainingPath || '/'
}

module.exports = (finalhandler = requiredFinalHandler(), options = {}) => {
  const router = FindMyWay({
    ...options,
    defaultRoute: (req, res) => finalhandler(undefined, req, res)
  })

  const globalMiddlewares = []
  const middlewaresByPath = new NullProtoObj()
  // First decoded segment → mounts under that segment, longest path first.
  const mountsByFirstSegment = new NullProtoObj()
  let pathMountCount = 0

  const matchPathMiddleware = pathname => {
    if (pathMountCount === 0) return undefined

    const decoded = decodePathname(pathname)
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
    return { params: result.params, handlers: result.handler.handlers }
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
    const urlInfo = parseUrl(req)
    const pathname = urlInfo.pathname
    req.path = pathname

    let route = findRoute(req.method, pathname)

    if (route.handlers.length === 0 && req.method === 'HEAD') {
      route = findRoute('GET', pathname)
    }

    const globalMw = globalMiddlewares
    const pathMw = matchPathMiddleware(pathname)
    const routeHandlers = route.handlers.length > 0 ? route.handlers : null

    if (routeHandlers !== null) {
      req.params =
        req.params !== undefined
          ? { ...req.params, ...route.params }
          : route.params
    } else {
      req.params = req.params || {}
    }

    req.search = req.query || urlInfo.search
    req.query = req.query || urlInfo.query

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
      const normalizedPath = normalizeMountPath(path)
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
            mutateRequestUrl(
              reqPath.indexOf('%') === -1
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
