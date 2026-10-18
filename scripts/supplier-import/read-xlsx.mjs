// Reads a supplier .xlsx into JSON for prepare.mjs: { "<sheet name>": [ { A: "...", B: "..." }, ... ] }.
// Row 1 is the sheet's header row. No spreadsheet library needed: the workbook is unpacked with the system
// `tar` (Windows 10+, macOS and Linux read .zip) and its XML is parsed directly.
//   node scripts/supplier-import/read-xlsx.mjs "<file.xlsx>" <out.json>
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [file, out] = process.argv.slice(2);
if (!file || !out) {
  console.error('Usage: node scripts/supplier-import/read-xlsx.mjs "<file.xlsx>" <out.json>');
  process.exit(1);
}
const dir = mkdtempSync(path.join(tmpdir(), "xlsx-"));
try {
  execFileSync("tar", ["-xf", path.resolve(file), "-C", dir]);
  const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
  const texts = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
  const sharedFile = path.join(dir, "xl/sharedStrings.xml");
  const shared = existsSync(sharedFile) ? [...readFileSync(sharedFile, "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec(texts(m[1]))) : [];
  const wb = readFileSync(path.join(dir, "xl/workbook.xml"), "utf8");
  const rels = readFileSync(path.join(dir, "xl/_rels/workbook.xml.rels"), "utf8");
  const result = {};
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const rel = [...rels.matchAll(/<Relationship [^>]*>/g)].map((r) => r[0]).find((r) => r.includes(`Id="${m[2]}"`));
    const target = rel.match(/Target="([^"]+)"/)[1].replace(/^\/?xl\//, "");
    const xml = readFileSync(path.join(dir, "xl", target), "utf8");
    const rows = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = (c[2].match(/t="([^"]+)"/) || [])[1];
        const body = c[3] || "";
        let v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (type === "s") v = shared[+v];
        else if (type === "inlineStr") v = dec(texts(body));
        else if (v !== undefined) v = dec(v);
        if (v !== undefined && v !== "") row[c[1]] = v;
      }
      rows.push(row);
    }
    result[dec(m[1])] = rows;
  }
  writeFileSync(out, JSON.stringify(result));
  for (const [name, rows] of Object.entries(result)) console.log(`${name}: ${rows.length - 1} rows`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
