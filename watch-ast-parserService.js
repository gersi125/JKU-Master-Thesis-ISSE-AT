const crypto = require('crypto');
const { Parser, Language } = require('web-tree-sitter');
const { GRAMMAR_WASM } = require('./watch-ast-config');

let parser;

async function initParser() {
    await Parser.init();
    parser = new Parser();
    const CSharp = await Language.load(GRAMMAR_WASM);
    parser.setLanguage(CSharp);
}

function parse(content) {
    return parser.parse(content);
}

function hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Normalizes content before hashing so pure whitespace/blank-line changes
// don't register as a "real" edit and don't trigger a snapshot/diff cycle.
function normalizeForHash(content) {
    return content
        .replace(/[ \t]+$/gm, '')   // strip trailing whitespace per line
        .replace(/\n{2,}/g, '\n')  // collapse any run of blank lines to a single newline
        .trim();
}

module.exports = {
    initParser,
    parse,
    hashContent,
    normalizeForHash
};