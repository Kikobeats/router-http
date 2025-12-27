'use strict'

const NullProtoObj = require('null-prototype-object')
const { Trouter } = require('trouter')

const requiredFinalHandler = () => {
  throw new TypeError('You should to provide a final handler')
}

/**
 * ensure input starts with '/'
 */
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

class Router extends Trouter {
  constructor (unhandler) {
    super()
    this.unhandler = unhandler
  }

  /**
   * Middleware per all routes
   */
  #middlewares = []

  /**
   * Middleware for specific routes
   */
  #middlewaresBy = new NullProtoObj()

  /**
   * Middleware declaration, where the page is optional
   * .use(one)
   * .use('/v1', one)
   * .use(one, two)
   * .use('/v2', two)
   */
  use = (page = '/', ...fns) => {
    if (typeof page === 'function' || typeof page === 'boolean') {
      this.#middlewares = this.#middlewares.concat(page, fns).filter(Boolean)
    } else if (page === '/') {
      this.#middlewares = this.#middlewares.concat(fns).filter(Boolean)
    } else {
      page = lead(page)
      fns.filter(Boolean).forEach(fn => {
        const array = this.#middlewaresBy[page] ?? []
        if (array.length === 0) {
          array.push((r, _, nxt) => {
            mutate(page, r)
            nxt()
          })
        }
        this.#middlewaresBy[page] = array.concat(fn)
      })
    }
    return this
  }

  handler = (req, res, next) => {
    const info = parse(req)
    const pathname = info.pathname
    req.path = pathname
    const route = this.find(req.method, pathname)
    const page = value(pathname)

    const m = this.#middlewares
    const mb = this.#middlewaresBy[page]
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
      if (err) return this.unhandler(err, req, res, next)
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

      this.unhandler(undefined, req, res, _next)
    }

    loop()
  }
}

module.exports = (finalhandler = requiredFinalHandler()) => {
  const router = new Router(finalhandler)
  const handler = (req, res, next) => router.handler(req, res, next)
  return Object.assign(handler, router)
}
