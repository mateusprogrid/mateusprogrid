import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const username = process.env.GITHUB_USERNAME || "mateusprogrid";
const outputPath = resolve(
  process.env.OUTPUT_PATH || "assets/contribution-activity-overview.svg",
);

function readNonNegativeInteger(name) {
  const rawValue = process.env[name];
  if (rawValue === undefined) return null;

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

function offlineStats() {
  const stats = {
    commits: readNonNegativeInteger("COMMITS"),
    reviews: readNonNegativeInteger("CODE_REVIEWS"),
    issues: readNonNegativeInteger("ISSUES"),
    pullRequests: readNonNegativeInteger("PULL_REQUESTS"),
  };

  return Object.values(stats).every((value) => value !== null) ? stats : null;
}

async function fetchContributionStats() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    const stats = offlineStats();
    if (stats) return stats;

    throw new Error(
      "Set GITHUB_TOKEN, or provide COMMITS, CODE_REVIEWS, ISSUES and PULL_REQUESTS for an offline build.",
    );
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 365);

  const query = `
    query ContributionOverview($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${username}-profile-readme`,
    },
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(({ message }) => message).join("; "));
  }

  const contributions = payload.data?.user?.contributionsCollection;
  if (!contributions) {
    throw new Error(`GitHub user ${username} was not found.`);
  }

  return {
    commits: contributions.totalCommitContributions,
    reviews: contributions.totalPullRequestReviewContributions,
    issues: contributions.totalIssueContributions,
    pullRequests: contributions.totalPullRequestContributions,
  };
}

function wholePercentages(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);

  const exact = values.map((value) => (value / total) * 100);
  const percentages = exact.map(Math.floor);
  let remaining = 100 - percentages.reduce((sum, value) => sum + value, 0);

  exact
    .map((value, index) => ({ index, remainder: value - percentages[index] }))
    .sort((a, b) => b.remainder - a.remainder)
    .forEach(({ index }) => {
      if (remaining > 0) {
        percentages[index] += 1;
        remaining -= 1;
      }
    });

  return percentages;
}

function pointFor(axis, percentage) {
  const centerX = 450;
  const centerY = 210;
  const distance = 95 * (percentage / 100);

  const points = {
    top: [centerX, centerY - distance],
    right: [centerX + distance, centerY],
    bottom: [centerX, centerY + distance],
    left: [centerX - distance, centerY],
  };

  return points[axis].map((value) => value.toFixed(1)).join(",");
}

function buildSvg(stats) {
  const values = [stats.commits, stats.reviews, stats.issues, stats.pullRequests];
  const [commitPct, reviewPct, issuePct, pullRequestPct] = wholePercentages(values);
  const total = values.reduce((sum, value) => sum + value, 0);

  const plotPoints = [
    pointFor("top", reviewPct),
    pointFor("right", issuePct),
    pointFor("bottom", pullRequestPct),
    pointFor("left", commitPct),
  ].join(" ");

  const labels = [
    { label: "Code reviews", value: stats.reviews, pct: reviewPct, x: 450, y: 78, anchor: "middle" },
    { label: "Issues", value: stats.issues, pct: issuePct, x: 735, y: 195, anchor: "start" },
    { label: "Pull requests", value: stats.pullRequests, pct: pullRequestPct, x: 450, y: 326, anchor: "middle" },
    { label: "Commits", value: stats.commits, pct: commitPct, x: 165, y: 195, anchor: "end" },
  ];

  const labelMarkup = labels
    .map(
      ({ label, value, pct, x, y, anchor }, index) => `
      <g class="metric metric-${index + 1}" transform="translate(${x} ${y})" text-anchor="${anchor}">
        <text class="metric-name">${label}</text>
        <text class="metric-value" y="22">${pct}% <tspan class="metric-count">· ${value}</tspan></text>
      </g>`,
    )
    .join("");

  const pointMarkup = [
    pointFor("top", reviewPct),
    pointFor("right", issuePct),
    pointFor("bottom", pullRequestPct),
    pointFor("left", commitPct),
  ]
    .map((point) => {
      const [cx, cy] = point.split(",");
      return `<circle class="data-point" cx="${cx}" cy="${cy}" r="5" />`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360" role="img" aria-labelledby="title desc">
  <title id="title">Mateus Melo GitHub Activity Overview</title>
  <desc id="desc">Public contribution mix during the last twelve months: ${stats.commits} commits, ${stats.reviews} code reviews, ${stats.issues} issues and ${stats.pullRequests} pull requests.</desc>
  <style>
    :root { color-scheme: dark; }
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .card { fill: #011356; stroke: #4801ff; stroke-opacity: .55; }
    .heading { fill: #16e6ff; font-size: 19px; font-weight: 700; }
    .subtitle, .metric-count { fill: #94a3b8; }
    .subtitle { font-size: 12px; }
    .grid { fill: none; stroke: #16e6ff; stroke-opacity: .16; }
    .axis { stroke: #16e6ff; stroke-opacity: .32; stroke-dasharray: 205; animation: draw-axis 1.25s ease-out both; }
    .area { fill: #16e6ff; fill-opacity: .20; stroke: #16e6ff; stroke-width: 2.5; transform-box: fill-box; transform-origin: center; animation: reveal-area 1.35s cubic-bezier(.2,.8,.2,1) both; }
    .data-point { fill: #4801ff; stroke: #16e6ff; stroke-width: 2; opacity: 1; transform-box: fill-box; transform-origin: center; animation: show-point .4s ease-out 1.05s both; }
    .metric { opacity: 1; animation: show-label .45s ease-out both; }
    .metric-1 { animation-delay: .25s; }
    .metric-2 { animation-delay: .4s; }
    .metric-3 { animation-delay: .55s; }
    .metric-4 { animation-delay: .7s; }
    .metric-name { fill: #ffffff; font-size: 14px; font-weight: 600; }
    .metric-value { fill: #16e6ff; font-size: 18px; font-weight: 700; }
    .metric-count { font-size: 12px; font-weight: 500; }
    @keyframes draw-axis { from { stroke-dashoffset: 205; } to { stroke-dashoffset: 0; } }
    @keyframes reveal-area { from { opacity: 0; transform: scale(.08); } to { opacity: 1; transform: scale(1); } }
    @keyframes show-point { from { opacity: 0; transform: scale(.25); } to { opacity: 1; transform: scale(1); } }
    @keyframes show-label { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .axis, .area, .data-point, .metric { animation: none; opacity: 1; }
    }
  </style>

  <rect class="card" x="1" y="1" width="898" height="358" rx="14" />
  <text class="heading" x="450" y="31" text-anchor="middle">Mateus Melo GitHub Activity Overview</text>
  <text class="subtitle" x="450" y="51" text-anchor="middle">Public contribution mix · last 12 months · updated daily</text>

  <g aria-hidden="true">
    <path class="grid" d="M450 186.25 L473.75 210 L450 233.75 L426.25 210 Z" />
    <path class="grid" d="M450 162.5 L497.5 210 L450 257.5 L402.5 210 Z" />
    <path class="grid" d="M450 138.75 L521.25 210 L450 281.25 L378.75 210 Z" />
    <path class="grid" d="M450 115 L545 210 L450 305 L355 210 Z" />
    <line class="axis" x1="450" y1="115" x2="450" y2="305" />
    <line class="axis" x1="355" y1="210" x2="545" y2="210" />
  </g>

  <polygon class="area" points="${plotPoints}" />
  <g aria-hidden="true">${pointMarkup}</g>
  ${labelMarkup}

  <text class="subtitle" x="878" y="340" text-anchor="end">${total} public activities</text>
</svg>
`;
}

const stats = await fetchContributionStats();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, buildSvg(stats), "utf8");

console.log(`Updated ${outputPath} for @${username}.`);
