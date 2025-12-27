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

test('throws error if the same route is added twice', t => {
  const router = Router(final)
  router.get('/foo', (req, res) => res.end('foo'))
  const error = t.throws(() => {
    router.get('/foo', (req, res) => res.end('bar'))
  })
  t.is(
    error.message,
    "Method 'GET' already declared for route '/foo' with constraints '{}'"
  )
})

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

test("next('router') exit the current router", async t => {
  const router = Router(final)
  const subRouter = Router(final)

  subRouter.get('/foo', (req, res, next) => {
    next('router')
  })

  router.use('/sub', subRouter)
  router.get('/sub/foo', (req, res) => {
    res.end('reached')
  })

  const url = await runServer(t, router)
  t.is(await got(new URL('/sub/foo', url).toString()), 'reached')
})

test('nested router with params', async t => {
  const router = Router(final)
  const subRouter = Router(final)

  subRouter.get('/:id', (req, res) => {
    res.end(`id: ${req.params.id}, version: ${req.params.version}`)
  })

  router.use('/v1', (req, res, next) => {
    req.params.version = 'v1'
    next()
  })
  router.use('/v1', subRouter)

  const url = await runServer(t, router)
  t.is(await got(new URL('/v1/123', url).toString()), 'id: 123, version: v1')
})

test('nested router should call parent next if no match', async t => {
  const router = Router(final)
  const subRouter = Router(final)

  // subRouter has no matching routes for /foo
  subRouter.get('/bar', (req, res) => res.end('bar'))

  router.use('/sub', subRouter)
  router.get('/sub/foo', (req, res) => {
    res.end('reached')
  })

  const url = await runServer(t, router)
  t.is(await got(new URL('/sub/foo', url).toString()), 'reached')
})

test("next('router') at top level", async t => {
  const router = Router(final)
  router.get('/foo', (req, res, next) => {
    next('router')
  })
  const url = await runServer(t, router)
  t.is(await got(new URL('/foo', url).toString()), 'Not Found')
})

test('middleware ends response and calls next', async t => {
  const router = Router(final)
  router.use((req, res, next) => {
    res.end('done')
    next()
  })
  router.get('/', (req, res) => {
    res.end('should not reach')
  })
  const url = await runServer(t, router)
  t.is(await got(url), 'done')
})

test('last middleware ends response', async t => {
  const router = Router(final)
  router.get('/', (req, res) => {
    res.end('done')
  })
  const url = await runServer(t, router)
  t.is(await got(url), 'done')
})

test('last middleware ends response and calls next', async t => {
  const router = Router(final)
  router.get('/', (req, res, next) => {
    res.end('done')
    next()
  })
  const url = await runServer(t, router)
  t.is(await got(url), 'done')
})

test('many sync middlewares', async t => {
  const router = Router(final)
  let count = 0
  for (let i = 0; i < 200; i++) {
    router.use((req, res, next) => {
      count++
      next()
    })
  }
  router.get('/', (req, res) => res.end(count.toString()))

  const url = await runServer(t, router)
  t.is(await got(url), '200')
})

test('req.params is an empty object on no-match', async t => {
  const router = Router((_err, req, res) => {
    t.deepEqual(req.params, {})
    res.end('done')
  })
  const url = await runServer(t, router)
  await got(new URL('/any', url).toString())
})

test('req.params is preserved on no-match if already defined', async t => {
  const router = Router((_err, req, res) => {
    t.deepEqual(req.params, { existing: 'value' })
    res.end('done')
  })
  const url = await runServer(t, (req, res) => {
    req.params = { existing: 'value' }
    router(req, res)
  })
  await got(new URL('/any', url).toString())
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

test('req.params is defined even without route match', async t => {
  const router = Router(final)

  router.use((req, res, next) => {
    t.truthy(req.params)
    next()
  })

  router.get('/match', (req, res) => res.end('match'))

  const url = await runServer(t, router)
  await got(new URL('/no-match', url).toString())
})

test('HEAD only calls HEAD handlers if defined', async t => {
  const router = Router(final)
  const results = []
  router.get('/foo', (req, res, next) => {
    results.push('get')
    next()
  })
  router.head('/foo', (req, res, next) => {
    results.push('head')
    res.end()
  })

  const url = await runServer(t, router)
  await got(new URL('/foo', url).toString(), { method: 'head' })
  t.deepEqual(results, ['head'])
})

test('HEAD fallback to GET', async t => {
  const router = Router(final)
  const results = []
  router.get('/bar', (req, res, next) => {
    results.push('get')
    res.end()
  })

  const url = await runServer(t, router)
  await got(new URL('/bar', url).toString(), { method: 'head' })
  t.deepEqual(results, ['get'])
})

test('pass options to find-my-way', async t => {
  const router = Router(final, { caseSensitive: false })
  router.get('/FOO', (req, res) => res.end('foo'))
  const url = await runServer(t, router)
  t.is(await got(new URL('/foo', url).toString()), 'foo')
})

test('exposes find-my-way methods', t => {
  const router = Router(final)
  t.is(typeof router.prettyPrint, 'function')
  t.true(Array.isArray(router.routes))
})

test('prettyPrint returns a string', t => {
  const router = Router(final)
  router.get('/foo', (req, res) => res.end('foo'))
  const output = router.prettyPrint()
  t.is(typeof output, 'string')
  t.true(output.includes('foo'))
})

test('add with no handlers', t => {
  const router = Router(final)
  const result = router.get('/foo')
  t.is(result, router)
  t.is(router.routes.length, 0)
})

test('internal _add method Map initialization', t => {
  const router = Router(final)
  // This will hit the !methodMap branch for POST
  router.post('/bar', () => {})
  t.is(router.routes.length, 1)
})

test('handles bad URLs (invalid encoding)', async t => {
  const router = Router((err, req, res) => {
    if (err) return
    res.statusCode = 404
    res.end('Not Found')
  })

  router.get('/hello', (req, res) => {
    res.end('hello')
  })

  const server = createServer(router)
  const url = await listen(server)
  t.teardown(() => server.close())

  // invalid % encoding, using raw http to avoid got's URL validation
  const path = '/hello/%world'
  const response = await new Promise(resolve => {
    require('http').get(`${url.origin}${path}`, resolve)
  })

  t.is(response.statusCode, 404)
})

test('matches static routes with encoded characters', async t => {
  const router = Router((err, req, res) => {
    if (err) return
    res.statusCode = 404
    res.end('Not Found')
  })

  router.get('/hello world', (req, res) => {
    res.end('found')
  })

  const url = await runServer(t, router)

  const response = await got(new URL('/hello%20world', url).toString())
  t.is(response, 'found')
})

test('decodes parameters in path', async t => {
  const router = Router((err, req, res) => {
    if (err) return
    res.statusCode = 404
    res.end('Not Found')
  })

  router.get('/greetings/:name', (req, res) => {
    res.end(`Hello, ${req.params.name}`)
  })

  const url = await runServer(t, router)

  const response = await got(new URL('/greetings/kiko%20beats', url).toString())
  t.is(response, 'Hello, kiko beats')
})
