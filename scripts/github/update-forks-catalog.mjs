import https from 'node:https'
import process from 'node:process'

const UPSTREAM = 'moeru-ai/airi'

function fetchJSON(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: urlPath,
      method: 'GET',
      headers: {
        'User-Agent': 'Airi-Fork-Tracker-Script',
      },
    }

    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${urlPath}: ${res.statusCode} ${data}`))
          return
        }
        try {
          resolve(JSON.parse(data))
        }
        catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

async function getUpstreamCommits() {
  try {
    const commits = await fetchJSON(`/repos/${UPSTREAM}/commits?per_page=10`)
    return new Set(commits.map(c => c.sha))
  }
  catch (err) {
    console.error('Error fetching upstream commits:', err.message)
    return new Set()
  }
}

async function run() {
  console.info('Fetching upstream commits to check divergence baseline...')
  const upstreamSHAs = await getUpstreamCommits()

  console.info('Fetching recently created forks (limit 50)...')
  let forks = []
  try {
    forks = await fetchJSON(`/repos/${UPSTREAM}/forks?sort=newest&per_page=50`)
    // Sort in memory by pushed_at descending
    forks.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    // Take top 30 recently pushed
    forks = forks.slice(0, 30)
  }
  catch (err) {
    console.error('Error fetching forks:', err.message)
    process.exit(1)
  }

  console.info(`Found ${forks.length} forks. Analyzing divergence...`)
  const activeForks = []

  for (const fork of forks) {
    const fullName = fork.full_name
    const owner = fork.owner.login

    if (owner === 'moeru-ai' || owner === 'features')
      continue

    try {
      // Fetch latest 3 commits of this fork
      const commits = await fetchJSON(`/repos/${fullName}/commits?per_page=3`)

      // Determine if it has custom commits (at least one commit SHA not present in upstream)
      const customCommits = commits.filter(c => !upstreamSHAs.has(c.sha))

      if (customCommits.length > 0) {
        activeForks.push({
          owner,
          name: fullName,
          pushedAt: fork.pushed_at,
          stars: fork.stargazers_count,
          openIssues: fork.open_issues_count,
          customCommits: customCommits.map(c => ({
            sha: c.sha.substring(0, 7),
            date: c.commit.author.date,
            message: c.commit.message.split('\n')[0],
          })),
        })
      }

      // Sleep slightly to respect GitHub API rate limits
      await new Promise(r => setTimeout(r, 500))
    }
    catch {
      // Some forks might have empty default branch or API errors
    }
  }

  console.info('\n======================================')
  console.info('      ACTIVE / DIVERGED FORKS         ')
  console.info('======================================')
  if (activeForks.length === 0) {
    console.info('No forks with custom commits found in the recently pushed list.')
  }
  else {
    activeForks.forEach((f) => {
      console.info(`\nFork: ${f.name} (⭐ ${f.stars} | Issues: ${f.openIssues})`)
      console.info(`Pushed: ${f.pushedAt}`)
      console.info('Recent Custom Commits:')
      f.customCommits.forEach((c) => {
        console.info(`  - [${c.date.substring(0, 10)}] ${c.sha}: ${c.message}`)
      })
    })
  }
}

run()
