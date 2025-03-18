import { redisClient } from "./lib/redis";
import { Client } from "discord.js";

export async function redisEventHandler(client: Client) {
  redisClient.subscribe("echo", (message) => {
    console.log("echo", message);
  });
}
