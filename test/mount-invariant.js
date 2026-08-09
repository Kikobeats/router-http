'use strict'

const test = require('ava').default

const Router = require('..')

// Two invariants this file guards, for every way a mount can be spelled:
//
// 1. If a route under the mount matches, the mount ran. A mount normalized
//    differently than the route silently drops its middleware, which for an
//    auth mount is a bypass.
// 2. Stripping the mount takes the same segments off req.url as off req.path.
//    The two are walked by different code (raw url vs normalized path), so a
//    disagreement eats into the tail the sub-router still needs.
//
// One mount per router keeps a failure readable: the spelling that broke is
// the one registered. Overlapping mounts are covered in index.js, where every
// matching mount runs and each gets its own frame.
const OPTION_SETS = [
  {},
  { ignoreDuplicateSlashes: true },
  { ignoreTrailingSlash: true },
  { useSemicolonDelimiter: true },
  { caseSensitive: false },
  { ignoreDuplicateSlashes: true, ignoreTrailingSlash: true },
  { ignoreDuplicateSlashes: true, caseSensitive: false },
  { ignoreTrailingSlash: true, useSemicolonDelimiter: true },
  { caseSensitive: false, useSemicolonDelimiter: true }
]

// Percent-encoded spellings are absent on purpose: find-my-way registers no
// matchable route for them, so every combination would pass vacuously. The
// `an encoded mount spelling matches nothing` test below pins that instead.
const MOUNT_SPELLINGS = [
  '/admin',
  '//admin',
  '/admin/',
  '/admin//',
  '/Admin',
  'admin',
  '/admin//panel',
  '/admin/panel/'
]

const ROUTE_TAILS = [
  '/secret',
  '/secret/',
  '//secret',
  '/Secret',
  '/panel/secret',
  ''
]

const REQUEST_MUTATORS = [
  path => path,
  path => `${path}/`,
  path => path.replace('/admin', '//admin'),
  path => path.replace('/admin', '/Admin'),
  path => `${path}#frag`,
  path => `${path};sid=1`,
  path => `${path}?a=1`,
  path => path.replace('/admin', '/ad%6din'),
  path => `http://example.com${path}`
]

const createResponse = () => ({
  writableEnded: false,
  statusCode: 200,
  end () {
    this.writableEnded = true
  }
})

const EXPECTED_COMBINATIONS =
  OPTION_SETS.length *
  MOUNT_SPELLINGS.length *
  ROUTE_TAILS.length *
  REQUEST_MUTATORS.length

// The mount is stripped from both, so whatever remains has to describe the
// same resource: req.path is req.url's path half under this router's options.
const stripsConsistently = (options, url, path) => {
  const pathEnd = url.search(options.useSemicolonDelimiter ? /[?#;]/ : /[?#]/)
  let expected = pathEnd === -1 ? url : url.substring(0, pathEnd)
  if (options.ignoreDuplicateSlashes) expected = expected.replace(/\/{2,}/g, '/')
  if (options.ignoreTrailingSlash && expected.length > 1) {
    expected = expected.replace(/\/$/, '')
  }
  return (expected || '/') === path
}

test('a matched route never skips its mount, however the mount is spelled', t => {
  const bypasses = []
  const crashes = []
  const desyncs = []
  // A row whose route never runs asserts nothing; without this the matrix
  // reads as coverage it does not have.
  const exercised = new Set()
  let combinations = 0

  for (const options of OPTION_SETS) {
    for (const mount of MOUNT_SPELLINGS) {
      // The unrooted spelling is a mount variant; find-my-way requires the
      // route itself to start with `/`.
      const rootedMount = mount.charAt(0) === '/' ? mount : `/${mount}`

      for (const tail of ROUTE_TAILS) {
        const routePath = rootedMount + tail
        const describe = target =>
          `${JSON.stringify(options)} mount=${mount} route=${routePath} GET ${target}`

        let mountRan
        let routeRan
        let stripped

        const router = Router(() => {}, options)
        // Read inside the frame: the mount's view is stripped, and the route
        // handler runs after the frame is undone.
        router.use(mount, (req, res, next) => {
          mountRan = true
          stripped = { url: req.url, path: req.path }
          next()
        })
        router.get(routePath, (req, res) => {
          routeRan = true
          res.end()
        })

        for (const mutate of REQUEST_MUTATORS) {
          const target = mutate(routePath)
          mountRan = false
          routeRan = false
          stripped = undefined
          combinations++

          // A throw is a finding, not a combination to skip: the router funnels
          // middleware errors to finalhandler, so anything reaching here is a
          // crash in normalization itself.
          try {
            router({ method: 'GET', url: target }, createResponse())
          } catch (error) {
            crashes.push(`${describe(target)} threw ${error.message}`)
            continue
          }

          if (routeRan) {
            exercised.add(mount)
            exercised.add(tail)
          }

          if (routeRan && !mountRan) bypasses.push(describe(target))

          if (
            mountRan &&
            !stripsConsistently(options, stripped.url, stripped.path)
          ) {
            desyncs.push(
              `${describe(target)} left url=${stripped.url} path=${stripped.path}`
            )
          }
        }
      }
    }
  }

  t.is(combinations, EXPECTED_COMBINATIONS)
  t.deepEqual(crashes, [])
  t.deepEqual(bypasses, [])
  t.deepEqual(desyncs, [])
  t.deepEqual(
    [...MOUNT_SPELLINGS, ...ROUTE_TAILS].filter(row => !exercised.has(row)),
    [],
    'every mount spelling and route tail must reach the route at least once'
  )
})

test('an encoded mount spelling matches nothing', t => {
  const router = Router(() => {})
  let mountRan = false

  router.use('/ad%6din', (req, res, next) => {
    mountRan = true
    next()
  })
  router.get('/admin/secret', (req, res) => res.end())

  for (const target of ['/admin/secret', '/ad%6din/secret']) {
    mountRan = false
    router({ method: 'GET', url: target }, createResponse())
    t.false(mountRan, target)
  }
})

test('.use() still runs for a mount with an empty first segment', t => {
  const router = Router(() => {})
  let mountRan = false

  router.use('//admin', (req, res, next) => {
    mountRan = true
    next()
  })
  router.get('//admin/secret', (req, res) => res.end())

  router({ method: 'GET', url: '//admin/secret' }, createResponse())

  t.true(mountRan)
})
