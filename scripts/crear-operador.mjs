#!/usr/bin/env node
/**
 * Crea (o restablece) una cuenta de operador del panel de administración (/admin).
 *
 *   node scripts/crear-operador.mjs staging
 *   node scripts/crear-operador.mjs production
 *   node scripts/crear-operador.mjs local
 *
 * Pide correo, nombre y contraseña, calcula el hash igual que la API (PBKDF2-SHA256, 100 000 iteraciones)
 * y lo guarda en la base de control con `wrangler d1 execute`. Si el correo ya existe, cambia su
 * contraseña y lo reactiva (sirve para recuperar el acceso). Nada se manda por la red salvo a Cloudflare.
 *
 * Requisitos: haber desplegado al menos una vez con la migración 0004 (npm run deploy:staging) y tener
 * la sesión de wrangler iniciada (npx wrangler login).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ENVS = { local: ["--local"], staging: ["--remote", "--env", "staging"], production: ["--remote", "--env", "production"] };
const env = process.argv[2];
if (!ENVS[env]) {
  console.error("Uso: node scripts/crear-operador.mjs <local|staging|production>");
  process.exit(1);
}

/* ---------- Prompts (the password is not echoed) ---------- */
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
rl._writeToOutput = function (text) {
  if (!muted || text.includes("\n") || text.includes("\r")) rl.output.write(muted ? "\n" : text);
};
const ask = (q, hidden = false) =>
  new Promise((ok) => {
    muted = false;
    rl.output.write(q);
    muted = hidden;
    rl.question("", (a) => { muted = false; ok(a); });
  });

const email = (await ask("Correo del operador: ")).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Correo no válido."); process.exit(1); }
const name = (await ask("Nombre: ")).trim() || email.split("@")[0];
const password = await ask("Contraseña (mínimo 10 caracteres): ", true);
if (password.length < 10) { console.error("La contraseña debe tener al menos 10 caracteres."); process.exit(1); }
const again = await ask("Repite la contraseña: ", true);
rl.close();
if (again !== password) { console.error("Las contraseñas no coinciden."); process.exit(1); }

/* ---------- Hash: same format as apps/api/src/lib/crypto.ts ---------- */
const ITERATIONS = 100_000;
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
const hash = `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;

/* ---------- Sortable id (ULID layout, like newId() in the API) ---------- */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let time = Date.now();
let id = "";
for (let i = 0; i < 10; i++) { id = ALPHABET[time % 32] + id; time = Math.floor(time / 32); }
for (const b of crypto.getRandomValues(new Uint8Array(16))) id += ALPHABET[b % 32];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `INSERT INTO platform_operators (id, email, name, password_hash, active) VALUES (${q(id)}, ${q(email)}, ${q(name)}, ${q(hash)}, 1)
ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, active = 1;
INSERT INTO platform_audit (id, operator_id, operator_name, action, entity, entity_id, summary) VALUES (${q(`${id}L`)}, NULL, 'Script crear-operador', 'operator.create', 'operator', (SELECT id FROM platform_operators WHERE email = ${q(email)}), ${q(`${name} (${email})`)});
`;

const dir = mkdtempSync(join(tmpdir(), "nexo-op-"));
const file = join(dir, "operador.sql");
writeFileSync(file, sql);
const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/api");
const win = process.platform === "win32";
const args = ["wrangler", "d1", "execute", "DB_CONTROL", ...ENVS[env], `--file=${win ? `"${file}"` : file}`, "--yes"];
console.log(`\nGuardando el operador en ${env}…`);
const res = spawnSync("npx", args, { cwd: apiDir, stdio: ["inherit", "pipe", "pipe"], shell: win, encoding: "utf8" });
rmSync(dir, { recursive: true, force: true });
const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
if (res.status !== 0) {
  console.error(out);
  if (/no such table: platform_operators/.test(out)) console.error("\nFalta la migración del panel de administración. Despliega primero: npm run deploy:" + (env === "local" ? "… (o npm run db:migrate:local)" : env));
  process.exit(1);
}
const url = env === "local" ? "http://localhost:5173/admin/" : "<APP_URL>/admin/";
console.log(`\nListo. ${name} (${email}) ya puede entrar en ${url}`);
