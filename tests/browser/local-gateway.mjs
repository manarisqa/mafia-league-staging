import { createServer } from "node:http";
import { request } from "node:http";

const targets = {
  "auth": Number(process.env.QA_AUTH_PORT || "55421"),
  "rest": Number(process.env.QA_REST_PORT || "55422"),
};
const server = createServer((incoming, outgoing) => {
  const match = /^\/(auth|rest)\/v1(?:\/|$)(.*)$/.exec(incoming.url);
  if (!match) {
    outgoing.writeHead(404).end();
    return;
  }
  const upstream = request({
    hostname: "127.0.0.1", port: targets[match[1]], path: "/" + match[2],
    method: incoming.method, headers: incoming.headers,
  }, (response) => {
    outgoing.writeHead(response.statusCode, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => outgoing.writeHead(502).end());
  incoming.pipe(upstream);
});
server.listen(Number(process.env.QA_GATEWAY_PORT || "55423"), "127.0.0.1");
