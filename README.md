# Requirements || Running the Applications ||Running Tests 

All commands below are PowerShell commands, run from that folder.

---

## 1. What the program does

It watches one C# file, parses it with Tree-sitter, compares each new version with the last valid one using GumTree, and writes one readable line per semantic change to `diff-log.txt`.

Main files:

| File | Role |
|---|---|
| `watch-ast.js` | Entry point. Polls the target file (every 500 ms) |
| `watch-ast-config.js` | Configuration (target file `TARGET_FILE`, paths) |
| `watch-ast-parserService.js` | Tree-sitter parsing and hashing |
| `watch-ast-snapshotService.js` | Stores snapshots of the last valid version |
| `watch-ast-gumtreeService.js` | Runs GumTree and builds the `Line ...` log entries |
| `watch-ast-webdiffService.js` | Browser editor (CodeMirror) and the `/log` and `/save` endpoints |
| `tree-sitter-c_sharp.wasm` | C# grammar, must stay next to the scripts |

---

## 2. Prerequisites


- Node.js + npm | v25.9.0 (Node 21+ needed for test glob) | Watcher, parser, tests (`node:test`, no extra packages)
  (the project has been run with v25.9.0). Check with `node -v`.
- GumTree installed at
  `C:\GumTree\dist\build\distributions\gumtree-4.0.0-beta8-SNAPSHOT\bin\gumtree.bat`
  (the path is set in `watch-ast-gumtreeService.js` as `GUMTREE_CMD`). Check with:
  ```powershell
  Test-Path "C:\GumTree\dist\build\distributions\gumtree-4.0.0-beta8-SNAPSHOT\bin\gumtree.bat"
  ```
  It must print `True`. GumTree itself needs Java, so `java -version` must work.
- **Dependencies** (first time only, or after pulling changes):
  ```powershell
  npm install
- tree-sitter-c_sharp.wasm | – | C# grammar, next to the scripts |
- GumTree | 4.0.0-beta8-SNAPSHOT | AST diff (`textdiff -f JSON`) |
- `tree-sitter-c_sharp.wasm` is in the project folder.
  ```

## 3. Starting the program

1. Open `watch-ast-config.js` and check that `TARGET_FILE` points to the C# file you want to watch.
2. Start the watcher:
   ```powershell
   node watch-ast.js
   ```
3. Edit and save the target file (in VS Code, or in the browser editor). Every save that changes the code produces new lines in `diff-log.txt`.
4. Stop with `Ctrl + C` in the terminal.

Things to know:

- **Browser editor:** the web server is started by the watcher. The address and port are set in `watch-ast-config.js` and/or printed in the terminal when the program starts. Open that address in a browser to see the editor (green = inserted, amber = updated, red strikethrough = deleted) and the live log pane.
- **No change, no log line.** Whitespace-only and indentation-only edits are intentionally silent.
- **Half-typed code** (syntax errors) does not crash the watcher. The last valid snapshot stays the reference.
- A `DEP0190` deprecation warning about `shell: true` in the terminal is harmless.

---

## 4. Running the tests

The tests use Node's built-in test runner. No extra packages are needed.

### 4.1 One-time check of `package.json`

The `scripts` section must look like this (the quotes around the glob matter):

```json
"scripts": {
  "test": "node --test \"tests/**/*.test.js\"",
  "test:update": "set UPDATE_SNAPSHOTS=1&& node --test \"tests/**/*.test.js\"",
  "test:dump": "node tests/dump.js"
}
```

`set UPDATE_SNAPSHOTS=1&&` has no space before `&&`. That is required in Windows `cmd`.

### 4.2 Commands

| Goal | Command |
|---|---|
| Run all tests | `npm test` |
| Run all tests, show only the result lines | `npm test 2>&1 \| Select-String "(pass\|fail\|todo\|cancelled\|tests) \d+"` |
| Print what the log produces for every case (to look at it) | `npm run test:dump` |
| Same, plus the raw result object | `$env:RAW = "1"; npm run test:dump` |
| Save the current output as the new expected snapshots | `npm run test:update` |

Each case needs about 0.7 to 1.2 seconds (GumTree runs as a separate process), so the full suite takes roughly 1 to 1.5 minutes.

If the symbols in the output look garbled (`Ô£ö` instead of a check mark), run this once in the PowerShell window. It does not affect the results:

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
```

### 4.3 Reading the result

```
tests 59
pass 49
fail 0
todo 10
```

| Symbol | Meaning |
|---|---|
| check mark | Case passed |
| cross | Case failed. This is a real problem; read the message under "failing tests" |
| warning sign + `# reason` | **Known defect** (`todo`). Shown on purpose, never fails the suite |

The agreed baseline is **0 failures**. The `todo` count is the number of known defects and should only go down.

### 4.4 Folder layout

```
tests\
  adapter.js            only file that knows the program internals
  harness.js            inClass(), inMethod(), diff(), L() helpers
  snapshot.js           snapshot compare / update
  dump.js               prints the output of every case
  run-cases.test.js     turns the case tables into tests
  invariants.test.js    general rules (no change = no output, etc.)
  cases\
    members.cases.js  signatures.cases.js  reorder.cases.js
    statements.cases.js  expressions.cases.js  cosmetic.cases.js
  snapshots\            expected output, one .txt per case (generated)
```

`run-cases.test.js` must be in `tests\`, not in `tests\cases\`.

---

## 5. Working with the tests

### Adding a case

Open the matching file in `tests\cases\` and add an entry:

```js
{ name: 'add parameter at end',
  before: inClass('void F(int a) { }'),
  after:  inClass('void F(int a, int b) { }'),
  expect: [L('+ param C.F(int,int) @2/2', 'int b')],   // lines that must exist
  forbid: [L('mv ')] }                                  // lines that must NOT exist (optional)
```

- `name` must be unique inside its file (the runner stops on duplicates).
- `inClass(...)` wraps a class-member snippet, `inMethod(...)` wraps a statement snippet.
- `L(prefix, tail)` matches a log line at any line number: the operation and construct, plus text that must appear later in the line.
- `silent: true` instead of `expect` means: this change must produce no log entries.
- `known: 'reason'` marks a known defect. It is reported as a warning and does not fail the suite.

Then run:

```powershell
npm run test:update
npm test
```

### When you change the log format on purpose

1. `npm run test:update` rewrites the snapshots.
2. Open the changes in `tests\snapshots\` (or `git diff`) and read them. Accept only changes you intended.
3. `npm test` must be green again.

A snapshot is never created silently. A missing snapshot makes the case fail with a message telling you to run `npm run test:update`.

### When you fix a known defect

1. Remove the `known:` line from the case.
2. Run `npm run test:update` to write its snapshot.
3. Check that the `todo` count went down by one and nothing else changed.

---

## 6. Troubleshooting

| Message | Cause and fix |
|---|---|
| `Cannot find module '...\tests'` | Old runner syntax. Use the glob form in `package.json` (section 4.1) |
| `Cannot find module './adapter'` | `run-cases.test.js` is in the wrong folder. Move it to `tests\` |
| `Duplicate case name in <file>: "<name>"` | The same `name` exists twice in that case file. Delete one |
| `No snapshot for "<group> <case>"` | New case without snapshot. Run `npm run test:update` and review the file |
| `os is not defined` / `exec is not defined` | Missing `require` line at the top of `watch-ast-gumtreeService.js` |
| `parse error` for every case | The raw JSON string must be passed to `parseGumTreeSummary`, not an already parsed object |
| Every test cancelled | A failure in a group (often a duplicate name) stops that whole group. Read the first error |
| GumTree not found | Check the `GUMTREE_CMD` path and `java -version` |

---

## 7. Open work (from the 10 `todo` cases)

- Wrapping a statement in `if` / `using` and unwrapping: the moved statement is not shown in the log.
- Reordering array initializer elements: the log cannot replay the new order.
- Text rendering: initializer content hidden by `{ ... }`, garbled marker on string interpolation, duplicate `+ expr` / `+ ternary`, noise `~ id` line on generic methods.
- Expression-bodied members (`=>`) are reported as method insert plus delete.
