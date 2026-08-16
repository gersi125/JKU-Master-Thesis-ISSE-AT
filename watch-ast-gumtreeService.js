const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { GUMTREE_CMD, DIFF_LOG } = require('./watch-ast-config');
const { setLatestPair } = require('./watch-ast-webdiffService');

const TYPE_MAP = {
    class_declaration: 'class',
    method_declaration: 'method',
    constructor_declaration: 'constructor',
    field_declaration: 'field',
    property_declaration: 'property',
    property: 'property',
    variable_declaration: 'variable',
    local_declaration_statement: 'local variable',
    parameter: 'parameter',
    namespace_declaration: 'namespace',
    using_directive: 'using directive',
    identifier: 'identifier',
    name: 'name',
    string_literal: 'string literal',
    invocation_expression: 'method call',
    expr_stmt: 'statement',
    expression_statement: 'statement',
    assignment_expression: 'assignment',
    postfix_unary_expression: 'expression',
    prefix_unary_expression: 'expression'
};

function humanizeType(rawType) {
    return TYPE_MAP[rawType] || rawType || 'an element';
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

// Reads the actual snippet of source at [start,end] from the given file.
function extractSnippet(filePath, start, end) {
    if (start === null || end === null) return null;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        let snippet = content.substring(start, end);
        snippet = snippet.split('\n')[0].trim().replace(/\s+/g, ' ');
        if (snippet.length > 200) snippet = snippet.slice(0, 200) + '...';
        return snippet || null;
    } catch (e) {
        return null;
    }
}

// Heuristic: peek at the source right after a renamed identifier's old
// end offset to guess what kind of declaration it belongs to.
function guessNameContext(filePath, endOffset) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const after = content.slice(endOffset, endOffset + 5);
        if (/^\s*\(/.test(after)) return 'method';
        if (/^\s*\{/.test(after)) return 'property';
    } catch (e) {
        // ignore — fall through to default
    }
    return 'variable';
}

// Best-effort regex parsing of a C# declaration snippet to pull out
// structured details: declared type, name, initial value, or method signature.
function analyzeSnippet(elementType, snippet) {
    if (!snippet) return null;

    const MODIFIERS = /^(?:(?:public|private|protected|internal|static|readonly|const|virtual|override|async|sealed)\s+)*/;

    if (elementType === 'method_declaration') {
        const m = snippet.replace(MODIFIERS, '').match(/^([\w<>\[\],.\s]+?)\s+(\w+)\s*\(([^)]*)\)/);
        if (m) {
            return { kind: 'method', returnType: m[1].trim(), name: m[2], parameters: m[3].trim() || '(none)' };
        }
    }

    if (elementType === 'constructor_declaration') {
        const m = snippet.replace(MODIFIERS, '').match(/^(\w+)\s*\(([^)]*)\)/);
        if (m) {
            return { kind: 'constructor', name: m[1], parameters: m[2].trim() || '(none)' };
        }
    }

    if (['field_declaration', 'property_declaration', 'property', 'variable_declaration', 'local_declaration_statement'].includes(elementType)) {
        const m = snippet.replace(MODIFIERS, '').match(/^([\w<>\[\],.]+)\s+(\w+)\s*(?:=\s*(.+?))?\s*(?:;|\{|$)/);
        if (m) {
            return { kind: 'variable', declaredType: m[1].trim(), name: m[2], initialValue: m[3] ? m[3].trim() : null };
        }
    }

    return null;
}

// Recognizes common statement-level operations inside a snippet:
// increment/decrement, compound assignment, plain assignment, calls.
// This is intentionally narrow regex matching, not expression parsing —
// it targets the common cases you'd want called out in a change log.
function analyzeStatement(snippet) {
    if (!snippet) return null;
    let s = snippet.trim();
    if (s.endsWith(';')) s = s.slice(0, -1).trim();

    // increment / decrement: x++ , x-- , ++x , --x
    let m = s.match(/^(\w+)\s*(\+\+|--)$/);
    if (m) return { kind: m[2] === '++' ? 'increment' : 'decrement', name: m[1] };

    m = s.match(/^(\+\+|--)\s*(\w+)$/);
    if (m) return { kind: m[1] === '++' ? 'increment' : 'decrement', name: m[2] };

    // compound assignment: x += n, x -= n, x *= n, x /= n, x %= n
    m = s.match(/^(\w+)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/);
    if (m) {
        const opWord = { '+=': 'increased', '-=': 'decreased', '*=': 'multiplied by', '/=': 'divided by', '%=': "modulo'd by" }[m[2]];
        return { kind: 'compound-assign', name: m[1], op: m[2], value: m[3].trim(), opWord };
    }

    // plain assignment: x = value  (but not == comparisons)
    m = s.match(/^(\w+)\s*=(?!=)\s*(.+)$/);
    if (m) return { kind: 'assign', name: m[1], value: m[2].trim() };

    // method call: Foo(args) or obj.Foo(args)
    m = s.match(/^([\w.]+)\s*\(([^)]*)\)$/);
    if (m) return { kind: 'call', name: m[1], args: m[2].trim() };

    return null;
}

// Renders a second, more specific bullet for a recognized statement.
// actionType lets us phrase deletions as "no longer" rather than restating
// the operation as if it still happens.
function describeStatement(actionType, stmt) {
    const removed = (actionType === 'delete-node' || actionType === 'delete-tree');

    switch (stmt.kind) {
        case 'increment':
            return removed
                ? `Variable '${stmt.name}' is no longer incremented here.`
                : `Variable '${stmt.name}' was incremented by 1.`;
        case 'decrement':
            return removed
                ? `Variable '${stmt.name}' is no longer decremented here.`
                : `Variable '${stmt.name}' was decremented by 1.`;
        case 'compound-assign': {
            const phrase = (stmt.op === '*=' || stmt.op === '/=' || stmt.op === '%=')
                ? `${stmt.opWord} ${stmt.value}`
                : `${stmt.opWord} by ${stmt.value}`;
            return removed
                ? `Variable '${stmt.name}' is no longer ${phrase} here.`
                : `Variable '${stmt.name}' was ${phrase}.`;
        }
        case 'assign':
            return removed
                ? `Variable '${stmt.name}' is no longer set to ${stmt.value} here.`
                : `Variable '${stmt.name}' was set to ${stmt.value}.`;
        case 'call':
            return removed
                ? `Call to '${stmt.name}' was removed.`
                : `Method '${stmt.name}' was called with arguments: ${stmt.args || '(none)'}.`;
        default:
            return null;
    }
}

// Builds the plain-English logic-change sentence(s) for one action.
// Returns an array — usually one line, but two when a more specific
// statement-level interpretation is available (e.g. increment/assignment).
function describeAction(actionType, elementType, snippet, options = {}) {
    const { oldLabel, contextFile, contextOffset } = options;
    const verb = { 'insert-node': 'Added', 'insert-tree': 'Added', 'delete-node': 'Removed', 'delete-tree': 'Removed', 'update-node': 'Modified' }[actionType] || actionType;
    const lines = [];

    // Rename of a leaf identifier.
    if (actionType === 'update-node' && oldLabel && snippet && oldLabel !== snippet) {
        const context = contextFile ? guessNameContext(contextFile, contextOffset) : 'identifier';
        return [`Renamed ${context} '${oldLabel}' to '${snippet}'.`];
    }

    const kind = humanizeType(elementType);
    const sem = analyzeSnippet(elementType, snippet);

    if (sem && sem.kind === 'variable') {
        const valuePart = sem.initialValue ? `, initial value: ${sem.initialValue}` : ', no initial value assigned';
        lines.push(`${verb} ${kind} '${sem.name}' — declared type: ${sem.declaredType}${valuePart}.`);
    } else if (sem && (sem.kind === 'method' || sem.kind === 'constructor')) {
        const returnPart = sem.returnType ? `, return type: ${sem.returnType}` : '';
        lines.push(`${verb} ${sem.kind} '${sem.name}'${returnPart}, parameters: ${sem.parameters}.`);
    } else {
        const preview = snippet ? `'${snippet}'` : 'an unnamed element';
        lines.push(`${verb} ${kind} ${preview}.`);
    }

    // Extra, more specific row when the snippet is a recognizable statement.
    const stmt = analyzeStatement(snippet);
    if (stmt) {
        const extra = describeStatement(actionType, stmt);
        if (extra) lines.push(extra);
    }

    return lines;
}

function parseGumTreeSummary(json, oldPath, newPath) {
    const summary = { inserts: 0, deletes: 0, updates: 0, moves: 0, other: 0 };
    const details = [];
    const logicNotes = [];

    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        return { summaryText: 'parse error', actionCount: 0, details: [], logicNotes: [] };
    }

    const actions = parsed.actions || [];
    for (const action of actions) {
        const type = action.action || '';
        const rawTree = action.tree || '';
        const rawLabel = action.label || '';

        const { elementType, inlineLabel, start, end } = parseTreeField(rawTree);

        const sourceFile = (type === 'delete-node' || type === 'delete-tree') ? oldPath : newPath;
        const snippet = rawLabel || extractSnippet(sourceFile, start, end);

        switch (type) {
            case 'insert-node':
            case 'insert-tree':
                summary.inserts++;
                break;
            case 'delete-node':
            case 'delete-tree':
                summary.deletes++;
                break;
            case 'update-node':
                summary.updates++;
                break;
            case 'move-tree':
                summary.moves++;
                continue;
            default:
                summary.other++;
        }

        details.push(`    ${type} | type: ${elementType} | snippet: ${snippet || '(unavailable)'}`);
        logicNotes.push(...describeAction(type, elementType, snippet, {
            oldLabel: inlineLabel,
            contextFile: oldPath,
            contextOffset: end
        }));
    }

    const meaningfulCount = summary.inserts + summary.deletes + summary.updates + summary.other;

    const summaryText = `${summary.inserts} insert, ${summary.deletes} delete, ${summary.updates} update` +
        (summary.other > 0 ? `, ${summary.other} other` : '') +
        (summary.moves > 0 ? ` (${summary.moves} reorder ignored)` : '');

    return { summaryText, actionCount: meaningfulCount, details, logicNotes };
}

function runGumTreeDiff(oldPath, newPath) {
    const cmd = `"${GUMTREE_CMD}" textdiff "${oldPath}" "${newPath}" -f JSON`;
    exec(cmd, (err, stdout, stderr) => {
        if (err) {
            console.log('  -> GumTree error:', err.message);
            console.log('  -> stderr:', stderr);
            return;
        }

        const { summaryText, actionCount, details, logicNotes } = parseGumTreeSummary(stdout, oldPath, newPath);

        if (actionCount === 0) {
            return;
        }

        const header = `[${new Date().toISOString()}] ${path.basename(oldPath)} -> ${path.basename(newPath)}: ${summaryText}\n`;
        const detailBody = details.join('\n') + '\n';
        const logicBody = '  Logic changes:\n    - ' + logicNotes.join('\n    - ') + '\n';

        fs.appendFileSync(DIFF_LOG, header + detailBody + logicBody + '\n');

        setLatestPair(oldPath, newPath);
    });
}

module.exports = {
    runGumTreeDiff,
    parseGumTreeSummary,
    describeAction,
    describeStatement,
    analyzeStatement,
    humanizeType,
    analyzeSnippet
};