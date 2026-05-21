#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1080;
const COLORS = {
  bg: "#000000",
  text: "#FFFFFF",
  accent: "#4F8EF7",
  wordmark: "#6B7280",
};

const OUTPUT_DIR = path.join(
  process.env.HOME || "",
  "Desktop",
  "DisciplinedEdge-Carousel",
);

const slides = {
  1: {
    filename: "slide-1-the-5-rules-that-actually-matter.png",
    headline: ["The 5 Rules", "That Actually Matter"],
    subtitle: "And why writing them down isn't enough.",
    type: "cover",
  },
  2: {
    filename: "slide-2-max-daily-loss.png",
    rule: "RULE 1",
    headline: "Max Daily Loss %",
    body: "Set it. Write it down. If you can't name the exact number, you don't have a rule.",
    type: "rule",
  },
  3: {
    filename: "slide-3-max-trades-per-day.png",
    rule: "RULE 2",
    headline: "Max Trades Per Day",
    body: "Volume is a discipline problem. Most traders take 1-2 good trades and 3-4 frustration trades.",
    type: "rule",
  },
  4: {
    filename: "slide-4-session-hours-only.png",
    rule: "RULE 3",
    headline: "Session Hours Only",
    body: "If you don't define when you trade, you'll trade whenever the market looks good. That means always.",
    type: "rule",
  },
  5: {
    filename: "slide-5-fixed-position-sizing.png",
    rule: "RULE 4",
    headline: "Fixed Position Sizing",
    body: "Risk per trade. Not gut feel. Not 'high conviction.' A fixed percentage, every time.",
    type: "rule",
  },
  6: {
    filename: "slide-6-no-re-entry-after-stop-loss.png",
    rule: "RULE 5",
    headline: "No Re-Entry After Stop-Loss",
    body: "Define the window. 5 minutes. 10 minutes. Whatever it is - it needs to be a number, not a feeling.",
    type: "rule",
  },
  7: {
    filename: "slide-7-rule-isnt-the-discipline.png",
    headline: ["The rule isn't the discipline.", "Measuring whether you follow it", "that's the discipline."],
    footer: "@plugapro",
    type: "closing",
  },
};

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wordmark() {
  return `
    <text x="960" y="1010"
      text-anchor="end"
      font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
      font-size="28"
      font-weight="500"
      fill="${COLORS.wordmark}"
      letter-spacing="0.6">
      DisciplinedEdge
    </text>
  `;
}

function renderCover(slide) {
  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${COLORS.bg}" />
      <g transform="translate(540 430)">
        <text
          x="0"
          y="0"
          text-anchor="middle"
          font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
          font-size="88"
          font-weight="800"
          fill="${COLORS.text}"
          letter-spacing="-2.4">
          <tspan x="0" dy="0">${escapeXml(slide.headline[0])}</tspan>
          <tspan x="0" dy="98">${escapeXml(slide.headline[1])}</tspan>
        </text>
        <rect x="-180" y="142" width="360" height="8" rx="4" fill="${COLORS.accent}" />
        <text
          x="0"
          y="230"
          text-anchor="middle"
          font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
          font-size="36"
          font-weight="450"
          fill="${COLORS.text}"
          opacity="0.9"
          letter-spacing="-0.3">
          ${escapeXml(slide.subtitle)}
        </text>
      </g>
      ${wordmark()}
    </svg>
  `;
}

function renderRule(slide) {
  const bodyLines = wrapText(slide.body, 34);

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${COLORS.bg}" />
      <g transform="translate(118 148)">
        <rect x="0" y="0" width="152" height="46" rx="23" fill="${COLORS.accent}" />
        <text
          x="76"
          y="31"
          text-anchor="middle"
          font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
          font-size="22"
          font-weight="800"
          fill="${COLORS.bg}"
          letter-spacing="1.4">
          ${escapeXml(slide.rule)}
        </text>

        <text
          x="0"
          y="186"
          font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
          font-size="96"
          font-weight="800"
          fill="${COLORS.text}"
          letter-spacing="-2.6">
          ${escapeXml(slide.headline)}
        </text>

        <rect x="0" y="250" width="160" height="8" rx="4" fill="${COLORS.accent}" />

        <text
          x="0"
          y="374"
          font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
          font-size="42"
          font-weight="450"
          fill="${COLORS.text}"
          opacity="0.92"
          letter-spacing="-0.3">
          ${bodyLines
            .map(
              (line, index) =>
                `<tspan x="0" dy="${index === 0 ? 0 : 58}">${escapeXml(line)}</tspan>`,
            )
            .join("")}
        </text>
      </g>
      ${wordmark()}
    </svg>
  `;
}

function renderClosing(slide) {
  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${COLORS.bg}" />
      <g transform="translate(540 378)">
        <text
          x="0"
          y="0"
          text-anchor="middle"
          font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
          font-size="74"
          font-weight="800"
          fill="${COLORS.text}"
          letter-spacing="-1.8">
          <tspan x="0" dy="0">${escapeXml(slide.headline[0])}</tspan>
          <tspan x="0" dy="94">${escapeXml(slide.headline[1])}</tspan>
          <tspan x="0" dy="94">${escapeXml(slide.headline[2])}</tspan>
        </text>
        <text
          x="0"
          y="410"
          text-anchor="middle"
          font-family="Inter, SF Pro Display, SF Pro Text, Arial, sans-serif"
          font-size="40"
          font-weight="700"
          fill="${COLORS.accent}"
          letter-spacing="0.2">
          ${escapeXml(slide.footer)}
        </text>
      </g>
      ${wordmark()}
    </svg>
  `;
}

function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

async function main() {
  const slideNumber = Number(process.argv[2] || "1");
  const slide = slides[slideNumber];

  if (!slide) {
    throw new Error(`Unknown slide number: ${process.argv[2] || ""}`);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const svg =
    slide.type === "cover"
      ? renderCover(slide)
      : slide.type === "closing"
        ? renderClosing(slide)
        : renderRule(slide);

  const outputPath = path.join(OUTPUT_DIR, slide.filename);

  await sharp(Buffer.from(svg))
    .png()
    .toFile(outputPath);

  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
