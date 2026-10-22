import { matchBracket, indentedBlock } from "unslop-core";

const TS = /\.[cm]?tsx?$/;
const JS_TS = /\.[cm]?[jt]sx?$/;
const PY = /\.py$/;
const GO = /\.go$/;
const RS = /\.rs$/;
const TEST_FILE = /(?:^|[/\\])(?:tests?|__tests__|spec|fixtures?)[/\\]|[._-](?:test|spec)\.\w+$|(?:^|[/\\])test_[^/\\]+\.py$|_test\.go$/;

const SILENT_CATCH = new RegExp(
  [
    // JS / TS / Java / C# / PHP / Kotlin: empty, console-only or printStackTrace-only catch
    "catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*(?:(?:console\\.(?:log|error|warn)\\([^)]*\\)|\\w+\\.printStackTrace\\(\\))\\s*;?\\s*)?\\}",
    // Python except ...: pass / ... / print(e)
    "except(?:[ \\t]+[\\w.,() \\t]+(?:[ \\t]+as[ \\t]+\\w+)?)?[ \\t]*:\\s*(?:pass\\b|\\.\\.\\.|print\\(\\w*\\)\\s*$)",
    // Go: empty if err != nil {}
    "if\\s+err\\s*!=\\s*nil\\s*\\{\\s*\\}",
    // Ruby: rescue followed directly by end
    "\\brescue(?:[ \\t]+[\\w:, \\t=>]+)?[ \\t]*\\n\\s*end\\b",
  ].join("|"),
  "m"
);

const SQL_INTERP = new RegExp(
  [
    // JS/TS template literal or PHP "$var" interpolation (placeholders like $1 are fine)
    "\\b(?:SELECT|INSERT|UPDATE|DELETE)\\b[^;`\\n]{0,160}\\$(?:\\{|[A-Za-z_])",
    // Python f-strings, .format(), % formatting
    "\\bf[\"'](?:[^\"'\\n]*\\s)?(?:SELECT|INSERT|UPDATE|DELETE)\\b[^\"'\\n]*\\{",
    "\\b(?:SELECT|INSERT|UPDATE|DELETE)\\b[^;\\n\"']{0,160}[\"']\\s*(?:\\.format\\s*\\(|%\\s*[(\\w])",
    // Go fmt.Sprintf / Rust format!
    "\\b(?:fmt\\.Sprintf|format!)\\s*\\(\\s*[\"'`]\\s*(?:SELECT|INSERT|UPDATE|DELETE)\\b",
    // Ruby #{...}
    "\\b(?:SELECT|INSERT|UPDATE|DELETE)\\b[^;\\n\"']{0,160}#\\{",
    // String concatenation
    "\\b(?:SELECT|INSERT|UPDATE|DELETE)\\b[^;\\n\"']{0,120}[\"']\\s*(?:\\+|\\.)\\s*\\$?[a-zA-Z_]\\w*",
  ].join("|"),
  "i"
);

const DB = "(?:db|prisma|sql|pool|client|clickhouse|knex|supabase|redis|axios|session|cursor|conn|tx|gorm|sqlx|reqwest|httpx|requests|repo|repository|model|em|entityManager|collection)";
const IO_CALL = new RegExp(
  `\\bawait\\s+(?:${DB}|fetch)\\b|\\b${DB}\\.(?:query\\w*|exec\\w*|execute|get|post|put|patch|fetch\\w*|find\\w*|create|update\\w*|delete\\w*|insert\\w*|upsert|select|save|scalars?|Query\\w*|Exec\\w*|Get|Post|First|Find|Create|Save)\\s*\\(|\\bprisma\\.\\w+\\.\\w+\\s*\\(|\\.objects\\.(?:get|filter|create|update)\\s*\\(|\\bfetch\\s*\\(`
);

function loopBodies(src, file) {
  const bodies = [];
  if (PY.test(file)) {
    for (const m of src.matchAll(/^[ \t]*(?:async[ \t]+)?for[ \t]+[^\n]+:[ \t]*$/gm)) bodies.push({ index: m.index + m[0].search(/\S/), body: indentedBlock(src, m.index) });
    return bodies;
  }
  for (const m of src.matchAll(/\bfor\s*(?:await\s*)?\(|\bwhile\s*\(|\.(?:map|forEach|flatMap)\s*\(\s*async\b/g)) {
    const paren = src.indexOf("(", m.index);
    const headEnd = matchBracket(src, paren, "()");
    if (headEnd === -1) continue;
    if (m[0].startsWith(".")) {
      bodies.push({ index: m.index, body: src.slice(paren, headEnd) });
      continue;
    }
    const brace = src.slice(headEnd).match(/^\s*\{/);
    const start = brace ? headEnd + brace[0].length - 1 : headEnd;
    const end = brace ? matchBracket(src, start) : src.indexOf(";", start) + 1;
    if (end > start) bodies.push({ index: m.index, body: src.slice(start, end) });
  }
  // Go / Rust / Kotlin / Swift style: `for x in xs {`, `for _, x := range xs {`
  for (const m of src.matchAll(/\bfor\s+(?!\()[^{;\n]+\{/g)) {
    const start = m.index + m[0].length - 1;
    const end = matchBracket(src, start);
    if (end !== -1) bodies.push({ index: m.index, body: src.slice(start, end) });
  }
  return bodies;
}

function nPlusOne(src, file) {
  return loopBodies(src, file).filter((l) => IO_CALL.test(l.body)).map((l) => ({ index: l.index }));
}

function writeWithoutWhere(src) {
  const out = [];
  for (const m of src.matchAll(/\b(?:UPDATE\s+[\w."`]+\s+SET\b|DELETE\s+FROM\s+[\w."`]+)/gi)) {
    const rest = src.slice(m.index + m[0].length, m.index + 600);
    const stop = rest.search(/;|`|"""|'''|\n\s*\n/);
    if (!/\bWHERE\b/i.test(stop === -1 ? rest : rest.slice(0, stop))) out.push({ index: m.index });
  }
  return out;
}

function fetchWithoutSignal(src) {
  const out = [];
  for (const m of src.matchAll(/(?<![.\w$])fetch\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = matchBracket(src, open, "()");
    if (end !== -1 && !/\bsignal\b/.test(src.slice(open, end))) out.push({ index: m.index });
  }
  return out;
}

export const rules = [
  {
    id: "NO_SELECT_STAR",
    severity: "ERROR",
    regex: /(?<!EXISTS\s*\(\s*)\bSELECT\s+(?:\w+\.)?\*\s+FROM\b/i,
    message: "Banned SELECT *. Project explicit columns.",
    examples: [
      { file: "a.ts", bad: ["db.query('SELECT * FROM users')", "sql`SELECT u.* FROM users u`"], good: ["db.query('SELECT id, email FROM users')", "WHERE EXISTS (SELECT * FROM orders o)", "// SELECT * FROM users", "SELECT COUNT(*) FROM users"] },
      { file: "q.sql", bad: ["SELECT * FROM events;"], good: ["-- SELECT * FROM events"] },
    ],
  },
  {
    id: "NO_SQL_INTERPOLATION",
    severity: "ERROR",
    regex: SQL_INTERP,
    message: "String-interpolated or concatenated SQL. Use parameterized bindings ($1, ?, :name, %(name)s, @p1) or a typed query builder.",
    examples: [
      { file: "a.ts", bad: ["db.query(`SELECT id FROM users WHERE id = ${id}`)", "db.query('SELECT id FROM users WHERE id = ' + id)"], good: ["db.query('SELECT id FROM users WHERE id = $1', [id])" ] },
      { file: "a.py", bad: ['cur.execute(f"SELECT id FROM users WHERE id = {uid}")', 'cur.execute("SELECT id FROM t WHERE a = %s" % a)', 'cur.execute("DELETE FROM t WHERE id = {}".format(i))'], good: ['cur.execute("SELECT id FROM users WHERE id = %s", (uid,))'] },
      { file: "a.go", bad: ['db.Query(fmt.Sprintf("SELECT id FROM t WHERE id = %d", id))'], good: ['db.Query("SELECT id FROM t WHERE id = $1", id)'] },
      { file: "a.rb", bad: ['User.where("SELECT id FROM t WHERE name = #{name}")'], good: ['User.where("name = ?", name)'] },
      { file: "a.php", bad: ['$db->query("SELECT id FROM t WHERE id = $id");'], good: ['$stmt = $db->prepare("SELECT id FROM t WHERE id = ?");'] },
    ],
  },
  {
    id: "N_PLUS_ONE_IN_LOOP",
    severity: "ERROR",
    check: nPlusOne,
    message: "DB/HTTP call inside a loop (N+1). Batch with IN (...), ANY($1), bulk upsert, JOIN or a dataloader.",
    examples: [
      { file: "a.ts", bad: ["for (const id of ids) {\n  const u = await db.user.findUnique({ where: { id } });\n}", "await Promise.all(ids.map(async (id) => { await prisma.user.update({ where: { id } }) }))", "for (const x of xs) {\n  await fetch(`/api/${x}`)\n}"], good: ["const users = await db.query('SELECT id FROM users WHERE id = ANY($1)', [ids]);\nfor (const u of users) {\n  out.push(u.id);\n}", "for (const u of users) total += u.n;\nawait db.query('SELECT 1')"] },
      { file: "a.py", bad: ["for uid in ids:\n    row = await session.execute(q)\n"], good: ["for u in users:\n    session.add(u)\nawait session.commit()\n"] },
      { file: "a.go", bad: ["for _, id := range ids {\n\trow := db.QueryRow(q, id)\n}"], good: ["rows, err := db.Query(q, pq.Array(ids))\nfor rows.Next() {\n\trows.Scan(&id)\n}"] },
    ],
  },
  {
    id: "NO_SILENT_CATCH",
    severity: "ERROR",
    regex: SILENT_CATCH,
    message: "Silent or print-only error handler (catch/except/if err != nil/rescue). Log structured context and propagate or map the error.",
    examples: [
      { file: "a.ts", bad: ["try { a() } catch (e) {}", "try { a() } catch { console.error(e) }"], good: ["try { a() } catch (e) { logger.error({ e }, 'a failed'); throw e }"] },
      { file: "A.java", bad: ["try { a(); } catch (Exception e) { e.printStackTrace(); }"], good: ["try { a(); } catch (IOException e) { throw new UncheckedIOException(e); }"] },
      { file: "a.py", bad: ["try:\n    a()\nexcept Exception:\n    pass\n", "try:\n    a()\nexcept ValueError as e:\n    ...\n"], good: ["try:\n    a()\nexcept ValueError as e:\n    log.warning('bad input', exc_info=e)\n    raise\n"] },
      { file: "a.go", bad: ["if err != nil {\n}"], good: ["if err != nil {\n\treturn fmt.Errorf(\"load: %w\", err)\n}"] },
      { file: "a.rb", bad: ["begin\n  a\nrescue StandardError\nend"], good: ["begin\n  a\nrescue StandardError => e\n  Rails.logger.error(e)\n  raise\nend"] },
    ],
  },
  {
    id: "NO_TYPE_ESCAPE",
    severity: "ERROR",
    files: TS,
    regex: /:\s*any\b(?!\s*[,}\]]?\s*\/\/)|\bas\s+any\b|\bas\s+unknown\s+as\b/,
    message: "Type escape (': any', 'as any', 'as unknown as'). Validate the boundary with a schema (Zod, TypeBox, Valibot) and use the inferred type.",
    examples: [{ file: "a.ts", bad: ["function f(body: any) {}", "const u = req.body as any", "const u = x as unknown as User"], good: ["const body = Body.parse(req.body)", "// body: any is banned"] }],
  },
  {
    id: "NO_CHECKER_SUPPRESSION",
    severity: "ERROR",
    scope: "raw",
    regex: /@ts-ignore|@ts-expect-error|#\s*type:\s*ignore\b|eslint-disable/,
    message: "Type-checker/linter suppression. Fix the underlying type or lint error.",
    examples: [
      { file: "a.ts", bad: ["// @ts-ignore\nfoo()", "/* eslint-disable */"], good: ["foo()"] },
      { file: "a.py", bad: ["x = f()  # type: ignore"], good: ["x: int = f()"] },
    ],
  },
  {
    id: "NO_STACK_LEAK",
    severity: "ERROR",
    regex: /\.(?:json|send)\s*\(\s*\{[^}]*\b(?:err|error|e)\.(?:stack|message)\b|\btraceback\.format_exc\s*\(\)|(?:JSONResponse|jsonify|HTTPException)\s*\([^)]*\bstr\((?:e|err|exc|error)\)|\bhttp\.Error\s*\([^,]+,\s*err\.Error\(\)|gin\.H\s*\{[^}]*err\.Error\(\)|\bc\.(?:JSON|String)\s*\([^)]*err\.Error\(\)/,
    message: "Raw error stack/message/traceback returned to the client. Return a sanitized error code and log the details server-side.",
    examples: [
      { file: "a.ts", bad: ["res.status(500).json({ error: err.message })", "res.send({ stack: e.stack })"], good: ["res.status(500).json({ error: 'internal_error', requestId })"] },
      { file: "a.py", bad: ["return JSONResponse({'detail': str(e)}, status_code=500)", "raise HTTPException(500, str(exc))"], good: ["raise HTTPException(status_code=500, detail='internal_error')"] },
      { file: "a.go", bad: ["http.Error(w, err.Error(), 500)", 'c.JSON(500, gin.H{"error": err.Error()})'], good: ['http.Error(w, "internal error", http.StatusInternalServerError)'] },
    ],
  },
  {
    id: "NO_TODO_PLACEHOLDER",
    severity: "ERROR",
    scope: "raw",
    regex: /(?:\/\/|#|--|\/\*)\s*(?:TODO|FIXME|XXX)\b|\btodo!\s*\(|\bunimplemented!\s*\(|\braise\s+NotImplementedError\b|throw\s+new\s+Error\(\s*["'`]not implemented/i,
    message: "Unfinished TODO/FIXME or not-implemented placeholder in backend code.",
    examples: [
      { file: "a.ts", bad: ["// TODO: validate", "throw new Error('Not implemented')"], good: ["const todos = await listTodos()"] },
      { file: "a.py", bad: ["raise NotImplementedError", "# FIXME later"], good: ["todo_items = []"] },
      { file: "a.rs", bad: ["todo!()", "unimplemented!()"], good: ["let todo = 1;"] },
    ],
  },
  {
    id: "WRITE_WITHOUT_WHERE",
    severity: "ERROR",
    check: writeWithoutWhere,
    message: "UPDATE/DELETE without a WHERE clause rewrites or wipes the whole table. Add a WHERE (or use TRUNCATE deliberately).",
    examples: [
      { file: "a.ts", bad: ["await db.query('DELETE FROM sessions')", "db.query(`UPDATE users SET active = false`)"], good: ["await db.query('DELETE FROM sessions WHERE expires_at < now()')", "db.query(`UPDATE users SET active = false WHERE id = $1`, [id])"] },
      { file: "m.sql", bad: ["UPDATE accounts SET balance = 0;"], good: ["UPDATE accounts SET balance = 0 WHERE id = 1;"] },
    ],
  },
  {
    id: "HARDCODED_SECRET",
    severity: "ERROR",
    exclude: TEST_FILE,
    regex: /\b(?:api[_-]?key|secret(?:[_-]?key)?|password|passwd|auth[_-]?token|access[_-]?token|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["'](?!(?:your|change|example|xxx|placeholder|dummy|test|<|\$\{|\*+["']))[^"'\s]{8,}["']|\b(?:sk-(?:live|proj|ant)?[-_A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    message: "Hardcoded credential. Load it from the environment or a secret manager and rotate the leaked value.",
    examples: [
      { file: "a.ts", bad: ["const apiKey = 'a8f5f167f44f4964e6c998dee827110c'", "const k = 'AKIAIOSFODNN7EXAMPLE'", 'password: "hunter2hunter2"'], good: ["const apiKey = process.env.API_KEY", "const password = 'your-password-here'", "secret: '${SECRET}'"] },
      { file: "settings.py", bad: ["SECRET_KEY = 'django-insecure-9x!k2l@w#q'"], good: ["SECRET_KEY = os.environ['SECRET_KEY']"] },
    ],
  },
  {
    id: "TLS_VERIFICATION_DISABLED",
    severity: "ERROR",
    regex: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED["']?\]?\s*=\s*["']?0|\bverify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true|danger_accept_invalid_certs\s*\(\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)/,
    message: "TLS certificate verification disabled. Fix the CA bundle instead of trusting any certificate.",
    examples: [
      { file: "a.ts", bad: ["new https.Agent({ rejectUnauthorized: false })"], good: ["new https.Agent({ ca })"] },
      { file: "a.py", bad: ["requests.get(url, verify=False, timeout=5)"], good: ["requests.get(url, timeout=5)"] },
      { file: "a.go", bad: ["&tls.Config{InsecureSkipVerify: true}"], good: ["&tls.Config{MinVersion: tls.VersionTLS12}"] },
    ],
  },
  {
    id: "WEAK_PASSWORD_HASH",
    severity: "ERROR",
    regex: /\b(?:md5|sha1|sha256)\b[^\n]{0,60}\bpass(?:word|wd)?\b|\bpass(?:word|wd)?\b[^\n]{0,60}\b(?:md5|sha1|sha256)\b/i,
    message: "Passwords hashed with a fast digest. Use argon2id, scrypt or bcrypt.",
    examples: [
      { file: "a.ts", bad: ["const hash = createHash('sha256').update(password).digest('hex')"], good: ["const hash = await argon2.hash(password)"] },
      { file: "a.py", bad: ["hashed = hashlib.md5(password.encode()).hexdigest()"], good: ["hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())"] },
    ],
  },
  {
    id: "INSECURE_RANDOM_TOKEN",
    severity: "ERROR",
    regex: /\b\w*(?:token|secret|otp|nonce|salt|apikey|api_key|reset_?code|session_?id)\w*\s*[:=][^;\n]*(?:Math\.random\(\)|\brandom\.(?:random|randint|choice|choices)\()/i,
    message: "Security token from a non-cryptographic RNG. Use crypto.randomBytes/randomUUID, secrets.token_urlsafe, or crypto/rand.",
    examples: [
      { file: "a.ts", bad: ["const resetToken = Math.random().toString(36).slice(2)"], good: ["const resetToken = randomBytes(32).toString('base64url')", "const jitter = Math.random() * 100"] },
      { file: "a.py", bad: ["otp = random.randint(100000, 999999)"], good: ["otp = secrets.randbelow(900000) + 100000"] },
    ],
  },
  {
    id: "CODE_OR_SHELL_INJECTION",
    severity: "ERROR",
    regex: /(?<![.\w$])eval\s*\(|\bnew\s+Function\s*\(|\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{|\bsubprocess\.\w+\([^)]*shell\s*=\s*True|\bos\.system\s*\(\s*f["']|\bexec\.Command\(\s*"(?:sh|bash)"\s*,\s*"-c"/,
    message: "eval / dynamic code or shell command built from input. Pass arguments as an array (execFile, subprocess.run([...]), exec.Command(bin, args...)).",
    examples: [
      { file: "a.ts", bad: ["eval(req.body.expr)", "exec(`convert ${file} out.png`)"], good: ["execFile('convert', [file, 'out.png'])", "redis.eval(script, 0)"] },
      { file: "a.py", bad: ["subprocess.run(cmd, shell=True)", "os.system(f'rm {path}')"], good: ["subprocess.run(['rm', path], check=True)"] },
    ],
  },
  {
    id: "JWT_UNVERIFIED",
    severity: "ERROR",
    check: (src, file) =>
      [...src.matchAll(JS_TS.test(file) ? /\bjwt\.decode\s*\(|algorithms\s*:\s*\[\s*["']none["']/gi : /["']verify_signature["']\s*:\s*False|algorithms\s*=\s*\[\s*["']none["']/gi)].map((m) => ({ index: m.index })),
    message: "JWT decoded without signature verification. Use jwt.verify / jwt.decode with key and an explicit algorithms allowlist.",
    examples: [
      { file: "a.ts", bad: ["const claims = jwt.decode(token)"], good: ["const claims = jwt.verify(token, key, { algorithms: ['RS256'] })"] },
      { file: "a.py", bad: ["jwt.decode(t, options={'verify_signature': False})"], good: ["jwt.decode(t, key, algorithms=['RS256'])"] },
    ],
  },
  {
    id: "CORS_WILDCARD",
    severity: "WARN",
    regex: /\borigin\s*:\s*(?:["']\*["']|true)|Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*|allow_origins\s*=\s*\[\s*["']\*["']\s*\]|AllowAllOrigins\s*:\s*true|AllowOrigins\s*:\s*\[\]string\{\s*"\*"/,
    message: "CORS allows every origin. List the allowed origins explicitly, especially with credentials.",
    examples: [
      { file: "a.ts", bad: ["app.use(cors({ origin: '*', credentials: true }))", "res.setHeader('Access-Control-Allow-Origin', '*')"], good: ["app.use(cors({ origin: ['https://app.example.com'] }))"] },
      { file: "a.py", bad: ["app.add_middleware(CORSMiddleware, allow_origins=['*'])"], good: ["app.add_middleware(CORSMiddleware, allow_origins=settings.origins)"] },
    ],
  },
  {
    id: "NO_REQUEST_TIMEOUT",
    severity: "WARN",
    exclude: TEST_FILE,
    files: PY,
    regex: /\b(?:requests|httpx)\.(?:get|post|put|patch|delete|head|request)\((?![^)]*\btimeout\s*=)[^)]*\)/,
    message: "Outbound HTTP call without a timeout can hang a worker forever. Pass timeout=.",
    examples: [{ file: "a.py", bad: ["r = requests.get(url)"], good: ["r = requests.get(url, timeout=5)"] }],
  },
  {
    id: "FETCH_WITHOUT_TIMEOUT",
    severity: "WARN",
    files: JS_TS,
    exclude: TEST_FILE,
    check: fetchWithoutSignal,
    message: "fetch() without an AbortSignal never times out. Pass `signal: AbortSignal.timeout(ms)`.",
    examples: [{ file: "a.ts", bad: ["const r = await fetch(url)", "await fetch(url, { method: 'POST', body })"], good: ["await fetch(url, { signal: AbortSignal.timeout(5000) })", "await this.fetch(url)"] }],
  },
  {
    id: "GO_DEFAULT_HTTP_CLIENT",
    severity: "WARN",
    files: GO,
    regex: /\bhttp\.(?:Get|Post|PostForm|Head)\s*\(|&?http\.Client\s*\{\s*\}/,
    message: "Go's default http client has no timeout. Use &http.Client{Timeout: ...} or a context deadline.",
    examples: [{ file: "a.go", bad: ["resp, err := http.Get(url)", "c := &http.Client{}"], good: ["c := &http.Client{Timeout: 10 * time.Second}"] }],
  },
  {
    id: "UNBOUNDED_QUERY",
    severity: "WARN",
    regex: /\.findMany\s*\(\s*\)|\.findAll\s*\(\s*\)|\.find\s*\(\s*\{\s*\}\s*\)|\.objects\.all\s*\(\s*\)|\bModel\.all\b/,
    message: "Unbounded read: no LIMIT/take. Paginate with a cursor or an explicit limit.",
    examples: [
      { file: "a.ts", bad: ["const users = await prisma.user.findMany()", "await User.find({})"], good: ["await prisma.user.findMany({ take: 50, cursor })"] },
      { file: "a.py", bad: ["Order.objects.all()"], good: ["Order.objects.filter(user=u)[:50]"] },
    ],
  },
  {
    id: "GO_IGNORED_ERROR",
    severity: "WARN",
    files: GO,
    exclude: TEST_FILE,
    regex: /^[ \t]*(?:_|\w+\s*,\s*_)\s*:?=\s*[\w.]+\(/m,
    message: "Error return discarded with `_`. Handle or wrap it.",
    examples: [{ file: "a.go", bad: ["\t_ = json.Unmarshal(b, &v)", "\tf, _ := os.Open(p)"], good: ["\tf, err := os.Open(p)", "\t_, ok := m[k]"] }],
  },
  {
    id: "RUST_UNWRAP",
    severity: "WARN",
    files: RS,
    exclude: TEST_FILE,
    check: (src) => {
      const cut = src.search(/#\[cfg\(test\)\]/);
      const body = cut === -1 ? src : src.slice(0, cut);
      return [...body.matchAll(/\.unwrap\(\)|\.expect\(\s*""\s*\)/g)].map((m) => ({ index: m.index }));
    },
    message: ".unwrap() panics the request/worker on error. Propagate with `?` and a typed error.",
    examples: [{ file: "a.rs", bad: ["let v = s.parse::<u32>().unwrap();"], good: ["let v = s.parse::<u32>()?;", "fn a() {}\n#[cfg(test)]\nmod tests {\n    fn t() { f().unwrap(); }\n}"] }],
  },
  {
    id: "PY_BARE_EXCEPT",
    severity: "WARN",
    files: PY,
    regex: /^[ \t]*except[ \t]*:/m,
    message: "Bare `except:` also catches KeyboardInterrupt/SystemExit. Catch specific exceptions.",
    examples: [{ file: "a.py", bad: ["try:\n    a()\nexcept:\n    log()\n"], good: ["try:\n    a()\nexcept ValueError:\n    log()\n"] }],
  },
];
