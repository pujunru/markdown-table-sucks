import { test } from "node:test";
import assert from "node:assert/strict";
import { findNearest, planInsert, lineChToOffset, displayWidth, findTableAt, parseTableText, parseTsv, serializeTable, emptyTable } from "../src/table.ts";

const locate = (doc: string, line: number) => {
	const lines = doc.split("\n");
	return findTableAt((n) => lines[n], lines.length, line);
};

test("round-trips a basic table with alignment", () => {
	const src = "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |";
	const t = parseTableText(src)!;
	assert.deepEqual(t.aligns, ["left", "center", "right"]);
	assert.equal(
		serializeTable(t),
		"| a   |  b  |   c |\n| :-- | :-: | --: |\n| 1   |  2  |   3 |",
	);
});

test("parses tables without outer pipes and ragged rows", () => {
	const t = parseTableText("a | b\n--|--\n1\n1 | 2 | 3")!;
	assert.deepEqual(t.header, ["a", "b", ""]);
	assert.deepEqual(t.rows, [["1", "", ""], ["1", "2", "3"]]);
	assert.match(serializeTable(t), /^\| a   \| b   \|     \|$/m);
});

test("escaped pipes and wikilink aliases survive", () => {
	const t = parseTableText("| link | x |\n|---|---|\n| [[Note\\|alias]] | a \\| b |")!;
	assert.deepEqual(t.rows[0], ["[[Note|alias]]", "a | b"]);
	const out = serializeTable(t, { pad: false });
	assert.ok(out.includes("[[Note\\|alias]]"));
	assert.ok(out.includes("a \\| b"));
	assert.deepEqual(parseTableText(out), t);
});

test("line breaks become <br>", () => {
	const t = parseTableText("| a |\n|---|\n| x<br>y<br/>z |")!;
	assert.equal(t.rows[0][0], "x\ny\nz");
	assert.ok(serializeTable(t).includes("x<br>y<br>z"));
});

test("CJK cells pad by display width", () => {
	const out = serializeTable({ header: ["名字", "x"], rows: [["abcd", "y"]], aligns: ["none", "none"] });
	const [h, , r] = out.split("\n");
	assert.equal(displayWidth(h.slice(0, h.indexOf("| x"))), displayWidth(r.slice(0, r.indexOf("| y"))));
});

test("finds a table inside a callout and keeps the prefix", () => {
	const doc = "> [!note]\n> text\n>\n> | a | b |\n> | - | - |\n> | 1 | 2 |\n\nafter";
	const found = locate(doc, 5)!;
	assert.equal(found.startLine, 3);
	assert.equal(found.endLine, 5);
	assert.equal(found.prefix, "> ");
	assert.ok(serializeTable(found.table, { prefix: found.prefix }).split("\n").every((l) => l.startsWith("> |")));
});

test("does not treat random piped text as a table", () => {
	assert.equal(locate("hello | world\nsecond line", 0), null);
	assert.equal(locate("| a |\n| b |", 0), null);
});

test("cursor on any row finds the whole table", () => {
	const doc = "intro\n\n| h |\n| --- |\n| 1 |\n| 2 |\n\nend";
	for (const line of [2, 3, 4, 5]) assert.deepEqual([locate(doc, line)!.startLine, locate(doc, line)!.endLine], [2, 5]);
	assert.equal(locate(doc, 0), null);
});

test("TSV paste with quoted multi-line cells", () => {
	assert.deepEqual(parseTsv('a\tb\n"x\ny"\t"say ""hi"""\n'), [["a", "b"], ["x\ny", 'say "hi"']]);
});

test("empty table is valid", () => {
	const out = serializeTable(emptyTable(2, 1));
	assert.deepEqual(parseTableText(out), emptyTable(2, 1));
});

const applyPlan = (doc: string, line: number) => {
	const lines = doc.split("\n");
	const p = planInsert(lines, line, emptyTable(1, 0), { pad: false });
	const start = lineChToOffset(lines, p.from);
	return doc.slice(0, start) + p.text + doc.slice(lineChToOffset(lines, p.to));
};

test("planInsert replaces a blank line and separates from text", () => {
	assert.equal(applyPlan("above\n\nbelow", 1), "above\n\n| Column 1 |\n| --- |\n\nbelow");
	assert.equal(applyPlan("para", 0), "para\n\n| Column 1 |\n| --- |");
	assert.equal(applyPlan("> [!note]\n> ", 1), "> [!note]\n>\n> | Column 1 |\n> | --- |");
});

test("findNearest picks the closest duplicate", () => {
	assert.equal(findNearest("x T x T x", "T", 7), 6);
	assert.equal(findNearest("x T x T x", "T", 0), 2);
	assert.equal(findNearest("abc", "T", 0), -1);
});
