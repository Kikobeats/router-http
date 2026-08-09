'use strict'

// Underscore-prefixed so ava's default glob does not collect it as a test file.

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

module.exports = { got, createTracker }
