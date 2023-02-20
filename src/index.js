'use strict'

const Trouter = require('trouter')

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
  #middlewaresBy = []

  /**
   * Middleware declaration, where the base is optional
   * .use(one)
   * .use('/v1', one)
   * .use(one, two)
   * .use('/v2', two)
   */
  use = (base = '/', ...fns) => {
    if (typeof base === 'function') {
      this.#middlewares = this.#middlewares.concat(base, fns)
    } else if (base === '/') {
      this.#middlewares = this.#middlewares.concat(fns)
    } else {
      base = lead(base)
      fns.forEach(fn => {
        const array = this.#middlewaresBy[base] || []
        // eslint-disable-next-line no-sequences
        array.length > 0 || array.push((r, _, nxt) => (mutate(base, r), nxt()))
        this.#middlewaresBy[base] = array.concat(fn)
      })
    }
    return this
  }

  handler = (req, res, pathname) => {
    pathname = pathname || req.url
    let fns = []
    let middlewares = this.#middlewares
    const route = this.find(req.method, pathname)
    const base = value((req.path = pathname))
    if (this.#middlewaresBy[base] !== undefined) {
      middlewares = middlewares.concat(this.#middlewaresBy[base])
    }
    if (route) {
      fns = route.handlers
      req.params = { ...req.params, ...route.params }
    }
    fns.push(this.unhandler)
    // Exit if only a single function
    let i = 0
    let len = middlewares.length
    const num = fns.length
    if (len === i && num === 1) return fns[0](undefined, req, res)

    // Otherwise loop thru all middlware
    const next = err => (err ? this.unhandler(err, req, res, next) : loop())

    const loop = () => {
      if (res.writableEnded) return
      if (i >= len) return
      try {
        return middlewares[i++](req, res, next)
      } catch (err) {
        return next(err)
      }
    }

    middlewares = middlewares.concat(fns)
    len += num
    loop() // init
  }
}

module.exports = (finalhandler = requiredFinalHandler()) => {
  const router = new Router(finalhandler)
  const handler = (req, res) => router.handler(req, res)
  return Object.assign(handler, router)
}
