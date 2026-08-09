'use strict'

// Underscore-prefixed so ava's default glob does not collect it as a test file.

const { default: listen } = require('async-listen')
const { createServer } = require('http')

const got = require('got').extend({
  retry: 0,
  responseType: 'text',
  throwHttpErrors: false,
  resolveBodyOnly: true
})

// Records which layers ran, in order, so a test can assert the sequence.
const createTracker = () => {
  const ran = []
  return {
    ran,
    mark: name => (req, res, next) => {
      ran.push(name)
      next()
    }
  }
}

const runServer = async (t, handler) => {
  const server = createServer(handler)
  const url = await listen(server, { host: '127.0.0.1', port: 0 })
  t.teardown(() => new Promise(resolve => server.close(resolve)))
  return url
}

module.exports = { got, createTracker, runServer }
