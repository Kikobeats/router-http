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

const mutateRequestUrl = (prefix, req) => {
  req.url = req.url.substring(prefix.length) || '/'
  req.path = req.path.substring(prefix.length) || '/'
}

module.exports = (finalhandler = requiredFinalHandler(), options = {}) => {
  const router = FindMyWay({
    ...options,
    defaultRoute: (req, res) => finalhandler(undefined, req, res)
  })

  const globalMiddlewares = []
  const middlewaresByPath = new NullProtoObj()

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

    const pathSegment = getFirstPathSegment(pathname)

    let route = findRoute(req.method, pathname)

    if (route.handlers.length === 0 && req.method === 'HEAD') {
      route = findRoute('GET', pathname)
    }

    const globalMw = globalMiddlewares
    const pathMw = middlewaresByPath[pathSegment]
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
      const normalizedPath = ensureLeadingSlash(path)
      const middlewares = fns.filter(Boolean)

      if (middlewares.length > 0) {
        let pathMiddlewares = middlewaresByPath[normalizedPath]

        if (pathMiddlewares === undefined) {
          pathMiddlewares = []
          pathMiddlewares.push((req, _, next) => {
            mutateRequestUrl(normalizedPath, req)
            next()
          })
          middlewaresByPath[normalizedPath] = pathMiddlewares
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

  handler.del = handler.delete

  handler.prettyPrint = (...args) => router.prettyPrint(...args)

  Object.defineProperty(handler, 'routes', {
    get: () => router.routes,
    enumerable: true
  })

  return handler
}
