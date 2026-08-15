const path = require("path");

module.exports = {
TARGET_FILE: 'C:\\Users\\gersi\\Documents\\at.jku.isse.treesitter\\gv-sample-csharp-project\\test.cs',
SNAPSHOT_DIR: path.join(__dirname, 'snapshots'),
GUMTREE_CMD: 'C:\\GumTree\\dist\\build\\distributions\\gumtree-4.0.0-beta8-SNAPSHOT\\bin\\gumtree.bat',
DIFF_LOG: path.join(__dirname, 'diff-log.txt'),
WEBDIFF_MIN_INTERVAL_MS: 3000,
GRAMMAR_WASM: path.join(__dirname, 'tree-sitter-c_sharp.wasm')
}