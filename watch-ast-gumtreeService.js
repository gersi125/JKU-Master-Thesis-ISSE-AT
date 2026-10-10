// ===========================================================================
// watch-ast-GumtreeService.js
//
// Runs GumTree on two snapshots of the watched C# file and writes ONE compact,
// structured line per semantic change into diff-log.txt.
//
// LOG ENTRY
//   [ISO time] old-snapshot.cs -> new-snapshot.cs: +1 -2 ~1 mv1
//     <change line>
//     <change line>
//
// CHANGE LINE
//   L<line> <op> <kind> <where> : <detail>
//
//   line   '+' lines: line in the NEW snapshot.  '-' and '~' lines: line in the
//          OLD snapshot.  'L9->12' = old line -> new line (moves, paired edits).
//   op     +  added     -  removed     ~  modified     mv  reordered / moved
//   kind   class | struct | interface | enum | record | ctor | method | prop |
//          field | var | param | arg | elem | assign | incr | decr | op-assign |
//          call | stmt | return | if | else | for | foreach | while | switch |
//          try | catch | using | mod | access | type | rename | ...
//   where  owner path, e.g.  Teacher.ctor(string,int)   Person.Greet(string)
//          positional elements add  @index/total  (1-based), e.g.
//          Teacher.ctor(string,int) @2/2     Console.WriteLine @1/3 in Program.Main()
//   detail declared type / initial value / [modifiers] / statement text /
//          'old -> new' for modifications, with an optional [edit note]
//
// Set WATCH_AST_RAW=1 to also write the raw GumTree action lines,
// WATCH_AST_DEBUG=1 for console diagnostics.
// ===========================================================================

const { spawn } = require('child_process');
const GUMTREE_BAT = 'C:\\GumTree\\dist\\build\\distributions\\gumtree-4.0.0-beta8-SNAPSHOT\\bin\\gumtree.bat';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { GUMTREE_CMD, DIFF_LOG } = require('./watch-ast-config');
const { setHighlights } = require('./watch-ast-webdiffService');
const { parse } = require('./watch-ast-parserService');

const LOG_RAW_ACTIONS = process.env.WATCH_AST_RAW === '1';
const DEBUG = process.env.WATCH_AST_DEBUG === '1';
const MAX_TEXT = 120;      // max characters of source text in one log line
const MAX_PAIR_TEXT = 80;  // max characters per side of an 'old -> new' pair

function dbg(...args) {
    if (DEBUG) console.log(...args);
}

// ---------------------------------------------------------------------------
// Vocabulary: GumTree node types (the "type" in its JSON) and Tree-sitter node
// types are both normalised to Tree-sitter-style names, then labelled with a
// short kind word.
// ---------------------------------------------------------------------------

const TYPE_ALIASES = {
    expr_stmt: 'expression_statement',
    decl_stmt: 'local_declaration_statement',
    decl: 'variable_declaration',
    function: 'method_declaration',
    constructor: 'constructor_declaration',
    class: 'class_declaration',
    property: 'property_declaration',
    if_stmt: 'if_statement'
};

const KIND = {
    class_declaration: 'class',
    struct_declaration: 'struct',
    interface_declaration: 'interface',
    record_declaration: 'record',
    enum_declaration: 'enum',
    method_declaration: 'method',
    local_function_statement: 'local-fn',
    constructor_declaration: 'ctor',
    field_declaration: 'field',
    property_declaration: 'prop',
    variable_declaration: 'var',
    local_declaration_statement: 'var',
    variable_declarator: 'var',
    parameter: 'param',
    parameter_list: 'params',
    argument: 'arg',
    argument_list: 'args',
    namespace_declaration: 'namespace',
    file_scoped_namespace_declaration: 'namespace',
    using_directive: 'using',
    identifier: 'id',
    name: 'id',
    string_literal: 'string',
    integer_literal: 'number',
    real_literal: 'number',
    boolean_literal: 'bool',
    character_literal: 'char',
    null_literal: 'null',
    literal: 'literal',
    invocation_expression: 'call',
    object_creation_expression: 'new',
    assignment_expression: 'assign',
    postfix_unary_expression: 'expr',
    prefix_unary_expression: 'expr',
    expression_statement: 'stmt',
    return_statement: 'return',
    break_statement: 'break',
    continue_statement: 'continue',
    yield_statement: 'yield',
    throw_statement: 'throw',
    if_statement: 'if',
    else_clause: 'else',
    for_statement: 'for',
    foreach_statement: 'foreach',
    while_statement: 'while',
    do_statement: 'do',
    switch_statement: 'switch',
    switch_section: 'case',
    try_statement: 'try',
    catch_clause: 'catch',
    finally_clause: 'finally',
    lock_statement: 'lock',
    using_statement: 'using-block',
    modifier: 'mod',
    specifier: 'mod'
};

function canonType(rawType) {
    return TYPE_ALIASES[rawType] || rawType;
}

function humanizeType(rawType) {
    if (!rawType) return 'element';
    return KIND[canonType(rawType)] || KIND[rawType] || rawType;
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

function collapse(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function short(text, max = MAX_TEXT) {
    const t = collapse(text);
    return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

// Everything before the first '{' (the "head" of a block-bearing construct).
function core(text) {
    const i = text.indexOf('{');
    return (i === -1 ? text : text.slice(0, i)).trim();
}

// Header-only preview so a block-bearing construct never dumps its body.
function headerPreview(collapsedText) {
    const i = collapsedText.indexOf('{');
    if (i !== -1) return collapsedText.slice(0, i).trim() + ' { ... }';
    return collapsedText;
}

function joinPath(owner, segment) {
    return owner ? `${owner}.${segment}` : segment;
}

// ---------------------------------------------------------------------------
// File / tree cache. Every action used to re-read and re-parse the file; now a
// snapshot is read and parsed at most once per diff.
// ---------------------------------------------------------------------------

const fileCache = new Map();

function loadFile(filePath) {
    if (!filePath) return null;
    let st;
    try {
        st = fs.statSync(filePath);
    } catch (e) {
        return null;
    }
    const hit = fileCache.get(filePath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return null;
    }
    const entry = {
        filePath, content, mtimeMs: st.mtimeMs, size: st.size,
        tree: null, treeTried: false, lineStarts: null, flat: null
    };
    fileCache.set(filePath, entry);
    return entry;
}

function treeOf(entry) {
    if (!entry) return null;
    if (!entry.treeTried) {
        entry.treeTried = true;
        try {
            entry.tree = parse(entry.content);
        } catch (e) {
            dbg('  [parse] failed:', e.message);
        }
    }
    return entry.tree;
}

function flatText(entry) {
    if (entry.flat === null) entry.flat = entry.content.replace(/\s+/g, ' ');
    return entry.flat;
}

// 1-based line number of a character offset.
function lineAt(entry, offset) {
    if (!entry || offset === null || offset === undefined) return null;
    if (!entry.lineStarts) {
        const starts = [0];
        const c = entry.content;
        for (let i = 0; i < c.length; i++) {
            if (c.charCodeAt(i) === 10) starts.push(i + 1);
        }
        entry.lineStarts = starts;
    }
    const ls = entry.lineStarts;
    let lo = 0;
    let hi = ls.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ls[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
}

// GumTree's "tree" field comes in two shapes:
//   "type [start,end]"           - structural node, no inline label
//   "type: oldLabel [start,end]" - leaf node (identifier/literal) that
//                                   carries its own text inline
function parseTreeField(rawTree) {
    const withLabel = rawTree.match(/^(\S+):\s*(.*?)\s*\[(\d+),\s*(\d+)\]$/);
    if (withLabel) {
        return {
            elementType: withLabel[1],
            inlineLabel: withLabel[2],
            start: parseInt(withLabel[3], 10),
            end: parseInt(withLabel[4], 10)
        };
    }

    const plain = rawTree.match(/^(\S+)\s*\[(\d+),\s*(\d+)\]$/);
    if (plain) {
        return {
            elementType: plain[1],
            inlineLabel: null,
            start: parseInt(plain[2], 10),
            end: parseInt(plain[3], 10)
        };
    }

    return { elementType: rawTree, inlineLabel: null, start: null, end: null };
}

// First line of the source at [start,end] (used for highlight labels).
function extractSnippet(filePath, start, end) {
    if (start === null || end === null) return null;
    const entry = loadFile(filePath);
    if (!entry) return null;
    let snippet = entry.content.substring(start, end);
    snippet = snippet.split('\n')[0].trim().replace(/\s+/g, ' ');
    if (snippet.length > 200) snippet = snippet.slice(0, 200) + '...';
    return snippet || null;
}

// 0-based line (the web IDE highlights use 0-based hints).
function lineNumberAt(filePath, offset) {
    const entry = loadFile(filePath);
    const line = lineAt(entry, offset);
    return line === null ? null : line - 1;
}

// Finds the smallest node in the tree whose range fully contains [start,end].
function findExactOrSmallestNode(rootNode, start, end) {
    let best = rootNode;
    (function walk(node) {
        if (node.startIndex <= start && node.endIndex >= end) {
            best = node;
            for (let i = 0; i < node.childCount; i++) {
                walk(node.child(i));
            }
        }
    })(rootNode);
    return best;
}

function nodeAt(entry, start, end) {
    const tree = treeOf(entry);
    if (!tree || start === null || start === undefined || end === null || end === undefined) return null;
    return findExactOrSmallestNode(tree.rootNode, start, end);
}

// Outermost node with exactly this range and type (null if none).
function findSameNode(rootNode, type, start, end) {
    let n = findExactOrSmallestNode(rootNode, start, end);
    while (n) {
        if (n.startIndex !== start || n.endIndex !== end) return null;
        if (n.type === type) return n;
        n = n.parent;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

const ACCESS_MODIFIERS = new Set(['public', 'private', 'protected', 'internal']);

const MODIFIER_WORDS = [
    'public', 'private', 'protected', 'internal',
    'static', 'readonly', 'const', 'virtual', 'override', 'abstract',
    'async', 'sealed', 'new', 'extern', 'unsafe', 'partial', 'volatile',
    'required', 'ref', 'out', 'in', 'params', 'this'
];

const MODIFIER_NODE_TYPES = new Set(['specifier', 'modifier']);
const MODIFIER_PATTERN = new RegExp(`^((?:(?:${MODIFIER_WORDS.join('|')})\\s+)*)`);

// Pulls leading attributes and modifier keywords off a declaration snippet
// ("[Obsolete] public static readonly ...") and returns the modifier list and
// the remaining text to parse further.
function extractModifiers(text) {
    const stripped = text.replace(/^(?:\s*\[[^\]]*\]\s*)+/, '');
    const m = stripped.match(MODIFIER_PATTERN);
    const modifiersText = m ? m[1].trim() : '';
    const modifiers = modifiersText ? modifiersText.split(/\s+/) : [];
    const rest = stripped.slice(m ? m[1].length : 0);
    return { modifiers, rest };
}

const LOCAL_LIKE = new Set(['local_declaration_statement', 'variable_declaration', 'parameter']);

// " [public static]" for members; " [default]" when a member has no explicit
// modifier; '' for locals and parameters.
function fmtMods(canon, modifiers) {
    if (LOCAL_LIKE.has(canon)) return '';
    if (!modifiers || modifiers.length === 0) return ' [default]';
    return ` [${modifiers.join(' ')}]`;
}

// ---------------------------------------------------------------------------
// Declaration analysis (regex on the declaration text; robust against
// Tree-sitter node-name differences)
// ---------------------------------------------------------------------------

const CLASS_LIKE = new Set([
    'class_declaration', 'struct_declaration', 'interface_declaration',
    'record_declaration', 'enum_declaration'
]);

const VARIABLE_LIKE = new Set([
    'field_declaration', 'property_declaration', 'variable_declaration',
    'local_declaration_statement', 'parameter'
]);

const TYPE_PATTERN = '([\\w.]+(?:<.+?>)?(?:\\[[, ]*\\])*\\??)';
const VARIABLE_PATTERN = new RegExp(`^${TYPE_PATTERN}\\s+(\\w+)\\s*(?:=(?![>=])\\s*(.+?)\\s*(?:;|\\{|$))?`);

// Splits on top-level commas only, so generics like Dictionary<string,int> and
// nested calls stay in one piece.
function splitTopLevelCommas(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if ('([<'.includes(ch)) depth++;
        if (')]>'.includes(ch)) depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current);
    return parts;
}

// Text between the '(' at openIdx and its matching ')'.
function balancedParens(text, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const c = text[i];
        if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) return text.slice(openIdx + 1, i);
        }
    }
    return null;
}

// "string name, int age = 3"  ->  ['string', 'int']
function paramTypes(paramsText) {
    if (!paramsText || !paramsText.trim()) return [];
    return splitTopLevelCommas(paramsText).map(p => {
        let s = p.trim().replace(/^(?:\s*\[[^\]]*\]\s*)+/, '').replace(/\s*=\s*[\s\S]*$/, '').trim();
        s = s.replace(/^(?:(?:this|ref|out|in|params|readonly|scoped)\s+)+/, '');
        const m = s.match(/^([\s\S]+?)\s+(\w+)$/);
        return m ? m[1].trim() : s;
    });
}

function parseSignature(rest, isCtor) {
    const open = rest.indexOf('(');
    if (open < 1) return null;
    const head = rest.slice(0, open).trim();
    const params = balancedParens(rest, open);
    if (params === null) return null;
    if (isCtor) {
        const m = head.match(/^(\w+)$/);
        return m ? { name: m[1], returnType: null, parameters: params.trim() } : null;
    }
    const m = head.match(/^(.+?)\s+(\w+)(?:\s*<[^()]*>)?$/);
    return m ? { name: m[2], returnType: m[1].trim(), parameters: params.trim() } : null;
}

function analyzeSnippet(elementType, snippet) {
    if (!snippet) return null;
    const t = canonType(elementType);
    const { modifiers, rest } = extractModifiers(snippet);

    if (CLASS_LIKE.has(t)) {
        const m = rest.match(/^(class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+(\w+)/);
        if (m) return { kind: 'class', keyword: m[1], name: m[2], modifiers };
    }

    if (t === 'method_declaration' || t === 'local_function_statement') {
        const sig = parseSignature(rest, false);
        if (sig) return { kind: 'method', returnType: sig.returnType, name: sig.name, parameters: sig.parameters, modifiers };
    }

    if (t === 'constructor_declaration') {
        const sig = parseSignature(rest, true);
        if (sig) return { kind: 'constructor', name: sig.name, parameters: sig.parameters, modifiers };
    }

    if (VARIABLE_LIKE.has(t)) {
        const m = rest.match(VARIABLE_PATTERN);
        if (m) return { kind: 'variable', declaredType: m[1].trim(), name: m[2], initialValue: m[3] ? m[3].trim() : null, modifiers };
    }

    return null;
}

// "int a = 1, b = 2;" -> one entry per declarator. Returns [] unless it is a
// genuine multi-declarator line.
function analyzeAllDeclarators(elementType, snippet) {
    if (!snippet) return [];
    if (!['field_declaration', 'local_declaration_statement'].includes(canonType(elementType))) return [];

    const { modifiers, rest } = extractModifiers(snippet);
    const stripped = rest.replace(/;\s*$/, '');
    const m = stripped.match(new RegExp(`^${TYPE_PATTERN}\\s+(.+)$`));
    if (!m) return [];

    const declaredType = m[1].trim();
    const parts = splitTopLevelCommas(m[2]);
    if (parts.length < 2) return [];

    const results = [];
    for (const part of parts) {
        const dm = part.trim().match(/^(\w+)\s*(?:=\s*(.+))?$/);
        if (!dm) return [];
        results.push({ kind: 'variable', declaredType, name: dm[1], initialValue: dm[2] ? dm[2].trim() : null, modifiers });
    }
    return results;
}

// ---------------------------------------------------------------------------
// Statement analysis
// ---------------------------------------------------------------------------

const CONTROL_KEYWORDS = new Set([
    'if', 'else', 'while', 'for', 'foreach', 'switch', 'catch', 'using',
    'lock', 'fixed', 'return', 'do', 'try', 'finally', 'when'
]);

const STATEMENT_TAG = {
    increment: 'incr',
    decrement: 'decr',
    'compound-assign': 'op-assign',
    assign: 'assign',
    call: 'call'
};

function analyzeStatement(snippet) {
    if (!snippet) return null;
    let s = snippet.trim();
    if (s.endsWith(';')) s = s.slice(0, -1).trim();

    // x++ , x-- , ++x , --x
    let m = s.match(/^([\w.]+)\s*(\+\+|--)$/);
    if (m) return { kind: m[2] === '++' ? 'increment' : 'decrement', name: m[1] };

    m = s.match(/^(\+\+|--)\s*([\w.]+)$/);
    if (m) return { kind: m[1] === '++' ? 'increment' : 'decrement', name: m[2] };

    // x += n, x -= n, x *= n, x /= n, x %= n
    m = s.match(/^([\w.]+(?:\[[^\]]*\])?)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/);
    if (m) {
        const opWord = { '+=': 'increased', '-=': 'decreased', '*=': 'multiplied by', '/=': 'divided by', '%=': "modulo'd by" }[m[2]];
        return { kind: 'compound-assign', name: m[1], op: m[2], value: m[3].trim(), opWord };
    }

    // x = value (but not == or =>)
    m = s.match(/^([\w.]+(?:\[[^\]]*\])?)\s*=(?![=>])\s*(.+)$/);
    if (m) return { kind: 'assign', name: m[1], value: m[2].trim() };

    // Foo(...), a.b.Foo<T>(...)
    m = s.match(/^([\w.<>?]+)\s*\(/);
    if (m && !CONTROL_KEYWORDS.has(m[1])) {
        const args = balancedParens(s, m[0].length - 1);
        if (args !== null && s.length === m[0].length + args.length + 1) {
            return { kind: 'call', name: m[1], args: args.trim() };
        }
    }

    return null;
}

// Short semantic phrase for a recognised statement.
function describeStatement(actionType, stmt) {
    const removed = (actionType === 'delete-node' || actionType === 'delete-tree');
    const sign = removed ? '-' : '+';
    switch (stmt.kind) {
        case 'increment': return `${sign} incr ${stmt.name}`;
        case 'decrement': return `${sign} decr ${stmt.name}`;
        case 'compound-assign': return `${sign} ${stmt.name} ${stmt.op} ${stmt.value}`;
        case 'assign': return `${sign} ${stmt.name} = ${stmt.value}`;
        case 'call': return `${sign} call ${stmt.name}(${stmt.args || ''})`;
        default: return null;
    }
}

function statementKind(text, anchorType) {
    if (CONTROL_TYPES.has(anchorType) || SIMPLE_STATEMENT_LABELS[anchorType]) {
        return SIMPLE_STATEMENT_LABELS[anchorType] || KIND[anchorType] || 'stmt';
    }
    if (anchorType === 'local_declaration_statement') return 'var';
    const st = analyzeStatement(text);
    if (st) return STATEMENT_TAG[st.kind] || 'stmt';
    return KIND[anchorType] || 'stmt';
}

// ---------------------------------------------------------------------------
// Traceable node groups
// ---------------------------------------------------------------------------

// Declarations are traced individually, and we keep descending into them (a
// pasted class surfaces its members, a pasted method surfaces its locals).
const DECLARATION_TYPES = new Set([
    'class_declaration',
    'struct_declaration',
    'interface_declaration',
    'record_declaration',
    'enum_declaration',
    'method_declaration',
    'constructor_declaration',
    'local_function_statement',
    'field_declaration',
    'property_declaration',
    'local_declaration_statement',
    'using_directive',
    'namespace_declaration',
    'file_scoped_namespace_declaration'
]);

const STATEMENT_TYPES = new Set(['expression_statement']);

const SIMPLE_STATEMENT_LABELS = {
    return_statement: 'return',
    break_statement: 'break',
    continue_statement: 'continue',
    yield_statement: 'yield'
};

const CONTROL_TYPES = new Set([
    'if_statement',
    'else_clause',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'switch_section',
    'try_statement',
    'catch_clause',
    'finally_clause',
    'lock_statement',
    'using_statement',
    'throw_statement'
]);

// Statement-level anchors that token-level edits are rolled up into.
const ROLLUP_ANCHORS = new Set([
    ...STATEMENT_TYPES,
    ...CONTROL_TYPES,
    ...Object.keys(SIMPLE_STATEMENT_LABELS),
    'local_declaration_statement'
]);

// Climbing for a statement anchor stops at these.
const DECLARATION_BOUNDARY = new Set([
    ...CLASS_LIKE,
    'method_declaration', 'constructor_declaration', 'local_function_statement',
    'property_declaration', 'field_declaration', 'using_directive',
    'namespace_declaration', 'file_scoped_namespace_declaration'
]);

function isTraceableType(t) {
    return DECLARATION_TYPES.has(t) || STATEMENT_TYPES.has(t) || CONTROL_TYPES.has(t) || !!SIMPLE_STATEMENT_LABELS[t];
}

function isStatementNodeType(t) {
    return ROLLUP_ANCHORS.has(t);
}

const PUNCTUATION_ELEMENT_TYPES = new Set(['operator', 'punctuation']);

function collectTraceableNodes(node, out, lo = -Infinity, hi = Infinity) {
    if (!node) return;
    if (isTraceableType(node.type) && node.startIndex >= lo && node.endIndex <= hi) {
        out.push(node);
    }
    for (let i = 0; i < node.childCount; i++) {
        collectTraceableNodes(node.child(i), out, lo, hi);
    }
}

function findEnclosingStatementNode(node) {
    let cur = node;
    while (cur) {
        if (ROLLUP_ANCHORS.has(cur.type)) return cur;
        if (DECLARATION_BOUNDARY.has(cur.type)) return null;
        cur = cur.parent;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Owner paths: Namespace-free "Class.Member(signature)" strings
// ---------------------------------------------------------------------------

function headText(entry, node, max = 600) {
    return collapse(entry.content.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + max)));
}

// Path segment for a declaration node, or null if the node is not one.
function declSegment(entry, node) {
    const t = node.type;
    if (CLASS_LIKE.has(t)) {
        const m = headText(entry, node).match(/\b(?:class|struct|interface|enum|record)\s+(?:(?:class|struct)\s+)?(\w+)/);
        return m ? m[1] : null;
    }
    if (t === 'constructor_declaration' || t === 'method_declaration' || t === 'local_function_statement') {
        const isCtor = t === 'constructor_declaration';
        const { rest } = extractModifiers(headText(entry, node));
        const sig = parseSignature(rest, isCtor);
        if (!sig) return null;
        return `${isCtor ? 'constructor' : sig.name}(${paramTypes(sig.parameters).join(',')})`;
    }
    if (t === 'property_declaration' || t === 'field_declaration') {
        const sem = analyzeSnippet(t, headText(entry, node));
        return sem ? sem.name : null;
    }
    return null;
}

function ownerPath(entry, node, includeSelf = false) {
    if (!entry || !node) return '';
    const segs = [];
    let cur = includeSelf ? node : node.parent;
    while (cur) {
        const s = declSegment(entry, cur);
        if (s) segs.unshift(s);
        cur = cur.parent;
    }
    return segs.join('.');
}

// ---------------------------------------------------------------------------
// Positional context: index within a parameter list, argument list or
// array/collection initializer.
// ---------------------------------------------------------------------------

const POSITIONAL_LABELS = {
    parameter_list: 'param',
    argument_list: 'arg',
    bracketed_argument_list: 'arg',
    initializer_expression: 'elem',
    collection_expression: 'elem'
};

function namedItems(list) {
    const out = [];
    for (let i = 0; i < list.namedChildCount; i++) {
        const c = list.namedChild(i);
        if (c.type !== 'comment') out.push(c);
    }
    return out;
}

function positionalInfo(node) {
    let n = node;
    while (n.parent && n.parent.startIndex === n.startIndex && n.parent.endIndex === n.endIndex) {
        n = n.parent;
    }
    const list = n.parent;
    if (!list) return null;
    const label = POSITIONAL_LABELS[list.type];
    if (!label) return null;

    const items = namedItems(list);
    for (let i = 0; i < items.length; i++) {
        if (items[i].startIndex === n.startIndex && items[i].endIndex === n.endIndex) {
            return { label, position: i + 1, total: items.length, list, element: n };
        }
    }
    return null;
}

// Name of whatever owns a positional list, plus the member it sits in.
function listOwner(entry, list) {
    let cur = list.parent;
    while (cur) {
        const t = cur.type;
        if (t === 'method_declaration' || t === 'constructor_declaration' || t === 'local_function_statement') {
            return { name: ownerPath(entry, cur, true), encl: '' };
        }
        if (t === 'invocation_expression') {
            let name = null;
            if (typeof cur.childForFieldName === 'function') {
                const fn = cur.childForFieldName('function');
                if (fn) name = short(fn.text, 50);
            }
            if (!name) {
                const m = headText(entry, cur, 200).match(/^([\w.<>?]+)\s*\(/);
                name = m ? m[1] : 'call';
            }
            return { name, encl: ownerPath(entry, cur) };
        }
        if (t === 'object_creation_expression') {
            const m = headText(entry, cur, 200).match(/^new\s+([\w.<>\[\]?]+)/);
            return { name: `new ${m ? m[1] : '?'}`, encl: ownerPath(entry, cur) };
        }
        if (t === 'variable_declarator') {
            const m = headText(entry, cur, 100).match(/^(\w+)/);
            return { name: m ? m[1] : 'variable', encl: ownerPath(entry, cur) };
        }
        if (t === 'property_declaration' || t === 'field_declaration') {
            return { name: ownerPath(entry, cur, true), encl: '' };
        }
        cur = cur.parent;
    }
    return { name: ownerPath(entry, list), encl: '' };
}

function positionSuffix(pos) {
    return `@${pos.position}/${pos.total}`;
}

// "<owner> @i/n [in <member>]"
function positionalWhere(entry, pos) {
    const o = listOwner(entry, pos.list);
    return `${o.name} ${positionSuffix(pos)}${o.encl ? ` in ${o.encl}` : ''}`;
}

// ---------------------------------------------------------------------------
// Line formatting
// ---------------------------------------------------------------------------

function lp(line, line2) {
    if (!line) return line2 ? `Line ${line2} ` : '';
    if (line2 && line2 !== line) return `Line ${line}->${line2} `;
    return `Line ${line} `;
}

// L<line> <op> <kind> <where> : <text>
function mk(line, op, kind, where, text) {
    const prefix = typeof line === 'string' ? line : lp(line);
    let out = `${prefix}${op} ${kind}`;
    if (where) out += ` ${where}`;
    if (text) out += where ? ` : ${text}` : ` ${text}`;
    return out;
}

function item(text, side, start, end, leaf) {
    return { text, side, start, end, leaf: !!leaf };
}

// Pieces of a declaration line, from its analysed snippet.
function declParts(canon, sem, owner) {
    const mods = fmtMods(canon, sem.modifiers);
    switch (sem.kind) {
        case 'class':
            return { kind: sem.keyword.split(/\s+/)[0], where: joinPath(owner, sem.name), text: mods.trim() };
        case 'method':
            return { kind: 'method', where: joinPath(owner, `${sem.name}(${sem.parameters})`), text: `${sem.returnType}${mods}` };
        case 'constructor':
            return { kind: 'constructor', where: joinPath(owner, `constructor (${sem.parameters})`), text: mods.trim() };
        case 'variable': {
            const value = sem.initialValue ? ` = ${sem.initialValue}` : '';
            if (!LOCAL_LIKE.has(canon)) {
                return { kind: KIND[canon] || 'var', where: joinPath(owner, sem.name), text: `${sem.declaredType}${value}${mods}` };
            }
            const prefix = sem.modifiers.length ? `${sem.modifiers.join(' ')} ` : '';
            return {
                kind: canon === 'parameter' ? 'param' : 'var',
                where: owner,
                text: `${prefix}${sem.declaredType} ${sem.name}${value}`
            };
        }
        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Tracing of inserted / deleted declarations and statements
// ---------------------------------------------------------------------------

function traceNode(op, node, entry) {
    const t = node.type;
    const collapsed = collapse(entry.content.slice(node.startIndex, node.endIndex));
    const line = lineAt(entry, node.startIndex);
    const owner = ownerPath(entry, node);

    if (STATEMENT_TYPES.has(t)) {
        const st = analyzeStatement(collapsed);
        return [mk(line, op, st ? (STATEMENT_TAG[st.kind] || 'stmt') : 'stmt', owner, short(collapsed))];
    }

    if (SIMPLE_STATEMENT_LABELS[t]) {
        return [mk(line, op, SIMPLE_STATEMENT_LABELS[t], owner, short(collapsed))];
    }

    if (CONTROL_TYPES.has(t)) {
        return [mk(line, op, KIND[t] || humanizeType(t), owner, short(headerPreview(collapsed)))];
    }

    if (t === 'using_directive') {
        return [mk(line, op, 'using', '', short(collapsed.replace(/^using\s+/, '').replace(/;\s*$/, '')))];
    }

    if (t === 'namespace_declaration' || t === 'file_scoped_namespace_declaration') {
        const m = collapsed.match(/^namespace\s+([\w.]+)/);
        return [mk(line, op, 'namespace', '', m ? m[1] : short(headerPreview(collapsed)))];
    }

    const declarators = analyzeAllDeclarators(t, collapsed);
    if (declarators.length > 1) {
        return declarators.map(sem => {
            const parts = declParts(t, sem, owner);
            return mk(line, op, parts.kind, parts.where, parts.text);
        });
    }

    const sem = analyzeSnippet(t, collapsed);
    const parts = sem ? declParts(t, sem, owner) : null;
    if (parts) return [mk(line, op, parts.kind, parts.where, short(parts.text))];

    return [mk(line, op, humanizeType(t), owner, short(headerPreview(collapsed)))];
}

// ---------------------------------------------------------------------------
// Logic differences: token-level classification of a statement edit
// ---------------------------------------------------------------------------

const TOKEN_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|\d[\w.]*|=>|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|%=|\?\?|\S/g;

function tokenize(text) {
    return text.match(TOKEN_RE) || [];
}

function joinTokens(tokens) {
    let out = '';
    let prevWord = false;
    for (const t of tokens) {
        const isWord = /^[\w"']/.test(t);
        if (out && prevWord && isWord) out += ' ';
        out += t;
        prevWord = isWord;
    }
    return out;
}

// Describes WHAT changed between two statement heads, e.g.
//   op > -> >=      number 5 -> 6      id age -> years      this-qualifier added
function describeEdit(oldText, newText) {
    const a = tokenize(oldText);
    const b = tokenize(newText);
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;

    const am = a.slice(p, a.length - s);
    const bm = b.slice(p, b.length - s);
    if (!am.length && !bm.length) return null;

    const A = joinTokens(am);
    const B = joinTokens(bm);

    if (!am.length) return B === 'this.' ? 'this-qualifier added' : `+${short(B, 40)}`;
    if (!bm.length) return A === 'this.' ? 'this-qualifier removed' : `-${short(A, 40)}`;

    if (am.length === 1 && bm.length === 1) {
        const x = am[0];
        const y = bm[0];
        let label = 'token';
        if (/^[^\w\s"']+$/.test(x) && /^[^\w\s"']+$/.test(y)) label = 'op';
        else if (/^\d/.test(x) && /^\d/.test(y)) label = 'number';
        else if (/^"/.test(x) && /^"/.test(y)) label = 'string';
        else if (/^(true|false)$/.test(x) && /^(true|false)$/.test(y)) label = 'bool';
        else if (/^[A-Za-z_]\w*$/.test(x) && /^[A-Za-z_]\w*$/.test(y)) label = 'id';
        return `${label} ${short(x, 40)} -> ${short(y, 40)}`;
    }

    return `${short(A, 40)} -> ${short(B, 40)}`;
}

// ---------------------------------------------------------------------------
// Statement roll-up: scattered token-level actions inside one statement are
// folded into a single "old -> new" line.
// ---------------------------------------------------------------------------

function registerRollup(ctx, side, anchor, entry, edit, fallbackItem) {
    const key = `${side}:${anchor.startIndex}:${anchor.endIndex}`;
    let rec = ctx.rollup.get(key);
    if (!rec) {
        rec = {
            side,
            anchorType: anchor.type,
            start: anchor.startIndex,
            end: anchor.endIndex,
            full: entry.content.slice(anchor.startIndex, anchor.endIndex),
            owner: ownerPath(entry, anchor),
            line: lineAt(entry, anchor.startIndex),
            edits: [],
            fallback: []
        };
        ctx.rollup.set(key, rec);
    }
    rec.edits.push(edit);
    rec.fallback.push(fallbackItem);
}

// New text of an "updates only" statement (old text with the new labels applied).
function synthesizeUpdated(rec) {
    let text = rec.full;
    const edits = [...rec.edits].sort((x, y) => y.start - x.start);
    for (const e of edits) {
        const from = e.start - rec.start;
        const to = e.end - rec.start;
        if (from < 0 || to > text.length || e.newLabel === null || e.newLabel === undefined) return null;
        text = text.slice(0, from) + e.newLabel + text.slice(to);
    }
    return text;
}

// Old text of an "inserts only" statement (new text without the inserted nodes).
function synthesizeBeforeInsert(rec) {
    let text = rec.full;
    const edits = [...rec.edits].sort((x, y) => y.start - x.start);
    for (const e of edits) {
        const from = e.start - rec.start;
        const to = e.end - rec.start;
        if (from < 0 || to > text.length) return null;
        text = text.slice(0, from) + text.slice(to);
    }
    return text;
}

function presentIn(entry, text) {
    if (!entry) return false;
    const c = core(collapse(text));
    if (c.length < 3) return false;
    return flatText(entry).includes(c);
}

function rollupItem(rec, oldFull, newFull, lineOld, lineNew) {
    const oldC = collapse(oldFull);
    const newC = collapse(newFull);
    const oldH = headerPreview(oldC);
    const newH = headerPreview(newC);
    if (oldH === newH) return null;

    const kind = statementKind(newC, rec.anchorType);
    const note = describeEdit(core(oldC), core(newC));
    const text = `${short(oldH, MAX_PAIR_TEXT)} -> ${short(newH, MAX_PAIR_TEXT)}${note ? `  [${note}]` : ''}`;
    return item(mk(lp(lineOld, lineNew), '~', kind, rec.owner, text), rec.side, rec.start, rec.end, false);
}

// Fraction of tokens shared (common prefix + suffix) between two statement heads.
function headSimilarity(oldText, newText) {
    const a = tokenize(core(collapse(oldText)));
    const b = tokenize(core(collapse(newText)));
    const min = Math.min(a.length, b.length);
    if (min === 0) return 0;
    let p = 0;
    while (p < min && a[p] === b[p]) p++;
    let s = 0;
    while (s < min - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    return (p + s) / Math.max(a.length, b.length);
}

function resolveRollup(ctx) {
    const items = [];
    const recs = [...ctx.rollup.values()];
    const olds = recs.filter(r => r.side === 'old').sort((a, b) => a.start - b.start);
    const news = recs.filter(r => r.side === 'new').sort((a, b) => a.start - b.start);
    const oldEntry = loadFile(ctx.oldPath);
    const newEntry = loadFile(ctx.newPath);

    const fallback = rec => rec.fallback.forEach(f => items.push(f));

    const paired = olds.length > 0 && olds.length === news.length &&
        olds.every((r, i) => r.anchorType === news[i].anchorType && headSimilarity(r.full, news[i].full) >= 0.5);

    if (paired) {
        olds.forEach((o, i) => {
            const n = news[i];
            const it = rollupItem(o, o.full, n.full, o.line, n.line);
            if (it) items.push(it);
        });
        return items;
    }

    for (const o of olds) {
        const updatesOnly = o.edits.every(e => e.type === 'update-node');
        const synth = updatesOnly ? synthesizeUpdated(o) : null;
        if (synth !== null && presentIn(newEntry, synth)) {
            const it = rollupItem(o, o.full, synth, o.line, null);
            if (it) items.push(it);
        } else {
            fallback(o);
        }
    }

    for (const n of news) {
        const insertsOnly = n.edits.every(e => e.type === 'insert-node');
        const synth = insertsOnly ? synthesizeBeforeInsert(n) : null;
        if (synth !== null && presentIn(oldEntry, synth)) {
            const it = rollupItem(n, synth, n.full, null, n.line);
            if (it) items.push(it);
        } else {
            fallback(n);
        }
    }
    return items;
}

// ---------------------------------------------------------------------------
// Change description (one GumTree insert / delete / update action)
// ---------------------------------------------------------------------------

const OP = {
    'insert-node': '+',
    'insert-tree': '+',
    'delete-node': '-',
    'delete-tree': '-',
    'update-node': '~'
};

const DECL_TYPES_WITH_TYPE_FIELD = new Set([
    'property_declaration', 'field_declaration', 'local_declaration_statement',
    'parameter', 'variable_declaration'
]);

// True when the changed leaf is the declared TYPE of a property, field, local
// or parameter (the "int" in "public int Age { get; set; }").
function isTypeDeclarationNode(node) {
    if (!node) return false;
    const parent = node.parent;
    if (!parent || !DECL_TYPES_WITH_TYPE_FIELD.has(parent.type)) return false;

    if (typeof parent.childForFieldName === 'function') {
        const typeNode = parent.childForFieldName('type');
        if (typeNode && typeNode.startIndex === node.startIndex && typeNode.endIndex === node.endIndex) return true;
    }
    const first = parent.namedChildCount > 0 ? parent.namedChild(0) : null;
    return !!(first && first.startIndex === node.startIndex && first.endIndex === node.endIndex);
}

const NAME_PARENTS = new Set([
    ...CLASS_LIKE,
    'method_declaration', 'constructor_declaration', 'local_function_statement',
    'property_declaration', 'parameter', 'variable_declarator'
]);

// True when the leaf is the declared NAME of a type, member, parameter or variable.
function isNameOf(node) {
    const p = node.parent;
    if (!p || !NAME_PARENTS.has(p.type)) return false;
    let nameNode = null;
    if (typeof p.childForFieldName === 'function') nameNode = p.childForFieldName('name');
    if (!nameNode && p.type === 'variable_declarator') nameNode = p.namedChild(0);
    return !!nameNode && nameNode.startIndex === node.startIndex && nameNode.endIndex === node.endIndex;
}

function isSelfReferenceNode(node) {
    if (!node) return false;
    if (node.type === 'this_expression') return true;
    if ((node.type === 'identifier' || node.type === 'name') && node.text && node.text.toLowerCase() === 'this') {
        const parent = node.parent;
        return !!(parent && parent.type === 'member_access_expression' && parent.namedChild(0) === node);
    }
    return false;
}

function isMemberAccessFieldOfSelfReference(node) {
    if (!node) return false;
    const parent = node.parent;
    if (!parent || parent.type !== 'member_access_expression' || parent.namedChildCount < 2) return false;
    const fieldNode = parent.namedChild(parent.namedChildCount - 1);
    if (!fieldNode || fieldNode.startIndex !== node.startIndex || fieldNode.endIndex !== node.endIndex) return false;
    return isSelfReferenceNode(parent.namedChild(0));
}

function findEnclosingClassName(node) {
    let cur = node;
    while (cur) {
        if (cur.type === 'class_declaration') {
            const m = (cur.text || '').replace(/\s+/g, ' ').match(/\bclass\s+(\w+)/);
            if (m) return m[1];
        }
        cur = cur.parent;
    }
    return null;
}

// Generic one-line description of a single changed node.
function genericLeafItem(op, elementType, entry, node, start, end, oldLabel, newLabel, side, text) {
    const kind = humanizeType(elementType);
    const line = lineAt(entry, start);
    const owner = node ? ownerPath(entry, node) : '';
    let detail;
    if (op === '~') {
        detail = (oldLabel && newLabel) ? `${short(oldLabel, 60)} -> ${short(newLabel, 60)}` : short(newLabel || oldLabel || '', 80);
    } else {
        detail = short(text, 80);
    }
    return item(mk(line, op, kind, owner, detail), side, start, end, true);
}

// Describes one insert / delete / update action. Returns items
// {text, side, start, end, leaf}. When ctx.rollup is set, token-level edits
// inside a statement are registered for the roll-up and yield no item here.
function describeChange(ctx, type, elementType, oldLabel, newLabel, start, end, sourceFile) {
    const out = [];
    const punctuation = PUNCTUATION_ELEMENT_TYPES.has(elementType);

    const op = OP[type] || '?';
    const isTree = type === 'insert-tree' || type === 'delete-tree';
    const side = (type === 'insert-node' || type === 'insert-tree') ? 'new' : 'old';
    const entry = loadFile(sourceFile);
    const hasRange = start !== null && start !== undefined && end !== null && end !== undefined;
    const node = (entry && hasRange) ? nodeAt(entry, start, end) : null;
    const line = (entry && hasRange) ? lineAt(entry, start) : null;
    const rawText = (entry && hasRange) ? entry.content.slice(start, end) : '';
    const text = op === '~' ? (newLabel || '') : (collapse(rawText) || newLabel || oldLabel || '');

    // --- operators / punctuation never get a line of their own; inside a
    //     statement they still feed the roll-up so '>' -> '>=' is reported ----------
    if (punctuation) {
        if (!isTree && node && ctx.rollup) {
            const anchor = findEnclosingStatementNode(node);
            if (anchor && !(anchor.startIndex === start && anchor.endIndex === end)) {
                const fallbackItem = genericLeafItem(op, elementType, entry, node, start, end, oldLabel, newLabel, side, text);
                registerRollup(ctx, side, anchor, entry, { type, start, end, oldLabel, newLabel }, fallbackItem);
            }
        }
        return out;
    }

    // --- modifiers: + static / - readonly / ~ private -> public -------------
    const modUpdate = op === '~' && oldLabel && newLabel &&
        (MODIFIER_NODE_TYPES.has(elementType) || (MODIFIER_WORDS.includes(oldLabel) && MODIFIER_WORDS.includes(newLabel)));
    const modInsDel = op !== '~' && op !== '?' && (MODIFIER_NODE_TYPES.has(elementType) || (node && node.type === 'modifier'));
    if (modUpdate || modInsDel) {
        const words = op === '~' ? [oldLabel, newLabel] : [text];
        const kind = words.some(w => ACCESS_MODIFIERS.has(w)) ? 'access' : 'mod';
        const detail = op === '~' ? `${oldLabel} -> ${newLabel}` : text;
        out.push(item(mk(line, op, kind, ownerPath(entry, node, true), detail), side, start, end, false));
        return out;
    }

    // --- token edits inside a statement are rolled up --------------------------
    if (!isTree && node && ctx.rollup) {
        const anchor = findEnclosingStatementNode(node);
        if (anchor && !(anchor.startIndex === start && anchor.endIndex === end)) {
            const fallbackItem = genericLeafItem(op, elementType, entry, node, start, end, oldLabel, newLabel, side, text);
            registerRollup(ctx, side, anchor, entry, { type, start, end, oldLabel, newLabel }, fallbackItem);
            return out;
        }
    }

    // --- modifications of declarations -----------------------------------------
    if (op === '~' && oldLabel && newLabel && oldLabel !== newLabel && node) {
        if (isTypeDeclarationNode(node)) {
            out.push(item(mk(line, '~', 'type', ownerPath(entry, node.parent, true), `${oldLabel} -> ${newLabel}`), side, start, end, false));
            return out;
        }
        if (isNameOf(node)) {
            const p = node.parent;
            const detail = `${humanizeType(p.type)} ${oldLabel} -> ${newLabel}`;
            out.push(item(mk(line, '~', 'rename', ownerPath(entry, p), detail), side, start, end, false));
            return out;
        }
    }

    // --- 'this.' qualifier outside statements ------------------------------------
    if ((op === '+' || op === '-') && !isTree && (elementType === 'name' || elementType === 'identifier') && node) {
        if (isSelfReferenceNode(node)) {
            const cls = findEnclosingClassName(node);
            out.push(item(mk(line, op, 'this-qualifier', ownerPath(entry, node), cls ? `class ${cls}` : ''), side, start, end, false));
            return out;
        }
        if (isMemberAccessFieldOfSelfReference(node)) return out;
    }

    // --- inserted / deleted parameter, argument, array element -------------------
    if ((op === '+' || op === '-') && node) {
        const pos = positionalInfo(node);
        if (pos) {
            const elText = short(entry.content.slice(pos.element.startIndex, pos.element.endIndex), 80);
            out.push(item(mk(line, op, pos.label, positionalWhere(entry, pos), elText), side, start, end, false));
            if (isTree) {
                const nested = [];
                collectTraceableNodes(pos.element, nested, start, end + 2);
                for (const n of nested) {
                    for (const t of traceNode(op, n, entry)) out.push(item(t, side, n.startIndex, n.endIndex, false));
                }
            }
            return out;
        }
    }

    // --- inserted / deleted declarations, statements, whole blocks -----------------
    if ((op === '+' || op === '-') && node) {
        const collected = [];
        if (isTree) {
            collectTraceableNodes(node, collected, start, end + 2);
        } else if (isTraceableType(node.type) && node.startIndex === start && node.endIndex <= end + 2) {
            collected.push(node);
        }
        if (collected.length > 0) {
            for (const n of collected) {
                for (const t of traceNode(op, n, entry)) out.push(item(t, side, n.startIndex, n.endIndex, false));
            }
            return out;
        }
    }

    // --- anything else ------------------------------------------------------------
    out.push(genericLeafItem(op, elementType, entry, node, start, end, oldLabel, newLabel, side, text));
    return out;
}

// Public helper kept for compatibility: lines for a single action, no roll-up.
function describeAction(actionType, elementType, snippet, options = {}) {
    const { oldLabel, contextFile, contextStart, contextOffset } = options;
    const ctx = { oldPath: null, newPath: null, rollup: null };
    const items = describeChange(
        ctx, actionType, elementType, oldLabel || null, snippet || null,
        contextStart === undefined ? null : contextStart,
        contextOffset === undefined ? null : contextOffset,
        contextFile
    );
    return items.map(i => i.text);
}

// ---------------------------------------------------------------------------
// Moves / reorders (GumTree "move-tree")
// ---------------------------------------------------------------------------

// Short identity of an element in a positional / member list.
function describeListElementIdentity(elementType, rawText) {
    const text = collapse(rawText);
    const canon = canonType(elementType);
    const sem = analyzeSnippet(canon, text);
    if (sem && sem.kind === 'variable') {
        return canon === 'parameter' ? `${sem.declaredType} ${sem.name}` : `${sem.name} : ${sem.declaredType}`;
    }
    if (sem && sem.kind === 'method') return `${sem.name}(${sem.parameters})`;
    if (sem && sem.kind === 'constructor') return `constructor (${sem.parameters})`;
    if (sem && sem.kind === 'class') return sem.name;
    return short(text, 60);
}

// Outermost node whose range is [s,e] (tolerating a missing trailing token).
function findMovedNode(rootNode, s, e) {
    let n = findExactOrSmallestNode(rootNode, s, e);
    while (n.parent && n.parent.startIndex === n.startIndex && n.parent.endIndex === n.endIndex) {
        n = n.parent;
    }
    if (n.startIndex === s && Math.abs(n.endIndex - e) <= 2) return n;
    for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i);
        if (c.startIndex === s && Math.abs(c.endIndex - e) <= 2) return c;
    }
    return null;
}

// Resolves a move-tree action into a reconstructable log line. The moved node
// is located from its own (old-file) offsets; the destination index is found by
// matching the node's text in the new list, with GumTree's "at" as fallback.
function describeMove(oldPath, newPath, elementType, srcStart, srcEnd, dst, at) {
    if (srcStart === null || srcEnd === null) return null;

    const oldE = loadFile(oldPath);
    const newE = loadFile(newPath);
    const oldTree = treeOf(oldE);
    const newTree = treeOf(newE);
    if (!oldTree || !newTree) { dbg('  [move] no tree'); return null; }

    const moved = findMovedNode(oldTree.rootNode, srcStart, srcEnd);
    if (!moved || !moved.parent) { dbg('  [move] moved node not found'); return null; }

    const oldList = moved.parent;
    const oldItems = namedItems(oldList);
    const originIndex = oldItems.findIndex(c => c.startIndex === moved.startIndex && c.endIndex === moved.endIndex);
    if (originIndex < 0) { dbg('  [move] origin index not found'); return null; }

    // Candidate destination lists: the same list in the new tree (pure reorder),
    // then whatever GumTree names as the destination parent.
    const candidates = [];
    const sameList = findSameNode(newTree.rootNode, oldList.type, oldList.startIndex, oldList.endIndex);
    if (sameList) candidates.push(sameList);
    if (dst && dst.start !== null && dst.end !== null) {
        let n = findExactOrSmallestNode(newTree.rootNode, dst.start, dst.end);
        while (n && n.type !== oldList.type) n = n.parent;
        if (n && !candidates.includes(n)) candidates.push(n);
    }

    const movedText = collapse(oldE.content.slice(moved.startIndex, moved.endIndex));
    let newList = null;
    let newItems = null;
    let destIndex = null;

    for (const cand of candidates) {
        const items = namedItems(cand);
        const matches = [];
        items.forEach((c, i) => {
            if (collapse(newE.content.slice(c.startIndex, c.endIndex)) === movedText) matches.push(i);
        });
        if (matches.length > 0) {
            newList = cand;
            newItems = items;
            destIndex = matches.includes(at) ? at : matches[0];
            break;
        }
    }
    if (destIndex === null && candidates.length > 0 && typeof at === 'number') {
        const items = namedItems(candidates[0]);
        if (at >= 0 && at < items.length) {
            newList = candidates[0];
            newItems = items;
            destIndex = at;
        }
    }
    if (destIndex === null) { dbg('  [move] destination not found'); return null; }

    const isStatement = isStatementNodeType(moved.type);
    const posLabel = POSITIONAL_LABELS[newList.type];
    const kind = isStatement ? statementKind(movedText, moved.type) : (posLabel || humanizeType(moved.type));
    const detail = isStatement ? short(headerPreview(movedText)) : describeListElementIdentity(moved.type, movedText);

    let where;
    if (posLabel) {
        const o = listOwner(newE, newList);
        where = `${o.name}${o.encl ? ` in ${o.encl}` : ''}`;
    } else {
        where = ownerPath(newE, newList);
    }
    const positions = `@${originIndex + 1}/${oldItems.length} -> @${destIndex + 1}/${newItems.length}`;
    const lineOld = lineAt(oldE, moved.startIndex);
    const lineNew = lineAt(newE, newItems[destIndex].startIndex);

    const logicLine = mk(lp(lineOld, lineNew), 'mv', kind, `${where ? where + ' ' : ''}${positions}`.trim(), detail);
    const detailLine = `${detail} moved from named-index ${originIndex} to named-index ${destIndex}`;
    return { logicLine, detailLine, start: moved.startIndex, end: moved.endIndex };
}

// ---------------------------------------------------------------------------
// GumTree JSON -> log lines
// ---------------------------------------------------------------------------

// Drops generic leaf lines that sit inside a more specific line of the same op
// and snapshot (e.g. the 'id' leaves of an inserted parameter), then removes
// exact duplicates.
function finalizeItems(items) {
    const structs = items.filter(i => !i.leaf);
    const kept = items.filter(i => {
        if (!i.leaf) return true;
        return !structs.some(s => s.side === i.side && s.start !== null && i.start !== null &&
            s.start <= i.start && s.end >= i.end);
    });
    const seen = new Set();
    const lines = [];
    for (const i of kept) {
        if (seen.has(i.text)) continue;
        seen.add(i.text);
        lines.push(i.text);
    }
    return lines;
}

function parseGumTreeSummary(json, oldPath, newPath) {
    fileCache.clear();
    try {
        return parseGumTreeSummaryInner(json, oldPath, newPath);
    } finally {
        fileCache.clear();
    }
}

// Containers GumTree inserts/deletes as bare nodes while re-matching; their children carry the real change.
const CONTAINER_TYPES = new Set(['block', 'block_content']);
const isEmptyBlockText = (t) => /^\{\s*\}$/.test((t || '').trim());
const POSITION_PAIR_RE = /@(\d+)\/\d+ -> @(\d+)\/\d+/;

function parseGumTreeSummaryInner(json, oldPath, newPath) {
    const summary = { inserts: 0, deletes: 0, updates: 0, moves: 0, other: 0 };
    const details = [];
    const items = [];
    const unresolvedMoves = [];   // only shown when nothing better explains the save
    const highlights = [];

    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        return { summaryText: 'parse error', actionCount: 0, details: [], logicNotes: [], highlights: [] };
    }

    const actions = parsed.actions || [];
    if (DEBUG) console.log(JSON.stringify(actions, null, 2));

    const ctx = { oldPath, newPath, rollup: new Map() };

    for (const action of actions) {
        const type = action.action || '';
        const rawTree = action.tree || '';
        const rawLabel = action.label || '';

        const { elementType, inlineLabel, start, end } = parseTreeField(rawTree);

        // GumTree offsets: insert -> new file; delete / update / move -> old file.
        const sourceFile = (type === 'insert-node' || type === 'insert-tree') ? newPath
            : (type === 'delete-node' || type === 'delete-tree' || type === 'update-node' || type === 'move-tree') ? oldPath
            : newPath;
        const snippet = rawLabel || extractSnippet(sourceFile, start, end);

        switch (type) {
            case 'insert-node':
            case 'insert-tree':
                summary.inserts++;
                if (start !== null && end !== null) {
                    highlights.push({ type: 'insert', start, end, elementType, label: snippet });
                }
                break;
            case 'delete-node':
            case 'delete-tree':
                summary.deletes++;
                if (start !== null) {
                    highlights.push({
                        type: 'delete',
                        lineHint: lineNumberAt(oldPath, start),
                        elementType,
                        label: snippet
                    });
                }
                break;
            case 'update-node':
                summary.updates++;
                if (start !== null && snippet) {
                    highlights.push({ type: 'update', start, end: start + snippet.length, elementType, label: snippet });
                }
                break;

            case 'move-tree': {
                summary.moves++;
                const dst = parseTreeField(action.parent || '');
                const emptyBlock = CONTAINER_TYPES.has(elementType) && isEmptyBlockText(snippet);
                let mv = null;
                try {
                    mv = describeMove(oldPath, newPath, elementType, start, end, dst, action.at);
                } catch (e) {
                    dbg('  [move] error:', e.message);
                }
                if (mv) {
                    details.push(`    move-tree | type: ${elementType} | ${mv.detailLine}`);
                    const logicText = String(mv.logicLine || '');
                    const pos = POSITION_PAIR_RE.exec(logicText);
                    // The moved text as the log itself reports it ("... : { }")
                    const movedEmptyBlock = CONTAINER_TYPES.has(elementType) &&
                        (/:\s*\{\s*\}\s*$/.test(logicText) || /^\{\s*\}\s+moved/.test(String(mv.detailLine || '')));
                    if (pos && pos[1] === pos[2]) {
                        dbg('  [move] no-op (same position) skipped');
                    } else if (emptyBlock || movedEmptyBlock) {
                        dbg('  [move] empty block skipped');
                    } else {
                        items.push(item(mv.logicLine, 'old', mv.start, mv.end, false));
                    }
                } else {
                    details.push(`    move-tree | type: ${elementType} | (position could not be resolved)`);
                    if (!emptyBlock) {
                        const oldE = loadFile(oldPath);
                        unresolvedMoves.push(item(
                            mk(lineAt(oldE, start), 'move ', humanizeType(elementType), '', `${short(snippet || '', 80)} (position unresolved)`),
                            'old', start, end, false
                        ));
                    }
                }
                continue;
            }

            default:
                summary.other++;
        }

        details.push(`    ${type} | type: ${elementType} | snippet: ${snippet || '(unavailable)'}`);

        // A bare container node says nothing by itself; its children are described on their own.
        if ((type === 'insert-node' || type === 'delete-node') && CONTAINER_TYPES.has(elementType)) {
            continue;
        }

        try {
            items.push(...describeChange(ctx, type, elementType, inlineLabel, rawLabel || null, start, end, sourceFile));
        } catch (e) {
            dbg('  [describe] error:', e.message);
            items.push(item(`? ${type} ${humanizeType(elementType)} : ${short(snippet || '', 80)}`, 'new', start, end, false));
        }
    }

    try {
        items.unshift(...resolveRollup(ctx));
    } catch (e) {
        dbg('  [rollup] error:', e.message);
        for (const rec of ctx.rollup.values()) items.push(...rec.fallback);
    }

    // Never swallow a save: if nothing else explains it, fall back to the unresolved moves.
    if (items.length === 0) items.push(...unresolvedMoves);

    const logicNotes = finalizeItems(items);

    const meaningfulCount = summary.inserts + summary.deletes + summary.updates + summary.other + summary.moves;

    const parts = [];
    if (summary.inserts) parts.push(`+${summary.inserts}`);
    if (summary.deletes) parts.push(`- ${summary.deletes}`);
    if (summary.updates) parts.push(`~ ${summary.updates}`);
    if (summary.moves) parts.push(`move ${summary.moves}`);
    if (summary.other) parts.push(`other ${summary.other}`);
    const summaryText = parts.join(' ') || 'no changes';

    return { summaryText, actionCount: meaningfulCount, details, logicNotes, highlights };
}


function runGumTreeDiff(oldPath, newPath) {
    const cmd = `"${GUMTREE_CMD}" textdiff "${oldPath}" "${newPath}" -f JSON`;
    exec(cmd, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
            console.log('  -> GumTree error:', err.message);
            console.log('  -> stderr:', stderr);
            return;
        }

        const { summaryText, actionCount, details, logicNotes, highlights } = parseGumTreeSummary(stdout, oldPath, newPath);

        if (actionCount === 0) {
            return;
        }

        const header = `[${new Date().toISOString()}] ${path.basename(oldPath)} -> ${path.basename(newPath)}: ${summaryText}\n`;
        const rawBody = LOG_RAW_ACTIONS ? details.join('\n') + '\n' : '';
        const lines = logicNotes.length > 0 ? logicNotes : ['(formatting / punctuation only)'];
        const logicBody = lines.map(l => '  ' + l).join('\n') + '\n';

        fs.appendFileSync(DIFF_LOG, header + rawBody + logicBody + '\n');

        console.log(`  -> GumTree diff processed: ${actionCount} action(s), pushing to webdiff`);

        setHighlights(highlights);
    });
}

function runGumTreeJson(oldPath, newPath) {
  return new Promise((resolve, reject) => {
    const cmd = `"${GUMTREE_CMD}" textdiff "${oldPath}" "${newPath}" -f JSON`;
    exec(cmd, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr || err.message));
      resolve(stdout);   // raw string, exactly what parseGumTreeSummary expects
    });
  });
}

async function analyzeChange(oldSource, newSource) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'astdiff-'));
  const oldFile = path.join(dir, 'old.cs');
  const newFile = path.join(dir, 'new.cs');
  try {
    await fs.promises.writeFile(oldFile, oldSource, 'utf8');
    await fs.promises.writeFile(newFile, newSource, 'utf8');

    const rawJson = await runGumTreeJson(oldFile, newFile);
    const summary = parseGumTreeSummary(rawJson, oldFile, newFile);

    let actions = [];
    try { actions = JSON.parse(rawJson).actions || []; } catch (e) { /* leave empty */ }

    return {
      summary,
      lines: linesFromSummary(summary),
      actions,
      meaningfulCount: summary.actionCount,
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

// Flattens whatever shape `details` / `logicNotes` have into plain strings for tests.
function linesFromSummary(summary) {
  const out = [];
  const push = (x) => {
    if (x == null) return;
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach(push);
    else if (typeof x === 'object') out.push(x.line ?? x.text ?? JSON.stringify(x));
  };
  push(summary.details);
  push(summary.logicNotes);
  return out;
}

module.exports = {
    runGumTreeDiff,
    runGumTreeJson,
    parseGumTreeSummary,
    describeAction,
    describeStatement,
    analyzeStatement,
    analyzeChange,
    humanizeType,
    analyzeSnippet
};