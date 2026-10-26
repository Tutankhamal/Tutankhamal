const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const USERNAME = 'Tutankhamal';
const GQL_QUERY = `query {
  user(login: "${USERNAME}") {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

async function fetchContributions() {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Tutankhamal-Profile-Generator'
      },
      body: JSON.stringify({ query: GQL_QUERY })
    });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  } else {
    const tmpQuery = path.join(__dirname, 'tmp-query.gql');
    fs.writeFileSync(tmpQuery, GQL_QUERY, 'utf8');
    try {
      const out = execSync(`gh api graphql -F query=@"${tmpQuery}"`, { encoding: 'utf8' });
      return JSON.parse(out.replace(/^\uFEFF/, ''));
    } finally {
      if (fs.existsSync(tmpQuery)) fs.unlinkSync(tmpQuery);
    }
  }
}

function generateActivitySvg(days) {
  const width = 900;
  const height = 210;

  const padLeft = 45;
  const padRight = 35;
  const padTop = 65;
  const padBottom = 35;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const totalCommits = days.reduce((sum, d) => sum + d.contributionCount, 0);
  const maxValRaw = Math.max(...days.map(d => d.contributionCount), 10);
  const maxY = Math.ceil(maxValRaw / 25) * 25;

  const stepX = chartWidth / (days.length - 1);
  const points = days.map((d, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + chartHeight - (d.contributionCount / maxY) * chartHeight;
    return { x, y, count: d.contributionCount, date: d.date };
  });

  function getCubicBezierPath(pts) {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  const linePath = getCubicBezierPath(points);
  const areaBottomY = (padTop + chartHeight).toFixed(1);
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${areaBottomY} L ${points[0].x.toFixed(1)} ${areaBottomY} Z`;

  const gridLines = [0.25, 0.5, 0.75, 1.0].map(ratio => {
    const y = padTop + chartHeight - ratio * chartHeight;
    const val = Math.round(ratio * maxY);
    return `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#FF3333" stroke-opacity="0.12" stroke-dasharray="3,4" stroke-width="1"/>
      <text x="${padLeft - 8}" y="${y + 3}" text-anchor="end" class="grid-val">${val}</text>
    `;
  }).join('');

  const xLabels = points.map((p, idx) => {
    if (idx % 5 === 0 || idx === points.length - 1) {
      const parts = p.date.split('-');
      const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = `${parts[2]} ${monthNames[parseInt(parts[1], 10)]}`;
      return `<text x="${p.x.toFixed(1)}" y="${height - 12}" text-anchor="middle" class="axis-date">${label}</text>`;
    }
    return '';
  }).join('');

  const circles = points.map((p, idx) => {
    const isSuperPeak = p.count >= 120;
    const isPeak = p.count >= 60;
    if (isSuperPeak) {
      return `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" fill="#FF3333" fill-opacity="0.25"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#FFFFFF" stroke="#FF3333" stroke-width="2"/>
        <text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" class="peak-label">${p.count}</text>
      `;
    } else if (isPeak) {
      return `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#FF3333" stroke="#FFFFFF" stroke-width="1.5"/>
        <text x="${p.x.toFixed(1)}" y="${(p.y - 7).toFixed(1)}" text-anchor="middle" class="peak-label-sub">${p.count}</text>
      `;
    } else if (idx % 2 === 0) {
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#FF3333"/>`;
    }
    return '';
  }).join('');

  const avgPerDay = (totalCommits / days.length).toFixed(1);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="André Borba's GitHub Activity Graph">
  <defs>
    <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FF3333" stop-opacity="0.35"/>
      <stop offset="60%" stop-color="#FF3333" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#FF3333" stop-opacity="0.00"/>
    </linearGradient>
    <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FF5555"/>
      <stop offset="50%" stop-color="#FF2222"/>
      <stop offset="100%" stop-color="#FF4444"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#FF3333" flood-opacity="0.5"/>
    </filter>
  </defs>

  <style>
    .header { font: 700 18px 'Orbitron', 'Segoe UI', Ubuntu, Sans-Serif; fill: #FF3333; letter-spacing: 0.5px; }
    .badge-label { font: 600 11px 'Orbitron', 'Segoe UI', Ubuntu, Sans-Serif; fill: #EFE6D0; }
    .badge-val { font: 800 12px 'Orbitron', 'Segoe UI', Ubuntu, Sans-Serif; fill: #FF3333; }
    .axis-date { font: 500 10px 'Orbitron', 'Segoe UI', Ubuntu, Sans-Serif; fill: #888888; }
    .grid-val { font: 500 9px 'Segoe UI', Ubuntu, Sans-Serif; fill: #666666; }
    .peak-label { font: 800 10px 'Orbitron', 'Segoe UI', Ubuntu, Sans-Serif; fill: #FFFFFF; }
    .peak-label-sub { font: 700 9px 'Orbitron', 'Segoe UI', Ubuntu, Sans-Serif; fill: #FF9999; }
  </style>

  <!-- Background Card -->
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="10" fill="#050505" stroke="#FF3333" stroke-width="1.5" stroke-opacity="0.6"/>

  <!-- Corner Tech Accent -->
  <path d="M1 15 L1 1 L15 1" stroke="#FF3333" stroke-width="2.5" fill="none"/>
  <path d="M${width - 1} 15 L${width - 1} 1 L${width - 15} 1" stroke="#FF3333" stroke-width="2.5" fill="none"/>
  <path d="M1 ${height - 15} L1 ${height - 1} L15 ${height - 1}" stroke="#FF3333" stroke-width="2.5" fill="none"/>
  <path d="M${width - 1} ${height - 15} L${width - 1} ${height - 1} L${width - 15} ${height - 1}" stroke="#FF3333" stroke-width="2.5" fill="none"/>

  <!-- Header Title -->
  <text x="25" y="35" class="header">ACTIVITY GRAPH · LAST 31 DAYS</text>

  <!-- Metric Badges (Top Right) -->
  <g transform="translate(${width - 430}, 20)">
    <!-- Pill 1: Total -->
    <rect x="0" y="0" width="130" height="24" rx="4" fill="#15080A" stroke="#FF3333" stroke-width="1"/>
    <text x="10" y="16" class="badge-label">TOTAL:</text>
    <text x="65" y="16" class="badge-val">${totalCommits}</text>

    <!-- Pill 2: Peak -->
    <rect x="140" y="0" width="125" height="24" rx="4" fill="#15080A" stroke="#FF3333" stroke-width="1"/>
    <text x="150" y="16" class="badge-label">PEAK:</text>
    <text x="200" y="16" class="badge-val">${maxValRaw}</text>

    <!-- Pill 3: Average -->
    <rect x="275" y="0" width="130" height="24" rx="4" fill="#15080A" stroke="#FF3333" stroke-width="1"/>
    <text x="285" y="16" class="badge-label">AVG:</text>
    <text x="325" y="16" class="badge-val">${avgPerDay}/d</text>
  </g>

  <!-- Grid lines -->
  ${gridLines}

  <!-- Chart Area Gradient Fill -->
  <path d="${areaPath}" fill="url(#areaGradient)"/>

  <!-- Chart Line Curve with Glow -->
  <path d="${linePath}" stroke="url(#lineGradient)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>

  <!-- Interactive / Highlight Points -->
  ${circles}

  <!-- X Axis Date Labels -->
  ${xLabels}
</svg>
`;
}

async function main() {
  console.log('Fetching GitHub contribution data for', USERNAME);
  const data = await fetchContributions();
  const calendar = data.data.user.contributionsCollection.contributionCalendar;
  const weeks = calendar.weeks;
  const allDays = [];
  for (const w of weeks) {
    for (const d of w.contributionDays) {
      allDays.push(d);
    }
  }

  const last31 = allDays.slice(-31);
  const svg = generateActivitySvg(last31);

  const rootDir = path.resolve(__dirname, '..');
  const activityPath = path.join(rootDir, 'activity-graph.svg');
  fs.writeFileSync(activityPath, svg, 'utf8');
  console.log('Updated', activityPath);
  console.log(`Total year contributions: ${calendar.totalContributions}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
