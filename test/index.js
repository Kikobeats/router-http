'use strict'

const { default: listen } = require('async-listen')
const { createServer } = require('http')
const test = require('ava')

const got = require('got').extend({
  retry: 0,
  responseType: 'text',
  throwHttpErrors: false,
  resolveBodyOnly: true
})

const delay = d => new Promise(resolve => setTimeout(resolve, d))

const Router = require('..')

const final = (err, req, res) => {
  res.statusCode = err ? 500 : 404
  res.end(err ? err.message : 'Not Found')
}

const closeServer = server =>
  require('util').promisify(server.close.bind(server))()

const runServer = async (t, handler) => {
  const server = createServer(handler)
  const url = await listen(server, { host: '127.0.0.1', port: 0 })
  t.teardown(() => closeServer(server))
  return url
}

test('final handler is required', async t => {
  t.plan(1)
  try {
    Router()
  } catch (error) {
    t.is(error.message, 'You should to provide a final handler')
  }
})

test('hide internals', async t => {
  const router = Router(final)
  t.falsy(router.add)
})

test('define req.params', async t => {
  const router = Router(final)

  router.get('/greetings/:name', (req, res) =>
    res.end(`Hello, ${req.params.name}`)
  )

  const url = await runServer(t, router)

  t.is(await got(new URL('/greetings/kiko', url).toString()), 'Hello, kiko')
})

test('respect req.params', async t => {
  const router = Router(final)

  router.get('/greetings/:name', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.params))
  })

  const url = await runServer(t, (req, res) => {
    req.params = { fizz: 'buzz' }
    router(req, res)
  })

  t.deepEqual(
    await got(new URL('/greetings/kiko', url).toString(), {
      responseType: 'json'
    }),
    { name: 'kiko', fizz: 'buzz' }
  )
})

test('respect req.query', async t => {
  const router = Router(final)

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.query))
  })

  const url = await runServer(t, (req, res) => {
    req.query = { foo: 'bar' }
    router(req, res)
  })

  t.deepEqual(
    await got(new URL('/?foo=barz', url).toString(), {
      responseType: 'json'
    }),
    { foo: 'bar' }
  )
})

test('respect req.search', async t => {
  const router = Router(final)

  router.get('/', (req, res) => res.end(req.search))

  const url = await runServer(t, (req, res) => {
    req.query = '?foo=bar'
    router(req, res)
  })

  t.deepEqual(await got(new URL('/?foo=barz', url).toString()), '?foo=bar')
})

test('`.all`', async t => {
  const router = Router(final)

  router.all('/', (req, res) => res.end('foo'))

  const url = await runServer(t, router)

  t.is(await got(url, { method: 'get' }), 'foo')
  t.is(await got(url, { method: 'post' }), 'foo')
  t.is(await got(url, { method: 'put' }), 'foo')
  t.is(await got(url, { method: 'delete' }), 'foo')
  t.is(await got(url, { method: 'patch' }), 'foo')
  t.is(await got(url, { method: 'trace' }), 'foo')
  t.is(await got(url, { method: 'options' }), 'foo')
})

test('`.get`', async t => {
  const router = Router(final)

  router
    .get('/foo', (req, res) => res.end('foo'))
    .get('/bar', (req, res) => res.end('bar'))

  const url = await runServer(t, router)

  t.is(await got(new URL('/foo', url).toString()), 'foo')
  t.is(await got(new URL('/bar', url).toString()), 'bar')
})

test('`.use` with `.get`', async t => {
  const router = Router(final)

  router
    .use((req, res, next) => {
      req.greetings = 'hello world'
      next()
    })
    .get('/', (req, res) => res.end(req.greetings))

  const url = await runServer(t, router)

  t.is(await got(url), 'hello world')
})

test('async `.use`', async t => {
  {
    const router = Router(final)

    router
      .use(async (req, res, next) => {
        await delay(50)
        req.greetings = 'hello world'
        next()
      })
      .get('/', (req, res) => res.end(req.greetings))

    const url = await runServer(t, router)

    t.is(await got(url), 'hello world')
  }
  {
    const router = Router(final)

    router
      .use('/', async (req, res, next) => {
        await delay(50)
        req.greetings = 'hello world'
        next()
      })
      .get('/', (req, res) => res.end(req.greetings))

    const url = await runServer(t, router)

    t.is(await got(url), 'hello world')
  }
})

test('multi `.use` with `.get`', async t => {
  const router = Router(final)

  router
    .use('/greetings', (req, res, next) => {
      req.greetings = 'hello world 1'
      next()
    })
    .use('greetings', (req, res, next) => {
      req.greetings = 'hello world 2'
      next()
    })
    .get('/', (req, res) => res.end(req.greetings || 'cheers'))
    .get('/greetings', (req, res) => res.end(req.greetings || 'cheers'))

  const url = await runServer(t, router)

  t.is(await got(url), 'cheers')
  t.is(await got(new URL('/greetings', url).toString()), 'hello world 2')
})

test('multi `.use`', async t => {
  {
    const router = Router(final)

    router
      .use(
        (req, res, next) => {
          req.one = 'one'
          next()
        },
        (req, res, next) => {
          req.two = 'two'
          next()
        }
      )
      .get('/', (req, res) => res.end(req.one + ' ' + req.two))

    const url = await runServer(t, router)

    t.is(await got(url), 'one two')
  }

  {
    const router = Router(final)

    router
      .use(
        '/',
        (req, res, next) => {
          req.one = 'one'
          next()
        },
        (req, res, next) => {
          req.two = 'two'
          next()
        }
      )
      .get('/', (req, res) => res.end(req.one + ' ' + req.two))

    const url = await runServer(t, router)

    t.is(await got(url), 'one two')
  }
})

test('catch sync exceptions', async t => {
  t.plan(8)

  const router = Router((err, req, res) => {
    t.truthy(err)
    t.truthy(req)
    t.truthy(res)
    res.statusCode = err ? 500 : 404
    res.end(err ? err.message : 'Not Found')
  })

  router
    .use((req, res, next) => {
      req.one = 'one'
      next()
    })
    .use((req, res, next) => {
      req.two = 'two'
      next()
    })
    .get('/', (req, res) => {
      throw new Error('oh no')
    })
    .get('/greetings', (req, res) => res.end('greetings!'))

  const url = await runServer(t, router)

  t.is(await got(url), 'oh no')
  t.is((await got(url, { resolveBodyOnly: false })).statusCode, 500)
})

test('catch async exceptions', async t => {
  t.plan(8)

  const router = Router((err, req, res) => {
    t.truthy(err)
    t.truthy(req)
    t.truthy(res)
    res.statusCode = err ? 500 : 404
    res.end(err ? err.message : 'Not Found')
  })

  router
    .use((req, res, next) => {
      req.one = 'one'
      next()
    })
    .use((req, res, next) => {
      req.two = 'two'
      next()
    })
    .get('/', async (req, res) => {
      throw new Error('oh no')
    })
    .get('/greetings', (req, res) => res.end('greetings!'))

  const url = await runServer(t, router)

  t.is(await got(url), 'oh no')
  t.is((await got(url, { resolveBodyOnly: false })).statusCode, 500)
})

test('`.use` with error', async t => {
  const router = Router(final)

  router
    .use((req, res, next) => next(new Error('oh no')))
    .get('/', (req, res) => res.end('hello world'))

  const url = await runServer(t, router)

  t.is(await got(url), 'oh no')
  t.is((await got(url, { resolveBodyOnly: false })).statusCode, 500)
})

test('use a router for creating routes', async t => {
  const routes = Router(final)
  routes.get('/greetings', (req, res) => res.end('hello world'))

  const router = Router(final)
  router.use('v1', routes)

  const url = await runServer(t, router)

  t.is(await got(new URL('/v1/greetings', url).toString()), 'hello world')
})

test('unmatched route', async t => {
  const router = Router(final)

  router
    .use((req, res, next) => {
      req.one = 'one'
      next()
    })
    .use((req, res, next) => {
      req.two = 'two'
      next()
    })
    .get('/favicon.ico', _ => {})
    .get('/', (req, res) => res.end('Hello'))
    .get('/user/:id', (req, res) => res.end(`User: ${req.params.id}`))

  const url = await runServer(t, router)

  t.is(await got(new URL('/users/123', url).toString()), 'Not Found')
})

test("don't interfer with request query", async t => {
  t.plan(5)

  const router = Router(final)

  const query = ({ url }) => {
    return url.indexOf('?', 1) !== -1
      ? Object.fromEntries(new URLSearchParams(url.split('?', 2)[1]))
      : {}
  }

  router.get('/greetings', (req, res) => {
    t.is(req.query, 'name=kiko&foo=bar')
    t.is(req.search, '?name=kiko&foo=bar')
    t.is(req.path, '/greetings')
    t.is(req.pathname, undefined)

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(query(req)))
  })

  const url = await runServer(t, router)

  t.deepEqual(
    await got(new URL('/greetings?name=kiko&foo=bar', url).toString(), {
      responseType: 'json'
    }),
    {
      name: 'kiko',
      foo: 'bar'
    }
  )
})

test('remove falsy middlewares', async t => {
  const router = Router(final)

  router
    .use(false)
    .use('/', false)
    .use('/foo', false)
    .get('/foo', (req, res) => res.end('greetings'))

  const url = await runServer(t, router)

  t.is(await got(new URL('/foo', url).toString()), 'greetings')
})

test('middleware runs before routes regardless of declaration order', async t => {
  const executionOrder = []

  // Declare routes BEFORE middleware
  const router = Router(final)
  router
    .get('/ping', (req, res) => {
      executionOrder.push('route:/ping')
      res.end('pong')
    })
    .get('/checkout', (req, res) => {
      executionOrder.push('route:/checkout')
      res.end('checkout')
    })
    .use((req, res, next) => {
      executionOrder.push('middleware')
      next()
    })

  const url = await runServer(t, router)

  // Test /ping
  executionOrder.length = 0
  await got(new URL('/ping', url).toString())
  t.deepEqual(
    executionOrder,
    ['middleware', 'route:/ping'],
    'middleware runs before /ping even though declared after'
  )

  // Test /checkout
  executionOrder.length = 0
  await got(new URL('/checkout', url).toString())
  t.deepEqual(
    executionOrder,
    ['middleware', 'route:/checkout'],
    'middleware runs before /checkout even though declared after'
  )
})

test('middleware declaration order vs route declaration order', async t => {
  const executionOrder = []

  // Compare two routers: one with .use() before .get(), one with .use() after .get()
  const routerUseBefore = Router(final)
  routerUseBefore
    .use((req, res, next) => {
      executionOrder.push('middleware-before')
      next()
    })
    .get('/test', (req, res) => {
      executionOrder.push('route-before')
      res.end('ok')
    })

  const routerUseAfter = Router(final)
  routerUseAfter
    .get('/test', (req, res) => {
      executionOrder.push('route-after')
      res.end('ok')
    })
    .use((req, res, next) => {
      executionOrder.push('middleware-after')
      next()
    })

  const urlBefore = await runServer(t, routerUseBefore)
  const urlAfter = await runServer(t, routerUseAfter)

  // Test router with .use() declared before .get()
  executionOrder.length = 0
  await got(new URL('/test', urlBefore).toString())
  t.deepEqual(
    executionOrder,
    ['middleware-before', 'route-before'],
    '.use() before .get() - middleware runs first'
  )

  // Test router with .use() declared after .get()
  executionOrder.length = 0
  await got(new URL('/test', urlAfter).toString())
  t.deepEqual(
    executionOrder,
    ['middleware-after', 'route-after'],
    '.use() after .get() - middleware STILL runs first'
  )
})
