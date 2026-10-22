// The icon family of the "Reef Poster" look (mockups/06-icons.png), ported unchanged from _reports/aaa/mockups/src/lib.js.
// 24-unit grid, 2-unit ink line with round caps and joins, 2-unit corner radius, one flat accent plate 1.4 units down and right
// of the line (light from the top left). Each icon is [closed shapes (a filled plate and a line), open shapes (a stroked plate and
// a line)]. ico() returns an inline <svg>: the line takes the CSS colour of the element, the plate takes --ia.

const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
// name: [closed shapes (filled shadow plate + line), open shapes (stroked shadow + line)]
export const ICONS = {
  swell: ['M2.5 19C3 11 8 5 14.5 5.5C18.5 5.8 21 8.5 21.5 12C20 10.6 18 10.8 17.2 12.4C16.4 14.2 17.4 16.4 19.5 17.4L21.5 19Z', 'M5.5 15.5C7.3 12.3 10 10.8 13 10.8'],
  wind: ['', 'M3 9h10a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 18.5h6'],
  tide: ['', 'M3 14q2.25-3 4.5 0t4.5 0t4.5 0t4.5 0M3 19q2.25-3 4.5 0t4.5 0t4.5 0t4.5 0M12 2.5v7M9 6.5l3 3l3-3'],
  shark: ['M2.5 18.5C8 17.5 10.5 12 11.5 3.5C13.5 9 17 14.5 21.5 18.5Z', 'M3 21.5q2.25-1.5 4.5 0t4.5 0t4.5 0t3 0'],
  reef: ['M3 20.5L5 15L10 13.5L13 15L16 12.5L21 17V20.5Z', 'M8 13.5V6M8 9L5.5 6.5M8 10.3L10.5 7.8M16 12.5V4.5M16 8L13.5 5.5M16 9.6L18.5 7.1'],
  trophy: ['M7 3.5H17V10a5 5 0 0 1-10 0Z', 'M7 5.5H4.5C4.5 9 5.5 10 7.5 10.5M17 5.5H19.5C19.5 9 18.5 10 16.5 10.5M12 15v3.5M8 20.5H16M9.5 18.5H14.5'],
  rank: ['M12 2.5L20 5.5V12C20 16.5 16.5 19.8 12 21.5C7.5 19.8 4 16.5 4 12V5.5Z', 'M8.5 10.5L12 7.5L15.5 10.5M8.5 15L12 12L15.5 15'],
  board: ['M12 2C15.5 6 16.5 12 15.5 17.5C15 20 13.5 22 12 22C10.5 22 9 20 8.5 17.5C7.5 12 8.5 6 12 2Z', 'M12 6.5V15.5'],
  shorts: ['M5 4H19L20.5 19.5H13.2L12 11L10.8 19.5H3.5Z', 'M5 7.2H19M10.5 7.2L9.5 10.2M13.5 7.2L14.5 10.2'],
  bikini: ['M3 5H10.5L7 12ZM21 5H13.5L17 12ZM5.5 15.5H18.5L14.5 21H9.5Z', 'M10.5 5Q12 2.5 13.5 5'],
  rashguard: ['M9 3Q12 5.5 15 3L20 5.5L22 18L18.5 18.6L16.5 10V21H7.5V10L5.5 18.6L2 18L4 5.5Z', 'M9 3Q12 6.5 15 3'],
  locker: ['M5 3H19V21H5Z', 'M12 3V21M7.5 6.5H9.5M7.5 8.7H9.5M14.5 6.5H16.5M14.5 8.7H16.5M10 13v2.5M14 13v2.5'],
  settings: [circ(8, 7, 2.2) + circ(16, 12, 2.2) + circ(10, 17, 2.2), 'M3 7H5.8M10.2 7H21M3 12H13.8M18.2 12H21M3 17H7.8M12.2 17H21'],
  help: [circ(12, 12, 9.5), 'M9.4 9.6C9.4 6.6 14.6 6.6 14.6 9.6C14.6 11.7 12 11.7 12 14.2M12 17v.2'],
  play: ['M7 4.5L19.5 12L7 19.5Z', ''],
  lock: ['M5.5 10.5H18.5V21H5.5Z', 'M8 10.5V7.5a4 4 0 0 1 8 0V10.5M12 14.5v2.5'],
  tube: ['', 'M20 12a8 8 0 1 1-8-8M16.5 12a4.5 4.5 0 1 1-4.5-4.5M12 11.5v.5M17 3.5l3.5.5l-.5 3.5'],
  clock: [circ(12, 12, 9.5), 'M12 6.5V12L15.5 14'],
  flag: ['M5 4H19L16 8L19 12H5Z', 'M5 21V3'],
  bolt: ['M13 2L4.5 13.5H11L10 22L19.5 10H13Z', ''],
  'r-basic': [circ(12, 12, 7.5), 'M12 11.2v1.6'],
  'r-tour': ['M12 3L19.5 7.5V16.5L12 21L4.5 16.5V7.5Z', 'M12 8v8M8.5 10l3.5 2l3.5-2'],
  'r-elite': ['M7 4H17L21.5 10L12 21L2.5 10Z', 'M2.5 10H21.5M9 4L12 10L15 4M12 10V21'],
  'r-signature': ['M12 2L14.8 8.2L21.5 9L16.5 13.6L17.9 20.3L12 17L6.1 20.3L7.5 13.6L2.5 9L9.2 8.2Z', '']
};

const esc = (v) => String(v).replace(/[^#\w(),.% -]/g, "");

/** An inline icon: name from ICONS, size in px, the accent plate colour, the line colour (default: the surrounding CSS colour). */
export function ico(name, px = 24, accent = "#FFC21A", line = "currentColor") {
  const entry = ICONS[name];
  if (!entry) throw new Error(`icons: no icon called "${name}"`);
  const [closed, open] = entry;
  const plate = `<g transform="translate(1.4 1.4)" fill="var(--ia)" stroke="var(--ia)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${closed ? `<path d="${closed}"/>` : ""}${open ? `<path d="${open}" fill="none"/>` : ""}</g>`;
  const ink = `<g fill="none" stroke="${esc(line)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${closed ? `<path d="${closed}"/>` : ""}${open ? `<path d="${open}"/>` : ""}</g>`;
  return `<svg class="ico" viewBox="-1 -1 26.4 26.4" width="${px}" height="${px}" style="--ia:${esc(accent)}" aria-hidden="true">${plate}${ink}</svg>`;
}
