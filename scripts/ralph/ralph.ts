#!/usr/bin/env bun
import { $ } from "bun";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

// Configuration
const MAX_ITERATIONS = parseInt(process.argv[2] || "10", 10);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PRD_FILE = join(SCRIPT_DIR, "prd.json");
const PROGRESS_FILE = join(SCRIPT_DIR, "progress.txt");
const ARCHIVE_DIR = join(SCRIPT_DIR, "archive");
const LAST_BRANCH_FILE = join(SCRIPT_DIR, ".last-branch");
const PROMPT_FILE = join(SCRIPT_DIR, "prompt.md");

// Helper to safely read JSON
async function readJson(path: string) {
  try {
    return await Bun.file(path).json();
  } catch {
    return null;
  }
}

// Archive previous run if branch changed
if (existsSync(PRD_FILE) && existsSync(LAST_BRANCH_FILE)) {
  const prd = await readJson(PRD_FILE);
  const currentBranch = prd?.branchName || "";
  const lastBranch = (await Bun.file(LAST_BRANCH_FILE).text()).trim();

  if (currentBranch && lastBranch && currentBranch !== lastBranch) {
    const date = new Date().toISOString().split('T')[0];
    const folderName = lastBranch.replace(/^ralph\//, "");
    const archiveFolder = join(ARCHIVE_DIR, `${date}-${folderName}`);

    console.log(`Archiving previous run: ${lastBranch}`);
    await $`mkdir -p ${archiveFolder}`;
    if (existsSync(PRD_FILE)) await $`cp ${PRD_FILE} ${archiveFolder}/`;
    if (existsSync(PROGRESS_FILE)) await $`cp ${PROGRESS_FILE} ${archiveFolder}/`;
    console.log(`   Archived to: ${archiveFolder}`);

    // Reset progress file for new run
    await Bun.write(PROGRESS_FILE, `# Ralph Progress Log\nStarted: ${new Date().toString()}\n---\n`);
  }
}

// Track current branch
if (existsSync(PRD_FILE)) {
  const prd = await readJson(PRD_FILE);
  if (prd?.branchName) {
    await Bun.write(LAST_BRANCH_FILE, prd.branchName);
  }
}

// Initialize progress file if it doesn't exist
if (!existsSync(PROGRESS_FILE)) {
  await Bun.write(PROGRESS_FILE, `# Ralph Progress Log\nStarted: ${new Date().toString()}\n---\n`);
}

console.log(`Starting Ralph - Max iterations: ${MAX_ITERATIONS}`);

for (let i = 1; i <= MAX_ITERATIONS; i++) {
  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Ralph Iteration ${i} of ${MAX_ITERATIONS}`);
  console.log("═══════════════════════════════════════════════════════");
  
  // Run amp with the ralph prompt
  // using tee to show output in realtime while capturing it
  const output = await $`cat ${PROMPT_FILE} | amp --dangerously-allow-all 2>&1 | tee /dev/stderr`.nothrow().text();
  
  // Check for completion signal
  if (output.includes("<promise>COMPLETE</promise>")) {
    // Verify completion against PRD
    if (existsSync(PRD_FILE)) {
      const prd = await readJson(PRD_FILE);
      // userStories might be undefined if file is empty/invalid
      const stories = Array.isArray(prd?.userStories) ? prd.userStories : [];
      const remainingTasks = stories.filter((s: any) => s.passes === false).length;
      
      if (remainingTasks === 0) {
        console.log("");
        console.log("✅ Ralph completed all tasks! (Verified with prd.json)");
        console.log(`Completed at iteration ${i} of ${MAX_ITERATIONS}`);
        process.exit(0);
      } else {
        console.log("");
        console.log(`⚠️  Agent signaled completion, but ${remainingTasks} tasks remain in prd.json.`);
        console.log("   Ignoring false completion signal and continuing...");
      }
    } else {
      console.log("⚠️  prd.json not found to verify completion. Exiting based on agent signal.");
      process.exit(0);
    }
  }
  
  console.log(`Iteration ${i} complete. Continuing...`);
  await $`sleep 2`;
}

console.log("");
console.log(`Ralph reached max iterations (${MAX_ITERATIONS}) without completing all tasks.`);
console.log(`Check ${PROGRESS_FILE} for status.`);
process.exit(1);
