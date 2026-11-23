/**
 * Checks whether a proxy works and which IP it exits from.
 * Supports HTTP proxies and SOCKS5 (no extra dependencies).
 *
 * Accepted credential formats (one per line):
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   user:pass:host:port            (when the 3rd part looks like a host)
 *   http://user:pass@host:port     socks5://user:pass@host:port
 */
const net = require("net");

const TIMEOUT_MS = 12000;
const TEST_HOST = "api.ipify.org";
const TEST_PATH = "/?format=json";

const isPort = (s) => /^\d{2,5}$/.test(s) && +s > 0 && +s < 65536;
const looksLikeHost = (s) => /^(\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i.test(s);

/** Parses one credential line. Returns null when it isn't a proxy. */
function parseProxy(line) {
  let s = String(line || "").trim();
  if (!s) return null;

  let protocol = null;
  const scheme = s.match(/^(https?|socks5h?|socks):\/\//i);
  if (scheme) {
    protocol = scheme[1].toLowerCase().startsWith("socks") ? "socks5" : "http";
    s = s.slice(scheme[0].length);
  }

  let user = null;
  let pass = null;
  let host;
  let port;

  if (s.includes("@")) {
    const [auth, addr] = [s.slice(0, s.lastIndexOf("@")), s.slice(s.lastIndexOf("@") + 1)];
    [host, port] = addr.split(":");
    const i = auth.indexOf(":");
    user = i >= 0 ? auth.slice(0, i) : auth;
    pass = i >= 0 ? auth.slice(i + 1) : "";
  } else {
    const parts = s.split(":");
    if (parts.length === 2) {
      [host, port] = parts;
    } else if (parts.length >= 4 && looksLikeHost(parts[0]) && isPort(parts[1])) {
      host = parts[0];
      port = parts[1];
      user = parts[2];
      pass = parts.slice(3).join(":");
    } else if (parts.length >= 4 && looksLikeHost(parts[2]) && isPort(parts[3])) {
      user = parts[0];
      pass = parts[1];
      host = parts[2];
      port = parts[3];
    } else {
      return null;
    }
  }

  if (!host || !isPort(port) || !looksLikeHost(host)) return null;
  return { protocol, host, port: +port, user, pass };
}

function withTimeout(socket, reject) {
  socket.setTimeout(TIMEOUT_MS, () => {
    socket.destroy();
    reject(new Error("Timed out"));
  });
  socket.on("error", reject);
}

/** HTTP proxy: plain GET through the proxy. */
function viaHttp(p) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(p.port, p.host);
    withTimeout(socket, reject);
    socket.on("connect", () => {
      const auth = p.user ? `Proxy-Authorization: Basic ${Buffer.from(`${p.user}:${p.pass}`).toString("base64")}\r\n` : "";
      socket.write(
        `GET http://${TEST_HOST}${TEST_PATH} HTTP/1.1\r\nHost: ${TEST_HOST}\r\n${auth}User-Agent: proxy-check\r\nConnection: close\r\n\r\n`,
      );
    });
    let data = "";
    socket.on("data", (c) => {
      data += c.toString("utf8");
      if (data.length > 20000) socket.destroy();
    });
    socket.on("close", () => resolve(data));
  });
}

/** SOCKS5: handshake, optional username/password auth, CONNECT, then GET. */
function viaSocks5(p) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(p.port, p.host);
    withTimeout(socket, reject);
    let stage = "greet";
    let data = "";
    let buf = Buffer.alloc(0);

    const sendConnect = () => {
      const host = Buffer.from(TEST_HOST);
      socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([0, 80])]));
      stage = "connect";
    };

    socket.on("connect", () => {
      socket.write(p.user ? Buffer.from([5, 2, 0, 2]) : Buffer.from([5, 1, 0]));
    });

    socket.on("data", (chunk) => {
      if (stage === "http") {
        data += chunk.toString("utf8");
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      if (stage === "greet" && buf.length >= 2) {
        if (buf[0] !== 5) return reject(new Error("Not a SOCKS5 proxy"));
        const method = buf[1];
        buf = buf.slice(2);
        if (method === 2) {
          const u = Buffer.from(p.user || "");
          const pw = Buffer.from(p.pass || "");
          socket.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]));
          stage = "auth";
        } else if (method === 0) {
          sendConnect();
        } else {
          socket.destroy();
          return reject(new Error("Proxy rejected the login method"));
        }
      }
      if (stage === "auth" && buf.length >= 2) {
        if (buf[1] !== 0) {
          socket.destroy();
          return reject(new Error("Wrong proxy username or password"));
        }
        buf = buf.slice(2);
        sendConnect();
      }
      if (stage === "connect" && buf.length >= 10) {
        if (buf[1] !== 0) {
          socket.destroy();
          return reject(new Error(`Proxy could not connect (code ${buf[1]})`));
        }
        stage = "http";
        socket.write(`GET ${TEST_PATH} HTTP/1.1\r\nHost: ${TEST_HOST}\r\nUser-Agent: proxy-check\r\nConnection: close\r\n\r\n`);
      }
    });
    socket.on("close", () => resolve(data));
  });
}

function readIp(raw) {
  const status = raw.match(/^HTTP\/1\.[01] (\d{3})/);
  if (status && status[1] === "407") throw new Error("Wrong proxy username or password");
  const ip = raw.match(/"ip"\s*:\s*"([^"]+)"/);
  if (!ip) throw new Error(status ? `Proxy answered with HTTP ${status[1]}` : "No answer from proxy");
  return ip[1];
}

/**
 * Tests one proxy line.
 * @returns {Promise<{ok:boolean, ip?:string, ms?:number, protocol?:string, error?:string, label:string}>}
 */
async function checkProxy(line) {
  const p = parseProxy(line);
  if (!p) return { ok: false, label: String(line).slice(0, 40), error: "Not a proxy address" };
  const label = `${p.host}:${p.port}`;
  const order = p.protocol ? [p.protocol] : ["http", "socks5"];
  let lastErr = null;
  for (const proto of order) {
    const started = Date.now();
    try {
      const raw = proto === "socks5" ? await viaSocks5(p) : await viaHttp(p);
      const ip = readIp(raw);
      return { ok: true, ip, ms: Date.now() - started, protocol: proto.toUpperCase(), label };
    } catch (err) {
      lastErr = err;
      // A wrong password won't get better with the other protocol
      if (/password/i.test(err.message)) break;
    }
  }
  return { ok: false, label, error: lastErr ? lastErr.message : "Unknown error" };
}

/** Pulls proxy lines out of delivered credentials text. */
function extractProxies(credentialsText, limit = 3) {
  return String(credentialsText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => parseProxy(l))
    .slice(0, limit);
}

module.exports = { parseProxy, checkProxy, extractProxies };
