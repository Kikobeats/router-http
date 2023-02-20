# router-http

![Last version](https://img.shields.io/github/tag/Kikobeats/router-http.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/router-http.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/router-http)
[![NPM Status](https://img.shields.io/npm/dm/router-http.svg?style=flat-square)](https://www.npmjs.org/package/router-http)

An HTTP router focused in only that, similar to [express@router](https://github.com/pillarjs/router), but:

- Focused in just one thing.
- Maintained and well tested.
- Smaller and portable (1.4 kB).
- Most of router API is supported.

Don't get me wrong: The original Express router is a piece of art. I used it for years and I just considered create this library after experienced a bug that never was addressed in the stable version due to the [lack of maintenance](https://github.com/pillarjs/router/pull/60).

While I was evaluating the market for finding an alternative I found [polka](https://github.com/lukeed/polka/tree/master/packages/polka) was a good starting point for creating a replacement. This module is different than polka in some aspects:

- This module doesn't take care about the http.Server.
- This module doesn't use any of the Node.js built-in module, so it can be used in Vercel Edge Functions, Deno or CF Workers.

## Install

```bash
$ npm install router-http --save
```

## Usage

First, you should to create a router:

```js
const createRouter = require('router-http')

const router = createRouter((error, req, res) => {
  const hasError = error !== undefined
  res.statusCode = hasError ? 500 : 404
  res.end(hasError ? err.message : 'Not Found')
})
```

The router requires a final handler that will be called if an error occurred or none of the routes match.

After that, you can declare any HTTP verb route:

### Declaring routes

```js
/**
 * Declaring multiple routes based on the HTTP verb.
 */
router
  .get('/', (req, res) => {
    res.statusCode = 204
    res.end()
  })
  .post('/ping', (req, res) => res.end('pong'))
  .get('/greetings/:name', (req, res) => {
    const { name } = req.params
    res.end(`Hello, ${name}!`)
  })
```

Alternatively, you can call `.all` for associate a route for all the verbs:

```js
/**
 * Declaring a route to match all the HTTP verbs.
 */
router.all('/ping', (req, res) => res.end('pong'))
```

### Declaring middlewares

A middleware can be declared at root level:

```js
/**
 * Declaring a middleware that will be always executed.
 */
router
  .use('/', (req, res, next) => {
    req.timestamp = Date.now()
    next()
  })
```

or for specific routes:

```js
/**
 * Declaring a middleware to execute for a certain route path.
 */
router
  .use('/greetings', (req, res, next) => {
    req.greetings = 'Greetings'
    next()
  })
  .get('/greetings/:username', (req, res) => {
    res.end(`${req.greetings}, ${req.params.username}`)
  })
```

### Prefixing routes

In case you need you can prefix all the routes:

```js
routes.get('/', (req, res) => res.end('Welcome to my API!'))

/**
 * Prefix all routes with the API version
 */
const router = Router(final)
router
  .use('/latest', routes)
  .use('/v1', routes)
```

### Using the router

After the router has been initialized, start using it as handler in your Node.js server:

```js
const server = http.createServer(router)
```

## Benchmark

The performance is essentially the same than polka, and that is almost x3 faster than express.

See [benchmark](/benchmark) sections.

## Related

- [send-http](https://github.com/Kikobeats/send-http) – A `res.end` with data type detection.
- [http-body](https://github.com/Kikobeats/http-body) – Parse the http.IncomingMessage body into text/json/buffer.
- [http-compression](https://github.com/Kikobeats/http-compression) – Adding compression (gzip/brotli) for your HTTP server in Node.js
- [to-query](https://github.com/Kikobeats/to-query) Get query object from a request url.

## License

**router-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/router-http/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/Kikobeats/router-http/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/Kikobeats) · Twitter [@Kikobeats](https://twitter.com/Kikobeats)
