const http = require('http')

const createRouter = require('../src')

const final = (err, req, res) => {
  const hasError = err !== undefined
  res.statusCode = hasError ? 500 : 404
  res.end(hasError ? err.message : 'Not Found')
}

const router = createRouter(final)

function one (req, res, next) {
  req.one = true
  next()
}

function two (req, res, next) {
  req.two = true
  next()
}

router
  .use(one, two)
  .get('/favicon.ico', _ => {})
  .get('/', (req, res) => res.end('Hello'))
  .get('/user/:id', (req, res) => res.end(`User: ${req.params.id}`))

http.createServer(router).listen(3000)
