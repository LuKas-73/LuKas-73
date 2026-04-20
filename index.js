const fs = require("fs");
const https = require("https");

const USERNAME = "LuKas-73";
const TOKEN = process.env.GH_TOKEN || "";

console.log(`🔑 Token present: ${TOKEN ? "YES (" + TOKEN.substring(0, 4) + "...)" : "NO"}`);

/**
 * Make a GitHub API request
 */
function githubRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path,
      method: "GET",
      headers: {
        "User-Agent": "LuKas-73-stats-bot",
        Accept: "application/vnd.github.v3+json",
      },
    };

    if (TOKEN) {
      options.headers["Authorization"] = `token ${TOKEN}`;
    }

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          console.error(`⚠️ API ${path} returned status ${res.statusCode}`);
          console.error(`   Response: ${data.substring(0, 200)}`);
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Failed to parse response from ${path}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetch all repos (tries authenticated first, falls back to public)
 */
async function fetchAllRepos() {
  const repos = [];
  let page = 1;

  // Try authenticated endpoint first
  if (TOKEN) {
    console.log("📡 Trying authenticated endpoint /user/repos...");
    while (true) {
      const batch = await githubRequest(
        `/user/repos?per_page=100&page=${page}&type=owner&affiliation=owner`
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      repos.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
  }

  // Fall back to public endpoint if authenticated returned nothing
  if (repos.length === 0) {
    console.log("📡 Falling back to public endpoint /users/...");
    page = 1;
    while (true) {
      const batch = await githubRequest(
        `/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      repos.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
  }

  return repos;
}

/**
 * Fetch language bytes for a single repo
 */
async function fetchRepoLanguages(repoName) {
  return githubRequest(`/repos/${USERNAME}/${repoName}/languages`);
}

/**
 * Estimate total commits across all repos
 */
async function estimateCommits(repos) {
  let total = 0;

  for (const repo of repos) {
    try {
      const contributors = await githubRequest(
        `/repos/${USERNAME}/${repo.name}/contributors?per_page=100&anon=true`
      );

      if (Array.isArray(contributors)) {
        // Find our user in contributors
        const me = contributors.find(
          (c) => c.login && c.login.toLowerCase() === USERNAME.toLowerCase()
        );
        if (me) {
          total += me.contributions || 0;
        } else if (contributors.length === 1 && !repo.fork) {
          // If only 1 contributor and it's our repo, count them
          total += contributors[0]?.contributions || 0;
        }
      }
    } catch {
      // Skip erroring repos
    }
  }

  return total;
}

/**
 * Generate progress bar using Unicode blocks
 */
function progressBar(percentage, length = 15) {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return "🟪".repeat(filled) + "⬛".repeat(empty);
}

/**
 * Main execution
 */
async function main() {
  console.log("🚀 Fetching stats for", USERNAME);

  // 1. Fetch all repos
  const repos = await fetchAllRepos();
  const totalRepos = repos.length;
  console.log(`📦 Total repos: ${totalRepos}`);

  if (totalRepos === 0) {
    console.log("⚠️ No repos found. Skipping update.");
    return;
  }

  // Log repo names for debugging
  console.log("📋 Repos found:", repos.map((r) => r.name).join(", "));

  // 2. Aggregate languages
  const langBytes = {};
  for (const repo of repos) {
    try {
      const langs = await fetchRepoLanguages(repo.name);
      if (langs && typeof langs === "object" && !langs.message) {
        for (const [lang, bytes] of Object.entries(langs)) {
          langBytes[lang] = (langBytes[lang] || 0) + bytes;
        }
      }
    } catch {
      // Skip
    }
  }

  const totalBytes = Object.values(langBytes).reduce((a, b) => a + b, 0);
  const langPercent = Object.entries(langBytes)
    .map(([lang, bytes]) => ({
      lang,
      percent: ((bytes / totalBytes) * 100).toFixed(1),
    }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 8);

  console.log("💻 Languages:", langPercent);

  // 3. Estimate commits
  const totalCommits = await estimateCommits(repos);
  console.log(`🔥 Estimated commits: ${totalCommits}`);

  // 4. Build stats block
  const langRows = langPercent
    .map(
      ({ lang, percent }) =>
        `| ${lang} | ${progressBar(parseFloat(percent))} | ${percent}% |`
    )
    .join("\n");

  const newStats = `<!-- STATS START -->

<div align="center">
<table>
<tr>
<td align="center"><b>📦 Repositórios</b></td>
<td align="center"><b>🔥 Commits</b></td>
</tr>
<tr>
<td align="center"><code>${totalRepos}</code></td>
<td align="center"><code>${totalCommits}</code></td>
</tr>
</table>

#### 💻 Linguagens Mais Usadas

| Linguagem | Progresso | Uso |
|:---------:|:---------:|:---:|
${langRows}

</div>

<!-- STATS END -->`;

  // 5. Update README
  const readme = fs.readFileSync("README.md", "utf-8");
  const updated = readme.replace(
    /<!-- STATS START -->[\s\S]*<!-- STATS END -->/,
    newStats
  );

  fs.writeFileSync("README.md", updated);
  console.log("✅ README.md updated successfully!");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
