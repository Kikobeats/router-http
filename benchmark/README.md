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

## express@5.2.1


```
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.23ms    1.40ms  96.27ms   99.61%
    Req/Sec    10.15k   615.89    11.07k    86.24%
  2430687 requests in 30.10s, 356.98MB read
Requests/sec:  80752.48
Transfer/sec:     11.86MB
```

## polka@0.5.2

```
wrk -t8 -c100 -d30s http://localhost:3000/user/123
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.01ms    1.27ms  85.35ms   99.61%
    Req/Sec    12.45k     1.11k   17.39k    74.02%
  2980626 requests in 30.10s, 372.37MB read
Requests/sec:  99012.80
Transfer/sec:     12.37MB
```

## router-http

```
wrk -t8 -c100 -d30s http://localhost:3000/user/123
Running 30s test @ http://localhost:3000/user/123
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     0.97ms    1.27ms  84.82ms   99.77%
    Req/Sec    12.91k     1.07k   14.67k    71.51%
  3092927 requests in 30.10s, 386.40MB read
Requests/sec: 102751.65
Transfer/sec:     12.84MB
```


