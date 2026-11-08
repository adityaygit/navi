import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JARGON } from "@/lib/plain-text";
import { TOOL_LABELS } from "@/lib/tool-labels";

// A lint over the source: every person-facing line a tool can produce (its
// `display`, and a leftover's `line`) is built from text that has no field
// names, arrows, timestamps or planner words. Dynamic parts (titles, counts)
// are checked at run time by tests/integration/plain-chat.test.ts.

const root = join(__dirname, "..", "..");
const FILES = ["src/server/ai/tools.ts", "src/lib/plan-summary.ts", "src/lib/plain-text.ts", "src/server/planner/plan.ts"];

type Piece = { kind: "code" | "text"; text: string };

/**
 * Splits source from `start` into code and literal text, stopping at the end
 * of one expression (a top-level , ; or closing bracket). `${…}` inside a
 * template is code; the text around it is joined with "X".
 */
function scanExpression(src: string, start: number): Piece[] {
  const pieces: Piece[] = [];
  const modes: ("code" | "tpl")[] = ["code"];
  let depth = 0;
  let quote: string | null = null;
  let text = "";
  let code = "";
  const endText = () => {
    pieces.push({ kind: "text", text });
    text = "";
  };
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") text += src[++i] ?? "";
      else if (c === quote) {
        quote = null;
        endText();
      } else text += c;
      continue;
    }
    if (modes[modes.length - 1] === "tpl") {
      if (c === "\\") text += src[++i] ?? "";
      else if (c === "`") {
        modes.pop();
        endText();
      } else if (c === "$" && src[i + 1] === "{") {
        text += "X";
        i++;
        modes.push("code");
        depth++;
      } else text += c;
      continue;
    }
    // Code.
    if (c === '"' || c === "'") quote = c;
    else if (c === "`") modes.push("tpl");
    else if ("([{".includes(c)) {
      if (c === "{") modes.push("code");
      depth++;
    } else if (")]}".includes(c)) {
      if (c === "}" && modes.length > 1) {
        modes.pop();
        depth--;
        continue;
      }
      if (depth === 0) break;
      depth--;
    } else if ((c === "," || c === ";") && depth === 0 && modes.length === 1) break;
    code += c;
  }
  pieces.push({ kind: "code", text: code });
  return pieces;
}

/** The prose of every `display` / `line` expression in a file (single words are code, e.g. "capacity"). */
function displayTexts(raw: string): string[][] {
  // Comments are prose for developers (and their apostrophes would look like quotes).
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const out: string[][] = [];
  const re = /\b(display|line)\s*(?::|=(?!=))\s*/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push(scanExpression(src, re.lastIndex).filter((p) => p.kind === "text" && /\s/.test(p.text.trim()) && /[A-Za-z]{3,}/.test(p.text)).map((p) => p.text));
  }
  return out;
}

describe("person-facing tool lines (source lint)", () => {
  it("finds the display lines", () => {
    const src = readFileSync(join(root, "src/server/ai/tools.ts"), "utf8");
    expect(displayTexts(src).length).toBeGreaterThan(25);
    // And it would catch the old line.
    expect(displayTexts('return { display: `Updated plan block ${t}: starts_at → ${v}`, ok };').flat()).toEqual(["Updated plan block X: starts_at → X"]);
    expect(displayTexts(src).flat()).toContain("Put X in your inbox to review");
  });

  for (const file of FILES) {
    it(`${file}: no field names, arrows, timestamps or planner words`, () => {
      const src = readFileSync(join(root, file), "utf8");
      const bad: string[] = [];
      for (const text of displayTexts(src).flat()) {
        const unquoted = text.replace(/“[^”]*”/g, "");
        if (JARGON.test(unquoted)) bad.push(`jargon: ${text}`);
        if (/\b[a-z]+_[a-z]+\b/.test(unquoted)) bad.push(`field name: ${text}`);
        if (/→|->/.test(unquoted)) bad.push(`arrow: ${text}`);
        if (/\d{4}-\d{2}-\d{2}T/.test(unquoted)) bad.push(`timestamp: ${text}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it("step labels are plain too", () => {
    for (const [name, l] of Object.entries(TOOL_LABELS)) {
      for (const text of [l.doing, l.done]) expect(JARGON.test(text), `${name}: ${text}`).toBe(false);
    }
  });
});
