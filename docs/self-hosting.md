# Self-hosting Adrien

`adrien serve` is the same server you run on a laptop, put where your team can reach it: the read-only HTTP API and the
web visualizer for one decision log. Nothing here changes how decisions are made. They are still proposed in merge
requests and approved by merging, and the server only shows what is in git.

## What you need

- A decision log in git, either a repository checkout on the server or a git URL the server can read.
- A secret token, so that not everyone who can reach the server can read your decisions.
- A name for the server and, for anything beyond a trial, TLS in front of it (see below).

## With Docker

From the first release that includes the Docker workflow, a prebuilt image is published to GitHub Container Registry as
`ghcr.io/moumine9/adrien:<version>`, and `:latest` points at the newest release. Use it in place of `adrien` in the
commands below, or build it yourself from the Dockerfile as shown here.

```sh
docker build -t adrien --build-arg ADRIEN_PACKAGE=adrien@latest https://github.com/moumine9/adrien.git
```

Read a log from a git URL. The server fetches it every five minutes (`--sync-every`):

```sh
docker run -d --name adrien -p 4310:4310 -v adrien-data:/data \
  -e ADRIEN_TOKEN="$(openssl rand -hex 24)" \
  -e ADRIEN_ALLOWED_HOSTS=adr.example.com \
  -e ADRIEN_LOG=https://git.example.com/acme/decisions.git \
  adrien
```

Or mount a checkout that you keep up to date yourself. The mount must be writable, because the search index lives in
`.adrien/` inside the log. The image runs as uid 1000 (`node`), so the checkout must be writable by that user, or run the
container with `--user "$(id -u):$(id -g)"`:

```sh
docker run -d --name adrien -p 4310:4310 -v /srv/decisions:/log \
  -e ADRIEN_TOKEN=… -e ADRIEN_ALLOWED_HOSTS=adr.example.com adrien
```

The image checks itself with `GET /healthz`, which needs no token and shows nothing.

## Without Docker

```sh
ADRIEN_TOKEN=… adrien serve --host 0.0.0.0 --allowed-host adr.example.com --log https://git.example.com/acme/decisions.git
```

## The settings

| Setting                             | Flag                                 | Environment                              | Default                                  |
| ----------------------------------- | ------------------------------------ | ---------------------------------------- | ---------------------------------------- |
| Log to serve                        | `--log <path or url>`                | `ADRIEN_LOG`                             | the log found from the working directory |
| Address to bind                     | `--host <host>`                      |                                          | `127.0.0.1`                              |
| Port                                | `--port <n>`                         |                                          | `4310`                                   |
| Access token                        |                                      | `ADRIEN_TOKEN`                           | none: loopback only                      |
| Names requests may carry            | `--allowed-host <name>` (repeatable) | `ADRIEN_ALLOWED_HOSTS` (comma-separated) | loopback names and the bound host        |
| Skip the token                      | `--no-auth`                          |                                          | off                                      |
| Fetch a git-URL log every N seconds | `--sync-every <n>`                   |                                          | `300` (0 turns it off)                   |

## Safety rules

- **No token, no network.** Bound to anything but a loopback address, `adrien serve` refuses to start without
  `ADRIEN_TOKEN`. Pass `--no-auth` only when a reverse proxy in front already authenticates every request.
- **The token travels as a Bearer token or as the password of Basic authentication** (any user name). Browsers ask for it
  once. The token is read from the environment, never from a flag, so it does not show up in process listings.
- **Host names are checked before the token.** A request must carry a name you allowed, or it gets 403 whoever it is.
  This stops a web page from reaching the server through a name that points at it.
- **Put TLS in front.** Basic and Bearer credentials are readable on plain HTTP. Terminate TLS in a reverse proxy
  (Caddy, nginx, Traefik) and forward to port 4310, passing the original `Host` header.
- **It is read-only.** Nothing here can accept, edit or delete a decision.

## Reverse proxy sketch (Caddy)

```text
adr.example.com {
    reverse_proxy 127.0.0.1:4310
}
```

Caddy passes the original `Host` header, so `ADRIEN_ALLOWED_HOSTS=adr.example.com` is enough.
