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

// test('final handler is required', async t => {
//   t.plan(1)
//   try {
//     Router()
//   } catch (error) {
//     t.is(error.message, 'You should to provide a final handler')
//   }
// })

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

test('merge req.params', async t => {
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
  const router = Router(final)

  router.get('/', (req, res) => {
    throw new Error('oh no')
  })

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

test('get query from url', async t => {
  const router = Router(final)

  const query = ({ url }) => {
    return url.indexOf('?', 1) !== -1
      ? Object.fromEntries(new URLSearchParams(url.split('?', 2)[1]))
      : {}
  }

  router.get('/greetings/:name', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(query(req)))
  })

  const server = createServer(router)
  const serverUrl = await listen(server)

  t.teardown(() => close(server))

  t.deepEqual(
    await got(new URL('/greetings/kiko?foo=bar', serverUrl).toString(), {
      responseType: 'json'
    }),
    {
      foo: 'bar'
    }
  )
})
