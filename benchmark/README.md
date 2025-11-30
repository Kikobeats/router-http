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

## express@4.21.2

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     5.17ms    7.14ms 295.58ms   99.24%
    Req/Sec     2.51k   204.95     4.50k    93.66%
  600369 requests in 30.03s, 88.17MB read
Requests/sec:  19990.18
Transfer/sec:      2.94MB
```

## polka@0.5.2

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.50ms    2.26ms 127.41ms   99.62%
    Req/Sec     8.52k     0.96k   34.21k    93.63%
  2036779 requests in 30.10s, 254.46MB read
Requests/sec:  67661.92
Transfer/sec:      8.45MB
```

## router-http@1.0.0

```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.43ms    2.05ms 120.80ms   99.70%
    Req/Sec     8.82k     1.01k   38.59k    92.09%
  2109270 requests in 30.10s, 263.51MB read
Requests/sec:  70068.20
Transfer/sec:      8.75MB
```


