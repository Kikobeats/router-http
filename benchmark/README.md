# Benchmarks

All apps employ two global middlewares with `req` mutations, an empty `GET` route handler for `favicon.ico` and a `GET` handler for the `/users/:id`, returning a `User: {id}` string response.

The conditions of the runs are:

- Using Node.js v18.14.0.
- Using the latest stable module version available.
- Running a first run as warmup.

All the benchmark are run using the folllwing commnad:

```sh
wrk -t8 -c100 -d30s http://localhost:3000/user/123
```

## express@4.18.2

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     4.12ms  653.26us  21.71ms   89.35%
    Req/Sec     2.93k   159.60     5.99k    84.75%
  700421 requests in 30.06s, 102.87MB read
Requests/sec:  23304.22
Transfer/sec:      3.42MB
```

## polka@0.5.2

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.39ms  431.36us  21.70ms   96.27%
    Req/Sec     8.72k     1.07k   31.74k    83.31%
  2083301 requests in 30.10s, 260.27MB read
Requests/sec:  69203.34
Transfer/sec:      8.65MB
```

## router-http@1.0.0

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.38ms  263.56us   7.95ms   84.71%
    Req/Sec     8.74k     1.31k   60.73k    95.25%
  2089271 requests in 30.10s, 261.02MB read
Requests/sec:  69403.92
Transfer/sec:      8.67MB
```


