import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import prettier from 'prettier';
import ts from 'typescript';

const baseline = process.argv[2] ?? '403b569fcd18914d64d279f38a826db092a4ba77';
const git = (...args) =>
	execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const paths = [
	...new Set([
		...git('diff', '--name-only', baseline, '--', 'src').split('\n'),
		...git('ls-files', '--others', '--exclude-standard', 'src').split('\n')
	])
]
	.filter(Boolean)
	.sort();

function measure(source, path) {
	const text = source.replaceAll('\r\n', '\n');
	const script = path.endsWith('.svelte')
		? (text.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '')
		: text;
	let branchSites = 0;
	const syntax = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true);
	function visit(node) {
		if (
			ts.isIfStatement(node) ||
			ts.isConditionalExpression(node) ||
			ts.isCaseClause(node) ||
			ts.isCatchClause(node) ||
			ts.isForStatement(node) ||
			ts.isForOfStatement(node) ||
			ts.isForInStatement(node) ||
			ts.isWhileStatement(node) ||
			(ts.isBinaryExpression(node) &&
				[
					ts.SyntaxKind.AmpersandAmpersandToken,
					ts.SyntaxKind.BarBarToken,
					ts.SyntaxKind.QuestionQuestionToken
				].includes(node.operatorToken.kind))
		)
			branchSites++;
		ts.forEachChild(node, visit);
	}
	visit(syntax);
	return {
		lines: text ? text.trimEnd().split('\n').length : 0,
		nonblankScriptLines: script.split('\n').filter((line) => line.trim()).length,
		bytes: Buffer.byteLength(text),
		branchSites
	};
}

const files = [];
for (const path of paths) {
	let before = '';
	try {
		before = execFileSync('git', ['show', `${baseline}:${path}`], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
	} catch {
		/* Newly added files have no baseline. */
	}
	const after = existsSync(path) ? readFileSync(path, 'utf8') : '';
	const options = { ...(await prettier.resolveConfig(path)), filepath: path };
	files.push({
		path,
		before: measure(before, path),
		after: measure(after, path),
		formattedBefore: measure(before ? await prettier.format(before, options) : '', path),
		formattedAfter: measure(after ? await prettier.format(after, options) : '', path)
	});
}
const total = (side) =>
	files.reduce((sum, file) => {
		for (const [key, value] of Object.entries(file[side])) sum[key] = (sum[key] ?? 0) + value;
		return sum;
	}, {});
console.log(
	JSON.stringify(
		{
			baseline,
			scope:
				'Changed production files under src, including additions and deletions; tests/docs excluded',
			before: total('before'),
			after: total('after'),
			formattedBefore: total('formattedBefore'),
			formattedAfter: total('formattedAfter'),
			files
		},
		null,
		2
	)
);
