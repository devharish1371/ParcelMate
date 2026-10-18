import { db } from "../src/db.js";
import { setTicketStatus, supportInbox, supportTicket } from "../src/support.js";

const [command, first, second] = process.argv.slice(2);
let result;
if (command === "list") result = supportInbox(first || "received");
else if (command === "show" && first) result = supportTicket(first) || { error: "Ticket not found." };
else if (command === "status" && first && second) result = setTicketStatus(first, second);
else result = { error: "Usage: npm run support -- list [received|in_review|resolved|all] | show <id> | status <id> <in_review|resolved>" };

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
db.close();
if (result?.error) process.exitCode = 1;
