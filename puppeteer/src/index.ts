import { getAuthCookies } from "./auth";

async function main() {
    const time = Date.now();
    const cookies = await getAuthCookies();
    console.log(cookies);
    console.log(Date.now() - time);
}

main();