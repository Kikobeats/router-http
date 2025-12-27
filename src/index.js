'use strict'

const NullProtoObj = require('null-prototype-object')
const FindMyWay = require('find-my-way')

const METHODS = [
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

const requiredFinalHandler = () => {
  throw new TypeError('You should to provide a final handler')
}

const lead = route => (route.charCodeAt(0) === 47 ? route : `/${route}`)

const value = x => {
  const y = x.indexOf('/', 1)
  return y > 1 ? x.substring(0, y) : x
}

const parse = ({ url }) => {
  const index = url.indexOf('?', 1)
  if (index === -1) return { pathname: url, query: null, search: null }
  const search = url.substring(index)
  return {
    pathname: url.substring(0, index),
    query: search.substring(1),
    search
  }
}

const mutate = (str, req) => {
  req.url = req.url.substring(str.length) || '/'
  req.path = req.path.substring(str.length) || '/'
}

module.exports = (finalhandler = requiredFinalHandler(), options = {}) => {
  const _router = FindMyWay({
    ...options,
    defaultRoute: (req, res) => finalhandler(undefined, req, res)
  })

  const middlewares = []
  const middlewaresBy = new NullProtoObj()

  const find = (method, path, constraints) => {
    const result = _router.find(method, path, constraints)
    if (!result) return { params: {}, handlers: [] }
    return {
      params: result.params,
      handlers: result.handler.handlers
    }
  }

  const _add = (m, path, handlers) => {
    const fn = () => {}
    fn.handlers = handlers
    _router.on(m, path, fn)
  }

  const add = (method, path, ...handlers) => {
    const fns = [].concat(...handlers).filter(Boolean)
    if (fns.length === 0) return handler

    const list = method === '' ? METHODS : [method]

    list.forEach(m => {
      _add(m.toUpperCase(), path, fns)
    })

    return handler
  }

  const handler = (req, res, next) => {
    const info = parse(req)
    const pathname = info.pathname
    req.path = pathname
    const page = value(pathname)

    let route = find(req.method, pathname)

    if (route.handlers.length === 0 && req.method === 'HEAD') {
      route = find('GET', pathname)
    }

    const m = middlewares
    const mb = middlewaresBy[page]
    const f = route.handlers.length > 0 ? route.handlers : null

    if (f) {
      req.params = req.params
        ? { ...req.params, ...route.params }
        : route.params
    } else {
      req.params = req.params || {}
    }

    req.search = req.query || info.search
    req.query = req.query || info.query

    let index = 0
    let sync = 0

    const mLen = m.length
    const mbLen = mb ? mb.length : 0
    const fLen = f ? f.length : 0
    const total = mLen + mbLen + fLen

    const _next = err => {
      if (err === 'router') {
        if (next) return next()
        index = total
        err = undefined
      }
      if (err) return finalhandler(err, req, res, next)
      if (++sync > 100) {
        sync = 0
        return setImmediate(loop)
      }
      loop()
    }

    const loop = () => {
      if (index < total) {
        if (res.writableEnded) return
        const i = index++
        const mware =
          i < mLen
            ? m[i]
            : i < mLen + mbLen
              ? mb[i - mLen]
              : f[i - mLen - mbLen]

        try {
          const result = mware(req, res, _next)
          if (result && typeof result.then === 'function') {
            return result.then(undefined, _next)
          }
        } catch (err) {
          return _next(err)
        }
        return
      }

      if (res.writableEnded) return
      if (next) return next()
      finalhandler(undefined, req, res, _next)
    }

    loop()
  }

  handler.use = (page = '/', ...fns) => {
    if (typeof page === 'function' || typeof page === 'boolean') {
      middlewares.push(...[page, ...fns].filter(Boolean))
    } else if (page === '/') {
      middlewares.push(...fns.filter(Boolean))
    } else {
      page = lead(page)
      const list = fns.filter(Boolean)
      if (list.length > 0) {
        const array = middlewaresBy[page] ?? []
        if (array.length === 0) {
          array.push((r, _, nxt) => {
            mutate(page, r)
            nxt()
          })
        }
        array.push(...list)
        middlewaresBy[page] = array
      }
    }
    return handler
  }

  handler.all = add.bind(null, '')
  METHODS.forEach(m => (handler[m] = add.bind(null, m)))
  handler.del = handler.delete

  handler.prettyPrint = (...args) => _router.prettyPrint(...args)
  Object.defineProperty(handler, 'routes', {
    get: () => _router.routes,
    enumerable: true
  })

  return handler
}
