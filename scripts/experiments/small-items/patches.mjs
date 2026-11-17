// Bounded candidates for U7, U8 and C6. Production sources are restored after builds.
function replace(source, before, after) {
	if (!source.includes(before))
		throw new Error('Candidate no longer matches the source: ' + before.slice(0, 70));
	return source.replace(before, after);
}

export function exportCandidate(source) {
	return replace(
		source,
		'fields: structuredClone($state.snapshot(fields))',
		'fields: $state.snapshot(fields)'
	);
}

export function dragCandidate(source) {
	let result = replace(
		source,
		'function insertAfter(element: Element, event: DragEvent): boolean {\n\tconst rect = element.getBoundingClientRect();',
		'function insertAfter(element: Element, event: DragEvent, rect = element.getBoundingClientRect()): boolean {'
	);
	result = replace(
		result,
		'function nearestBlock(container: Element, event: DragEvent): Element | null {\n\tlet nearest: Element | null = null;',
		'function nearestBlock(container: Element, event: DragEvent): { element: Element; rect: DOMRect } | null {\n\tlet nearest: { element: Element; rect: DOMRect } | null = null;'
	);
	result = replace(result, 'nearest = child;', 'nearest = { element: child, rect };');
	result = replace(
		result,
		'\tif (block && !view.dom.contains(block)) block = null;',
		'\tif (block && !view.dom.contains(block)) block = null;\n\tlet blockRect: DOMRect | undefined;'
	);
	result = replace(
		result,
		'\t\tif (closestChild) block = closestChild;',
		'\t\tif (closestChild) {\n\t\t\tblock = closestChild.element;\n\t\t\tblockRect = closestChild.rect;\n\t\t}'
	);
	result = replace(
		result,
		'insertAfter(block, event) ? boundary.to : boundary.from',
		'insertAfter(block, event, blockRect) ? boundary.to : boundary.from'
	);
	result = replace(
		result,
		'\tconst originRect = origin instanceof Element ? origin.getBoundingClientRect() : null;\n\tif (source && !originRect) return null;',
		'\tif (source && !(origin instanceof Element)) return null;'
	);
	result = replace(
		result,
		'\n\tconst target = targetPosition(view, event);',
		'\n\tconst originRect = origin instanceof Element ? origin.getBoundingClientRect() : null;\n\tconst target = targetPosition(view, event);'
	);
	return result;
}
