#!/usr/bin/env node

import process from 'node:process'

import { execSync } from 'node:child_process'

const REPO = 'dasilva333/airi'
const args = process.argv.slice(2)
const isWatch = args.includes('--watch') || args.includes('-w')
const isRelease = args.includes('--release') || args.includes('-r')
const isLogError = args.includes('--log-error') || args.includes('-e')
const tagArg = args.find(a => a.startsWith('--tag='))?.split('=')[1] || 'v0.9.36-stable.20261001'

function gh(cmd) {
  try {
    return execSync(`gh ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  }
  catch (err) {
    if (err.stdout)
      return err.stdout.trim()
    throw err
  }
}

function ghJson(cmd) {
  const output = gh(cmd)
  return output ? JSON.parse(output) : null
}

function formatDuration(startedAt, completedAt) {
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const sec = Math.floor((end - start) / 1000)
  if (sec < 60)
    return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return `${min}m${remSec}s`
}

function printReleaseAssets(tag) {
  console.log(`\n📦 Assets for Release [${tag}]:`)
  try {
    const data = ghJson(`release view ${tag} -R ${REPO} --json assets,tagName,publishedAt`)
    if (!data || !data.assets || data.assets.length === 0) {
      console.log('  No assets attached yet.')
      return
    }

    console.log(`  Published: ${data.publishedAt} | Total Assets: ${data.assets.length}\n`)
    const maxName = Math.max(...data.assets.map(a => a.name.length), 10)
    for (const a of data.assets) {
      const sizeMb = (a.size / (1024 * 1024)).toFixed(2)
      console.log(`  • ${a.name.padEnd(maxName + 2)} ${sizeMb.padStart(7)} MB  (${a.contentType || 'file'})`)
    }
  }
  catch (err) {
    console.error(`  Failed to fetch release: ${err.message}`)
  }
}

function getWorkflowSummary() {
  const runs = ghJson(`run list -R ${REPO} -L 8 --json databaseId,name,status,conclusion,headSha,createdAt,updatedAt,event`)
  if (!runs || runs.length === 0)
    return []

  const summaries = []

  for (const r of runs) {
    let activeJobInfo = ''
    if (r.status === 'in_progress' || r.status === 'queued') {
      try {
        const jobsData = ghJson(`api /repos/${REPO}/actions/runs/${r.databaseId}/jobs`)
        if (jobsData && jobsData.jobs) {
          const inProgress = jobsData.jobs.filter(j => j.status === 'in_progress')
          const queued = jobsData.jobs.filter(j => j.status === 'queued')
          const completed = jobsData.jobs.filter(j => j.status === 'completed')

          if (inProgress.length > 0) {
            const details = inProgress.map((j) => {
              const activeStep = j.steps?.find(s => s.status === 'in_progress')
              return `${j.name}${activeStep ? ` -> [${activeStep.name}]` : ''}`
            })
            activeJobInfo = details.join(' | ')
          }
          else if (queued.length > 0) {
            activeJobInfo = `${queued.length} queued`
          }
          else {
            activeJobInfo = `${completed.length}/${jobsData.jobs.length} completed`
          }
        }
      }
      catch {
        activeJobInfo = 'fetching jobs...'
      }
    }
    else if (r.conclusion === 'failure') {
      try {
        const jobsData = ghJson(`api /repos/${REPO}/actions/runs/${r.databaseId}/jobs`)
        if (jobsData && jobsData.jobs) {
          const failedJob = jobsData.jobs.find(j => j.conclusion === 'failure')
          if (failedJob) {
            const failedStep = failedJob.steps?.find(s => s.conclusion === 'failure')
            activeJobInfo = `FAILED: ${failedJob.name}${failedStep ? ` -> [${failedStep.name}]` : ''}`
          }
        }
      }
      catch {}
    }

    summaries.push({
      id: r.databaseId,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion || 'running',
      duration: formatDuration(r.createdAt, r.status === 'completed' ? r.updatedAt : null),
      sha: (r.headSha || '').slice(0, 7),
      details: activeJobInfo,
    })
  }

  return summaries
}

function printStatusTable() {
  const summaries = getWorkflowSummary()
  if (summaries.length === 0) {
    console.log('No recent workflow runs found.')
    return { activeCount: 0, hasFailure: false }
  }

  console.log(`\n🚀 GitHub Actions Status (${REPO}) at ${new Date().toLocaleTimeString()}:`)
  console.log('─'.repeat(95))
  console.log(`${'ID'.padEnd(13)} ${'Workflow'.padEnd(32)} ${'Status'.padEnd(12)} ${'Time'.padEnd(8)} ${'Details'}`)
  console.log('─'.repeat(95))

  let activeCount = 0
  let hasFailure = false

  for (const s of summaries) {
    if (s.status !== 'completed')
      activeCount++
    if (s.conclusion === 'failure')
      hasFailure = true

    let statusDisplay = s.conclusion
    if (s.status !== 'completed') {
      statusDisplay = `⟳ ${s.status}`
    }
    else if (s.conclusion === 'success') {
      statusDisplay = '✓ success'
    }
    else if (s.conclusion === 'failure') {
      statusDisplay = '✗ failure'
    }

    console.log(`${String(s.id).padEnd(13)} ${s.name.slice(0, 30).padEnd(32)} ${statusDisplay.padEnd(12)} ${s.duration.padEnd(8)} ${s.details}`)
  }

  console.log('─'.repeat(95))
  return { activeCount, hasFailure }
}

async function main() {
  if (isRelease) {
    printReleaseAssets(tagArg)
    return
  }

  if (isLogError) {
    const runId = args.find(a => /^\d+$/.test(a))
    const target = runId ? `run view ${runId} --log-failed` : 'run view --log-failed'
    console.log(gh(`${target} -R ${REPO}`))
    return
  }

  const { activeCount } = printStatusTable()

  if (isWatch && activeCount > 0) {
    console.log(`\nWatching ${activeCount} active run(s)... (press Ctrl+C to stop)`)
    while (true) {
      await new Promise(r => setTimeout(r, 20000))
      const res = printStatusTable()
      if (res.activeCount === 0) {
        console.log('\n🎉 All runs completed.')
        printReleaseAssets(tagArg)
        process.exit(res.hasFailure ? 1 : 0)
      }
    }
  }
}

main()
