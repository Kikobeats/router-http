'use strict'

const { default: listen } = require('async-listen')
const { createServer, get: httpGet } = require('http')
const ExpressRouter = require('router')
const test = require('ava').default

const Router = require('..')

// Behaviour is compared against the router Express itself uses by running the
// same case through both and diffing the middleware trace and the response.
// Asserting equality against a real implementation catches drift that a
// hand-written expectation cannot, because it does not encode our own reading
// of the semantics.
const createRouter = () =>
  Router((error, req, res, next) => {
    if (next !== undefined) return next()
    res.statusCode = error ? 500 : 404
    res.end(error ? String(error.message || error) : 'DONE')
  })

const runCase = async (createRouterUnderTest, testCase) => {
  const trace = []
  const track = name => (req, res, next) => {
    trace.push(name)
    next()
  }

  const router = createRouterUnderTest()
  testCase.build(router, track, createRouterUnderTest)

  const server = createServer((req, res) =>
    router(req, res, () => {
      if (!res.writableEnded) res.end('DONE')
    })
  )
  const url = await listen(server, { host: '127.0.0.1', port: 0 })

  try {
    const body = await new Promise((resolve, reject) => {
      httpGet(`${url.origin}${testCase.url}`, res => {
        let data = ''
        res.on('data', chunk => {
          data += chunk
        })
        res.on('end', () => resolve(data))
      }).on('error', reject)
    })
    return `[${trace.join(' ')}] ${body}`
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

const SHARED_BEHAVIOUR = [
  {
    name: 'every matching mount runs, in registration order',
    url: '/admin/panel/secret',
    build: (router, track) => {
      router.use('/admin', track('authorize'))
      router.use('/admin/panel', track('audit'))
      router.get('/admin/panel/secret', (req, res) => res.end('END'))
    }
  },
  {
    name: 're-registering a mount path keeps its position',
    url: '/admin/panel/x',
    build: (router, track) => {
      router.use('/admin/panel', track('audit'))
      router.use('/admin', track('authorize'))
      router.use('/admin/panel', track('log'))
      router.get('/admin/panel/x', (req, res) => res.end('END'))
    }
  },
  {
    name: 'a global registered after a mount runs after it',
    url: '/admin/x',
    build: (router, track) => {
      router.use('/admin', track('authorize'))
      router.use(track('logger'))
      router.get('/admin/x', (req, res) => res.end('END'))
    }
  },
  {
    name: 'a mount is rooted at itself, the route handler is not',
    url: '/admin/panel/x',
    build: (router, track) => {
      router.use('/admin', (req, res, next) =>
        track(`mount url=${req.url} base=${req.baseUrl}`)(req, res, next)
      )
      router.get('/admin/panel/x', (req, res) =>
        res.end(`route url=${req.url} base=${req.baseUrl}`)
      )
    }
  },
  {
    name: 'req.baseUrl accumulates through a nested router',
    url: '/admin/panel/x',
    build: (router, track, createNested) => {
      const child = createNested()
      child.use('/panel', (req, res) =>
        res.end(`base=${req.baseUrl} url=${req.url}`)
      )
      router.use('/admin', child)
    }
  },
  {
    name: 'req.originalUrl is the target the client sent',
    url: '/admin/x?q=1',
    build: (router, track) => {
      router.use('/admin', track('mount'))
      router.get('/admin/x', (req, res) =>
        res.end(`orig=${req.originalUrl} url=${req.url}`)
      )
    }
  },
  {
    name: 'next(null) continues the chain',
    url: '/a',
    build: router => {
      router.use((req, res, next) => next(null))
      router.get('/a', (req, res) => res.end('route ok'))
    }
  },
  {
    name: "next('route') from middleware continues to the next layer",
    url: '/a/b',
    build: (router, track) => {
      router.use((req, res, next) =>
        track('g1')(req, res, () => next('route'))
      )
      router.use(track('g2'))
      router.use('/a', track('m1'))
      router.get('/a/b', (req, res) => res.end('END'))
    }
  },
  {
    name: 'a url rewritten before a mount survives the frame',
    url: '/admin/x',
    build: (router, track) => {
      router.use((req, res, next) => {
        req.url = '/admin/other'
        next()
      })
      router.use('/admin', (req, res, next) =>
        track(`mount ${req.url}`)(req, res, next)
      )
      router.get('/admin/other', (req, res) => res.end(`route url=${req.url}`))
      router.get('/admin/x', (req, res) => res.end(`route url=${req.url}`))
    }
  },
  {
    name: 'a request matching the mount exactly is rooted at /',
    url: '/admin',
    build: router => {
      router.use('/admin', (req, res) =>
        res.end(`url=${req.url} base=${req.baseUrl}`)
      )
    }
  },
  {
    name: 'a trailing slash survives the strip',
    url: '/admin/',
    build: router => {
      router.use('/admin', (req, res) =>
        res.end(`url=${req.url} base=${req.baseUrl}`)
      )
    }
  },
  {
    name: 'the query string survives the strip',
    url: '/admin/x?a=1&b=2',
    build: router => {
      router.use('/admin', (req, res) => res.end(`url=${req.url}`))
    }
  },
  {
    name: 'an unmatched request falls through to the parent',
    url: '/missing',
    build: router => {
      router.get('/other', (req, res) => res.end('nope'))
    }
  }
]

for (const testCase of SHARED_BEHAVIOUR) {
  test(`matches express: ${testCase.name}`, async t => {
    const expected = await runCase(ExpressRouter, testCase)
    const actual = await runCase(createRouter, testCase)
    t.is(actual, expected)
  })
}

// A deliberate divergence. find-my-way matches routes on the decoded
// path, so mounts are matched decoded too; matching them literally would let
// the route run with its mount skipped, which for an auth mount is a bypass.
const ENCODED_MOUNT = {
  name: 'decoded mount against a percent-encoded request',
  url: '/caf%C3%A9/secret',
  build: (router, track) => {
    router.use('/café', track('authorize'))
    router.get('/café/secret', (req, res) => res.end('END'))
  }
}

test('a decoded mount matches a percent-encoded request', async t => {
  const express = await runCase(ExpressRouter, ENCODED_MOUNT)
  const ours = await runCase(createRouter, ENCODED_MOUNT)

  t.is(express, '[] DONE', 'express matches neither the mount nor the route')
  t.is(ours, '[authorize] END', 'both match, so the mount still guards')
})
