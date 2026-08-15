const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { GUMTREE_CMD, DIFF_LOG } = require('./watch-ast-config');
const { launchWebDiff } = require('./watch-ast-webdiffService');

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
    string_literal: 'string literal',
    invocation_expression: 'method call'
};

function humanizeType(rawType) {
    return TYPE_MAP[rawType] || rawType || 'an element';
}

// GumTree's "tree" field looks like "property [87,115]" — a node type
// plus a character-offset range into the source file, not a name.
function parseTreeField(rawTree) {
    const match = rawTree.match(/^(\S+)\s*\[(\d+),\s*(\d+)\]$/);
    if (match) {
        return { elementType: match[1], start: parseInt(match[2], 10), end: parseInt(match[3], 10) };
    }
    return { elementType: rawTree, start: null, end: null };
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

// Best-effort regex parsing of a C# declaration snippet to pull out
// structured details: declared type, name, initial value, or method signature.
// This is heuristic text parsing, not full semantic analysis — multi-line
// or heavily generic/attributed declarations may not match cleanly.
function analyzeSnippet(elementType, snippet) {
    if (!snippet) return null;

    const MODIFIERS = /^(?:(?:public|private|protected|internal|static|readonly|const|virtual|override|async|sealed)\s+)*/;

    // Method declarations: returnType Name(params)
    if (elementType === 'method_declaration') {
        const m = snippet.replace(MODIFIERS, '').match(/^([\w<>\[\],.\s]+?)\s+(\w+)\s*\(([^)]*)\)/);
        if (m) {
            return {
                kind: 'method',
                returnType: m[1].trim(),
                name: m[2],
                parameters: m[3].trim() || '(none)'
            };
        }
    }

    // Constructors: Name(params) — no return type
    if (elementType === 'constructor_declaration') {
        const m = snippet.replace(MODIFIERS, '').match(/^(\w+)\s*\(([^)]*)\)/);
        if (m) {
            return {
                kind: 'constructor',
                name: m[1],
                parameters: m[2].trim() || '(none)'
            };
        }
    }

    // Fields, properties, variables: Type Name [= value];
    if (['field_declaration', 'property_declaration', 'property', 'variable_declaration', 'local_declaration_statement'].includes(elementType)) {
        const m = snippet.replace(MODIFIERS, '').match(/^([\w<>\[\],.]+)\s+(\w+)\s*(?:=\s*(.+?))?\s*(?:;|\{|$)/);
        if (m) {
            return {
                kind: 'variable',
                declaredType: m[1].trim(),
                name: m[2],
                initialValue: m[3] ? m[3].trim() : null
            };
        }
    }

    return null;
}

// Builds the plain-English logic-change sentence, using structured
// details from analyzeSnippet when available, falling back to the
// raw snippet/type otherwise.
function describeAction(actionType, elementType, snippet) {
    const kind = humanizeType(elementType);
    const sem = analyzeSnippet(elementType, snippet);
    const verb = { 'insert-node': 'Added', 'insert-tree': 'Added', 'delete-node': 'Removed', 'delete-tree': 'Removed', 'update-node': 'Modified' }[actionType] || actionType;

    if (sem && sem.kind === 'variable') {
        const valuePart = sem.initialValue ? `, initial value: ${sem.initialValue}` : ', no initial value assigned';
        return `${verb} ${kind} '${sem.name}' — declared type: ${sem.declaredType}${valuePart}.`;
    }

    if (sem && (sem.kind === 'method' || sem.kind === 'constructor')) {
        const returnPart = sem.returnType ? `, return type: ${sem.returnType}` : '';
        return `${verb} ${sem.kind} '${sem.name}'${returnPart}, parameters: ${sem.parameters}.`;
    }

    // Fallback — no structured match, just report the raw snippet
    const preview = snippet ? `'${snippet}'` : 'an unnamed element';
    return `${verb} ${kind} ${preview}.`;
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

        const { elementType, start, end } = parseTreeField(rawTree);

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
        logicNotes.push(describeAction(type, elementType, snippet));
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

        launchWebDiff(oldPath, newPath);
    });
}

module.exports = {
    runGumTreeDiff,
    parseGumTreeSummary,
    describeAction,
    humanizeType,
    analyzeSnippet
};