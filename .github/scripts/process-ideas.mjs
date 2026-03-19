import { execSync } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.method === 'PATCH' ? 'return=representation' : 'return=minimal',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function updateIdea(id, updates) {
  return supabaseFetch(`feature_ideas?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// Determine which ideas to process
let ideas = [];
const dispatchId = process.env.IDEA_ID;
const processAll = process.env.PROCESS_ALL === 'true';

if (dispatchId) {
  const data = await supabaseFetch(`feature_ideas?id=eq.${dispatchId}`);
  if (data && data.length > 0) ideas = data;
}

if (processAll || ideas.length === 0) {
  const data = await supabaseFetch(`feature_ideas?status=eq.pending&order=created_at.asc`);
  if (data) ideas = data;
}

if (ideas.length === 0) {
  console.log('No pending ideas found. Exiting.');
  process.exit(0);
}

console.log(`\n Found ${ideas.length} idea(s) to process\n`);

const results = [];

for (const idea of ideas) {
  const shortId = `${idea.type === 'bug' ? 'B' : 'F'}${idea.seq}`;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing ${shortId}: "${idea.text}"`);
  console.log(`${'='.repeat(60)}\n`);

  await updateIdea(idea.id, { status: 'in-progress' });

  const branchName = `auto/${idea.type}-${idea.seq}-${idea.id.slice(0, 8)}`;

  try {
    execSync(`git checkout -b ${branchName}`, { stdio: 'inherit' });

    const prompt = [
      'You are working on ExpTrack, an expense tracker app (Next.js 15 + React 19 + Supabase + Tailwind).',
      '',
      `Here is a ${idea.type} request from the user:`,
      `"${idea.text}"`,
      '',
      'INSTRUCTIONS:',
      '1. TRIAGE this request:',
      '   - CLEAR and SPECIFIC enough to implement without ambiguity -> implement it',
      '   - VAGUE, needs architectural decisions, or multiple interpretations -> do NOT implement',
      '',
      '2. If implementing:',
      '   - Make minimal, focused changes',
      '   - Follow existing code patterns and styling',
      '   - Do NOT rename existing variables or refactor unrelated code',
      '',
      '3. Output FIRST line:',
      '   DECISION: IMPLEMENT | NEEDS_INPUT | SKIP',
      '',
      '4. After the decision line, explain what you did or what you need.',
    ].join('\n');

    // First, verify claude CLI works
    try {
      const ver = execSync('claude --version 2>&1', { encoding: 'utf-8' }).trim();
      console.log(`Claude CLI version: ${ver}`);
    } catch (verErr) {
      console.error('Claude CLI check failed:', verErr.stderr?.toString() || verErr.stdout?.toString() || verErr.message);
    }

    let claudeOutput;
    try {
      claudeOutput = execSync(
        `claude -p ${JSON.stringify(prompt)} --allowedTools "Edit,Write,Read,Glob,Grep" 2>&1`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 300000 }
      ).trim();
    } catch (claudeErr) {
      const output = claudeErr.stdout?.toString() || claudeErr.stderr?.toString() || '';
      console.error('Claude CLI failed. Exit code:', claudeErr.status);
      console.error('Output:', output.slice(0, 2000));
      console.error('Message:', claudeErr.message.slice(0, 500));
      throw new Error(`Claude CLI failed (exit ${claudeErr.status}): ${output.slice(0, 300) || claudeErr.message.slice(0, 300)}`);
    }

    console.log('\n--- Claude Output ---');
    console.log(claudeOutput.slice(0, 2000));
    console.log('--- End Output ---\n');

    const decisionMatch = claudeOutput.match(/DECISION:\s*(IMPLEMENT|NEEDS_INPUT|SKIP)/i);
    const decision = decisionMatch ? decisionMatch[1].toUpperCase() : 'NEEDS_INPUT';

    const explanationStart = claudeOutput.indexOf('\n', claudeOutput.indexOf('DECISION:'));
    const explanation = explanationStart > 0
      ? claudeOutput.slice(explanationStart).trim().slice(0, 500)
      : 'No details provided.';

    if (decision === 'IMPLEMENT') {
      const diffOutput = execSync('git diff --name-only', { encoding: 'utf-8' }).trim();
      const untrackedFiles = execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8' }).trim();
      const hasChanges = diffOutput.length > 0 || untrackedFiles.length > 0;

      if (hasChanges) {
        execSync('git add -A', { stdio: 'inherit' });
        const commitMsg = `${shortId}: ${idea.text.slice(0, 72)}`;
        execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { stdio: 'inherit' });
        execSync(`git push origin ${branchName}`, { stdio: 'inherit' });

        const prTitle = `${shortId}: ${idea.text.slice(0, 72)}`;
        const prBody = `## ${shortId}: ${idea.text}\n\n**Type:** ${idea.type}\n**Auto-implemented by Claude**\n\n### What changed\n${explanation}`;

        const prUrl = execSync(
          `gh pr create --title ${JSON.stringify(prTitle)} --body ${JSON.stringify(prBody)} --base main --head ${branchName}`,
          { encoding: 'utf-8' }
        ).trim();

        await updateIdea(idea.id, {
          status: 'implemented',
          resolution_note: explanation.slice(0, 500),
          pr_url: prUrl,
          branch_name: branchName,
        });

        results.push({ id: shortId, status: 'implemented', pr: prUrl });
        console.log(`${shortId} implemented -> ${prUrl}`);
      } else {
        await updateIdea(idea.id, {
          status: 'needs-input',
          resolution_note: 'Claude attempted but produced no file changes.',
        });
        results.push({ id: shortId, status: 'needs-input' });
      }
    } else if (decision === 'SKIP') {
      await updateIdea(idea.id, {
        status: 'skipped',
        resolution_note: explanation.slice(0, 500),
      });
      results.push({ id: shortId, status: 'skipped' });
    } else {
      await updateIdea(idea.id, {
        status: 'needs-input',
        resolution_note: explanation.slice(0, 500),
      });
      results.push({ id: shortId, status: 'needs-input' });
    }
  } catch (err) {
    const errDetail = err.stderr?.toString() || err.stdout?.toString() || err.message;
    console.error(`Error processing ${shortId}:`, errDetail);
    await updateIdea(idea.id, {
      status: 'error',
      resolution_note: `Automation error: ${errDetail.slice(0, 300)}`,
    });
    results.push({ id: shortId, status: 'error' });
  }

  execSync('git checkout main', { stdio: 'inherit' });
  execSync('git clean -fd', { stdio: 'inherit' });
}

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log('SUMMARY');
console.log(`${'='.repeat(60)}`);
for (const r of results) {
  const icon = r.status === 'implemented' ? 'OK' : r.status === 'skipped' ? 'SKIP' : r.status === 'error' ? 'ERR' : 'INPUT';
  console.log(`  [${icon}] ${r.id}: ${r.status}${r.pr ? ` -> ${r.pr}` : ''}`);
}
