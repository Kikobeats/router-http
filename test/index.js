'use strict'

const { createServer } = require('http')
const { once } = require('events')
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

const listen = async (server, ...args) => {
  server.listen(...args)
  await once(server, 'listening')

  const { address, port, family } = server.address()
  return `http://${family === 'IPv6' ? `[${address}]` : address}:${port}/`
}

const close = server => new Promise(resolve => server.close(resolve))

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

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.is(
    await got(new URL('/greetings/kiko', serverUrl).toString()),
    'Hello, kiko'
  )
})

test('respect req.params', async t => {
  const router = Router(final)

  router.get('/greetings/:name', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.params))
  })

  const server = createServer((req, res) => {
    req.params = { fizz: 'buzz' }
    router(req, res)
  })
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.deepEqual(
    await got(new URL('/greetings/kiko', serverUrl).toString(), {
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

  const server = createServer((req, res) => {
    req.query = { foo: 'bar' }
    router(req, res)
  })
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.deepEqual(
    await got(new URL('/?foo=barz', serverUrl).toString(), {
      responseType: 'json'
    }),
    { foo: 'bar' }
  )
})

test('respect req.search', async t => {
  const router = Router(final)

  router.get('/', (req, res) => res.end(req.search))

  const server = createServer((req, res) => {
    req.query = '?foo=bar'
    router(req, res)
  })
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.deepEqual(
    await got(new URL('/?foo=barz', serverUrl).toString()),
    '?foo=bar'
  )
})

test('`.all`', async t => {
  const router = Router(final)

  router.all('/', (req, res) => res.end('foo'))

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.is(await got(serverUrl, { method: 'get' }), 'foo')
  t.is(await got(serverUrl, { method: 'post' }), 'foo')
  t.is(await got(serverUrl, { method: 'put' }), 'foo')
  t.is(await got(serverUrl, { method: 'delete' }), 'foo')
  t.is(await got(serverUrl, { method: 'patch' }), 'foo')
  t.is(await got(serverUrl, { method: 'trace' }), 'foo')
  t.is(await got(serverUrl, { method: 'options' }), 'foo')
})

test('`.get`', async t => {
  const router = Router(final)

  router
    .get('/foo', (req, res) => res.end('foo'))
    .get('/bar', (req, res) => res.end('bar'))

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.is(await got(new URL('/foo', serverUrl).toString()), 'foo')
  t.is(await got(new URL('/bar', serverUrl).toString()), 'bar')
})

test('`.use` with `.get`', async t => {
  const router = Router(final)

  router
    .use((req, res, next) => {
      req.greetings = 'hello world'
      next()
    })
    .get('/', (req, res) => res.end(req.greetings))

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.is(await got(serverUrl), 'hello world')
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

    const server = createServer(router)
    const serverUrl = await listen(server)

    t.teardown(() => close(server))

    t.is(await got(serverUrl), 'hello world')
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

    const server = createServer(router)
    const serverUrl = await listen(server)

    t.teardown(() => close(server))

    t.is(await got(serverUrl), 'hello world')
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

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.is(await got(serverUrl), 'cheers')
  t.is(await got(new URL('/greetings', serverUrl).toString()), 'hello world 2')
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

    const server = createServer(router)
    const serverUrl = await listen(server)

    t.teardown(() => close(server))

    t.is(await got(serverUrl), 'one two')
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

    const server = createServer(router)
    const serverUrl = await listen(server)

    t.teardown(() => close(server))

    t.is(await got(serverUrl), 'one two')
  }
})

test('catch exceptions', async t => {
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

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.is(await got(serverUrl), 'oh no')
  t.is((await got(serverUrl, { resolveBodyOnly: false })).statusCode, 500)
})

test('`.use` with error', async t => {
  const router = Router(final)

  router
    .use((req, res, next) => next(new Error('oh no')))
    .get('/', (req, res) => res.end('hello world'))

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.is(await got(serverUrl), 'oh no')
  t.is((await got(serverUrl, { resolveBodyOnly: false })).statusCode, 500)
})

test('use a router for creating routes', async t => {
  const routes = Router(final)
  routes.get('/greetings', (req, res) => res.end('hello world'))

  const router = Router(final)
  router.use('v1', routes)

  const server = createServer(router)
  const serverUrl = await listen(server)
  t.teardown(() => close(server))

  t.is(await got(new URL('/v1/greetings', serverUrl).toString()), 'hello world')
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

  const server = createServer(router)
  const serverUrl = await listen(server)
  t.teardown(() => close(server))

  t.is(await got(new URL('/users/123', serverUrl).toString()), 'Not Found')
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

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.deepEqual(
    await got(new URL('/greetings?name=kiko&foo=bar', serverUrl).toString(), {
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

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))
  t.is(await got(new URL('/foo', serverUrl).toString()), 'greetings')
})
