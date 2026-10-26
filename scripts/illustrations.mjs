// KingsView starter illustrations: flat vector drawings in the brand colours for slides, service pages and shop
// categories. They contain no text, people or real brands (product photos stay real photos).
// Writes the SVG sources to assets/illustrations and web copies (WebP 320/800/1600) plus a manifest to
// assets/starter-images, which `npm run images:starter` installs into the picture library. Slides and shop
// categories use the 3D renders in assets/renders (scripts/blender/starter_3d.py) when they exist.
// Usage: npm run images:build
import sharp from "sharp";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const W = 1200;
const H = 800;
const RED = "#b00101";
const RED2 = "#d11a1a";
const INK = "#1c1c1c";
const INK2 = "#2b2b2b";
const STEEL = "#4a4a4a";
const GREY = "#d9d6d2";
const LIGHT = "#ecebe9";
const WHITE = "#ffffff";
const THEMES = {
  light: { bg: "#f5f3f1", glow: "#fbe3e3", dots: "#e3dfdb", floor: "rgba(28,28,28,0.10)" },
  dark: { bg: "#151515", glow: "#4a0606", dots: "#262626", floor: "rgba(0,0,0,0.45)" },
};

// ---------- primitives ----------
const rect = (x, y, w, h, fill, rx = 0, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const circle = (cx, cy, r, fill, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const ellipse = (cx, cy, rx, ry, fill) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
const path_ = (d, fill, extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke, w = 4, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;
const at = (x, y, s, ...kids) => `<g transform="translate(${x} ${y}) scale(${s})">${kids.join("")}</g>`;
const rot = (deg, cx, cy, ...kids) => `<g transform="rotate(${deg} ${cx} ${cy})">${kids.join("")}</g>`;
/** Text-like bars (no real text in the pictures). */
const bars = (x, y, widths, fill, h = 10, gap = 18) => widths.map((w, i) => rect(x, y + i * gap, w, h, fill, h / 2)).join("");

// ---------- objects (drawn at their own origin) ----------
function browser(w, h) {
  return [
    rect(10, 14, w, h, "rgba(0,0,0,0.12)", 18),
    rect(0, 0, w, h, WHITE, 18),
    path_(`M18 0 H${w - 18} Q${w} 0 ${w} 18 V46 H0 V18 Q0 0 18 0 Z`, INK),
    circle(26, 23, 7, RED2),
    circle(48, 23, 7, "#8a8a8a"),
    circle(70, 23, 7, "#8a8a8a"),
    rect(100, 13, w - 130, 20, INK2, 10),
    rect(28, 72, w - 56, h * 0.34, "#f3e1e1", 12),
    rect(52, 100, w * 0.32, 18, RED, 9),
    bars(52, 132, [w * 0.42, w * 0.36], "#c9b9b9", 10),
    rect(52, 72 + h * 0.34 - 52, 120, 30, RED, 15),
    path_(`M${w - 210} ${72 + h * 0.34} l70 -96 l46 56 l30 -36 l64 76 Z`, "#e6c3c3"),
    circle(w - 96, 112, 18, "#e6c3c3"),
    ...[0, 1, 2].map((i) => {
      const cw = (w - 56 - 40) / 3;
      const x = 28 + i * (cw + 20);
      const y = 92 + h * 0.34;
      return rect(x, y, cw, h - y - 26, LIGHT, 12) + rect(x + 16, y + 16, 34, 34, i === 1 ? RED : INK, 8) + bars(x + 16, y + 66, [cw * 0.7, cw * 0.5], GREY, 9, 16);
    }),
  ].join("");
}

function codePanel(w, h) {
  const rows = [
    [[0, 60, RED2], [70, 90, "#9a9a9a"]],
    [[24, 110, "#e8e8e8"], [144, 40, RED2]],
    [[24, 70, "#9a9a9a"], [104, 120, "#e8e8e8"]],
    [[48, 90, RED2], [148, 60, "#9a9a9a"]],
    [[48, 140, "#e8e8e8"]],
    [[24, 50, "#9a9a9a"], [84, 80, RED2]],
    [[0, 40, "#e8e8e8"]],
  ];
  return [
    rect(10, 14, w, h, "rgba(0,0,0,0.18)", 16),
    rect(0, 0, w, h, INK, 16),
    circle(22, 22, 6, RED2),
    circle(42, 22, 6, "#5c5c5c"),
    circle(62, 22, 6, "#5c5c5c"),
    ...rows.map((segs, i) => segs.map(([x, sw, c]) => rect(26 + x, 54 + i * 26, sw, 10, c, 5)).join("")),
  ].join("");
}

function phone(h, screen = "app") {
  const w = h * 0.5;
  const inner =
    screen === "app"
      ? rect(14, 40, w - 28, h * 0.26, "#f3e1e1", 10) + rect(24, 52, w * 0.4, 12, RED, 6) + bars(24, 74, [w * 0.55, w * 0.45], "#c9b9b9", 8, 14) +
        [0, 1, 2].map((i) => rect(14, 50 + h * 0.26 + i * (h * 0.15), w - 28, h * 0.12, LIGHT, 10) + rect(24, 60 + h * 0.26 + i * (h * 0.15), 26, 26, i === 0 ? RED : INK, 7)).join("")
      : screen;
  return [rect(8, 12, w, h, "rgba(0,0,0,0.15)", 26), rect(0, 0, w, h, INK, 26), rect(8, 10, w - 16, h - 20, WHITE, 20), inner, rect(w / 2 - 22, 18, 44, 8, INK, 4)].join("");
}

function laptop(w, screen = "") {
  const h = w * 0.62;
  return [
    ellipse(w / 2, h + 34, w * 0.62, 16, "rgba(0,0,0,0.10)"),
    rect(0, 0, w, h, INK, 16),
    rect(14, 14, w - 28, h - 28, WHITE, 6),
    screen,
    path_(`M${-w * 0.08} ${h} H${w * 1.08} L${w * 1.02} ${h + 26} Q${w} ${h + 32} ${w * 0.96} ${h + 32} H${w * 0.04} Q0 ${h + 32} ${-w * 0.02} ${h + 26} Z`, "#3a3a3a"),
    rect(w * 0.42, h, w * 0.16, 8, "#555", 4),
  ].join("");
}

function dashboardScreen(x, y, w, h) {
  const bw = (w - 70) / 6;
  return [
    rect(x, y, w, h, WHITE),
    rect(x + 16, y + 16, w * 0.3, 12, INK, 6),
    ...[0.45, 0.7, 0.5, 0.9, 0.65, 0.8].map((v, i) => rect(x + 20 + i * (bw + 6), y + h - 20 - (h - 70) * v, bw, (h - 70) * v, i === 3 ? RED : i % 2 ? INK2 : "#bdbdbd", 4)),
  ].join("");
}

function monitor(w, screen) {
  const h = w * 0.6;
  return [
    rect(w / 2 - 14, h, 28, 70, "#3a3a3a"),
    ellipse(w / 2, h + 74, w * 0.24, 12, "#2b2b2b"),
    rect(0, 0, w, h, INK, 14),
    rect(12, 12, w - 24, h - 24, "#0f0f0f", 4),
    screen,
  ].join("");
}

/** 2×2 camera feed grid inside a monitor screen. */
function feeds(x, y, w, h) {
  const cw = (w - 8) / 2;
  const ch = (h - 8) / 2;
  const tile = (tx, ty, i) =>
    rect(tx, ty, cw, ch, ["#3b4148", "#454b43", "#4a4340", "#3e4550"][i]) +
    path_(`M${tx} ${ty + ch} l${cw * 0.3} ${-ch * 0.45} l${cw * 0.2} ${ch * 0.2} l${cw * 0.25} ${-ch * 0.35} l${cw * 0.25} ${ch * 0.6} Z`, "rgba(255,255,255,0.18)") +
    circle(tx + 12, ty + 12, 5, i === 0 ? RED2 : "rgba(255,255,255,0.5)");
  return [tile(x, y, 0), tile(x + cw + 8, y, 1), tile(x, y + ch + 8, 2), tile(x + cw + 8, y + ch + 8, 3)].join("");
}

function bulletCamera(s = 1) {
  return at(0, 0, s, [
    rect(-20, -60, 40, 120, "#cfcac4", 8),
    rect(-6, -14, 70, 26, "#bdb7b0", 8),
    rot(-12, 60, 0,
      rect(40, -48, 230, 96, WHITE, 40),
      rect(40, -48, 230, 30, "#f0eeec", 15),
      path_("M230 -58 H300 Q312 -58 312 -46 V-36 H218 Z", INK2),
      rect(250, -40, 30, 80, INK, 14),
      circle(266, 0, 26, "#111"),
      circle(266, 0, 15, "#2c3e50"),
      circle(260, -6, 5, "rgba(255,255,255,0.7)"),
      circle(110, -24, 6, RED2),
    ),
  ].join(""));
}

function domeCamera(s = 1) {
  return at(0, 0, s, [
    ellipse(0, 6, 110, 22, "#cfcac4"),
    rect(-110, -8, 220, 18, WHITE, 9),
    path_("M-82 10 A82 82 0 0 0 82 10 Z", "#2a2a2a"),
    path_("M-82 10 A82 82 0 0 0 82 10 Z", "rgba(255,255,255,0.08)"),
    circle(0, 46, 28, "#111"),
    circle(0, 46, 16, "#2c3e50"),
    circle(-6, 40, 5, "rgba(255,255,255,0.7)"),
    path_("M-60 22 Q-40 60 -10 74", "none", `stroke="rgba(255,255,255,0.18)" stroke-width="6" stroke-linecap="round"`),
  ].join(""));
}

function router(s = 1) {
  return at(0, 0, s, [
    ellipse(150, 118, 170, 14, "rgba(0,0,0,0.12)"),
    rot(-14, 40, 30, rect(34, -120, 14, 150, INK2, 7)),
    rot(14, 260, 30, rect(252, -120, 14, 150, INK2, 7)),
    rect(150 - 7, -100, 14, 130, INK2, 7),
    path_("M0 40 Q0 20 20 20 H280 Q300 20 300 40 V92 Q300 110 282 110 H18 Q0 110 0 92 Z", INK),
    rect(0, 20, 300, 26, "#2e2e2e", 18),
    ...[0, 1, 2, 3, 4].map((i) => circle(52 + i * 28, 80, 6, i < 3 ? "#3cc46a" : i === 3 ? RED2 : "#555")),
    rect(210, 70, 66, 18, "#2e2e2e", 6),
  ].join(""));
}

function rackSwitch(s = 1, ports = 12) {
  const w = 40 + ports * 30;
  return at(0, 0, s, [
    rect(0, 0, w, 64, INK, 8),
    rect(8, 8, w - 16, 48, "#2a2a2a", 5),
    ...Array.from({ length: ports }, (_, i) => rect(20 + i * 30, 18, 22, 18, "#111", 3) + circle(31 + i * 30, 46, 3, i % 4 === 3 ? RED2 : "#3cc46a")),
  ].join(""));
}

function cable(d, color = RED, w = 10) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
}

function printer(s = 1) {
  return at(0, 0, s, [
    rect(70, -90, 260, 120, WHITE, 6, `stroke="${GREY}" stroke-width="4"`),
    bars(100, -60, [150, 190, 120], "#d8d3ce", 12, 22),
    rect(0, 0, 400, 170, "#2f2f2f", 26),
    rect(0, 0, 400, 60, "#3d3d3d", 26),
    rect(300, 22, 70, 18, "#1a1a1a", 6),
    circle(318, 31, 5, "#3cc46a"),
    circle(338, 31, 5, RED2),
    rect(40, 110, 320, 22, "#1a1a1a", 6),
    rect(60, 120, 280, 120, WHITE, 6),
    rect(84, 140, 96, 70, RED, 6),
    bars(196, 144, [120, 96, 110], "#c9c4bf", 10, 20),
    rect(-20, 160, 440, 20, "#262626", 10),
  ].join(""));
}

function inkDrops(s = 1) {
  const drop = (x, c) => path_(`M${x} 0 C${x + 26} 34 ${x + 34} 52 ${x + 34} 66 A34 34 0 0 1 ${x - 34} 66 C${x - 34} 52 ${x - 26} 34 ${x} 0 Z`, c);
  return at(0, 0, s, [drop(0, "#1fa3c9"), drop(84, "#d6247a"), drop(168, "#f2c230"), drop(252, INK)].join(""));
}

function dslr(s = 1) {
  return at(0, 0, s, [
    ellipse(160, 230, 190, 16, "rgba(0,0,0,0.12)"),
    path_("M20 60 Q20 40 40 40 H96 L116 8 H210 L230 40 H290 Q310 40 310 60 V200 Q310 220 290 220 H40 Q20 220 20 200 Z", INK),
    rect(20, 80, 290, 110, "#2a2a2a"),
    rect(250, 52, 40, 16, "#3a3a3a", 6),
    circle(66, 56, 10, RED2),
    circle(165, 132, 82, "#3a3a3a"),
    circle(165, 132, 64, "#111"),
    circle(165, 132, 44, "#26394a"),
    circle(165, 132, 22, "#0d1620"),
    circle(148, 114, 10, "rgba(255,255,255,0.6)"),
    rect(140, 12, 50, 14, "#3a3a3a", 4),
  ].join(""));
}

function videoCamOnTripod(s = 1) {
  return at(0, 0, s, [
    line(130, 170, 40, 420, INK2, 12),
    line(150, 170, 150, 430, INK2, 12),
    line(170, 170, 260, 420, INK2, 12),
    rect(110, 150, 80, 30, "#3a3a3a", 8),
    rect(40, 40, 200, 110, INK, 18),
    rect(240, 62, 70, 66, "#2a2a2a", 12),
    circle(310, 95, 40, "#3a3a3a"),
    circle(310, 95, 26, "#26394a"),
    circle(302, 87, 7, "rgba(255,255,255,0.55)"),
    rect(60, 10, 120, 34, "#2a2a2a", 10),
    circle(76, 70, 8, RED2),
    rect(70, 96, 120, 30, "#3a3a3a", 6),
  ].join(""));
}

function softbox(s = 1) {
  return at(0, 0, s, [
    line(100, 200, 100, 460, INK2, 10),
    line(100, 440, 40, 500, INK2, 10),
    line(100, 440, 160, 500, INK2, 10),
    path_("M0 0 H200 L170 200 H30 Z", INK2),
    path_("M16 14 H184 L158 186 H42 Z", "#fff6e8"),
    path_("M16 14 H184 L158 186 H42 Z", "url(#warm)"),
  ].join(""));
}

function ream(s = 1) {
  return at(0, 0, s, [
    rect(0, 0, 260, 120, WHITE, 6, `stroke="${GREY}" stroke-width="3"`),
    ...[0, 1, 2, 3, 4].map((i) => line(8, 22 + i * 20, 252, 22 + i * 20, "#e9e6e2", 3)),
    rect(0, 40, 260, 50, RED),
    rect(90, 52, 80, 26, WHITE, 4),
  ].join(""));
}

function binder(s = 1, color = INK) {
  return at(0, 0, s, [
    rect(0, 0, 90, 300, color, 8),
    rect(0, 0, 90, 300, "rgba(255,255,255,0.06)", 8),
    rect(18, 40, 54, 80, WHITE, 4),
    bars(28, 56, [34, 26, 30], GREY, 7, 14),
    circle(45, 240, 14, "rgba(255,255,255,0.85)"),
    circle(45, 240, 7, color),
  ].join(""));
}

function penCup(s = 1) {
  return at(0, 0, s, [
    rot(-14, 50, 0, rect(30, -150, 16, 170, RED, 8), path_("M30 -150 L38 -176 L46 -150 Z", "#f2d2a9")),
    rot(8, 80, 0, rect(70, -170, 16, 190, INK2, 8)),
    rot(20, 110, 0, rect(100, -130, 14, 150, "#f2c230", 7)),
    rect(16, 0, 130, 140, STEEL, 14),
    rect(16, 0, 130, 22, "#5c5c5c", 11),
    rect(30, 40, 16, 84, "rgba(255,255,255,0.12)", 8),
  ].join(""));
}

function stapler(s = 1) {
  return at(0, 0, s, [
    ellipse(130, 92, 140, 10, "rgba(0,0,0,0.10)"),
    rect(0, 64, 260, 24, INK2, 12),
    path_("M10 60 Q10 18 60 14 L250 30 Q262 32 262 44 V58 Q262 66 254 66 H18 Q10 66 10 60 Z", RED),
    rect(20, 26, 230, 10, "rgba(255,255,255,0.18)", 5),
  ].join(""));
}

function notebook(s = 1) {
  return at(0, 0, s, [
    rect(8, 10, 200, 260, "rgba(0,0,0,0.10)", 10),
    rect(0, 0, 200, 260, INK, 10),
    rect(160, 0, 14, 260, RED),
    rect(30, 40, 110, 40, "rgba(255,255,255,0.14)", 6),
  ].join(""));
}

function tshirt(s = 1, color = RED, mark = WHITE) {
  return at(0, 0, s, [
    path_("M80 0 Q130 34 180 0 L260 34 L300 120 L240 146 L224 118 V330 H36 V118 L20 146 L-40 120 L0 34 Z", color),
    path_("M80 0 Q130 34 180 0 L172 -2 Q130 22 88 -2 Z", "rgba(0,0,0,0.25)"),
    path_("M36 118 L20 146 L-40 120 L-30 96 Z", "rgba(0,0,0,0.12)"),
    path_("M224 118 L240 146 L300 120 L290 96 Z", "rgba(0,0,0,0.12)"),
    circle(130, 120, 34, mark),
    circle(130, 120, 16, color),
  ].join(""));
}

function mug(s = 1, color = WHITE, band = RED) {
  return at(0, 0, s, [
    ellipse(80, 182, 100, 12, "rgba(0,0,0,0.12)"),
    path_("M150 40 Q214 40 214 96 Q214 150 150 150", "none", `stroke="${color === WHITE ? "#e2ded9" : color}" stroke-width="22"`),
    rect(0, 0, 160, 180, color, 16, color === WHITE ? `stroke="${GREY}" stroke-width="3"` : ""),
    rect(0, 64, 160, 54, band),
    circle(80, 91, 16, WHITE),
    ellipse(80, 4, 80, 10, "#2a2a2a"),
  ].join(""));
}

function cap(s = 1) {
  return at(0, 0, s, [
    path_("M10 120 Q10 0 130 0 Q250 0 250 120 Z", INK),
    path_("M130 0 Q160 60 160 120 H140 Q140 60 130 0 Z", "rgba(255,255,255,0.08)"),
    path_("M200 108 Q300 104 340 128 Q300 146 220 140 Z", "#111"),
    circle(130, 2, 10, RED),
    circle(80, 70, 22, RED),
    rect(10, 110, 240, 14, "#111", 7),
  ].join(""));
}

function tote(s = 1) {
  return at(0, 0, s, [
    path_("M50 70 Q50 0 100 0 Q150 0 150 70", "none", `stroke="#cbbfae" stroke-width="12"`),
    rect(0, 60, 200, 230, "#efe6d8", 6),
    circle(100, 170, 40, RED),
    circle(100, 170, 18, "#efe6d8"),
  ].join(""));
}

function swatches(s = 1) {
  const sw = (deg, c) => rot(deg, 30, 260, rect(0, 0, 60, 260, WHITE, 10, `stroke="${GREY}" stroke-width="3"`), rect(6, 6, 48, 160, c, 6), circle(30, 230, 9, GREY));
  return at(0, 0, s, [sw(-40, INK), sw(-20, "#7a7a7a"), sw(0, RED2), sw(20, RED)].join(""));
}

function megaphone(s = 1) {
  return at(0, 0, s, [
    path_("M40 70 L230 0 V200 L40 130 Z", RED),
    path_("M40 70 L230 0 V40 L40 92 Z", "rgba(255,255,255,0.15)"),
    rect(0, 64, 60, 72, INK, 12),
    rect(222, -6, 30, 212, INK, 14),
    path_("M70 132 L110 146 L96 210 Q92 222 80 220 L64 216 Q54 212 56 200 Z", INK2),
    ...[0, 1, 2].map((i) => path_(`M${280 + i * 34} ${40 - i * 20} Q${310 + i * 40} 100 ${280 + i * 34} ${160 + i * 20}`, "none", `stroke="${i === 1 ? RED2 : INK2}" stroke-width="10" stroke-linecap="round"`)),
  ].join(""));
}

function penTool(s = 1) {
  return at(0, 0, s, [
    path_("M0 200 C120 -40 280 -40 400 200", "none", `stroke="${INK}" stroke-width="6"`),
    line(0, 200, 120, 60, "#9a958f", 3, `stroke-dasharray="8 8"`),
    line(400, 200, 280, 60, "#9a958f", 3, `stroke-dasharray="8 8"`),
    rect(-12, 188, 24, 24, WHITE, 3, `stroke="${INK}" stroke-width="5"`),
    rect(388, 188, 24, 24, WHITE, 3, `stroke="${INK}" stroke-width="5"`),
    circle(120, 60, 11, RED),
    circle(280, 60, 11, RED),
  ].join(""));
}

function businessCard(s = 1, dark = false) {
  return at(0, 0, s, [
    rect(8, 10, 300, 170, "rgba(0,0,0,0.12)", 12),
    rect(0, 0, 300, 170, dark ? INK : WHITE, 12),
    circle(60, 62, 30, RED),
    circle(60, 62, 13, dark ? INK : WHITE),
    bars(110, 46, [140, 100], dark ? "#5a5a5a" : GREY, 12, 24),
    bars(30, 120, [180, 130], dark ? "#3c3c3c" : LIGHT, 9, 18),
  ].join(""));
}

function screenBoard(s = 1) {
  return at(0, 0, s, [
    rect(0, 0, 460, 300, WHITE, 10, `stroke="${GREY}" stroke-width="4"`),
    rect(0, 0, 460, 24, INK, 10),
    rect(36, 60, 150, 14, INK, 7),
    bars(36, 92, [130, 110, 140], GREY, 10, 22),
    ...[0.4, 0.6, 0.5, 0.85].map((v, i) => rect(240 + i * 46, 250 - 180 * v, 32, 180 * v, i === 3 ? RED : i % 2 ? INK2 : "#bdbdbd", 5)),
    path_("M36 250 Q90 200 130 220 T 200 160", "none", `stroke="${RED}" stroke-width="6" stroke-linecap="round"`),
    line(230, 300, 200, 420, INK2, 10),
    line(230, 300, 260, 420, INK2, 10),
  ].join(""));
}

function chair(s = 1) {
  return at(0, 0, s, [
    rect(10, 0, 100, 90, INK2, 16),
    rect(0, 96, 120, 26, INK, 13),
    line(60, 122, 60, 170, "#555", 10),
    line(20, 180, 100, 180, "#555", 10),
  ].join(""));
}

function mouse(s = 1) {
  return at(0, 0, s, [rect(0, 0, 70, 110, INK2, 35), line(35, 8, 35, 40, "#555", 4), rect(30, 16, 10, 18, RED2, 5)].join(""));
}

function keyboard(s = 1) {
  return at(0, 0, s, [
    rect(0, 0, 380, 110, INK, 14),
    ...Array.from({ length: 3 }, (_, r) => Array.from({ length: 12 }, (_, c) => rect(14 + c * 30, 14 + r * 28, 24, 22, "#333", 4)).join("")),
    rect(90, 98 - 14, 200, 14, "#333", 4),
  ].join(""));
}

function cloud(x, y, s, fill) {
  return at(x, y, s, path_("M40 100 Q0 100 0 66 Q0 34 34 30 Q44 0 84 0 Q122 0 132 32 Q170 30 176 64 Q180 100 140 100 Z", fill));
}

/** Little "connection" nodes for network scenes. */
function nodes(points, color) {
  const lines = points.slice(1).map(([x, y]) => line(points[0][0], points[0][1], x, y, color, 4, `stroke-dasharray="2 12"`)).join("");
  return lines + points.map(([x, y], i) => circle(x, y, i === 0 ? 14 : 10, i === 0 ? RED : color)).join("");
}

// ---------- scenes ----------
function frame(theme, body, { glowX = 600, glowY = 400, floorY = 640, floorW = 420 } = {}) {
  const t = THEMES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${t.glow}" stop-opacity="1"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="warm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf7" stop-opacity="0.9"/><stop offset="1" stop-color="#ffe2b0" stop-opacity="0.6"/></linearGradient>
<pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="${t.dots}"/></pattern>
</defs>
${rect(0, 0, W, H, t.bg)}
${rect(0, 0, W, H, "url(#dots)")}
${circle(glowX, glowY, 420, "url(#glow)")}
${ellipse(600, floorY, floorW, 26, t.floor)}
${body}
</svg>`;
}

/** Alarm keypad with a small screen and number keys. */
function alarmKeypad(s = 1) {
  return at(0, 0, s, [
    rect(8, 10, 220, 300, "rgba(0,0,0,0.12)", 22),
    rect(0, 0, 220, 300, WHITE, 22, `stroke="${GREY}" stroke-width="4"`),
    rect(24, 24, 172, 60, INK, 10),
    rect(40, 44, 90, 12, RED2, 6),
    circle(176, 50, 7, "#3cc46a"),
    ...Array.from({ length: 12 }, (_, i) => rect(30 + (i % 3) * 56, 106 + Math.floor(i / 3) * 44, 46, 34, i === 11 ? RED : LIGHT, 8)),
  ].join(""));
}

/** Motion detector (PIR) on a wall bracket. */
function motionDetector(s = 1) {
  return at(0, 0, s, [
    rect(40, 0, 80, 26, "#cfcac4", 8),
    path_("M0 26 H160 V120 Q160 170 80 190 Q0 170 0 120 Z", WHITE, `stroke="${GREY}" stroke-width="4"`),
    path_("M30 70 H130 V110 Q130 140 80 150 Q30 140 30 110 Z", "#2c2c2c"),
    path_("M40 80 H120", "none", `stroke="rgba(255,255,255,0.25)" stroke-width="6"`),
    circle(80, 165, 6, RED2),
  ].join(""));
}

/** Card reader with an access card being presented. */
function cardReader(s = 1) {
  return at(0, 0, s, [
    rect(8, 10, 150, 240, "rgba(0,0,0,0.12)", 18),
    rect(0, 0, 150, 240, INK, 18),
    circle(75, 90, 40, "none", `stroke="${RED2}" stroke-width="6" opacity="0.8"`),
    circle(75, 90, 22, "none", `stroke="${RED2}" stroke-width="6" opacity="0.5"`),
    circle(75, 200, 8, "#3cc46a"),
    rot(-18, 160, 140, rect(110, 110, 170, 108, RED, 12), rect(126, 128, 46, 34, "#e8c56a", 6), bars(126, 182, [110], "rgba(255,255,255,0.6)", 10)),
  ].join(""));
}

/** Wall siren / strobe. */
function siren(s = 1) {
  return at(0, 0, s, [
    rect(0, 0, 150, 180, WHITE, 24, `stroke="${GREY}" stroke-width="4"`),
    rect(20, 20, 110, 70, RED2, 14),
    rect(20, 20, 110, 24, "rgba(255,255,255,0.3)", 12),
    ...[0, 1, 2].map((i) => rect(36, 110 + i * 18, 78, 8, GREY, 4)),
  ].join(""));
}

const SCENES = {
  alarms: (theme) =>
    frame(theme, [at(250, 230, 1.05, alarmKeypad(1)), at(560, 200, 1, motionDetector(1)), at(800, 260, 1, cardReader(1)), at(560, 440, 0.7, siren(1))].join(""), { floorY: 650 }),
  web: (theme) =>
    frame(theme, [
      at(250, 170, 1, browser(560, 400)),
      at(700, 330, 1, codePanel(300, 230)),
      at(180, 360, 1, phone(270)),
      circle(930, 220, 30, RED),
      path_("M918 220 l8 9 l16 -18", "none", `stroke="${WHITE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`),
    ].join("")),

  branding: (theme) =>
    frame(theme, [
      at(250, 250, 0.9, swatches(1)),
      at(400, 200, 1, penTool(1)),
      at(470, 420, 1, businessCard(1, theme === "light")),
      at(600, 470, 0.9, businessCard(1, theme === "dark")),
      at(800, 270, 0.8, megaphone(1)),
    ].join("")),

  printing: (theme) =>
    frame(theme, [
      at(330, 300, 1.05, printer(1)),
      at(820, 270, 0.9, inkDrops(1)),
      at(860, 420, 0.8, ream(1)),
      at(140, 330, 0.9, businessCard(1)),
      at(180, 450, 0.75, businessCard(1, true)),
    ].join(""), { floorY: 660 }),

  cctv: (theme) =>
    frame(theme, [
      rect(120, 150, 26, 300, theme === "dark" ? "#2a2a2a" : "#e2ded9", 6),
      at(150, 260, 1, bulletCamera(1)),
      path_("M470 210 L760 120 L760 430 Z", theme === "dark" ? "rgba(209,26,26,0.16)" : "rgba(176,1,1,0.08)"),
      at(640, 300, 1, monitor(380, feeds(12, 12, 356, 204))),
      at(300, 470, 0.9, domeCamera(1)),
    ].join(""), { glowX: 700 }),

  office: (theme) =>
    frame(theme, [
      at(230, 340, 1, binder(1, INK)),
      at(330, 340, 1, binder(1, RED)),
      at(430, 340, 1, binder(1, STEEL)),
      at(560, 520, 1, ream(1)),
      at(570, 440, 1, ream(0.98)),
      at(860, 390, 1, penCup(1)),
      at(640, 340, 0.6, notebook(1)),
      at(800, 580, 0.7, stapler(1)),
    ].join(""), { floorY: 650 }),

  photo: (theme) =>
    frame(theme, [
      at(120, 120, 1, softbox(1)),
      at(420, 300, 1.05, dslr(1)),
      at(780, 150, 1, videoCamOnTripod(1)),
    ].join(""), { floorY: 630, floorW: 480 }),

  training: (theme) =>
    frame(theme, [
      at(170, 140, 1, screenBoard(1)),
      at(700, 330, 1, laptop(300, dashboardScreen(14, 14, 272, 158))),
      at(640, 560, 0.7, chair(1)),
      at(860, 560, 0.7, chair(1)),
      circle(980, 190, 46, RED),
      circle(980, 180, 18, WHITE), rect(972, 196, 16, 14, WHITE, 3),
    ].join(""), { floorY: 660 }),

  souvenirs: (theme) =>
    frame(theme, [
      at(200, 200, 1, tshirt(1, RED)),
      at(560, 360, 1, mug(1)),
      at(560, 230, 0.75, cap(1)),
      at(850, 280, 1, tote(1)),
    ].join(""), { floorY: 590 }),

  network: (theme) =>
    frame(theme, [
      cloud(520, 120, 1, theme === "dark" ? "#2a2a2a" : WHITE),
      nodes([[608, 230], [380, 330], [820, 330]], theme === "dark" ? "#555" : "#bdb7b0"),
      at(450, 380, 1, router(1)),
      at(180, 280, 0.9, rackSwitch(1, 10)),
      at(180, 340, 0.9, rackSwitch(1, 10)),
      cable("M240 400 C240 520 420 520 470 480"),
      cable("M330 400 C330 560 520 560 560 490", INK2),
      at(820, 370, 1, laptop(240, dashboardScreen(14, 14, 212, 121))),
    ].join(""), { floorY: 620 }),

  computers: (theme) =>
    frame(theme, [
      at(330, 200, 1, laptop(420, dashboardScreen(14, 14, 392, 232))),
      at(240, 560, 0.85, keyboard(1)),
      at(880, 470, 1, mouse(1)),
      at(810, 250, 0.9, phone(250)),
    ].join(""), { floorY: 640 }),

  networkingCat: (theme) =>
    frame(theme, [
      at(420, 300, 1.2, router(1)),
      at(330, 520, 1, rackSwitch(1, 14)),
      cable("M380 440 C300 480 300 560 350 560"),
      cable("M820 440 C900 480 900 560 820 560", INK2),
    ].join(""), { floorY: 640 }),

  cctvCat: (theme) =>
    frame(theme, [
      rect(180, 170, 26, 260, theme === "dark" ? "#2a2a2a" : "#e2ded9", 6),
      at(210, 280, 1.1, bulletCamera(1)),
      at(720, 330, 1.2, domeCamera(1)),
      at(560, 520, 0.6, monitor(380, feeds(12, 12, 356, 204))),
    ].join(""), { floorY: 640 }),

  hero: (theme) =>
    frame(theme, [
      at(380, 170, 0.8, browser(560, 400)),
      at(170, 320, 0.7, bulletCamera(1)),
      at(780, 420, 0.7, printer(1)),
      at(320, 470, 0.75, mug(1)),
      at(470, 520, 0.9, router(1)),
      at(900, 220, 0.6, tshirt(1, RED)),
    ].join(""), { floorY: 660, floorW: 520 }),
};

// ---------- what goes where ----------
const SERVICE_ALT = {
  "web-software-development": ["web", "Illustration of a website, its code and a phone app"],
  "branding-advertising": ["branding", "Illustration of colour swatches, business cards and a megaphone"],
  "design-printing": ["printing", "Illustration of a printer, ink drops, business cards and paper"],
  "cctv-installation": ["cctv", "Illustration of security cameras and a monitor showing four camera views"],
  "office-supplies": ["office", "Illustration of binders, paper, pens, a notebook and a stapler"],
  "photography-videography": ["photo", "Illustration of a camera, a video camera on a tripod and a studio light"],
  "computer-training-consultancy": ["training", "Illustration of a presentation screen, a laptop and chairs"],
  "souvenirs-uniforms-promotional": ["souvenirs", "Illustration of a branded T-shirt, mug, cap and tote bag"],
  "tech-networking-it-supplies": ["network", "Illustration of a router, network switches, cables and a laptop"],
};
const CATEGORY_ALT = {
  "computers-accessories": ["computers", "Illustration of a laptop, keyboard, mouse and phone"],
  networking: ["networkingCat", "Illustration of a router and a network switch"],
  cctv: ["cctvCat", "Illustration of a bullet camera, a dome camera and a monitor"],
  "office-supplies": ["office", "Illustration of binders, paper, pens, a notebook and a stapler"],
  "souvenirs-promotional": ["souvenirs", "Illustration of a branded T-shirt, mug, cap and tote bag"],
  "alarms-access-control": ["alarms", "Illustration of an alarm keypad, a motion detector, a card reader and a siren"],
  "printers-ink": ["printing", "Illustration of a printer, ink drops, business cards and paper"],
};
/** Whether slides and shop categories use the 3D renders. Off: KingsView chose the drawings (2026-10-14). */
const USE_3D = false;
/** Shop categories pictured by a 3D render (assets/renders/<name>.webp). */
const CATEGORY_3D = { "computers-accessories": "computers-light", networking: "networking-light", cctv: "cctv-light", "office-supplies": "office-light", "souvenirs-promotional": "souvenirs-light" };
/** Starter slides: wording is a draft for KingsView to edit in admin. */
const SLIDES = [
  { key: "hero", headline: "Technology, design and supplies — handled in one place.", body: "Websites, branding, printing, CCTV, training, branded items, office and IT supplies for businesses, schools, churches and homes.", ctaLabel: "Request a quotation", ctaHref: "/contact", alt: "Illustration of a website, camera, printer, router and branded items" },
  { key: "cctv", headline: "CCTV installed, explained and supported", body: "We survey your site, recommend the right cameras and recorder, install them neatly and show you how to view them on your phone.", ctaLabel: "CCTV installation", ctaHref: "/services/cctv-installation", alt: "Illustration of security cameras and a monitor showing four camera views" },
  { key: "web", headline: "Websites and software that work for your business", body: "From a clear company website to online shops and custom systems that save your team time.", ctaLabel: "Website & software", ctaHref: "/services/web-software-development", alt: "Illustration of a website, its code and a phone app" },
  { key: "office", headline: "Office and IT supplies, ready when you are", body: "Order online for pickup or delivery and pay by mobile money, card or transfer.", ctaLabel: "Visit the shop", ctaHref: "/shop", alt: "Illustration of binders, paper, pens, a notebook and a stapler" },
  { key: "souvenirs", headline: "Your brand on uniforms, mugs and gifts", body: "Branded T-shirts, caps, mugs and bags for staff, events and customers.", ctaLabel: "Branded items", ctaHref: "/services/souvenirs-uniforms-promotional", alt: "Illustration of a branded T-shirt, mug, cap and tote bag" },
];

// ---------- build ----------
const SRC_DIR = "assets/illustrations";
const OUT_DIR = "assets/starter-images";
// Fingerprints of every earlier starter picture, so the installer may replace them (and only them) later.
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const replaceable = new Set();
if (existsSync(path.join(OUT_DIR, "manifest.json"))) {
  for (const h of JSON.parse(readFileSync(path.join(OUT_DIR, "manifest.json"), "utf8")).replaceable ?? []) replaceable.add(h);
  for (const d of readdirSync(OUT_DIR)) if (existsSync(path.join(OUT_DIR, d, "1600.webp"))) replaceable.add(sha(path.join(OUT_DIR, d, "1600.webp")));
}
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const rendered = new Map();
async function render(scene, theme) {
  const name = `${scene}-${theme}`;
  if (rendered.has(name)) return name;
  const svg = SCENES[scene](theme);
  writeFileSync(path.join(SRC_DIR, `${name}.svg`), svg);
  const dir = path.join(OUT_DIR, name);
  mkdirSync(dir, { recursive: true });
  for (const width of [320, 800, 1600]) {
    await sharp(Buffer.from(svg), { density: (72 * width) / W })
      .resize({ width })
      .webp({ quality: width === 320 ? 72 : 80, effort: 6 })
      .toFile(path.join(dir, `${width}.webp`));
  }
  rendered.set(name, true);
  return name;
}

/**
 * A 3D render converted to the web copies, or null when there is none. Blender writes assets/renders/<name>.png
 * (not committed: too large); it is kept as a high-quality <name>.webp, which is what the repository stores.
 */
async function render3d(name) {
  if (!USE_3D) return null;
  const png = path.join("assets/renders", `${name}.png`);
  const src = path.join("assets/renders", `${name}.webp`);
  if (existsSync(png)) await sharp(png).webp({ quality: 95, effort: 6 }).toFile(src);
  if (!existsSync(src)) return null;
  const out = `3d-${name}`;
  if (rendered.has(out)) return out;
  const dir = path.join(OUT_DIR, out);
  mkdirSync(dir, { recursive: true });
  for (const width of [320, 800, 1600]) {
    await sharp(src).resize({ width }).webp({ quality: width === 320 ? 72 : 82, effort: 6 }).toFile(path.join(dir, `${width}.webp`));
  }
  rendered.set(out, true);
  return out;
}

const manifest = { services: [], categories: [], slides: [] };
for (const [slug, [scene, alt]] of Object.entries(SERVICE_ALT)) manifest.services.push({ slug, image: await render(scene, "light"), alt });
for (const [slug, [scene, alt]] of Object.entries(CATEGORY_ALT)) {
  const r = CATEGORY_3D[slug] && (await render3d(CATEGORY_3D[slug]));
  manifest.categories.push({ slug, image: r ?? (await render(scene, "light")), alt: r ? alt.replace("Illustration", "3D illustration") : alt });
}
for (const s of SLIDES) {
  const r = await render3d(`${s.key}-dark`);
  manifest.slides.push({ ...s, image: r ?? (await render(s.key, "dark")), alt: r ? s.alt.replace("Illustration", "3D illustration") : s.alt });
}
manifest.replaceable = [...replaceable].sort();
writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${rendered.size} illustrations to ${SRC_DIR} and ${OUT_DIR}`);
