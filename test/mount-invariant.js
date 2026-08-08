'use strict'

const test = require('ava').default

const Router = require('..')

// The invariant this file guards: however a mount is spelled, if a route under
// it matches then that mount ran. A mount normalized differently than the route
// silently drops its middleware, which for an auth mount is a bypass.
//
// Scoped to one mount per router on purpose. When several mounts prefix the
// same path only the longest runs — see the `longest matching .use() mount`
// test in index.js — so a multi-mount router would not satisfy this shape.
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

const MOUNT_SPELLINGS = [
  '/admin',
  '//admin',
  '/admin/',
  '/admin//',
  '/Admin',
  'admin',
  '/admin//panel',
  '/admin/panel/',
  '/ad%6din'
]

const ROUTE_TAILS = [
  '/secret',
  '/secret/',
  '//secret',
  '/Secret',
  '/panel/secret',
  '/se%63ret',
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

test('a matched route never skips its mount, however the mount is spelled', t => {
  const bypasses = []
  let combinations = 0

  for (const options of OPTION_SETS) {
    for (const mount of MOUNT_SPELLINGS) {
      for (const tail of ROUTE_TAILS) {
        const routePath = mount + tail

        let mountRan = false
        let routeRan = false
        let router

        try {
          router = Router(() => {}, options)
          router.use(mount, (req, res, next) => {
            mountRan = true
            next()
          })
          router.get(routePath, (req, res) => {
            routeRan = true
            res.end()
          })
        } catch {
          continue
        }

        for (const mutate of REQUEST_MUTATORS) {
          mountRan = false
          routeRan = false

          try {
            router({ method: 'GET', url: mutate(routePath) }, createResponse())
          } catch {
            continue
          }

          combinations++
          if (routeRan && !mountRan) {
            bypasses.push(
              `${JSON.stringify(options)} mount=${mount} route=${routePath} GET ${mutate(routePath)}`
            )
          }
        }
      }
    }
  }

  t.true(combinations > 4000)
  t.deepEqual(bypasses, [])
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
