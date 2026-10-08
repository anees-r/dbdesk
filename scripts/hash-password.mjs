#!/usr/bin/env node
// Prints env lines for dbdesk's admin login.
//   npm run hash-password            (prompts, input hidden)
//   node scripts/hash-password.mjs   (same, inside the container)
import crypto from "node:crypto";
import readline from "node:readline";

const tty = Boolean(process.stdin.isTTY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
rl._writeToOutput = () => {}; // never echo what's typed

// Queue lines so piped input (two lines at once) works as well as typing.
const lines = [];
const waiters = [];
rl.on("line", (l) => (waiters.length ? waiters.shift()(l) : lines.push(l)));
rl.on("close", () => waiters.splice(0).forEach((w) => w(null)));

function ask(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    const done = (l) => { process.stdout.write("\n"); resolve(l); };
    lines.length ? done(lines.shift()) : waiters.push(done);
  });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const pw = await ask("New admin password: ");
if (!pw || pw.length < 12) fail("Use at least 12 characters.");
const again = await ask("Repeat password: ");
rl.close();
if (again !== pw) fail("Passwords don't match.");

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });

console.log("\nAdd these to your environment (Coolify → Environment Variables):\n");
console.log(`ADMIN_PASSWORD_HASH=scrypt:${salt.toString("hex")}:${hash.toString("hex")}`);
console.log(`SESSION_SECRET=${crypto.randomBytes(32).toString("hex")}`);
console.log("\nKeep the same SESSION_SECRET when you only change the password; changing either logs out all sessions.");
