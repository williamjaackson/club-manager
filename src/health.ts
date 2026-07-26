import { createServer, type Server } from "node:http";
import type { Client } from "discord.js";

export function startHealthServer(client: Client, port: number): Server {
  const server = createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end("Not found\n");
      return;
    }

    const ready = client.isReady();
    response
      .writeHead(ready ? 200 : 503, { "content-type": "application/json" })
      .end(JSON.stringify({ ready }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Health endpoint listening on port ${port}`);
  });

  return server;
}
