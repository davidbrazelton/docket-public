// Docket, the Claude session portal: a page on this computer that starts, resumes and tracks
// Claude Code sessions for several clients (each client = one Claude Code home folder).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash, createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { spawn, execFile } from 'node:child_process';
import { chromium } from 'playwright';
import { createScheduler } from './scheduler.mjs';
import { familyBelow } from './drag-move.mjs';
import { workingNow, newPause, holdsMessage, noteMessaged, wokeByItself, noteWoke, resumePlan, resumeNote, autoPaused, clockJumped, holdsRunner, RUNNER_RESTART_NOTE } from './pause.mjs';
import { newCutOff, autoContinueCheck, cutOffNote, GAP_MS } from './cut-off.mjs';
import { netError, refused, netText, withRetries, noConversation, startMode, continueNudge, firstMessage, reportText, firstStore } from './first-start.mjs';
import { savedWaiting, unreadAfterRestart, desktopTurn, desktopWaiting, keptReason, markUnreadReason } from './needs-you.mjs';
import { turnKey, keepQuiet, markQuiet } from './quiet-turns.mjs';
import { notQuiet, restartWaiter } from './runner-idle.mjs';
import { taskChanges, mergeTask, newScan, repairChanges, markedDone, stalledSteps, endedDuring, runningJobs, jobText } from './tasks.mjs';
import { waitingOnUser, closeRefusal, endsWaiting, endsAsking, awaitingAnswer, reportRoute, turnStarter, wakeDecision, readyReports, heldNote, freedReply, childState, quietRefusal, kidStartRefusal, heldTurnReport, doneWithJobsReply, leftoverJobsText, turnNewsFor, reportIsNews, agreedAsNote, heldNewsText, debounceLeft, REPORT_DEBOUNCE, lowGearNote } from './reports.mjs';
import { KEEP_WARM, PING_TEXT, keepWarmDue, realReplyFrom, isPing } from './keep-warm.mjs';
import { WAITS, CONDITIONS, parseWait, waitWhat, prVerdict, sessionVerdict, portVerdict, portAnswers, timeoutLine, nextLook, waitInline, kindOf, checksOf, stateLine, branchPr } from './waits.mjs';
import { openParent, openFamily, closedNote } from './family.mjs';
import { titleFromBrief, handoffFromTurn, handoffPlace, handoffChildren, handoffPlans, cleanHandoffPattern, weaveCards } from './handoff.mjs';
import { startGroup } from './start-group.mjs';
import { childSettings } from './child-settings.mjs';
import { transcriptTimes, asyncHookEvents, covered, turnSplit } from './chat-times.mjs';
import { createSampler, turnLine, appendLine } from './turn-times.mjs';
import { KEEP_DAYS as ACTIVITY_KEEP_DAYS, stateOf, createTally, slotKey, slotStart, dayOf as localDay, turnSpans, createRebuild, mergeRebuilt, runOnce, rollUp, today as activityToday } from './activity.mjs';
import { DOCKET_BLOCK, SESSION_BLOCK, messageFrom, lastTyped, mergeTouches } from './touches.mjs';
import { GEARS, gearsOf, findGear, topGearOf, startGearOf, cleanStartGear, sessionSettings, firstGear, parentGear, raiseGear, parentHeldGear, belowTop } from './gears.mjs';
import { shiftUpFor, coordinatorHold } from './shift-up.mjs';
import { sessionCost, sessionRows, sessionSignature, writeCsv, fillRow, loadPrices, modelName, modelRates, addSeconds, emptyRow, rowLines, priceReply, usageLeft, SHORT_TURNS } from './costs.mjs';
import { topGearCost, sessionShiftFacts, shiftEntry, withShift } from './shift-savings.mjs';
import { defaultCodexHome, codexSessions, codexRows } from './codex-usage.mjs';
import { connectionOf, parseAwsConfig, kindOfKey } from './connection.mjs';
import { sessionTimeline, sessionSkills, buildProfile, parseMcpList, TIMELINE_CATS } from './profile.mjs';
import { hooksFor, hooksOffFor, cleanDocketHooks } from './docket-hooks.mjs';
import { configFiles, readPrint, configChanges, reloadDecision, rulesNote, reloadNote } from './config-watch.mjs';
import { LAYERS, cleanSettingSources, writePluginOn, GROK_COMPAT, writeGrokCompat } from './switches.mjs';
import { sourceFrom, cloneCommands, noPrompts, plainError, readMarket, isClone, hostOf, CLONES } from './plugin-sources.mjs';
import { makeGrokHome, writeGrokHooks, signedInFrom, grokAccount, deviceLink, isInside, HOOK_FILE as GROK_HOOK_FILE } from './grok-home.mjs';
import { homeRootsFor } from './home-roots.mjs';
import { homeInUse, freeHome } from './home-in-use.mjs';
import { workFolders, existingHomes } from './work-folders.mjs';
import { sourceHomes, findGroups, planRun, writeReport, readReports, reportPaths, copyRun, checkCopies, undoRun } from './bring-in.mjs';
import { moveDesk } from './move-desk.mjs';
import { openCommand, folderOpenCommand, toolFolders, pathRe, isFullPath, exampleFolder, macTerminalScript, macTerminalOpen, terminalShells, exeNames, psTerminalScript, cmdTerminalScript, windowsTerminalCommand, presentFileText, processListCommand, parseProcessList, powerWatchCommand, powerEvent, vsCodePaths, vswhereCommand, solutionIn, editorCommand, trashCommand, parseTrashOutput, trash, treeListCommand, parseTreeList, descendants, leftBehind, killCommand, commandLineCommand, relaunchesApp,
  startupReadCommand, parseStartupRead, startupFiles, startupState, startupNeeds, startupScriptCommand, isTestCopy, folderPickCommand, parseFolderPick, folderPickStart, findLite } from './platform.mjs';
import { cleanGateway, gatewayFor, loginOf, claudeRouteOf, claudeGateway, visibleGears, usableGear, modelFor, gearModelMap, liteArgs, liteCommand, loginLink, loginDone, pkceUnsupported, whoamiUser, tokenFrom, gatewayRefused, gatewayHost } from './gateway.mjs';
import { groupProcesses, folderSize, cpuPercent, diskKeeper, breakdown, sharedServers } from './machine-use.mjs';
import { grokSessionDirs, grokSignature, grokRows, grokTitle } from './grok-usage.mjs';
import { findCodexExe, codexCommand, makeCodexHome, codexSignedIn, codexAccount, codexDeviceLink } from './codex-home.mjs';
import { start as startCodex } from './engines/codex.mjs';
import { createPlanStore, readyTasks, whyNoneReady, userSteps, userTag, STATES, PLAN_RULES_VERSION, reviewDue, planOpen } from './plans.mjs';
import { REVIEW_EVERY_MS, reviewSent, nextReview, reviewText } from './plan-review.mjs';
import { plansOnFor, planUse, PLAN_HINT, planOfferDue, USE_PLAN_TEXT } from './plan-use.mjs';
import { planStartNote } from './plan-use.mjs';
import { createFolderReader, readMarkers, markerPlan, cleanPlanFolder, planFolderProblem } from './plan-folder.mjs';
import { scanPlanSystem, switchWarning, conversionBrief, systemName } from './plan-switch.mjs';
import { createIndex } from './search.mjs';
import { fileReplies, tally, offerKind, CACHE_OFFER } from './cache-offer.mjs';
import { START_OFFER, startTally, startOfferKind, startOfferWords } from './start-offer.mjs';
import { SETUP_OFFER, scanFile, measureUse, measureFiles, assess, quickStart, costPerToken, checkDue, setupOfferKind, headlines, setupBrief, itemTable, kTokens, dollars } from './setup-size.mjs';
import { docketFacts, buildReport, cleanDestination, destinationInfo, sendReport, installId, today, sentToday, limitReached, countSend, limitMessage, DAILY_LIMIT } from './feedback.mjs';
import { cleanMode, pullsByItself, updatePrompt, changeReason, typingNow, TYPING_RETRY_MS, TYPING_HOLD } from './update-mode.mjs';
import { readEntries, searchEntries, lastUserMessages, readEntry, saveDue, saveShare, cleanSaveShare, SAVE_PROMPT, RECALL_NOTE, COMPACT_AT_BREAK, BREAK_COMPACT, breakCompactDue } from './recall.mjs';
import { newLinkScan, scanLinkText, ticketKeys, isTicketKey, adoBase, parseAdoPrUrl, adoPRsForBranch, adoPRById, adoWorkItemIds, adoItemKey, isAdoItemKey, adoItemKeyFrom, adoPRWorkItemIds, adoWorkItems, jiraTickets, jiraMe, ticketUnread, jiraFromClaudeJson, linkTtl, githubRepo, ghStatus, ghBranchQuery, ghBranchAnswer,
  parseIssueUrl, branchIssue, githubTicket, CLOSES, CHECKS, closesOf, ghUnreadable, ghAccounts, ghAccountOrder, ghPick, ghNote, sessionBranches, sessionMadePr,
  prTalk, adoThreadLasts, GH_TALK_PR, GH_TALK_ISSUE, ghPrTalkOf, ghIssueLast, adoItemNewestComment, adoPrThreads, adoMe, ticketFinished } from './links.mjs';
import { currentBranch } from './git-head.mjs';
import { restDue, restMinutes } from './rest.mjs';
import { ARTIFACT_URL, artifactPublished } from './artifacts.mjs';
import { copyPlan, runCopy, copyGroups, groupAction, copyEntry, needsSignIn, targetProblem, COPY_ITEMS, defaultChoices } from './copy-company.mjs';
import { cleanEnv, isReserved, envScripts } from './company-env.mjs';
import { canPair, isApproved, approve, crossingLog, insideCompany, answerInstructions, addToInbox, settleInbox, openInbox } from './crossings.mjs';
import { signInFailure, recheckSignIns, awsSignedIn, keepKnown } from './signin-errors.mjs';
import { newSigninFail, messagedSince, signinResumeCheck, dropsMark, signinNote, SIGNIN_NOTE } from './signin-resume.mjs';
import WebSocket, { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { REMOTE_HOURS, ASK_WAIT_MS, newSecret, checkCode, stepOf, otpUri, makeCertificate, fingerprintOf, checkCodeOf, sameCheck, isOfficeAddress, officeAddresses,
  remoteRoute, remoteMessage, relayFor, remoteDeskRow, renameClient, peerCertificate, pinnedTls, pinnedRequest, connectError } from './remote.mjs';
import { z } from 'zod';
import { deskCheck, deskCheckText } from './desk-check.mjs';
import { createSharedMcp, freePort } from './shared-mcp.mjs';
import { KEEP_DAYS, OUTPUT_FOLDER } from './output-limits.mjs';
import { deskServerArgs, mcpUrl, savedFiles } from './desk-browser.mjs';
import { outputUseRows, addRows, readLog, outputFolders, OUTPUT_LOG } from './big-output-use.mjs';
import {
  query, listSessions, getSessionMessages, renameSession, tool, createSdkMcpServer,
} from '@anthropic-ai/claude-agent-sdk';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// The Docket plugin: the hooks Docket adds to every Claude session it starts (docket-hooks.mjs).
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const PORT = Number(process.env.PORTAL_PORT || 4400);
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
// The company list is per machine: clients.local.json (never uploaded). Nothing is shipped as a starting list.
const CLIENTS_FILE = process.env.PORTAL_CLIENTS || path.join(ROOT, 'clients.local.json');
// A first start writes an empty list, so the page walks the person through adding a company.
if (!process.env.PORTAL_CLIENTS && !fs.existsSync(CLIENTS_FILE)) {
  try { fs.writeFileSync(CLIENTS_FILE, '[]', { flag: 'wx' }); } catch {}
}
// No list, or one that can't be read, starts empty: the page then walks the person through adding a company.
const CLIENTS = (() => {
  try { const l = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8')); return Array.isArray(l) ? l.map(upgradeCompany) : []; }
  catch { return []; }
})();
// A company used to have one brand: "engine": "grok" meant all its sessions ran on Grok. That company now has
// Grok set up (its grokHome, kept as it was) and Grok as the default for new sessions. The file is rewritten in
// the new shape the next time the company list is saved.
function upgradeCompany(c) {
  if (!c || typeof c !== 'object' || c.engine === undefined) return c;
  const { engine, ...rest } = c;
  return engine === 'grok' && rest.defaultEngine === undefined ? { ...rest, defaultEngine: 'grok' } : rest;
}

// ---------- a record of starts, stops and crashes (portal-events.log) ----------
const EVENTS_LOG = path.join(ROOT, 'portal-events.log');
function logEvent(what, detail = '') {
  const indented = detail ? '\n  ' + String(detail).replace(/\n/g, '\n  ') : '';
  const line = `${new Date().toISOString()}  port ${PORT}  ${what}${indented}\n`;
  try { fs.appendFileSync(EVENTS_LOG, line); } catch {}
  console.log(line.trim());
}
// An error nothing else caught: record it, then stop.
process.on('uncaughtException', (err) => { logEvent('CRASHED', err?.stack || err); process.exit(1); });
// A failed promise nothing waited on: record it and keep running.
process.on('unhandledRejection', (err) => logEvent('error (kept running)', err?.stack || err));
// Closing the portal window or pressing Ctrl+C.
for (const sig of ['SIGHUP', 'SIGINT', 'SIGBREAK']) process.on(sig, () => { logEvent('stopped (' + (sig === 'SIGINT' ? 'Ctrl+C' : 'window closed') + ')'); process.exit(0); });
const STATE_FILE = process.env.PORTAL_STATE || path.join(ROOT, 'portal-state.json');
const UPLOADS = path.join(ROOT, 'uploads');
const MAX_EVENTS = 4000;
const TASK_TOOLS = new Set(['Bash', 'PowerShell', 'Agent', 'Task', 'Workflow', 'Monitor']);

// ---------- saved portal state (parent links, clients, folders of sessions started here) ----------
let state = { sessions: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, 200);
}
function writeState() { saveTimer = null; fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
// A restart exits 200 ms after deciding to: a change saved just before it must not be lost.
process.on('exit', () => { if (saveTimer) { clearTimeout(saveTimer); try { writeState(); } catch {} } });

const clientById = (id) => CLIENTS.find((c) => c.id === id);

// Sessions that were mid-run when the portal last stopped. They show as
// "interrupted" until the next message picks them up again.
const interrupted = new Set(Object.entries(state.sessions).filter(([, v]) => v.running).map(([k]) => k));
function markRunning(id, running) {
  if (!state.sessions[id] || state.sessions[id].running === running) return;
  state.sessions[id].running = running;
  saveState();
}

// A clean environment for one client: drop any Claude/Anthropic variables this
// process inherited (for example from a desktop-app session) so the child signs
// in with that client's own home folder.
// A client on the standard home (~/.claude) runs without CLAUDE_CONFIG_DIR: setting it, even to that
// same folder, makes Claude Code read <home>/.claude.json instead of ~/.claude.json, which loses the
// MCP servers and folder trust the terminal and editor use.
// A client with an AWS profile runs on Amazon Bedrock with that profile instead of a Claude sign-in.
const DEFAULT_HOME = path.join(os.homedir(), '.claude');
const isDefaultHome = (client) => path.resolve(client.home).toLowerCase() === DEFAULT_HOME.toLowerCase();
const isBedrock = (client) => !!client.awsProfile;
// A company whose Claude goes through a LiteLLM gateway has no AWS profile (cleanCompany refuses both).
const liteOf = (gw) => gw.lite || findLite({ home: os.homedir(), exists: (f) => fs.existsSync(f) });
// engine: the brand of the program it starts (a session's own brand; Claude for Docket's own helper runs).
// sessionId: the session it is for, tagged on each gateway request so the gateway's spend can be split by session.
function envFor(client, engine = 'claude', sessionId) {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !/^(CLAUDE|ANTHROPIC|USE_LOCAL_OAUTH|USE_STAGING_OAUTH|CODEX_)/.test(k)));
  // The company's own variables, before Docket's own: cleanEnv refuses the names Docket sets.
  for (const [k, v] of Object.entries(client.env || {})) if (!isReserved(k)) env[k] = String(v);
  if (!isDefaultHome(client)) env.CLAUDE_CONFIG_DIR = client.home;
  if (isBedrock(client)) {
    env.CLAUDE_CODE_USE_BEDROCK = '1';
    env.AWS_PROFILE = client.awsProfile;
    if (client.awsRegion) env.AWS_REGION = client.awsRegion;
  }
  if (client.grokHome) env.GROK_HOME = client.grokHome; else delete env.GROK_HOME;
  // Codex's home. The CODEX_ variables this process may have inherited (from a Codex session) are dropped above.
  if (client.codexHome) env.CODEX_HOME = client.codexHome;
  const gw = engine === 'claude' && gatewayFor(client, 'claude');
  if (gw) {
    const g = claudeGateway(gw, { route: claudeRouteOf(gw, policyProvider()), lite: liteOf(gw), companyId: client.id, sessionId, key: process.env.LITELLM_PROXY_API_KEY });
    for (const k of g.unset) delete env[k];
    Object.assign(env, g.env);
  }
  // Which program the session runs on; Docket's hook scripts read it, and do nothing when it is missing.
  env.DOCKET_ENGINE = engine;
  // The prompt cache length picked for this company, over whatever its own settings say; Claude only.
  if (engine === 'claude' && client.promptCacheTtl) env.CLAUDE_CODE_PROMPT_CACHE_TTL = client.promptCacheTtl;
  const gh = path.join(client.home, 'gh-config');
  if (fs.existsSync(gh)) env.GH_CONFIG_DIR = gh;
  // The Docket hooks this company turned off, or whose own copy its home already runs; each such hook exits quietly.
  const off = hooksOffFor(client, PLUGIN_DIR);
  if (off) env.DOCKET_HOOKS_OFF = off; else delete env.DOCKET_HOOKS_OFF;
  return env;
}
// The options a Claude run through a gateway adds to its env: its own settings layer, with the key helper (the SDK's
// settings option, kept for that run only, so the company's own settings.json never holds it). {} for any other.
function claudeSettings(client) {
  const gw = gatewayFor(client, 'claude');
  if (!gw) return {};
  const { settings } = claudeGateway(gw, { route: claudeRouteOf(gw, policyProvider()), lite: liteOf(gw), companyId: client.id });
  return Object.keys(settings).length ? { settings } : {};
}

// ---------- sign-in, run through the claude program so nobody needs a terminal ----------
const CLAUDE_EXE = process.env.PORTAL_CLAUDE_EXE || 'claude';
// Sign-ins are per company per brand: Claude's under the company id, another brand's under "<id>:<brand>".
// A brand that goes through a LiteLLM gateway signs in to that gateway instead, under "gateway:<url>": lite keeps
// one sign-in per OS user, so every company on that gateway shares it.
const authKey = (clientId, engine = 'claude') => {
  const gw = gatewayFor(clientById(clientId), engine);
  return gw ? `gateway:${gw.url}` : engine === 'claude' ? clientId : `${clientId}:${engine}`;
};
// The companies that go through a gateway, by its URL, and the broadcast that tells each one's page its sign-in changed.
const onGateway = (url) => CLIENTS.flatMap((c) => brandsOf(c).filter((e) => gatewayFor(c, e)?.url === url).map((e) => ({ client: c, engine: e })));
const broadcastGateway = (url, signedIn) => { for (const { client, engine } of onGateway(url)) broadcast({ t: 'auth', client: client.id, engine, signedIn }); };
const authCache = new Map(); // authKey -> { at, loggedIn }
const logins = new Map();    // authKey -> { proc, url, out }

// exe: another program to run the same way (git, for plugin sources); prompts: false turns git's sign-in prompts off.
function runClaude(client, args, { input, timeout = 20000, cwd, exe = CLAUDE_EXE, prompts = true } = {}) {
  return new Promise((resolve) => {
    const env = { ...envFor(client), BROWSER: 'none' };
    const proc = spawn(exe, args, { env: prompts ? env : noPrompts(env), windowsHide: true, ...(cwd && fs.existsSync(cwd) ? { cwd } : {}) });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => proc.kill(), timeout);
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message }); });
    if (input !== undefined) proc.stdin.end(input);
  });
}

// A computer's managed policy can set CLAUDE_CODE_USE_BEDROCK (or Vertex, Foundry) for every Claude run. envFor
// can't take that away, since claude reads the policy itself, so a Claude sign-in can't work on such a computer.
const MANAGED_SETTINGS = process.platform === 'win32'
  ? ['C:\\Program Files\\ClaudeCode', 'C:\\ProgramData\\ClaudeCode']
  : process.platform === 'darwin' ? ['/Library/Application Support/ClaudeCode'] : ['/etc/claude-code'];
const PROVIDER_VARS = { CLAUDE_CODE_USE_BEDROCK: 'Amazon Bedrock', CLAUDE_CODE_USE_VERTEX: 'Google Vertex AI', CLAUDE_CODE_USE_FOUNDRY: 'Microsoft Foundry' };
const PROVIDER_NAMES = { bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry' };
function policyProvider() {
  for (const dir of MANAGED_SETTINGS) {
    const files = [path.join(dir, 'managed-settings.json')];
    try { files.push(...fs.readdirSync(path.join(dir, 'managed-settings.d')).filter((n) => n.endsWith('.json')).map((n) => path.join(dir, 'managed-settings.d', n))); } catch {}
    for (const file of files) {
      let env; try { env = JSON.parse(fs.readFileSync(file, 'utf8')).env; } catch { continue; }
      for (const [k, name] of Object.entries(PROVIDER_VARS)) if (env && /^(1|true|yes)$/i.test(String(env[k] ?? ''))) return name;
    }
  }
  return null;
}
// The settings files a session's hooks come from, parsed: the computer's managed policy, the desk's and the folder's
// settings (the layers the desk loads), and Docket's own plugin. Read when a session starts, for the events whose hooks
// are all async, which the chat's step times leave out (#743).
function hookSettings(client, cwd) {
  const files = MANAGED_SETTINGS.flatMap((dir) => {
    const out = [path.join(dir, 'managed-settings.json')];
    try { out.push(...fs.readdirSync(path.join(dir, 'managed-settings.d')).filter((n) => n.endsWith('.json')).map((n) => path.join(dir, 'managed-settings.d', n))); } catch {}
    return out;
  });
  files.push(...configFiles({ home: client?.home, cwd, sources: client?.settingSources }).filter((f) => f.kind === 'settings').map((f) => f.file));
  files.push(path.join(PLUGIN_DIR, 'hooks', 'hooks.json'));
  return files.map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }).filter(Boolean);
}
const forcedText = (provider) => `This computer's policy makes every Claude run use ${provider}, so a Claude sign-in will not work here.${provider === 'Amazon Bedrock' ? ' Use an AWS profile instead.' : ''}`;

// { loggedIn, forced, email, plan }. email: who it is signed in as, plan: the brand's plan, where it says. forced: the provider this computer's policy makes a Claude company use instead of
// its Claude sign-in (claude auth status then says signed in, by "third_party"), so its sessions can't run here.
async function authInfo(client, force, engine = 'claude') {
  const key = authKey(client.id, engine);
  const hit = authCache.get(key);
  if (hit && !force && Date.now() - hit.at < 60000) return hit;
  let loggedIn = false, forced = null, email = null, plan = null, extra = {};
  const gw = gatewayFor(client, engine);
  if (gw) ({ loggedIn, email, ...extra } = await gatewayStatus(gw));
  else if (engine === 'grok') {
    // Grok signs in in the company's own Grok home: `grok models` says whether it is (it never opens a browser).
    loggedIn = signedInFrom((await runCommand(...grokCommand(['models']), { ...envFor(client, 'grok'), BROWSER: 'none' })).out);
    if (loggedIn) email = grokAccount(client.grokHome || path.join(os.homedir(), '.grok'));
  } else if (engine === 'codex') {
    // Codex signs in in the company's own Codex home: `codex login status` says whether it is.
    const [cmd, args] = codexCommand(findCodexExe(), ['login', 'status']);
    const r = await runCommand(cmd, args, envFor(client, 'codex'));
    loggedIn = codexSignedIn(r.code, r.out);
    if (loggedIn) ({ email, plan } = codexAccount(codexHomeOf(client)));
  } else if (isBedrock(client)) {
    // claude auth status says Bedrock is signed in whatever the AWS credentials are, so ask AWS. AWS or the network
    // can be slow: a check that runs out of time or can't reach AWS keeps the last answer rather than signing the desk out.
    loggedIn = keepKnown(awsSignedIn(await runCommand('aws', ['sts', 'get-caller-identity', '--output', 'json'], envFor(client), 45000)), hit?.loggedIn);
  } else {
    const { out } = await runClaude(client, ['auth', 'status', '--json']);
    try {
      const j = JSON.parse(out.slice(out.indexOf('{')));
      const provider = PROVIDER_NAMES[String(j.apiProvider || '').toLowerCase()];
      if (j.authMethod === 'third_party' || provider) forced = provider || policyProvider() || 'another provider';
      else { loggedIn = !!j.loggedIn; email = j.email || null; plan = j.subscriptionType ? `${j.subscriptionType[0].toUpperCase()}${j.subscriptionType.slice(1)}` : null; }
    } catch {}
  }
  const info = { at: Date.now(), loggedIn, forced, email, plan, ...extra };
  authCache.set(key, info);
  if (loggedIn) signedInAgain(client, engine, 'seen'); // sessions that failed on it carry on (also after a restart, when nothing changed)
  return info;
}
// Runs lite for a gateway: { code, out, err }, with stdout and stderr apart (print-token prints only the key on stdout).
function runLite(gw, args, timeout = 30000) {
  const [cmd, a] = liteCommand(liteOf(gw), liteArgs(gw.url, ...args));
  return new Promise((resolve) => {
    const proc = spawn(cmd, a, { env: { ...process.env, BROWSER: 'none' }, windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => proc.kill(), timeout);
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: '', err: `Could not run lite (${cmd}): ${e.message}` }); });
  });
}
// Whether this computer's lite sign-in works on a gateway: lite gives a key (or, for login "key", LITELLM_PROXY_API_KEY
// holds one) and the gateway answers GET /v1/models with it. { loggedIn, email, models, detail }.
async function gatewayStatus(gw) {
  let token = '', detail = '';
  if (loginOf(gw) === 'key') { token = process.env.LITELLM_PROXY_API_KEY || ''; if (!token) detail = 'LITELLM_PROXY_API_KEY is not set for Docket'; }
  else { const r = await runLite(gw, ['auth', 'print-token']); token = tokenFrom(r.code, r.out); if (!token) detail = (r.err || r.out).trim().split('\n').pop() || 'not signed in to the gateway'; }
  if (!token) return { loggedIn: false, email: null, detail };
  let models = [];
  try {
    const res = await fetch(`${gw.url}/v1/models`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { loggedIn: false, email: null, detail: `the gateway answered ${res.status}` };
    models = ((await res.json().catch(() => ({}))).data || []).map((m) => m.id).filter(Boolean).slice(0, 200);
  } catch (e) { return { loggedIn: false, email: null, detail: `could not reach the gateway: ${e.cause?.code || e.message}` }; }
  const who = loginOf(gw) === 'key' ? null : whoamiUser((await runLite(gw, ['whoami'], 15000)).out);
  return { loggedIn: true, email: who, models };
}
const authStatus = async (client, force, engine = 'claude') => (await authInfo(client, force, engine)).loggedIn;
// How a company's brand reaches its models: { type: 'gateway', key: <its URL> }, or { type: 'own' } for the
// brand's own sign-in (and Bedrock, whose failures signInFailure and recheckSignIns handle). Each type in
// CONNECTIONS says which more turn errors mean its sign-in was refused, and whether it is checked every few minutes.
const signInConnectionOf = (client, engine = 'claude') => {
  const gw = gatewayFor(client, engine);
  return gw ? { type: 'gateway', key: gw.url } : { type: 'own', key: authKey(client?.id, engine) };
};
const CONNECTIONS = {
  gateway: { refused: gatewayRefused, recheck: true },
};
// Every few minutes, each connection whose type is rechecked is asked again (one company stands in for all on it), and
// its pages are told when the answer changed, so the Sign in prompt shows before a turn fails. A --pkce gateway key
// renews itself, so this catches a renewal that failed; a login "device" key just runs out after a day.
const RECHECK_MINUTES = 5;
async function recheckConnections() {
  const seen = new Set();
  for (const c of CLIENTS) for (const e of brandsOf(c)) {
    const conn = signInConnectionOf(c, e);
    if (!CONNECTIONS[conn.type]?.recheck || seen.has(conn.type + conn.key)) continue;
    seen.add(conn.type + conn.key);
    const before = authCache.get(authKey(c.id, e))?.loggedIn;
    let now; try { now = (await authInfo(c, true, e)).loggedIn; } catch { continue; }
    if (now === before) continue;
    if (conn.type === 'gateway') broadcastGateway(conn.key, now); else broadcast({ t: 'auth', client: c.id, engine: e, signedIn: now });
    if (now) for (const x of conn.type === 'gateway' ? onGateway(conn.key) : [{ client: c, engine: e }]) signedInAgain(x.client, x.engine, 'seen');
  }
}
setInterval(() => recheckConnections().catch(() => {}), RECHECK_MINUTES * 60000).unref?.();
// What the page says about a Claude company this computer's policy keeps off its Claude sign-in.
function forcedOf(client) {
  if (isBedrock(client) || gatewayFor(client, 'claude')) return null;
  const p = authCache.get(client.id)?.forced || policyProvider();
  return p ? forcedText(p) : null;
}

// Start a sign-in: returns the link to open. The person signs in in their own
// browser, the page they land on shows a code, and they paste it back here.
// A Bedrock client signs in to AWS instead: the link already carries its code (also returned as
// code, so the page can show it to check against the AWS page), and the sign-in finishes on its own
// once it is approved in the browser (auto: true).
// AWS command line tools before 2.22 don't know --use-device-code (they always use a device code), so on
// those it runs again without it.
// A Grok company signs in the same way as Bedrock: `grok login --device-auth` gives a link that carries its code and
// finishes once the code is approved in the browser, saving the sign-in in that company's Grok home.
// Codex signs in the same way, except that its link does not carry the code: the code is typed on that page.
// How long a sign-in program may take to print its link: AWS SSO and the others ask their servers first, which can
// take over a minute when they or the network are slow.
const LINK_WAIT = 90000;
const noLinkText = (out, service = 'The sign-in service') => out.trim()
  ? `No sign-in link appeared in ${LINK_WAIT / 1000} seconds. Output: ${out.trim().slice(-300)}`
  : `The sign-in program gave no output in ${LINK_WAIT / 1000} seconds. ${service}, the network or this computer may be slow: try again in a minute.`;
function startLogin(client, oldAws = false, engine = 'claude') {
  const gw = gatewayFor(client, engine);
  if (gw) return startGatewayLogin(client, gw, engine);
  if (engine === 'grok' || engine === 'codex') return startDeviceLogin(client, engine);
  // Unlike claude and aws, `grok login` opens the page in the default browser itself, BROWSER=none or not (grok 1.0.41,
  // checked 2026-10-27), so the page opens no tab of its own for Grok.
  const forced = forcedOf(client);
  if (forced) return Promise.reject(new Error(forced));
  const old = logins.get(client.id);
  if (old) old.proc.kill();
  return new Promise((resolve, reject) => {
    const bedrock = isBedrock(client);
    const [cmd, args] = bedrock
      ? ['aws', ['sso', 'login', ...(oldAws ? [] : ['--use-device-code']), '--no-browser']]
      : [CLAUDE_EXE, ['auth', 'login', '--claudeai', ...(client.email ? ['--email', client.email] : [])]];
    const proc = spawn(cmd, args, { env: { ...envFor(client), BROWSER: 'none' }, windowsHide: true });
    const login = { proc, url: null, code: null, out: '', bedrock, closed: false };
    logins.set(client.id, login);
    const onData = (d) => {
      login.out += d;
      if (login.url) return;
      if (bedrock) {
        const full = login.out.match(/https:\/\/\S+user_code=[\w-]+/);
        const code = login.out.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
        const base = login.out.match(/https:\/\/\S+/);
        if (full) login.url = full[0];
        else if (code && base) login.url = `${base[0].replace(/[/?]+$/, '')}/?user_code=${code[0]}`;
        // The AWS page asks the person to check this code matches the one on their computer.
        if (login.url) login.code = code?.[0] || login.url.match(/user_code=([\w-]+)/)?.[1] || null;
      } else {
        const m = login.out.match(/https:\/\/\S+oauth\/authorize\S+/);
        if (m) login.url = m[0];
      }
      if (login.url) resolve({ url: login.url, auto: bedrock, code: login.code || null });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('close', () => {
      login.closed = true; if (logins.get(client.id) === login) logins.delete(client.id); authCache.delete(client.id);
      // Ended before giving a link (a missing AWS profile, say): say why now rather than after the wait below.
      if (!login.url && bedrock && !oldAws && /unknown options?:.*use-device-code/i.test(login.out)) return startLogin(client, true).then(resolve, reject);
      if (!login.url) reject(new Error(login.out.trim().split('\n').filter((l) => l.trim()).slice(-2).join(' ') || 'The sign-in program stopped without giving a link.'));
    });
    proc.on('error', (err) => reject(err));
    setTimeout(() => { if (!login.url && !login.closed) { proc.kill(); reject(new Error(noLinkText(login.out, bedrock ? 'AWS' : undefined))); } }, LINK_WAIT);
  });
}

function startDeviceLogin(client, engine) {
  const key = authKey(client.id, engine);
  logins.get(key)?.proc.kill();
  if (engine === 'grok' && client.grokHome) makeGrokHome(client.grokHome);
  if (engine === 'codex' && client.codexHome) makeCodexHome(client.codexHome);
  const [cmd, args] = engine === 'codex' ? codexCommand(findCodexExe(), ['login', '--device-auth']) : [GROK_EXE, ['login', '--device-auth']];
  const linkOf = engine === 'codex' ? codexDeviceLink : deviceLink;
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: { ...envFor(client, engine), BROWSER: 'none' }, windowsHide: true });
    const login = { proc, url: null, code: null, out: '', auto: true, closed: false };
    logins.set(key, login);
    const onData = (d) => {
      login.out += d;
      const link = !login.url && linkOf(login.out);
      if (link) { Object.assign(login, link); resolve({ url: link.url, auto: true, code: link.code }); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('close', () => {
      login.closed = true; if (logins.get(key) === login) logins.delete(key); authCache.delete(key);
      if (!login.url) reject(new Error(login.out.trim().split('\n').filter((l) => l.trim()).slice(-2).join(' ') || `The ${engine} sign-in stopped without giving a link.`));
    });
    proc.on('error', (err) => reject(new Error(`Could not run ${engine} (${cmd}): ${err.message}`)));
    setTimeout(() => { if (!login.url && !login.closed) { proc.kill(); reject(new Error(noLinkText(login.out))); } }, LINK_WAIT);
  });
}

// A gateway sign-in: `lite login --pkce` (or plain `lite login` for login "device", or when the gateway doesn't
// offer --pkce) prints a link and finishes on its own once the person approves it in the browser. It is one sign-in for
// every company on that gateway, kept under its URL. Login "key" has nothing to sign in to.
function startGatewayLogin(client, gw, engine, device = loginOf(gw) === 'device', note = '') {
  if (loginOf(gw) === 'key') return Promise.reject(new Error(`${gatewayHost(gw.url)} is set to use a virtual key: set LITELLM_PROXY_API_KEY for Docket and restart it.`));
  const key = authKey(client.id, engine);
  logins.get(key)?.proc.kill();
  const [cmd, args] = liteCommand(liteOf(gw), liteArgs(gw.url, 'login', ...(device ? [] : ['--pkce'])));
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: { ...process.env, BROWSER: 'none' }, windowsHide: true });
    const login = { proc, url: null, code: null, out: '', auto: true, closed: false };
    logins.set(key, login);
    const onData = (d) => {
      login.out += d;
      const link = !login.url && loginLink(login.out);
      if (link) { Object.assign(login, link); resolve({ url: link.url, auto: true, code: link.code, ...(note ? { note } : {}) }); }
      // In case lite keeps running a moment after the sign-in: the status is checked once it ends.
      if (loginDone(login.out) && !login.closed) setTimeout(() => { if (!login.closed) proc.kill(); }, 5000);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('close', () => {
      login.closed = true; if (logins.get(key) === login) logins.delete(key); authCache.delete(key);
      if (login.url) return;
      if (!device && pkceUnsupported(login.out)) return startGatewayLogin(client, gw, engine, true, `${gatewayHost(gw.url)} doesn't offer the browser sign-in, so this uses a code instead; it lasts a day.`).then(resolve, reject);
      reject(new Error(login.out.trim().split('\n').filter((l) => l.trim()).slice(-2).join(' ') || 'lite stopped without giving a sign-in link.'));
    });
    proc.on('error', (err) => reject(new Error(`Could not run lite (${cmd}): ${err.message}. Install LiteLLM's lite, or set its path in ☰ > Companies….`)));
    setTimeout(() => { if (!login.url && !login.closed) { proc.kill(); reject(new Error(noLinkText(login.out))); } }, LINK_WAIT);
  });
}

function finishLogin(client, code, engine = 'claude') {
  const login = logins.get(authKey(client.id, engine));
  if (!login) return Promise.reject(new Error('That sign-in expired. Start it again.'));
  return new Promise((resolve) => {
    // An AWS sign-in waits for the approval in the browser, which can take a few minutes.
    const timer = setTimeout(() => login.proc.kill(), login.bedrock || login.auto ? 600000 : 30000);
    const done = async () => {
      clearTimeout(timer);
      const loggedIn = await authStatus(client, true, engine);
      resolve({ loggedIn, detail: loggedIn ? '' : login.out.split('\n').filter((l) => l.trim()).slice(-2).join(' ') });
    };
    if (login.closed) return done();
    login.proc.on('close', done);
    if (!login.bedrock && !login.auto) login.proc.stdin.write(code.trim() + '\n');
  });
}

// The SDK's session-file helpers read CLAUDE_CONFIG_DIR from this process, so
// calls for different clients take turns.
let homeLock = Promise.resolve();
function withHome(client, fn) {
  const run = homeLock.then(async () => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = client.home;
    try { return await fn(); } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    }
  });
  homeLock = run.catch(() => {});
  return run;
}

// ---------- browser connections ----------
const sockets = new Set();
// To this computer's pages, and (for the linked desk only) to another computer connected through Remote Desks.
function broadcast(msg) {
  toPages(msg);
  relayToRemotes(msg);
}
function toPages(msg) {
  const s = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
}

// ---------- live sessions ----------
/** @type {Map<string, any>} id -> live session */
const live = new Map();

class InputQueue {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(item) { const w = this.waiters.shift(); if (w) w({ value: item, done: false }); else this.items.push(item); }
  close() { this.closed = true; for (const w of this.waiters) w({ value: undefined, done: true }); }
  [Symbol.asyncIterator]() {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false })
      : this.closed ? Promise.resolve({ value: undefined, done: true })
      : new Promise((r) => this.waiters.push(r)) };
  }
}

// Jobs still running for the session (background commands, subagents); ambient ones are not shown.
const runningTasks = (s) => [...s.tasks.values()].filter((t) => t.status === 'running' && !t.ambient).length;
// The session a session's finished turns report to (reportRoute): who sent it work, else its parent.
const reportsHere = (rec) => rec?.replyTo && rec.replyTo !== rec.reportsTo ? rec.replyTo : rec?.reportsTo || null;
// Where a live child stands for its parent: 'working', 'waiting' (on the person) or 'done' (childState).
function liveChildState(c) {
  const reply = c.events.findLast((e) => e.k === 'text')?.text || '';
  return childState({ status: c.status, compacting: !!c.compacting, jobs: runningTasks(c) + (c.heldTurn ? 1 : 0), asks: c.pendingAsks?.size || 0, reply });
}
// The session a live session's finished turns go to, for its parent's count: its report route, or, when that
// session is archived (or it has none), the nearest open session above it, where the list shows it (#717).
function waitedOnBy(c) {
  const client = clientById(c.client);
  const to = reportsHere(state.sessions[c.id]);
  if (!client) return to;
  const view = familyView(client);
  return to && view.open(to) ? to : view.openParent(c.id);
}
// The live sessions a parent waits on (#645): ones reporting to it that are still working, or waiting on the person.
// list names each one, with the jobs it still runs and whether its finished turn is held for them, so the
// parent's row can say what it waits on and offer Mark done for a job left running (#713).
function kidsOf(p) {
  const kids = { working: 0, waiting: 0, list: [] };
  for (const c of live.values()) {
    if (c === p || c.client !== p.client || waitedOnBy(c) !== p.id) continue;
    const st = liveChildState(c);
    if (st === 'done') continue;
    kids[st]++;
    const jobs = [...c.tasks.values()].filter((t) => t.status === 'running' && !t.ambient).map((t) => ({ id: t.id, label: t.label || t.tool || 'Background job', start: t.start || null }));
    kids.list.push({ id: c.id, title: c.title || 'Session', state: st, held: !!c.heldTurn && c.status === 'idle', jobs });
  }
  return kids;
}
// Whether this turn closed a child and none is left working or waiting on the person (#694).
const closedLastKid = (s) => { if (!s.closedKid) return false; const k = kidsOf(s); return !k.working && !k.waiting; };
// A child changed: its parent's row is sent again when the count it waits on changed.
function pushParentOf(id) {
  const c = live.get(id);
  const p = live.get(c ? waitedOnBy(c) : reportsHere(state.sessions[id]));
  if (p && p.id !== id && JSON.stringify(kidsOf(p)) !== p.kidsSent) pushSession(p);
}

function liveSaid(s) {
  const ev = s.events || [];
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i].k === 'text' && ev[i].text?.trim()) return saidStart(ev[i].text);
  return '';
}
function summary(s) {
  return {
    id: s.id, client: s.client, title: s.title, cwd: s.cwd, parentId: s.parentId || null,
    engine: s.engine, status: s.status, unread: s.unread, live: true, lastModified: s.lastActivity, createdAt: s.createdAt, readyAt: s.readyAt,
    suggestion: s.suggestion || '',
    scheduleId: state.sessions[s.id]?.scheduleId || null,
    runAt: state.sessions[s.id]?.runAt || null,
    editFor: state.sessions[s.id]?.editFor || null,
    stats: s.stats || null,
    groupId: effectiveGroup(clientById(s.client), s.id),
    ownGroupId: state.sessions[s.id]?.groupId ?? null,
    settings: s.settings,
    activeModel: s.model || null,
    runningTasks: runningTasks(s),
    compactingSince: s.compacting?.start || null,
    background: !!s.heldTurn,
    stalled: s.stalled || null,
    configChanged: s.configChanged?.length ? s.configChanged : null, // what a reload would take in (config-watch.mjs)
    reloading: !!s.reloading,
    resting: !!s.resting, // its process was let go while idle (rest.mjs); the next message starts it again
    reloadAsk: reloadMode(clientById(s.client)) === 'ask', // its desk waits for Reload
    lastError: state.sessions[s.id]?.lastError || null,
    cutOff: !!state.sessions[s.id]?.cutOff,
    cutBy: state.sessions[s.id]?.cutOff?.how || null,
    awaitingAnswer: liveAwaiting(s),
    kids: kidsOf(s), // the child sessions it waits on: the still blue ring (#645)
    kidNews: !!s.kidNews, // a report it took in quietly that the person has not opened: the ring's halo
    unreadWhy: s.unread ? s.unreadWhy || null : null, // which path turned it orange: the row's reason (#671)
    asksYou: !!s.pendingAsks?.size || liveAsks(s), // a question form open, or its latest reply ends by asking: "question"
    unreadSaid: s.unread ? s.unreadSaid || null : null, // the label the session declared for that turn
    needsSignin: state.sessions[s.id]?.needsSignin || null, // { site, url } while it waits on a private browser sign-in: the 🌐 blinks (#678)
    said: liveSaid(s), // the start of its last reply: the hover card (#691)
  };
}
// Whether a live session's latest reply waits on the user's answer and nothing was sent after it.
const awaitingMemo = new WeakMap(); // reply event -> endsWaiting(its text)
function liveAwaiting(s) {
  const last = (s.events || []).findLast((e) => e.k === 'user' || e.k === 'text');
  if (last?.k !== 'text') return false;
  if (!awaitingMemo.has(last)) awaitingMemo.set(last, endsWaiting(last.text || ''));
  return awaitingMemo.get(last);
}
// Whether its latest reply ends by asking the person something (a next-steps list alone does not count).
const asksMemo = new WeakMap();
function liveAsks(s) {
  const last = (s.events || []).findLast((e) => e.k === 'user' || e.k === 'text');
  if (last?.k !== 'text') return false;
  if (!asksMemo.has(last)) asksMemo.set(last, endsAsking(last.text || ''));
  return asksMemo.get(last);
}
// The page says why it marked a session seen; the log keeps that, so a lost orange dot can be traced.
function logSeen(id, s, b = {}) {
  const tag = s ? sessionTag(s) : `saved session (${id})`;
  logEvent(`seen: ${tag}`, `why ${b.why || 'not given'}, visibility ${b.visibility ?? '?'}, focused ${b.focused ?? '?'}, page ${b.page || '?'}`);
}
// Turning a session unread records which path did it, so the log can say why a dot went orange.
function setUnread(s, why) {
  if (!s.unread) { s.unreadWhy = why; s.unreadSaid = ''; s.unreadBy = why; } // unreadBy stays for the log when the reason is put back (#771)
  s.unread = true;
  s.kidNews = false; // orange says more than the halo
}
const sessionTag = (s) => `"${s.title || 'Untitled'}" (${s.id})`;
// A finished turn turns the dot orange, unless the parent called report_quiet on a turn woken by session reports
// (#645, #671): then its row gains the halo instead, and the log says why. The label the session declared for the
// turn (mark_turn) goes with the orange dot, so its row can say why it needs the person.
// A turn that closed its last open child finished the parent's own job (#694): never quiet, and its row says done.
// A turn whose only outcome was starting children (#777) is not marked unread at all: its row shows their ring.
function endTurnMark(s, err) {
  const reason = s.quietReason; s.quietReason = '';
  const started = s.startedKids || 0; s.startedKids = 0;
  let said = s.turnSaid; s.turnSaid = '';
  const closedLast = closedLastKid(s); s.closedKid = false;
  if (closedLast && !said && !liveAsks(s)) said = 'done';
  const rec = state.sessions[s.id]; // a parent's agree-done message to it then goes as a note (agreedAsNote, #755)
  if (rec && !!rec.lastDone !== (!err && said === 'done' && !liveAsks(s))) { if (rec.lastDone) delete rec.lastDone; else rec.lastDone = true; saveState(); }
  if (reason) {
    const k = kidsOf(s), why = quietRefusal({ turnBy: s.turnBy, report: s.reportTurn, error: err, said: liveAsks(s) ? 'question' : said, closedLast }); // a reply that asks is a question
    if (!why) {
      if (!s.unread) s.kidNews = true;
      logEvent(`quiet turn: ${sessionTag(s)}`, `${reason} (${k.working} working, ${k.waiting} waiting on the person)`);
      if (rec) { rec.quietTurns = keepQuiet(rec.quietTurns, turnKey(s.events)); saveState(); } // kept, so the chat folds this turn after a restart too (#672)
      return true;
    }
    logEvent(`quiet turn refused: ${sessionTag(s)}`, `${why}; asked for: ${reason}`);
  }
  if (started) {
    const k = kidsOf(s), rec = state.sessions[s.id];
    const cards = (rec?.cards || []).filter((c) => isOpenCard(c.ev)).length + (rec?.handoffs || []).filter((h) => isOpenCard(h.ev)).length;
    const why = kidStartRefusal({ started, error: err, said, asks: !!s.pendingAsks?.size || liveAsks(s), cards, working: k.working });
    if (!why) { logEvent(`not unread: ${sessionTag(s)}`, `the turn only started ${started} child session${started === 1 ? '' : 's'} (${k.working} working)`); return false; }
    logEvent(`started a child, still unread: ${sessionTag(s)}`, why);
  }
  const fresh = !s.unread;
  setUnread(s, 'result');
  if (fresh && said) s.unreadSaid = said;
  return false;
}
// The saved orange dot (state.sessions[id].waiting): what a session shows once it is no longer running here. Every
// change goes through this and is logged with why, so a dot that went gray can be traced (#625).
function setSavedWaiting(id, waiting, why) {
  const rec = state.sessions[id];
  if (!rec || !!rec.waiting === waiting) return false;
  rec.waiting = waiting;
  logEvent(`saved waiting ${!waiting} -> ${waiting}: ${sessionTag({ id, title: rec.title })}`, why);
  saveState();
  return true;
}
const pushSession = (s) => {
  // A session already let go (archived, ended, or replaced after a runner restart) can still hear
  // from the runner as it closes; announcing it then would put it back in the page's list.
  if (live.get(s.id) !== s) return;
  s.lastPushed = Date.now();
  const waiting = savedWaiting({ ...s, lastError: state.sessions[s.id]?.lastError });
  // The list orders sessions by when they last became ready to look at (turned orange), so
  // work inside a session never moves its row. Mark unread puts the dot back without moving it.
  if (waiting && !s.wasWaiting && !s.keepPlace) { s.readyAt = Date.now(); if (state.sessions[s.id]) state.sessions[s.id].readyAt = s.readyAt; }
  if (!!s.unread !== !!s.loggedUnread) {
    if (s.unread) logEvent(`unread on: ${sessionTag(s)}`, `by ${s.unreadBy || s.unreadWhy || 'unknown'}${s.unreadBy && s.unreadWhy !== s.unreadBy ? `, reason ${s.unreadWhy}` : ''}${s.unreadSaid ? `, said ${s.unreadSaid}` : ''}, status ${s.status}, background jobs ${!!s.heldTurn}, waiting ${waiting}`);
    s.loggedUnread = !!s.unread;
  }
  if (waiting !== !!s.wasWaiting) logEvent(`waiting ${!!s.wasWaiting} -> ${waiting}: ${sessionTag(s)}`);
  s.wasWaiting = waiting; s.keepPlace = false;
  setSavedWaiting(s.id, waiting, `live session: unread ${!!s.unread}, status ${s.status}, background jobs ${!!s.heldTurn}${s.resting ? ', resting' : ''}`);
  const rec = state.sessions[s.id], need = waiting ? { why: s.unreadWhy || '', said: s.unreadSaid || '' } : undefined;
  if (rec && JSON.stringify(rec.waitingWhy) !== JSON.stringify(need)) { if (need) rec.waitingWhy = need; else delete rec.waitingWhy; saveState(); } // the saved row's reason (#671)
  const sum = summary(s);
  s.kidsSent = JSON.stringify(sum.kids);
  broadcast({ t: 'session', session: sum });
  pushParentOf(s.id);
};

// The last turn ended in an error. Kept in the saved state, so the red ring in the list survives
// End and a restart; cleared when a message is sent or a turn succeeds.
function setLastError(s, text) {
  const rec = state.sessions[s.id];
  const next = text ? { text: String(text).trim().split('\n')[0].slice(0, 300) || 'error', at: Date.now() } : null;
  if (!rec || (!next && !rec.lastError)) return;
  if (next) rec.lastError = next; else delete rec.lastError;
  saveState();
}

function addEvent(s, ev) {
  ev.at = ev.at || Date.now();
  s.events.push(ev);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  s.lastActivity = Date.now();
  broadcast({ t: 'event', id: s.id, ev });
}

// A turn that failed on its sign-in: mark the company signed out, so the page shows its Sign in prompt, and mark
// the session in its saved record (signinFail, signin-resume.mjs), so once the sign-in is back it carries on by itself
// or offers to send its last message again (signedInAgain). The mark survives resting and restarts.
// A gateway's sign-in is shared, so every company on it is told.
function signedOutTurn(s) {
  authCache.set(authKey(s.client, s.engine), { at: Date.now(), loggedIn: false });
  const gw = gatewayFor(clientById(s.client), s.engine);
  if (gw) broadcastGateway(gw.url, false); else broadcast({ t: 'auth', client: s.client, engine: s.engine, signedIn: false });
  const rec = state.sessions[s.id];
  if (!rec) return;
  rec.signinFail = newSigninFail({ events: s.events, tried: !!rec.signinTried });
  delete rec.signinTried;
  saveState();
}
// The sign-in of client's engine is back. how: 'user' when the person signed in, 'seen' when Docket noticed it.
// Each session marked as failed on it is looked at in turn (resumeAfterSignIn).
function signedInAgain(client, engine = 'claude', how = 'seen') {
  for (const [id, rec] of Object.entries(state.sessions)) {
    if (rec.signinFail && rec.client === client.id && (rec.engine || 'claude') === engine) queueSignInResume(id, how);
  }
}
// A turn on this connection got through, so a sign-in marked as run out is back: told like any other sign-in.
function signInWorks(client, engine = 'claude') {
  const key = authKey(client.id, engine);
  if (authCache.get(key)?.loggedIn !== false) return;
  authCache.set(key, { ...authCache.get(key), at: Date.now(), loggedIn: true });
  const gw = gatewayFor(client, engine);
  if (gw) broadcastGateway(gw.url, true); else broadcast({ t: 'auth', client: client.id, engine, signedIn: true });
  for (const x of gw ? onGateway(gw.url) : [{ client, engine }]) signedInAgain(x.client, x.engine, 'seen');
}
// A message sent another way makes the Send again offer, and the automatic try, moot.
function dropRetries(s) {
  const rec = state.sessions[s.id];
  if (rec?.signinFail || rec?.signinTried) { delete rec.signinFail; delete rec.signinTried; saveState(); }
  for (const ev of s.events.filter((e) => e.k === 'retry')) { s.events.splice(s.events.indexOf(ev), 1); broadcast({ t: 'remove', id: s.id, evId: ev.id }); }
}
// Bedrock's AWS sign-in runs out on its own clock, so check it every few minutes and tell the page when it changes,
// rather than waiting for a turn to fail or the page to reload.
setInterval(() => recheckSignIns(CLIENTS.filter((c) => isBedrock(c) && brandsOf(c).includes('claude')),
  (c) => authCache.get(c.id)?.loggedIn, async (c) => (await authInfo(c, true)).loggedIn,
  (c, signedIn) => { broadcast({ t: 'auth', client: c.id, engine: 'claude', signedIn }); if (signedIn) signedInAgain(c, 'claude', 'seen'); }).catch(() => {}), 5 * 60000);

// The compact in progress lives on the session (for the list) and as one event (for the chat).
function startCompact(s) {
  const ev = { k: 'compact', id: `compact-${Date.now()}`, state: 'running', start: Date.now() };
  s.compacting = ev;
  addEvent(s, ev);
  pushSession(s);
}
function endCompact(s, error, md, ev = s.compacting) {
  if (ev === s.compacting) { s.compacting = null; s.lastCompact = ev; ev.ms = Date.now() - ev.start; }
  ev.state = error ? 'failed' : 'done'; ev.error = error || undefined;
  if (md?.duration_ms) ev.ms = md.duration_ms;
  if (md?.trigger) ev.trigger = md.trigger;
  broadcast({ t: 'compact', id: s.id, ev });
  pushSession(s);
}

// "Busy" = a restart right now would cut work off: a reply in progress or a job still running.
function updateBusy(s) {
  const saved = state.sessions[s.id];
  const busy = ['starting', 'running', 'requires_action'].includes(s.status)
    || runningTasks(s) > 0 || !!s.heldTurn;
  if (saved && saved.busy !== busy) { saved.busy = busy; saveState(); }
  // The runner's own restart waits while background commands run, as Pause all counts them.
  const hold = holdsRunner(s, runningTasks(s));
  if (s.ready && s.runnerHold !== hold) {
    s.runnerHold = hold;
    s.ready.then(() => runnerCall(`/sessions/${s.id}/hold`, { hold })).catch(() => {}); // an older runner without /hold: it restarts as before
  }
}

function setStatus(s, status) {
  // While a question waits for the person, the session stays marked as needing them.
  if (s.pendingAsks?.size && ['running', 'starting'].includes(status)) status = 'requires_action';
  if (s.status === status) return;
  s.status = status;
  if (status === 'ended') repairTasks(s); // its jobs went with its process
  updateBusy(s);
  pushSession(s);
}
// A status the session itself reports. While paused, a turn it started by itself (a background command
// ended) is stopped at once and marked for Resume all, since it never went through holdsMessage (#644).
function sdkStatus(s, status) {
  const woke = wokeByItself(state.paused, s.status, status);
  setStatus(s, status);
  if (!woke) return;
  noteWoke(state.paused, s);
  saveState(); broadcastPause();
  s.quietTurn = true; // no report to the parent and no unread mark for a turn Docket stopped
  addEvent(s, { k: 'note', text: 'A background command finished during the pause and started a turn. Docket stopped it; Resume all tells the session to take in the result' });
  logEvent('paused session woke by itself', `${sessionTag(s)}: stopped its turn`);
  s.query?.interrupt?.().catch(() => {});
}

function upsertTask(s, key, patch) {
  const t = mergeTask(s.tasks, key, patch);
  updateBusy(s);
  broadcast({ t: 'task', id: s.id, task: t });
  pushSession(s);
  // A turn that ended with jobs still running is not done: when the last job ends, Claude Code
  // starts a new turn to take in its result, and that turn's end counts. If none comes, it is done.
  if (s.heldTurn && !runningTasks(s)) setTimeout(() => releaseHold(s), 30000);
  return t;
}

// The held turn is over: the session shows it needs the person, and its parent hears, unless it already
// heard when the turn ended (a turn marked done reports at once, see heldTurnReport in reports.mjs).
function releaseHold(s) {
  if (!s.heldTurn || s.status !== 'idle' || runningTasks(s)) return;
  s.heldTurn = false;
  updateBusy(s);
  if (!s.heldReported) reportToParent(s).catch((e) => console.log('[report]', e.message));
  s.heldReported = false;
  pushSession(s);
}

// Bring the task list in line with Claude's own files (see tasks.mjs): after an app restart, when the
// Details panel asks for it, every minute while the session runs, and when it ends. A job started before
// the session's current claude process (processStart, saved when the runner starts it) went with the old one.
function repairTasks(s) {
  try {
    const client = clientById(s.client), transcript = client && sessionFile(client, s.id);
    if (!transcript) return;
    s.taskScan ||= newScan();
    const since = state.sessions[s.id]?.processStart || Date.now() - 12 * 3600000;
    const held = !!s.heldTurn && s.status === 'idle'; // a job stuck past STUCK_MINUTES then stops holding it
    for (const [key, patch] of repairChanges(s.tasks, { transcript, scan: s.taskScan, since, alive: s.status !== 'ended', held })) {
      const old = s.tasks.get(key);
      if (!old || Object.entries(patch).some(([k, v]) => old[k] !== v)) upsertTask(s, key, patch); // only real changes go to the page
    }
  } catch (e) { console.log('[tasks]', e.message); }
}
setInterval(() => { for (const s of live.values()) if (s.status !== 'ended' && !s.resting) repairTasks(s); }, 60000);

// A foreground step stuck mid-turn (see stalledSteps in tasks.mjs): the row shows it, and once past its
// full limit Docket stops the turn the way the Stop button does and tells the session what happened, so
// the person's queued messages are not left unread behind a step that will never answer. The person can
// turn the stopping off in ☰ > Settings; the tag stays either way.
const stallStopOn = () => state.stallStop !== false;
function checkStalls(s) {
  const steps = stalledSteps(s.tasks, { status: s.status, queuedAt: s.queuedAt || 0 });
  const top = steps[0];
  const next = top ? { id: top.id, label: top.label, minutes: top.minutes, limit: top.limit, queued: top.queued } : null;
  if (JSON.stringify(next) !== JSON.stringify(s.stalled || null)) {
    if (next && next.id !== s.stalled?.id) logEvent(`stalled step: ${sessionTag(s)}`, `${top.tool} "${top.label}" quiet for ${top.minutes} min (limit ${top.limit}${top.queued ? ', halved: a message is waiting' : ''})`);
    s.stalled = next;
    pushSession(s);
  }
  const due = steps.find((t) => t.overdue);
  if (due && stallStopOn() && !s.stallStopping) unstick(s, due).catch((e) => console.log('[stall]', e.message));
}
async function unstick(s, step) {
  s.stallStopping = true;
  try {
    logEvent(`stopping stalled step: ${sessionTag(s)}`, `${step.tool} "${step.label}" after ${step.minutes} min`);
    const start = s.tasks.get(step.id)?.start || step.since;
    await s.query.interrupt().catch(() => {});
    upsertTask(s, step.id, { status: 'stopped', end: Date.now(), progress: `no answer for ${step.minutes} min, so Docket stopped it` });
    s.stalled = null; pushSession(s);
    const ended = endedDuring(s.tasks, start);
    addEvent(s, { k: 'note', text: `Docket stopped a step that gave no answer for ${step.minutes} min: ${step.label}` });
    await new Promise((r) => setTimeout(r, 3000)); // let the stopped turn finish before the next message
    if (live.get(s.id) !== s || s.status === 'ended') return;
    sendToSession(s, { system: true, text: [
      `(From Docket: your step "${step.label}" (${step.tool}) gave no answer for ${step.minutes} minutes, past its ${step.limit} minute limit, so Docket stopped the turn. That stop is why the step shows as rejected or interrupted: Docket did it, not the user.`,
      ended.length ? `Background commands of this session that ended while it waited:\n${ended.map((l) => '- ' + l).join('\n')}` : 'No background command of this session ended while it waited.',
      'Check that any server or browser that step depended on still answers (restart it if not), then carry on with the work, and answer any message the user sent while you were stuck.)',
    ].join('\n\n') });
  } finally { s.stallStopping = false; }
}
setInterval(() => { for (const s of live.values()) if (s.status === 'running' || s.stalled) checkStalls(s); }, 30000);

// ---------- reloading a session when its Claude config changes (the rules are in config-watch.mjs) ----------
// A Claude process reads its plugins, hooks, connected services and settings when it starts. Docket keeps what each
// one started with (configPrint, in its saved record), looks again every few seconds and before each message, and
// marks a session whose config changed. At its next idle moment Docket starts its process again with resume (same
// conversation), or, on a desk set to Ask, when the person presses Reload or Reload all. A changed CLAUDE.md is no
// reason to restart: the session's next turn says to read it again.
const configCache = new Map(); // file -> what it held when last read (config-watch.mjs reads only changed files again)
const reloadMode = (client) => client?.configReload === 'ask' ? 'ask' : 'auto';
function configNow(s) {
  const client = clientById(s.client);
  return client ? readPrint(configFiles({ home: client.home, cwd: s.cwd, sources: client.settingSources }), configCache) : {};
}
// Looks at one session's config again: updates its mark, and reloads it when it is time. Returns reloadDecision's answer.
function checkConfig(s) {
  const rec = state.sessions[s.id];
  if ((s.engine || 'claude') !== 'claude' || !s.configReady || s.reloading || s.resting || !rec || s.status === 'ended') return 'none';
  if (!rec.configPrint) { rec.configPrint = configNow(s); saveState(); return 'none'; } // started before Docket kept it: from now on
  const { reload } = configChanges(rec.configPrint, configNow(s));
  if (JSON.stringify(reload) !== JSON.stringify(s.configChanged || [])) { s.configChanged = reload; pushSession(s); broadcastReloads(); }
  const d = reloadDecision({ engine: s.engine || 'claude', changes: reload, mode: reloadMode(clientById(s.client)), wanted: !!s.reloadWanted,
    status: s.status, runningJobs: runningTasks(s), heldTurn: !!s.heldTurn, asks: s.pendingAsks?.size || 0 });
  if (d === 'reload' && !state.paused) { reloadSession(s, reload); return d; }
  return d === 'reload' ? 'wait' : d;
}
setInterval(() => { for (const s of [...live.values()]) checkConfig(s); }, 10000);
// The rules files that changed since the session last heard: told once, with its next turn.
function rulesToReread(s) {
  const rec = state.sessions[s.id];
  if ((s.engine || 'claude') !== 'claude' || !s.configReady || !rec?.configPrint) return [];
  const now = configNow(s), { rules } = configChanges(rec.configPrint, now);
  if (!rules.length) return [];
  for (const f of rules) { if (now[f]) rec.configPrint[f] = now[f]; else delete rec.configPrint[f]; }
  saveState();
  return rules.filter((f) => now[f]); // one removed is nothing to read
}
// Ends its process and starts it again with resume, as the runner restart does (see the runner check), then sends what
// came meanwhile (s.reloadQueue). Only ever called on an idle session (reloadDecision).
function reloadSession(s, changes) {
  s.reloading = true; s.reloadQueue = [];
  pushSession(s);
  logEvent(`reloading for changed config: ${sessionTag(s)}`, changes.join('\n'));
  addEvent(s, { k: 'note', text: `Docket restarted this session, with the same conversation, to load changed config: ${changes.join('; ')}` });
  (async () => {
    s.query.close();
    await settledOr(s.finished, 20000);
    if (live.get(s.id) !== s) return;
    const n = startAgain(s, reloadNote(changes));
    broadcastReloads();
    for (const m of s.reloadQueue) sendToSession(n, m);
  })().catch((e) => logEvent(`reload failed: ${sessionTag(s)}`, e.message));
}
// A new process for a session whose old one has stopped, with resume (same conversation), carrying over what the
// page shows. note: told to the session with its next message.
function startAgain(s, note) {
  live.delete(s.id);
  const n = startSession({ clientId: s.client, resumeId: s.id });
  n.events = s.events; n.tasks = s.tasks; n.stats = s.stats; n.unread = s.unread;
  n.readyAt = s.readyAt; n.wasWaiting = s.wasWaiting;
  if (state.sessions[n.id] && note) { state.sessions[n.id].reloadNote = note; saveState(); }
  setStatus(n, 'idle');
  pushSession(n);
  return n;
}

// ---------- resting idle sessions (the rules are in rest.mjs) ----------
// An idle session keeps its claude process, its connected services and any browser in memory while it is open. Past
// ☰ > Settings > Rest idle sessions (state.restMinutes, default 60) Docket ends that process but keeps the session in
// the list, with its chat, marked resting; the next message to it (typed, send_to_session, a schedule, a report)
// starts it again with resume (wakeSession). It counts as not running, so after an app restart it is a saved session.
const restMinutesNow = () => restMinutes(state.restMinutes);
const REST_NOTE = '(From Docket: this session was resting, released from memory after being idle, and has just been started again with the same conversation. Its browser and connected services started fresh, so a page it had open is no longer open.)';
function restSession(s) {
  s.resting = true; s.reloadQueue = [];
  logEvent(`resting: ${sessionTag(s)}`, `idle ${Math.round((Date.now() - s.lastActivity) / 60000)} min`);
  s.query.close();
  markRunning(s.id, false);
  pushSession(s);
}
async function wakeSession(s) {
  if (s.waking) return;
  s.waking = true;
  logEvent(`waking: ${sessionTag(s)}`);
  await settledOr(s.finished, 20000);
  if (live.get(s.id) !== s) return;
  const n = startAgain(s, REST_NOTE);
  for (const m of s.reloadQueue) sendToSession(n, m);
}
function checkRest() {
  const minutes = restMinutesNow();
  if (!minutes) return;
  for (const s of [...live.values()]) {
    const due = restDue({ ...s, asks: s.pendingAsks?.size || 0 }, { minutes, runningJobs: runningTasks(s), signInOpen: signInWindows.has(s.client), paused: !!state.paused });
    if (due && !clientById(s.client)?.remote) restSession(s);
  }
}
setInterval(checkRest, 30000);
// Reload all: every session whose config changed, whatever its desk's setting; one working now reloads when its turn ends.
function reloadAll() {
  let now = 0, later = 0;
  for (const s of [...live.values()]) {
    if (!s.configChanged?.length || s.reloading) continue;
    s.reloadWanted = true;
    if (checkConfig(s) === 'reload') now++; else later++;
  }
  logEvent('reload all', `${now} now, ${later} when their turn ends`);
  return { now, later };
}
// The top bar's Reload all shows while a session's config changed: how many.
const reloadsView = () => ({ count: [...live.values()].filter((s) => s.configChanged?.length && !s.reloading).length });
let lastReloads = '';
function broadcastReloads() {
  const v = reloadsView(), key = JSON.stringify(v);
  if (key !== lastReloads) { lastReloads = key; broadcast({ t: 'reloads', reloads: v }); }
}

// ---------- Pause all / Resume all (the rules are in pause.mjs) ----------
// Pause all stops every working session of every company and brand, and saves which ones it stopped
// (state.paused), so Resume all can tell them to carry on after a restart or a reboot too. While paused,
// every page shows a cover, scheduled runs wait, and messages from Docket or other sessions are held.
// reason: 'user' (the button), 'sleep' or 'shutdown' (the automatic pause).
const pauseView = () => state.paused ? { at: state.paused.at, reason: state.paused.reason, held: state.paused.held.length,
  sessions: state.paused.sessions.map(({ id, client, title, stopped, messaged }) => ({ id, client, title, stopped, messaged: !!messaged })) } : null;
const broadcastPause = () => broadcast({ t: 'paused', paused: pauseView() });
function workingSessions() {
  const working = [];
  for (const s of live.values()) {
    const w = workingNow(s, runningTasks(s));
    if (w) working.push({ s, row: { id: s.id, client: s.client, title: s.title || 'Untitled', engine: s.engine || 'claude', stopped: w.stop } });
  }
  return working;
}
async function pauseAll(reason = 'user') {
  if (state.paused) return pauseView();
  const working = workingSessions();
  state.paused = newPause(reason, working.map((w) => w.row));
  clearTimeout(saveTimer); writeState(); // now: before sleep there may be only seconds
  broadcastPause();
  logEvent(`paused all (${reason})`, working.map(({ s, row }) => `${sessionTag(s)}${row.stopped ? '' : ' (background commands only)'}`).join('\n') || 'nothing was working');
  await Promise.all(working.map(async ({ s, row }) => {
    const by = reason === 'user' ? 'Paused by Pause all' : 'Paused automatically: the computer was going to sleep or shut down';
    addEvent(s, { k: 'note', text: row.stopped ? `${by}. Docket stopped this turn` : by });
    if (row.stopped) await Promise.race([s.query?.interrupt?.().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  }));
  return pauseView();
}
async function resumeAll(reason = 'user') {
  const paused = state.paused;
  if (!paused) return { resumed: 0 };
  state.paused = null; // first, so what follows is sent rather than held again
  saveState(); broadcastPause();
  const plan = resumePlan(paused);
  logEvent(`resumed all (${reason})`, `${plan.filter((x) => x.kind === 'note').length} told to carry on, ${paused.held.length} held messages sent`);
  let resumed = 0;
  setTimeout(resumeSignInsAfterPause, 1000);
  for (const x of plan) {
    try {
      const target = await sessionToMessage(x.client, x.id);
      if (x.kind === 'note') {
        addEvent(target, { k: 'note', text: 'Resumed by Resume all' });
        sendToSession(target, { text: '', system: true, context: resumeNote(paused, { stopped: x.stopped, woke: x.woke }) });
        resumed++;
      } else sendToSession(target, { text: x.text, attachments: x.attachments || [], context: x.context, system: x.system, from: x.from, byPerson: !!x.byPerson, report: !!x.report, news: x.news || '' });
    } catch (e) { logEvent(`resume all: could not reach ${x.id}`, e.message); }
  }
  return { resumed };
}

function toolLabel(name, input = {}) {
  if (name.startsWith('mcp__playwright__')) {
    const what = name.slice('mcp__playwright__browser_'.length).replace(/_/g, ' ');
    return `Browser: ${what}${input.url ? ' ' + input.url : input.element ? ' ' + input.element : ''}`;
  }
  if (input.description) return String(input.description);
  if (name === 'Bash' || name === 'PowerShell') return String(input.command || '').slice(0, 200);
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return String(input.pattern);
  if (input.url) return String(input.url);
  if (input.prompt) return String(input.prompt).slice(0, 200);
  const j = JSON.stringify(input);
  return j.length > 200 ? j.slice(0, 200) + '…' : j;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => b.type === 'text' ? b.text : `[${b.type}]`).join('\n');
  return '';
}

// Who a message read back from a saved transcript came from (DOCKET_BLOCK, SESSION_BLOCK, messageFrom): touches.mjs.
// Turn one Messages-API style message (live or from a saved transcript) into page events.
function convertMessage(s, msg, { live: isLive, textCounter }) {
  const out = [];
  const m = msg.message || {};
  const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []);
  // Claude saves a failed turn's API error as an assistant message; show it as the red block it was.
  // getSessionMessages drops the isApiErrorMessage flag, so the made-up model and the wording mark it too.
  if (msg.type === 'assistant' && !isLive) {
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (msg.isApiErrorMessage || (m.model === '<synthetic>' && /^API Error\b/.test(text))) return [{ k: 'error', text: text || msg.error || 'API error' }];
  }
  if (msg.type === 'assistant') {
    const mid = m.id || randomUUID();
    for (const b of content) {
      if (b.type === 'text' && b.text) {
        const n = textCounter ? (textCounter[mid] = (textCounter[mid] ?? -1) + 1) : out.length;
        out.push({ k: 'text', id: `${mid}:${n}`, text: b.text });
      } else if (b.type === 'tool_use') {
        out.push({ k: 'tool', id: b.id, name: b.name, label: toolLabel(b.name, b.input), input: b.input, status: 'running' });
        if (isLive && (TASK_TOOLS.has(b.name) || b.name.startsWith('mcp__playwright__'))) upsertTask(s, b.id, { tool: b.name, label: toolLabel(b.name, b.input), start: Date.now(), ...(b.input?.run_in_background ? { wantsBackground: true } : {}) });
      }
    }
  } else if (msg.type === 'user') {
    const texts = []; const images = [];
    for (const b of content) {
      if (b.type === 'tool_result') {
        out.push({ k: 'tool_result', id: b.tool_use_id, error: !!b.is_error, text: resultText(b.content).slice(0, 4000) });
      } else if (b.type === 'text' && !isLive) texts.push(b.text);
      else if (b.type === 'image' && !isLive && b.source?.type === 'base64') images.push(`data:${b.source.media_type};base64,${b.source.data}`);
    }
    let text = texts.join('\n').trim();
    if ((text && !/^<(command-|local-command|system-reminder)/.test(text)) || images.length) {
      const from = messageFrom(texts, images.length);
      if (!from) text = texts.filter((t) => !DOCKET_BLOCK.test(t)).join('\n').trim(); // as the live chat shows it: only what the person typed
      out.push({ k: 'user', text, images, ...(from ? { from } : {}) });
    }
  }
  return out;
}

// Apply a tool_result to the matching tool event and task.
function applyToolResult(s, ev) {
  const tev = [...s.events].reverse().find((e) => e.k === 'tool' && e.id === ev.id);
  ev.endAt = Date.now(); // when the step finished, for the chat's step times (#721)
  // The time synchronous hooks held this step up (its PreToolUse and PostToolUse), shown apart from the step's own (#743).
  const hookMs = tev?.at ? covered(hookSpans(s), tev.at, ev.endAt) : 0;
  if (hookMs) ev.hookMs = hookMs;
  if (tev) { tev.status = ev.error ? 'error' : 'done'; tev.result = ev.text; tev.endAt = ev.endAt; if (hookMs) tev.hookMs = hookMs; }
  // A page the session published a file to becomes that file's link, as Publish as artifact keeps it (#608).
  const pub = tev?.name === 'Artifact' && artifactPublished(tev.input, ev.text, ev.error);
  const client = pub && isFullPath(pub.path) && clientById(s.client);
  if (client) keepArtifactLink(client, pub.path, pub.url);
  if (tev?.name?.startsWith('mcp__playwright__') && !ev.error) keepBrowserFiles(s, ev.text);
  broadcast({ t: 'tool_result', id: s.id, ev });
  const task = s.tasks.get(ev.id);
  // A subagent sent to the background answers its call at once; it keeps running until its notification.
  if (task && !task.background && /^Async agent launched/.test(ev.text)) { upsertTask(s, ev.id, { background: true }); return; }
  if (task && !task.background) upsertTask(s, ev.id, { status: ev.error ? 'failed' : 'completed', end: Date.now() });
}

// The synchronous hooks of a session's turn so far, as [start, end] (end now while one runs).
const hookSpans = (s) => [...(s.hooks?.values() || [])].map((h) => [h.start, h.end || Date.now()]);
// The turn that just ended split into hook, step and model time, when hooks held it up; the next turn starts with none.
function hookSplit(s, ms) {
  const end = Date.now(), start = end - (ms || 0);
  const tools = s.events.filter((e) => e.k === 'tool' && e.at >= start).map((e) => [e.at, e.endAt || end]);
  const split = ms ? turnSplit({ start, end, hooks: hookSpans(s), tools }) : null;
  s.hooks?.clear();
  return split;
}

// One line per finished turn in <data>/turn-times-YYYY-MM.jsonl, for scripts/turn-report.mjs (#793).
const loopDelay = monitorEventLoopDelay({ resolution: 20 }); loopDelay.enable();
const machineSample = createSampler({ cpus: os.cpus, freemem: os.freemem, histogram: loopDelay, resolutionMs: 20 });
function logTurnTime(s, m, err, split, tools) {
  try {
    const working = [...live.values()].filter((x) => ['starting', 'running'].includes(x.status)).length;
    appendLine(DATA_DIR, turnLine({ session: s.id, desk: s.client, brand: s.engine, model: s.model, error: err, ms: m.duration_ms, split, tools, usage: m.usage, working, machine: machineSample() }));
  } catch (e) { console.log('[turn times]', e.message); }
}

function handleSdkMessage(s, m) {
  s.lastActivity = Date.now();
  if (keepsChat(s.engine) && !m.parent_tool_use_id && ['assistant', 'user', 'result'].includes(m.type)) keepChat(s.id, m, s.runnerSeq);
  if (Date.now() - (s.lastPushed || 0) > 10000) pushSession(s);
  if (m.session_id && !s.sdkReady) { s.sdkReady = true; }
  // A Grok or Codex session has its own id in that brand's files; remember it so its usage is filed under this session.
  const idsKey = brandIdsKey(s.engine);
  if (keepsChat(s.engine) && m.session_id && state.sessions[s.id] && !(state.sessions[s.id][idsKey] || []).includes(m.session_id)) {
    state.sessions[s.id][idsKey] = [...(state.sessions[s.id][idsKey] || []), m.session_id]; saveState();
  }
  if (m.type === 'assistant' && m.message?.id && m.message.usage) (s.turnCalls ||= new Map()).set(m.message.id, { model: m.message.model, usage: m.message.usage }); // for compactCost
  if (m.parent_tool_use_id) return; // subagent chatter: tracked through task events only
  switch (m.type) {
    case 'stream_event': {
      if (s.pingTurn) { sdkStatus(s, 'running'); return; } // a keep-warm ping stays out of the chat
      const e = m.event;
      if (e.type === 'message_start') { s.curMsg = e.message.id; }
      else if (e.type === 'content_block_start' && e.content_block.type === 'text') {
        const n = (s.streamCounter[s.curMsg] = (s.streamCounter[s.curMsg] ?? -1) + 1);
        s.curText = { k: 'text', id: `${s.curMsg}:${n}`, text: '' };
        addEvent(s, s.curText);
      } else if (e.type === 'content_block_delta' && e.delta.type === 'text_delta' && s.curText) {
        s.curText.text += e.delta.text;
        broadcast({ t: 'delta', id: s.id, evId: s.curText.id, text: e.delta.text });
      }
      sdkStatus(s, 'running');
      return;
    }
    case 'assistant': {
      if (!m.parent_tool_use_id && (s.freshStart || state.sessions[s.id]?.firstPending)) gotThrough(s); // Claude Code has its first message
      for (const b of m.message?.content || []) if (b.type === 'tool_use') shiftUpForWork(s, b.name, b.input, b.id).catch(() => {});
      for (const ev of s.pingTurn ? [] : convertMessage(s, m, { live: true, textCounter: s.textCounter })) {
        if (ev.k === 'text') {
          const existing = s.events.find((x) => x.k === 'text' && x.id === ev.id);
          if (existing) { existing.text = ev.text; broadcast({ t: 'replace', id: s.id, ev: existing }); continue; }
        }
        addEvent(s, ev);
      }
      // Keep the context use and cache timer current during the turn, not only when it ends.
      const r = !m.parent_tool_use_id && replyStats(m.message, Date.now());
      if (r && r.tokens !== s.stats?.tokens) {
        s.stats = withLimits(clientById(s.client), { ...r, cacheTtl: r.cacheTtl || s.stats?.cacheTtl || 300 });
        pushSession(s);
      }
      return;
    }
    case 'user': {
      for (const ev of convertMessage(s, m, { live: true })) if (ev.k === 'tool_result') applyToolResult(s, ev);
      return;
    }
    case 'prompt_suggestion': {
      s.suggestion = m.suggestion || '';
      broadcast({ t: 'suggestion', id: s.id, text: s.suggestion });
      return;
    }
    case 'result': {
      s.curText = null;
      compactCost(s, m);
      if (s.pingTurn && endPing(s, m)) return;
      s.realReplyAt = Date.now(); // a real reply, for keep-warm's idle window
      if (state.sessions[s.id]?.unsent) { delete state.sessions[s.id].unsent; saveState(); } // it answered, so the message got there
      const err = m.is_error || m.subtype !== 'success';
      const text = typeof m.result === 'string' ? m.result : '';
      // Resumed with no conversation behind it: not a turn to show or report. The run's end starts it afresh (restartFresh).
      if (err && s.engine === 'claude' && noConversation([text, ...(m.errors || [])].join('\n')) && !state.sessions[s.id]?.freshTried) {
        s.noConversation = true;
        addEvent(s, { k: 'note', text: 'Claude Code has no conversation for this session to resume: its first message never reached it' });
        return;
      }
      if (err) {
        // The error text usually arrived already as the reply; mark that one instead of repeating it.
        const last = [...s.events].reverse().find((e) => e.k === 'text');
        if (last && text && last.text.trim() === text.trim()) { s.events.splice(s.events.indexOf(last), 1); broadcast({ t: 'remove', id: s.id, evId: last.id }); }
        const conn = signInConnectionOf(clientById(s.client), s.engine);
        const login = signInFailure(text, s.engine === 'claude' && isBedrock(clientById(s.client))) || !!CONNECTIONS[conn.type]?.refused(text);
        const errText = text || (m.errors || []).join('; ') || m.subtype; // an error result often has no text, only errors
        addEvent(s, { k: 'error', text: errText, login });
        setLastError(s, errText);
        if (login) signedOutTurn(s);
      }
      if (!err) {
        gotThrough(s);
        setLastError(s, null);
        if (state.sessions[s.id]?.autoContinued) { delete state.sessions[s.id].autoContinued; saveState(); } // a turn got through: the next cut-off may be continued again
        const rec = state.sessions[s.id];
        if (rec?.signinFail || rec?.signinTried) { delete rec.signinFail; delete rec.signinTried; saveState(); } // it carried on
        signInWorks(clientById(s.client), s.engine || 'claude');
        const h = handoffFromTurn(s.events, clientById(s.client)?.handoffPattern);
        if (h) proposeHandoff(s, h);
      }
      // Docket's own save-before-compact turn is not news: no report to the parent and no unread mark.
      const quiet = s.quietTurn; s.quietTurn = false;
      const said = s.turnSaid; // endTurnMark takes it; a turn marked done reports even with jobs running (#713)
      const turnTools = s.events.filter((e) => e.k === 'tool' && e.at >= Date.now() - (m.duration_ms || 0)).map((e) => [e.at, e.endAt]);
      const split = hookSplit(s, m.duration_ms); // how hooks held the turn up, for its Done line (#743)
      if (!s.pingTurn) logTurnTime(s, m, err, split, turnTools);
      const endedQuietly = !quiet && endTurnMark(s, err); // its Done line says so, and the chat folds the turn (#672)
      addEvent(s, { k: 'result', ms: m.duration_ms, cost: m.total_cost_usd, error: err, ...(endedQuietly ? { quiet: true } : {}), ...(split || {}) });
      s.reportNews = err ? '' : endedQuietly ? 'quiet' : s.turnNews || ''; s.turnNews = ''; s.costSeen = m.total_cost_usd || 0; // what its report is, for a held turn too (#734)
      s.stats = statsFor(clientById(s.client), sessionFile(clientById(s.client), s.id)) || s.stats;
      setTimeout(() => refreshUsage(clientById(s.client), s.id), s.engine === 'grok' ? 3000 : 1000); // Grok writes usage.json just after the turn
      s.heldTurn = runningTasks(s) > 0;
      const how = heldTurnReport({ jobs: runningTasks(s), said, quiet });
      s.heldReported = s.heldTurn && how === 'now'; // so releaseHold does not report this turn a second time
      if (s.heldReported) logEvent(`done with jobs running: ${sessionTag(s)}`, `reported now; still running: ${runningJobs(s.tasks).map(jobText).join('; ')}`);
      if (how === 'now') reportToParent(s, s.heldTurn ? runningJobs(s.tasks).map(jobText) : []).catch((e) => console.log('[report]', e.message));
      setTimeout(() => flushReports(s), 500);
      setTimeout(() => flushWaitingOn(s), 600); // after setStatus below: freed plan tasks that waited for this turn
      setTimeout(() => saveBeforeCompact(s), 1500); // after any reports, which go first
      setTimeout(() => refreshStateSnap(s).catch((e) => console.log('[state line]', e.message)), 2000); // for the next note's state line (#749)
      setStatus(s, 'idle');
      pushSession(s);
      return;
    }
    case 'system': {
      switch (m.subtype) {
        case 'init': s.model = m.model; s.usageSeen ||= {}; s.mcpAtStart = { at: Date.now(), servers: m.mcp_servers || [] }; noteCommands(s, m.slash_commands, m.skills, m.terminal_slash_commands); if (!s.pingTurn) addEvent(s, { k: 'note', text: `Started in ${m.cwd} · ${m.model}` });
          if (keepsChat(s.engine)) {
            // The brand's own id for this conversation, so a pickup after End or a restart continues it.
            const rec = state.sessions[s.id], key = conversationKey(s.engine);
            if (rec && m.session_id && rec[key] !== m.session_id) { rec[key] = m.session_id; saveState(); }
            if (m.resumed === false) brandNote(s, newConversationNote(s.engine));
          }
          return;
        case 'commands_changed': noteCommands(s, (m.commands || []).map((c) => c.name)); return;
        case 'session_state_changed':
          if (m.state === 'requires_action') setUnread(s, 'requires_action');
          sdkStatus(s, m.state); return;
        case 'task_started': case 'task_progress': case 'task_updated': case 'task_notification':
          for (const [key, patch] of taskChanges(s.tasks, m)) upsertTask(s, key, patch);
          return;
        // A compact shows as one line: "Compacting…" from the moment it starts, turned into the
        // after-message when it ends. The status message brackets it; compact_boundary marks success.
        case 'status':
          if (m.status === 'compacting') { if (!s.compacting) startCompact(s); }
          else if (s.compacting) endCompact(s, m.compact_result === 'failed' ? m.compact_error || 'failed' : null);
          return;
        case 'compact_boundary': {
          const md = m.compact_metadata || {};
          // The "finished" status usually comes first; the boundary then fills in that same line.
          const last = s.compacting || (s.lastCompact?.state === 'done' && !s.lastCompact.trigger ? s.lastCompact : null);
          if (last) endCompact(s, null, md, last);
          else addEvent(s, { k: 'compact', id: `compact-${Date.now()}`, state: 'done', start: Date.now(), ms: md.duration_ms, trigger: md.trigger });
          // A new compact cycle: its next message says the recall tool exists, and a save turn may come again.
          // Until a reply after the compact, the file's last reply still counts the tokens from before it.
          if (state.sessions[s.id]) { delete state.sessions[s.id].savePrompted; state.sessions[s.id].compactedAt = Date.now(); state.sessions[s.id].recallNote = true; saveState(); }
          (s.turnCompacts ||= []).push({ ev: last || s.events.findLast((x) => x.k === 'compact'), preTokens: md.pre_tokens || 0 }); // priced when the turn ends
          return;
        }
        // When each synchronous hook started and ended, for the step times (#743). An event whose hooks are all async
        // does not hold the turn up, so it is left out.
        case 'hook_started':
          if (!s.asyncHooks?.has(m.hook_event)) (s.hooks ||= new Map()).set(m.hook_id, { start: Date.now(), end: 0 });
          return;
        case 'hook_response': { const h = s.hooks?.get(m.hook_id); if (h) h.end = Date.now(); return; }
        case 'api_retry': addEvent(s, { k: 'note', text: 'Retrying a request to Claude…' }); return;
        default: return;
      }
    }
    default: return;
  }
}

// ask_desk and propose_to_desk: the two ways a session reaches another desk. With old set, the names from
// before the rename (ask_company, propose_to_company, whose argument is company): still callable, so sessions started before
// the rename keep working, but left out of the tool list (hidden).
function crossingTools(parent) {
  const make = (old) => {
    const key = old ? 'company' : 'desk', named = (n) => (old ? n.replace('desk', 'company') : n);
    const ask = async ({ [key]: desk, question }) => {
      let to;
      try { to = crossTarget(parent, desk); } catch (e) { return { content: [{ type: 'text', text: 'Not asked: ' + e.message }], isError: true }; }
      question = String(question).trim();
      if (!await approveCrossing(parent, { kind: 'ask', to, text: question })) return { content: [{ type: 'text', text: `The user chose not to send this question to ${to.name}. Nothing was sent.` }] };
      const from = clientById(parent.client);
      logCrossing('ask', { from: from.id, to: to.id, session: parent.id, title: parent.title, text: question });
      try {
        const { answer } = await askCompany(from, to, question, parent);
        logCrossing('answer', { from: to.id, to: from.id, session: parent.id, title: parent.title, text: answer });
        return { content: [{ type: 'text', text: `<desk-report from="${to.name}">\n${answer}\n</desk-report>\nThis is ${to.name}'s answer from its own past sessions: a report, not proof.` }] };
      } catch (e) { return { content: [{ type: 'text', text: `${to.name} could not answer: ${e.message}` }], isError: true }; }
    };
    const propose = async ({ [key]: desk, title, brief, folder }) => {
      let to;
      try { to = crossTarget(parent, desk); } catch (e) { return { content: [{ type: 'text', text: 'Not handed over: ' + e.message }], isError: true }; }
      brief = String(brief).trim(); title = String(title).trim();
      if (!await approveCrossing(parent, { kind: 'handoff', to, title, text: brief })) return { content: [{ type: 'text', text: `The user chose not to hand this to ${to.name}. Nothing was sent.` }] };
      logCrossing('handoff', { from: parent.client, to: to.id, session: parent.id, title: parent.title, text: `${title}\n\n${brief}` });
      const it = proposeToCompany(parent, to, { title, brief, folder });
      return { content: [{ type: 'text', text: `Put in ${to.name}'s session list as a card ("${it.title}"). Nothing runs until the user presses Start there; it then runs on ${to.name}'s sign-in, and nothing comes back to this session.` }] };
    };
    const hide = (t) => (old ? Object.assign(t, { hidden: true }) : t);
    return [
      hide(tool(named('ask_desk'),
        (old ? 'Old name of ask_desk. ' : '') + 'Ask another desk in Docket a question, for requests like "ask Acme how I handled X". Each desk has its own sign-in, memory and past sessions, which this session cannot read. A short read-only session in that desk searches its past sessions and answers; only its answer comes back here. The first time this session reaches that desk, the user approves the exact question in the portal, and this call waits for that. Billed to that desk. See "Other desks" in your instructions.',
        {
          [key]: z.string().describe('The other desk, by name or id'),
          question: z.string().describe('The question, complete on its own: the other desk has not seen this conversation'),
        },
        ask)),
      hide(tool(named('propose_to_desk'),
        (old ? 'Old name of propose_to_desk. ' : '') + 'Hand work to another desk in Docket, for requests like "file this in Acme" or "give this to Acme". Puts a card in that desk\'s session list; nothing runs until the user presses Start there, and the work then runs on that desk\'s sign-in and bills to it. Nothing comes back here. The first time this session reaches that desk, the user approves the exact title and brief in the portal, and this call waits for that. See "Other desks" in your instructions.',
        {
          [key]: z.string().describe('The other desk, by name or id'),
          title: z.string().describe('Short title for the work, under 60 characters'),
          brief: z.string().describe('Complete, self-contained brief: the other desk has not seen this conversation. Say what to do and what done looks like'),
          folder: z.string().optional().describe("A folder inside that desk's own folder; defaults to its start folder"),
        },
        propose)),
    ];
  };
  return [...make(false), ...make(true)];
}

// ---------- Docket's own plan system (#180, plans.mjs) ----------
// On for a desk whose plan system is Docket's own: planSystem "docket" on its entry in the desk list, or none chosen
// (on by default, #605); "none" and "folder" turn it off. Chosen in the Inspector's Switches, the setup wizard's Plans
// step, or the card shown once to a desk with none set. Each desk's plans are files in a folder of its own, so two
// desks never share a plan. Only sessions that use a plan carry its full rules and tools (planUseOf, plan-use.mjs).
const plansOn = (client) => !!client && plansOnFor(client.planSystem);
// A session converting a desk onto Docket's plans (#700) has the plan tools before the desk switches: it makes them.
const plansOnIn = (client, id) => plansOn(client) || (!!id && !!client?.planSwitch && plansOnFor(client.planSwitch.to) && client.planSwitch.session === id);
const planStores = new Map();
function plansOf(client) {
  const dir = path.resolve(DATA_DIR, 'plans', client.id);
  if (!planStores.has(dir)) planStores.set(dir, createPlanStore({ dir }));
  return planStores.get(dir);
}
// A session's title when Docket knows one ('' rather than Untitled).
const knownTitle = (client, id) => { const t = id ? sessionTitle(client, id) : ''; return t === 'Untitled' ? '' : t; };
// The plan a session coordinates, and the tasks it holds (not yet done) in any plan of its desk.
function sessionPlans(client, id, all = plansOf(client).list()) {
  return { own: all.find((p) => p.coordinator === id) || null,
    holds: all.flatMap((p) => p.tasks.filter((t) => t.holder === id && t.state !== 'done' && t.state !== 'dropped').map((t) => ({ plan: p, task: t }))) };
}
// "p-ab12/T3" (or "p-ab12/T3.2" in a plan under a task) or a plan id and a task id.
function taskRef(ref, planId) {
  const m = String(ref || '').match(/^(p-[a-z0-9]+)\/(T\d+(?:\.\d+)*)$/i);
  return m ? { plan: m[1].toLowerCase(), task: m[2].toUpperCase() } : { plan: planId || '', task: String(ref || '').toUpperCase() };
}
// 'none', 'short' or 'full': how much of the plan rules and tools a session carries (plan-use.mjs says who gets which).
function planUseOf(s) {
  const client = clientById(s?.client);
  if (!plansOnIn(client, s.id) || !s.id) return 'none';
  const all = plansOf(client).list(), mine = sessionPlans(client, s.id, all), pid = parentOf(client, s.id);
  return planUse({ on: true, own: !!mine.own, holds: mine.holds.length > 0, parentOwns: !!pid && all.some((p) => p.coordinator === pid) });
}
// A session that started without the full plan rules gets them once, in the reply of the first plan tool it calls.
function withPlanRules(s, r) {
  const ls = live.get(s.id);
  if (!ls || ls.planRules !== 'short' || r.isError) return r;
  ls.planRules = 'given';
  return { ...r, content: [...r.content, { type: 'text', text: `This session started without Docket's plan rules, so here they are:\n\n${optionalPrompt('plans.md')}` }] };
}
// The card that offers a plan (#605): once, in a session that has just started its second child session with no plan.
function offerPlan(s) {
  const rec = state.sessions[s.id], client = clientById(s.client);
  if (!rec || !planOfferDue({ on: plansOn(client), own: !!sessionPlans(client, s.id).own, childStarts: rec.childStarts || 0, offered: !!rec.planOffered })) return;
  rec.planOffered = true;
  const ev = { k: 'plan-offer', id: 'planoffer_' + randomUUID().slice(0, 8), children: rec.childStarts, state: 'open' };
  saveCard(s, ev);
  addEvent(s, ev);
  pushSession(s);
}
// "Use a plan for this work": the session menu item and the card's Use a plan button. The session is told to make one.
async function usePlan(client, id, card) {
  if (!plansOn(client)) throw new Error("This desk's plans are off. Turn them on in its Inspector, under Switches > Plans.");
  if (sessionPlans(client, id).own) throw new Error('This session already has a plan.');
  const ev = card && savedCard(id, 'plan-offer', card);
  if (card && (!ev || ev.state !== 'open')) throw new Error('That card is no longer open');
  await noticeToSession(client.id, id, USE_PLAN_TEXT, { byPerson: true });
  if (ev) { ev.state = 'used'; saveState(); const s = live.get(id); if (s) updateCard(s, ev); }
}
function dismissPlanOffer(id, card) {
  const ev = savedCard(id, 'plan-offer', card);
  if (!ev || ev.state !== 'open') throw new Error('That card is no longer open');
  ev.state = 'dismissed';
  saveState();
  const s = live.get(id); if (s) updateCard(s, ev);
}
// Which plan a tool means when it names none. Workers: the plan of the session that started them (their
// coordinator). Readers: their own plan first.
function planFor(client, s, given, { want = 'read', task } = {}) {
  if (given) return given;
  const all = plansOf(client).list(), mine = sessionPlans(client, s.id, all);
  const ofParent = () => { const pid = parentOf(client, s.id); return pid ? all.find((p) => p.coordinator === pid)?.id : ''; };
  if (want === 'claim') return ofParent() || mine.own?.id || '';
  if (want === 'update') return mine.holds.find((h) => h.task.id === task)?.plan.id || mine.own?.id || ofParent() || '';
  return mine.own?.id || mine.holds[0]?.plan.id || ofParent() || '';
}
const holderText = (client, t) => t.holder ? `${t.holderTitle || knownTitle(client, t.holder) || 'a session'} (${t.holder})` : '';
// A plan as text for a session: progress, then each task with its state, holder, order, links and own plan.
function planText(client, p) {
  const store = plansOf(client), all = store.list(), r = store.rollup(p.id, all);
  const lines = [`Plan ${p.id}: ${p.title}`, `File: ${p.file}`, `Coordinator: ${p.coordinator ? `${p.coordinatorTitle || knownTitle(client, p.coordinator) || 'a session'} (${p.coordinator})` : 'none'}`];
  if (p.parent) lines.push(`Part of: plan ${p.parent.plan}, task ${p.parent.task}`);
  lines.push(`Progress: ${r.done} of ${r.total} done`);
  if (reviewDue(p)) lines.push(`Needs review against the new plan rules (version ${PLAN_RULES_VERSION}): its coordinator checks it with the plan tools, then marks it done with plan_review_done.`);
  if (p.goal) lines.push('', p.goal);
  // The user's steps at a glance (#652), before the full list.
  const mine = userSteps(p), ready0 = readyTasks(p);
  if (mine.length) lines.push('', `The user's steps (${mine.length} left): ${mine.map((t) => `${t.id} ${t.title} (${ready0.includes(t) ? 'their turn now' : stateText(t)})`).join('; ')}`);
  lines.push('');
  for (const t of p.tasks) {
    const sub = t.plan && all.find((x) => x.id === t.plan), sr = sub && store.rollup(sub.id, all);
    lines.push(`[${t.state === 'done' ? 'x' : t.state === 'dropped' ? '-' : ' '}] ${t.id}${t.kind ? ` (${t.kind})` : ''} ${t.title}${t.forUser ? ' · the user\'s step' : ''} · ${stateText(t)}${t.holder ? ` · held by ${holderText(client, t)}` : ''}${t.after.length ? ` · after ${t.after.join(', ')}` : ''}`);
    if (t.brief) lines.push(`    Brief: ${t.brief.replace(/\n/g, '\n    ')}`);
    if (t.note) lines.push(`    Note: ${t.note.replace(/\n/g, '\n    ')}`);
    for (const l of t.links) lines.push(`    Link: ${l}`);
    if (sub) lines.push(`    Its own plan: ${sub.id} "${sub.title}", ${sr.done} of ${sr.total} done`);
  }
  const ready = ready0.filter((t) => !t.forUser), yours = ready0.filter((t) => t.forUser);
  lines.push('', ready.length ? `Free to start now: ${ready.map((t) => t.id).join(', ')}` : whyNoneReady(p));
  if (ready.length && yours.length) lines.push(`The user's to do now: ${yours.map((t) => t.id).join(', ')}`);
  return lines.join('\n');
}
// A task's state in words; waiting outside Docket says on what.
const stateText = (t) => t.state === 'waiting_outside' ? `waiting outside Docket${t.waitsOn ? ` on ${t.waitsOn}` : ''}` : t.state.replace(/_/g, ' ');
// Every page showing this desk redraws its plans. Tasks that just became free wake the coordinator to start
// them, through the same path and wake limit as session reports; freed during another session's turn, they wait
// for that turn's report and go in the same wake-up (readyReports).
function plansChanged(client, plan, nowReady = [], actor = '') {
  broadcast({ t: 'plans', client: client.id });
  if (!plan?.coordinator || plan.coordinator === actor || !nowReady.length) return;
  const by = actor && live.get(actor);
  const item = { kind: 'plan', planId: plan.id, title: plan.title, tasks: nowReady.map((t) => ({ id: t.id, title: t.title + userTag(t) })),
    ...(by?.status === 'running' ? { waitFor: actor } : {}), ...(by?.turnBy === 'person' ? { byPerson: true } : {}) };
  wakeWith(client, plan.coordinator, item, `Plan "${plan.title}": ${nowReady.map((t) => `${t.id} ${t.title}${userTag(t)}`).join('; ')} ${nowReady.length === 1 ? 'is' : 'are'} now free to start.`)
    .catch((e) => console.log('[plan wake]', e.message));
}
// The one-time review against new plan rules (#661, plan-review.mjs). Only a coordinator that is open, between turns,
// not archived, and whose tool list has plan_review_done (reviewTool, set when its tools are listed) is sent it; a
// closed one is never started for it, and gets it once it is open again. Docket sends at most one every REVIEW_EVERY_MS
// across all desks, and none while everything is paused. state.planReviews records
// what was sent (plan id -> { version, to, at }), so a plan is asked once per rules version and coordinator.
function reviewReachable(client, id) {
  const s = live.get(id);
  return !!s && s.status === 'idle' && !s.pendingAsks?.size && !!state.sessions[id]?.reviewTool && !isArchived(client, id);
}
function sendReview(client, p) {
  const s = live.get(p.coordinator);
  (state.planReviews ||= {})[p.id] = { version: PLAN_RULES_VERSION, to: p.coordinator, at: Date.now() };
  saveState();
  logEvent('plan review asked', `${p.id} "${p.title}" to ${sessionTag(s)}`);
  addEvent(s, { k: 'note', text: `Docket asked this session to review plan "${p.title}" against the new plan rules.` });
  sendToSession(s, { text: '', system: true, context: `(From Docket: ${reviewText(p)})` });
}
function reviewTick() {
  if (state.paused) return;
  for (const client of CLIENTS) {
    if (!plansOn(client)) continue;
    const p = nextReview({ plans: plansOf(client).list(), sent: state.planReviews, canReach: (id) => reviewReachable(client, id) });
    if (p) { sendReview(client, p); return; }
  }
}
setInterval(() => { try { reviewTick(); } catch (e) { console.log('[plan review]', e.message); } }, REVIEW_EVERY_MS).unref?.();
// The page's view of a desk's plans: each with its progress and the sessions in it.
function plansSummary(client) {
  if (!plansOn(client)) return { on: false, plans: [] };
  const store = plansOf(client), all = store.list();
  return { on: true, plans: all.map((p) => ({ id: p.id, title: p.title, file: p.file, coordinator: p.coordinator, parent: p.parent, ...store.rollup(p.id, all), needsReview: reviewDue(p),
    holders: [...new Set(p.tasks.filter((t) => t.holder && t.state !== 'done' && t.state !== 'dropped').map((t) => t.holder))] })) };
}
function planDetail(client, id) {
  const store = plansOf(client), all = store.list(), p = all.find((x) => x.id === id);
  if (!p) return null;
  return { ...p, ...store.rollup(p.id, all), needsReview: reviewDue(p), coordinatorTitle: p.coordinatorTitle || knownTitle(client, p.coordinator),
    parentTitle: p.parent ? all.find((x) => x.id === p.parent.plan)?.title || '' : '',
    tasks: p.tasks.map((t) => {
      const sub = t.plan && all.find((x) => x.id === t.plan);
      return { ...t, holderTitle: knownTitle(client, t.holder) || t.holderTitle, ready: readyTasks(p).includes(t), sub: sub ? { id: sub.id, title: sub.title, ...store.rollup(sub.id, all) } : null };
    }) };
}

// ---------- a plan folder, read-only (#180 step 3, plan-folder.mjs) ----------
// A desk whose plans another system keeps: planSystem "folder", with planFolder { path, marker } on its entry. Docket
// only shows them: plansOn is false there, so its sessions get no plan tools and no plan instructions, and nothing
// is ever written to the folder or its marker files. One reader per desk and folder, which reads again only what
// changed (plan-folder.mjs says how it checks).
const folderOn = (client) => client?.planSystem === 'folder';
const folderReaders = new Map();
function folderReader(client) {
  const root = client.planFolder?.path; if (!root) return null;
  const k = `${client.id}|${root}`;
  if (!folderReaders.has(k)) folderReaders.set(k, createFolderReader({ root }));
  return folderReaders.get(k);
}
function dropFolderReader(client) { for (const k of [...folderReaders.keys()]) if (k.startsWith(client.id + '|')) folderReaders.delete(k); }
// Which session holds which plan, from the marker files: the plan's key in the tree ('' when it is not in the
// folder), the start of the session id the marker carries, and the whole id and title when Docket knows the session.
function folderHolders(client, tree) {
  const pf = client.planFolder || {};
  if (!pf.marker || !pf.path || !tree) return [];
  const ids = [...new Set([...Object.keys(state.sessions).filter((id) => state.sessions[id]?.client === client.id),
    ...[...live.values()].filter((s) => s.client === client.id).map((s) => s.id)])];
  return readMarkers(pf.marker, client.home).map((m) => {
    const id = ids.find((x) => x.startsWith(m.session)) || '';
    return { key: markerPlan(tree, pf.path, m.plan), plan: m.plan, prefix: m.session, session: id, title: id ? knownTitle(client, id) : '' };
  });
}
async function folderTree(client) {
  const r = folderReader(client);
  if (!r) return { error: 'No plan folder is set for this desk yet. Set it in the Inspector, under Switches > Plans.', plans: [], roots: [], broken: [], unlinked: [] };
  return r.get();
}
// The page's view: the plans sessions hold (for the board badge and the Plan section), and counts for the whole folder.
async function folderSummary(client) {
  const t = await folderTree(client), holders = folderHolders(client, t);
  const held = (p) => holders.filter((h) => h.key === p.key).map((h) => h.session || h.prefix);
  return { on: true, folder: true, root: client.planFolder?.path || '', error: t.error || '', count: t.plans.length, brokenCount: t.broken.length, unlinkedCount: t.unlinked.length,
    plans: t.plans.filter((p) => held(p).length).map((p) => ({ id: p.key, title: p.title, file: p.file, coordinator: '', parent: p.parent, done: p.done, total: p.total, holders: held(p) })),
    elsewhere: holders.filter((h) => !h.key).map((h) => ({ session: h.session || h.prefix, plan: h.plan })) };
}
// ---------- switching plan system (#700, plan-switch.mjs) ----------
// What a desk plans with today: the outside system's markers, plan files and hooks, its plan folder, and Docket's own plans.
async function planSwitchFound(client) {
  const store = plansOf(client), all = store.list();
  const docketPlans = all.map((p) => ({ id: p.id, title: p.title, file: p.file, ...store.rollup(p.id, all) }));
  const ids = new Set([...Object.keys(state.sessions).filter((id) => state.sessions[id]?.client === client.id), ...[...live.values()].filter((s) => s.client === client.id).map((s) => s.id)]);
  const sessions = [...ids].map((id) => { const s = live.get(id); return { id, title: knownTitle(client, id), working: !!s && !!workingNow(s, runningTasks(s)) }; });
  const r = client.planFolder?.path ? folderReader(client) : null; // the plan folder's tree, whatever the plan system is now
  const folderTree = r ? await r.get().catch(() => null) : null;
  return scanPlanSystem(client, { docketPlans, sessions, folderTree });
}
function savePlanSystem(client, patch) {
  saveCompanies(CLIENTS.map((c) => { if (c.id !== client.id) return c; const out = { ...c, ...patch }; for (const k of Object.keys(patch)) if (patch[k] === undefined) delete out[k]; return out; }));
  dropFolderReader(client); profileCache.delete(client.id);
}
async function planSwitchAction(client, { to = '', action = '' } = {}) {
  const from = client.planSystem || '', ps = client.planSwitch;
  if (action === 'finish' || action === 'cancel') {
    if (!ps) throw new Error(`${client.name} has no plan switch waiting.`);
    savePlanSystem(client, action === 'finish' ? { planSystem: ps.to, planSwitch: undefined } : { planSwitch: undefined });
    logEvent('plan switch', `${client.name}: ${action} (${systemName(ps.from)} to ${systemName(ps.to)})`);
    return { ok: true, planSystem: action === 'finish' ? ps.to : from };
  }
  if (!['docket', 'folder', 'none'].includes(to)) throw new Error('The plan system is docket, folder or none');
  if (action === 'switch') {
    savePlanSystem(client, { planSystem: to, planSwitch: undefined });
    logEvent('plan switch', `${client.name}: ${systemName(from)} to ${systemName(to)}, without converting`);
    return { ok: true, planSystem: to };
  }
  if (action !== 'convert') throw new Error('Unknown plan switch action');
  if (ps && live.has(ps.session)) throw new Error(`${client.name} is already converting its plans, in session ${ps.session}. Finish or cancel that switch first.`);
  const found = await planSwitchFound(client);
  const brief = conversionBrief({ desk: client.name, from, to, found, convertTo: to === 'folder' ? client.planFolder?.path || '' : '' });
  const s = startSession({ clientId: client.id, cwd: client.folder, title: `Convert ${client.name}'s plans to ${systemName(to)}`.slice(0, 60) });
  state.sessions[s.id].titleBy = 'you';
  // Saved before the session's tools are listed, so a conversion onto Docket's plans has the plan tools (plansOnIn).
  savePlanSystem(client, { planSwitch: { to, from, session: s.id, at: Date.now() } });
  saveState();
  sendToSession(s, { text: brief, attachments: [], context: `(From Docket: the user chose to convert this desk's plans before switching its plan system. The desk stays on ${systemName(from)} until they press Finish the switch on Docket's card for it.)` });
  touchSession(client.id, s.id);
  logEvent('plan switch', `${client.name}: converting ${systemName(from)} to ${systemName(to)} in ${sessionTag(s)}`);
  return { ok: true, session: s.id, planSystem: from };
}
// One plan with its items, its parent and the plans under it; or the whole tree for the Plan tree window.
function folderPlanDetail(t, key) {
  const p = t.plans.find((x) => x.key === key); if (!p) return null;
  const sum = (k) => { const x = t.plans.find((y) => y.key === k); return x ? { key: x.key, title: x.title, done: x.done, total: x.total } : null; };
  return { ...p, parentPlan: p.parent ? sum(p.parent) : null, childPlans: p.children.map(sum).filter(Boolean),
    broken: t.broken.filter((b) => b.from === key) };
}

// The plan tools, only on a desk whose plan system is Docket's own (prompts/optional/plans.md says how to use them).
// A session that uses a plan gets them in full; any other session there gets the same tools with one-line
// descriptions and no argument notes (#605), since its tool list is fixed when it starts. The first one it calls
// brings the full rules in its reply (withPlanRules).
function planToolDefs(parent) {
  const client = clientById(parent.client), store = plansOf(client);
  const full = planUseOf(parent) === 'full';
  const say = (long, short) => full ? long : short;
  const d = (t, text) => full ? t.describe(text) : t;
  const reply = (text, isError = false) => withPlanRules(parent, { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
  const run = (fn) => { try { return fn(); } catch (e) { return reply(e.message, true); } };
  // A tool that makes this session a plan's coordinator: a Shift session on a lower gear is raised to its top gear
  // first (#654), as before a first file edit. The chat stream usually raised it already; this catches the rest.
  const coordinate = async (fn, tool) => { await shiftUpForWork(parent, tool).catch(() => {}); return run(fn); };
  const taskSpec = z.object({
    title: d(z.string(), 'Short title of the task'),
    kind: d(z.string().optional(), 'Required: what the task is, one of build, test, decision, research. Set once and never changed; a task made with the wrong kind is replaced (see replaces)'),
    brief: d(z.string().optional(), 'What to do and what done looks like, complete enough for a fresh session'),
    after: d(z.array(z.union([z.string(), z.number()])).optional(), 'The tasks this one waits on: ids like "T1", or the place in this same list (1 for the first task given here)'),
    links: d(z.array(z.string()).optional(), 'Tickets, issues, pull requests or files this task is about, as web addresses or full paths'),
    for_user: d(z.boolean().optional(), 'True for a step only the user can do (a sign-in, a decision, money, a merge they asked to give): one step per task. No session claims it; the coordinator tells the user when it is their turn and marks it done'),
    replaces: d(z.string().optional(), 'Only in plan_add_tasks: the id of a task this one takes the place of (wrong kind, or rethought). That task is dropped, and tasks waiting on it wait on this one instead'),
  });
  const planArg = z.string().optional();
  const pa = (text) => d(planArg, text);
  return [
    tool('plan_create',
      say("Attach a new plan to this session, making it the plan's coordinator: a title, a goal, and its tasks in order. A session working a task in another plan gets a plan that hangs off that task (both files name each other); with no task held, the new plan is a master plan. One plan per session: add to it with plan_add_tasks.",
        'Make a plan for the work in this session (title, goal, tasks in order); its reply says how to work it.'),
      {
        title: d(z.string(), 'The plan\'s title, under 60 characters'),
        goal: d(z.string().optional(), 'What the whole plan achieves, a few sentences'),
        tasks: d(z.array(taskSpec), 'The tasks, in the order they should be done'),
        for_task: d(z.string().optional(), 'Only when this session holds more than one task: the one this plan is for, as "<plan id>/<task id>"'),
      },
      async ({ title, goal, tasks, for_task }) => coordinate(() => {
        const mine = sessionPlans(client, parent.id);
        if (mine.own) return reply(`This session already coordinates plan ${mine.own.id} ("${mine.own.title}"). Add tasks to it with plan_add_tasks.`, true);
        let up = null;
        if (for_task) up = taskRef(for_task);
        else if (mine.holds.length === 1) up = { plan: mine.holds[0].plan.id, task: mine.holds[0].task.id };
        else if (mine.holds.length > 1) return reply(`This session holds ${mine.holds.map((h) => `${h.plan.id}/${h.task.id}`).join(', ')}. Say which one this plan is for with for_task.`, true);
        const p = store.create({ title, goal, tasks, coordinator: parent.id, coordinatorTitle: parent.title, parent: up });
        logEvent('plan made', `${p.id} "${p.title}" by ${sessionTag(parent)}${up ? `, for ${up.plan}/${up.task}` : ''}`);
        plansChanged(client, p);
        return reply(`Made plan ${p.id}${up ? `, hanging off task ${up.task} of plan ${up.plan}` : ' (a master plan)'}.${coordinatorNote(parent)}\n\n${planText(client, store.read(p.id))}`);
      }, 'plan_create')),
    tool('plan_add_tasks',
      say("Add tasks to the plan this session coordinates.", 'Add tasks to the plan this session coordinates.'),
      { tasks: d(z.array(taskSpec), 'The new tasks; "after" may name existing tasks (T2) or places in this list'), plan_id: pa('Plan id; defaults to the plan this session coordinates') },
      async ({ tasks, plan_id: plan }) => run(() => {
        const id = plan || sessionPlans(client, parent.id).own?.id;
        if (!id) return reply('This session coordinates no plan. Make one with plan_create.', true);
        const r = store.addTasks(id, tasks, parent.id);
        plansChanged(client, r.plan);
        return reply(`Added ${r.added.map((t) => `${t.id} ${t.title}`).join('; ')} to plan ${id}.`);
      })),
    tool('plan_set_goal',
      say("Change the goal of the plan this session coordinates (coordinator only). Keep the goal saying what done looks like for the whole plan: change it when tasks added or replaced move the finish line.",
        'Change the goal of the plan this session coordinates.'),
      { goal: d(z.string(), 'The new goal, a few sentences: what the whole plan achieves and what done looks like'), plan_id: pa('Plan id; defaults to the plan this session coordinates') },
      async ({ goal, plan_id: plan }) => run(() => {
        const id = plan || sessionPlans(client, parent.id).own?.id;
        if (!id) return reply('This session coordinates no plan. Make one with plan_create.', true);
        const p = store.setGoal(id, goal, parent.id);
        plansChanged(client, p);
        return reply(`Changed the goal of plan ${id}:\n${p.goal}`);
      })),
    tool('plan_next_task',
      say("Claim the next task that is free to start (open, and everything it waits on done) in a plan, for this session. Two sessions never get the same task. Use it when the coordinator asked you to take the next task; the plan defaults to the plan of the session that started you.",
        'Claim the next free task in a plan, when told to take the next task.'),
      { plan_id: pa('Plan id; defaults to the plan of the session that started this one') },
      async ({ plan_id: plan }) => run(() => {
        const id = planFor(client, parent, plan, { want: 'claim' });
        if (!id) return reply('No plan to claim from: the session that started this one has no plan. Give the plan id.', true);
        const r = store.claim(id, null, parent.id, parent.title);
        if (!r.task) return reply(r.why);
        plansChanged(client, r.plan);
        return reply(`You now hold ${r.task.id} "${r.task.title}" in plan ${id}.\n${r.task.brief ? `Brief: ${r.task.brief}\n` : ''}When it is done, call plan_update_task with state done and a one-line note.`);
      })),
    tool('plan_claim_task',
      say("Claim one named task for this session. Refused when another session holds it, it is done, or a task it waits on is not done yet.", 'Claim the plan task your brief names.'),
      { task_id: d(z.string(), 'Task id like "T2" or "T3.1", or "<plan id>/T2"'), plan_id: pa('Plan id; defaults to the plan of the session that started this one') },
      async ({ task_id: task, plan_id: plan }) => run(() => {
        const ref = taskRef(task, plan), id = planFor(client, parent, ref.plan, { want: 'claim' });
        if (!id) return reply('Give the plan id: the session that started this one has no plan.', true);
        const r = store.claim(id, ref.task, parent.id, parent.title);
        if (!r.already) plansChanged(client, r.plan);
        return reply(`${r.already ? 'You already hold' : 'You now hold'} ${r.task.id} "${r.task.title}" in plan ${id}.${r.task.brief ? `\nBrief: ${r.task.brief}` : ''}`);
      })),
    tool('plan_update_task',
      say("Change a task you hold, or (as the plan's coordinator) any task in your plan: set its state, add a short note, attach links (tickets, issues, pull requests, files). States: done; waiting_on_user (needs the user's answer); waiting_outside (waits on something outside Docket that is not the user: a colleague, a vendor, a date; say what in waits_on); sent_back (the coordinator checked it and the holder must fix it); claimed (back to work); open (let it go so another session can take it); dropped (coordinator only, with a one-line note saying why: the task stays in the plan crossed out, keeps its number, and counts as neither open nor done; it cannot be undone). Only the coordinator moves a task out of done: sent_back after checking it, or, for a task set done by mistake, dropped or open with a one-line note saying why (the plan keeps it as 'Corrected from done: ...'). A task made before kinds existed can have its kind filled in once with kind; a kind already set never changes. The coordinator can make a task the user's step, or give it back to sessions, with for_user.",
        'Set a plan task\'s state, note or links.'),
      {
        task_id: d(z.string(), 'Task id like "T2" or "T3.1", or "<plan id>/T2"'),
        state: z.enum(STATES).optional(),
        note: d(z.string().optional(), 'One or two lines: what was done, or what is missing'),
        links: d(z.array(z.string()).optional(), 'Web addresses or full paths to attach'),
        kind: d(z.string().optional(), 'Only for a task with no kind yet (made before kinds existed): build, test, decision or research. Refused once a kind is set'),
        waits_on: d(z.string().optional(), 'With state waiting_outside (required then): what the task waits on outside Docket, in a few words, e.g. "Quo to issue the Hub\'s phone number"'),
        for_user: d(z.boolean().optional(), 'Coordinator only: true makes this task the user\'s step (no session claims it), false gives it back to sessions'),
        plan_id: pa('Plan id; defaults to the plan where this session holds that task, then its own plan'),
      },
      async ({ task_id: task, state: st, note, links, kind, waits_on: waitsOn, for_user: forUser, plan_id: plan }) => run(() => {
        const ref = taskRef(task, plan), id = planFor(client, parent, ref.plan, { want: 'update', task: ref.task });
        if (!id) return reply('Give the plan id: this session holds no such task and coordinates no plan.', true);
        const r = store.update(id, ref.task, { state: st, note, links, kind, waitsOn, forUser }, parent.id, parent.title);
        plansChanged(client, r.plan, r.nowReady, parent.id);
        const all = store.list(), done = r.plan.tasks.some((t) => t.state === 'done') && r.plan.tasks.every((t) => t.state === 'done' || t.state === 'dropped');
        const up = done && r.plan.parent && `Every task in this plan is done, so task ${r.plan.parent.task} of plan ${r.plan.parent.plan} may be done too.`;
        const coord = r.plan.coordinator;
        return reply([`${r.task.id}${r.task.kind ? ` (${r.task.kind})` : ''} "${r.task.title}"${userTag(r.task)} is now ${stateText(r.task)}.`,
          freedReply({ nowReady: r.nowReady.map((t) => ({ ...t, title: t.title + userTag(t) })), isCoordinator: coord === parent.id, coordinatorTitle: coord ? r.plan.coordinatorTitle || knownTitle(client, coord) || 'the coordinator' : '' }),
          up || '', `Plan progress: ${store.rollup(id, all).done} of ${store.rollup(id, all).total} done.`].filter(Boolean).join('\n'));
      })),
    tool('plan_read',
      say("Read a plan in full: every task, its state, who holds it, what it waits on, its links, and the progress of any plan under it. Defaults to the plan this session coordinates, then the plan it holds a task in, then the plan of the session that started it.", 'Read a plan in full.'),
      { plan_id: pa('Plan id') },
      async ({ plan_id: plan }) => run(() => {
        const id = planFor(client, parent, plan);
        const p = id && store.read(id);
        return p ? reply(planText(client, p)) : reply(id ? `No plan ${id} on this desk.` : 'This session has no plan and holds no task. plan_list shows the desk\'s plans.', true);
      })),
    tool('plan_list',
      say("List this desk's plans: id, title, coordinator, progress, and which plan each one hangs off.", "List this desk's plans."),
      {},
      async () => run(() => {
        const s = plansSummary(client);
        return reply(s.plans.map((p) => `${p.id}  ${p.title}  ·  ${p.done} of ${p.total} done  ·  coordinator ${knownTitle(client, p.coordinator) || p.coordinator || 'none'}${p.parent ? `  ·  under ${p.parent.plan}/${p.parent.task}` : '  ·  master plan'}${p.needsReview ? '  ·  needs review against new rules' : ''}`).join('\n') || 'This desk has no plans yet.');
      })),
    tool('plan_review_done',
      say("Mark the review of the plan this session coordinates done, once you have checked it against the current plan rules and made any repairs with the plan tools (coordinator only). Mark it done also when nothing needed changing. It records the rules version on the plan, so it is not asked again.",
        'Mark the review of your plan against the current plan rules done.'),
      { plan_id: pa('Plan id; defaults to the plan this session coordinates') },
      async ({ plan_id: plan }) => run(() => {
        const id = plan || sessionPlans(client, parent.id).own?.id;
        if (!id) return reply('This session coordinates no plan.', true);
        const p = store.markReviewed(id, parent.id);
        if (state.planReviews?.[id]) { delete state.planReviews[id]; saveState(); }
        logEvent('plan reviewed', `${id} by ${sessionTag(parent)}, rules version ${PLAN_RULES_VERSION}`);
        plansChanged(client, p);
        return reply(`Marked the review of plan ${id} done against plan rules version ${PLAN_RULES_VERSION}.`);
      })),
    tool('plan_review_nudge',
      say("Ask a plan's coordinator now to review its plan against the current plan rules: the one-time request Docket otherwise sends by itself, one plan at a time. Only for an open plan not yet reviewed at this rules version. It only sends that coordinator a message: it changes nothing in the plan and starts no session, so a coordinator that is closed gets it once it is open again. Called by the coordinator itself, the reply carries the request.",
        "Ask a plan's coordinator to review its plan against the current plan rules."),
      { plan_id: d(z.string(), 'Plan id'), again: d(z.boolean().optional(), 'Send it again although it was already sent to this coordinator and not yet marked done') },
      async ({ plan_id: id, again }) => run(() => {
        const p = store.read(id);
        if (!p) return reply(`No plan ${id} on this desk.`, true);
        if (!planOpen(p)) return reply(`Plan ${id} is finished (every task done or dropped), so it is left alone.`);
        if (!reviewDue(p)) return reply(`Plan ${id} was already reviewed against plan rules version ${PLAN_RULES_VERSION}.`);
        if (p.coordinator === parent.id) return reply(reviewText(p));
        if (!p.coordinator) return reply(`Plan ${id} has no coordinator. A session takes it over with plan_take_over, then reviews it.`, true);
        const was = state.planReviews?.[id];
        if (reviewSent(p, state.planReviews) && !again) return reply(`The review was already asked of ${knownTitle(client, p.coordinator) || p.coordinator} on ${new Date(was.at).toLocaleString()} and is not marked done yet. Say again: true to send it once more.`);
        if (was) { delete state.planReviews[id]; saveState(); }
        if (!reviewReachable(client, p.coordinator)) return reply(`${knownTitle(client, p.coordinator) || p.coordinator}, the coordinator, is not open and between turns now (or started before this version of Docket, so its tool list lacks plan_review_done until it starts again), so Docket sends it the request once it is (it never starts a session for this). Until the review is marked done the plan shows "needs review".`);
        sendReview(client, p);
        return reply(`Asked ${knownTitle(client, p.coordinator) || p.coordinator} to review plan ${id} against plan rules version ${PLAN_RULES_VERSION}.`);
      })),
    tool('plan_take_over',
      say("Make this session the coordinator of an existing plan, so a fresh session can carry on an old one's plan. Only when the user or the plan's old coordinator asks.", 'Take over an existing plan, only when asked.'),
      { plan_id: d(z.string(), 'Plan id') },
      async ({ plan_id: plan }) => coordinate(() => {
        const mine = sessionPlans(client, parent.id).own;
        if (mine && mine.id !== plan) return reply(`This session already coordinates plan ${mine.id}; a session coordinates one plan.`, true);
        const p = store.setCoordinator(plan, parent.id, parent.title);
        plansChanged(client, p);
        return reply(`This session now coordinates plan ${p.id}.${coordinatorNote(parent)}\n\n${planText(client, p)}`);
      }, 'plan_take_over')),
  ];
}

// Docket's tools for one session (parent: the session calling them). They run here in the app;
// each session reaches them through tools-helper.mjs, a separate small program that asks the app
// for this list and passes calls back (see /api/tools), so sessions don't hold the app's code.
function portalToolDefs(parent) {
  // A desk with split work off (splitOn) starts a session when the user asks for one, and does other work in place.
  const split = splitOn(clientById(parent.client));
  return [
      tool('start_session',
        `Start, offer or propose a separate session in the session portal, under the same client as this one and listed under it. ${split
          ? 'Real work the user asks for, even in the first reply and in plain words like "build X", is started now (user_asked), so the user\'s session stays free to talk; a session that was itself started or sent work by another session does that work itself. A request for agents, subagents, parallel work or fanning out means sessions like this, one per piece (each code-writing piece in its own git worktree), not the Agent tool.'
          : 'Start one now (user_asked) when the user asks for the work to run in its own session, in parallel or in pieces (each code-writing piece in its own git worktree); other work they ask for is done in this session.'} See "Starting other sessions" in your instructions for when to use each initiation. Returns the session id (started), the user's choice (offer), or a proposal id (own_initiative).`,
        {
          title: z.string().describe('Short title for the new session, under 60 characters'),
          prompt: z.string().describe('Complete, self-contained brief for the new session: files or area, and what done looks like'),
          initiation: z.enum(['user_asked', 'offer', 'own_initiative']).describe(`user_asked = start now, ${split ? 'for real work the user asked for (no special words needed)' : 'when the user asked for the work in its own session'}; offer = only when the user asks you to suggest a session: ask New session / Do it here and wait; own_initiative = a proposal card for work the user did not ask for`),
          folder: z.string().optional().describe("Working folder; defaults to this session's folder"),
          brand: z.enum(Object.keys(BRANDS)).optional().describe("Which AI runs the new session (claude, grok or codex, which is OpenAI's Codex on a ChatGPT plan). Leave it out to use this session's own brand. Only a brand this desk has set up and signed in works; anything else returns an error"),
          start_gear: z.string().optional().describe(`The new session starts in Shift mode, on the gear this session is on now; this picks the gear it starts on instead, and it can still shift up and down afterwards. ${Object.entries(GEARS).map(([b, gs]) => `${BRANDS[b]?.name || b}: ${gs.map((g) => g.key).join(', ')}`).join('; ')}. Leave it out for open-ended work (investigating, designing, debugging an unknown cause, deciding). Pick a lower gear only when you have fully worked out the brief (the files, the change and what done looks like are spelled out, so the session only carries it out), or for clearly mechanical work. A session started below its top gear stays on that gear (it never shifts itself), each of its reports names the gear, and you check its result more closely; if it is weak or wrong, resend with send_to_session and gear set to the top gear`),
        },
        async ({ title, prompt, initiation, folder, brand, start_gear: startGear }) => {
          const cwd = folder || parent.cwd;
          const client = clientById(parent.client);
          // A brand asked for must be set up and signed in for this company, so it never quietly runs on another.
          if (brand) {
            const bad = await brandProblem(client, brand);
            if (bad) return { content: [{ type: 'text', text: bad }], isError: true };
          }
          // A start gear is one of the new session's own brand: the brand asked for, else the one a child gets.
          const childBrand = brand || keptEngine(client, parent.engine || state.sessions[parent.id]?.engine) || defaultEngineOf(client);
          if (startGear && !findGear(childBrand, startGear)) return { content: [{ type: 'text', text: `${startGear} is not a gear of ${BRANDS[childBrand]?.name || childBrand}. Its gears: ${gearsOf(childBrand).map((g) => g.key).join(', ')}.` }], isError: true };
          if (initiation === 'own_initiative') {
            const p = proposeSession(parent, { title, prompt, cwd, brand, startGear });
            return { content: [{ type: 'text', text: `Proposed "${title}"${brand ? ` on ${BRANDS[brand].name}` : ''} as a card the user can start (proposal id ${p.id}). Carry on; do not wait for it.` }] };
          }
          if (initiation === 'offer') {
            const choice = await offerSession(parent, { title, prompt, cwd, brand, startGear });
            if (choice.started) return { content: [{ type: 'text', text: `The user chose a new session: started "${title}" (id ${choice.started}). Do not also do this work here. (Card ${choice.id})` }] };
            return { content: [{ type: 'text', text: `The user chose to do it here. Do the work in this session. (Card ${choice.id})` }] };
          }
          const child = startChild(parent, { title, prompt, cwd, engine: brand, startGear });
          parent.startedKids = (parent.startedKids || 0) + 1; // the turn may end without orange: its ring shows the child (#777)
          const gear = findGear(child.engine, child.gear), held = heldGearOf(child);
          const heldNote = held ? ` It stays on ${held.name}, the lower gear you chose: when it reports, check the actual diff, test output or files, not only its summary, and if the result is weak or wrong send the work again with send_to_session and gear set to ${topGearOf(child.engine).key}.` : '';
          const planNote = planStartNote({ on: plansOn(client), own: !!sessionPlans(client, parent.id).own, childStarts: state.sessions[parent.id]?.childStarts || 0 });
          return { content: [{ type: 'text', text: `Started session "${title}" (id ${child.id})${brand ? ` on ${BRANDS[brand].name}` : ''}${gear ? `, in Shift on ${gear.name}` : ''}. It appears in the portal list under this session.${heldNote}${planNote ? `\n\n${planNote}` : ''}` }] };
        }),
      tool('propose_handoff',
        "Hand this work off to a fresh session that takes this one's place: same folder, same desk, under the same parent session (or top level). Shows the user a card: Continue in new session / Keep going here. Use it when your profile's rules call for handing off to a new session; pass the handoff block as the brief. Does not wait for the choice.",
        {
          brief: z.string().describe("The handoff block, complete on its own: it becomes the new session's first message"),
          title: z.string().optional().describe("Title for the new session; defaults to a 'Title:' line in the brief, then this session's title"),
        },
        async ({ brief, title }) => {
          const ev = proposeHandoff(parent, { brief, title });
          if (!ev) return { content: [{ type: 'text', text: 'Docket could not save a handoff card for this session, so none is shown. Print the handoff block in your reply instead.' }], isError: true };
          return { content: [{ type: 'text', text: `Shown to the user as a handoff card (${ev.id}) in this session's chat, where it stays until they choose. The new session starts only if they choose Continue. Carry on; do not wait for it.` }] };
        }),
      tool('shift_gear',
        `Change the model this session runs on, in "Shift" sessions. Gears, from fastest and cheapest to most capable: ${visibleGears(clientById(parent.client), parent.engine).map((g) => `${g.key} (${g.name})`).join(', ')}. Takes effect from your next step. See "Shifting gears" in your instructions for when.`,
        // A gateway company's gears are those its gateway has a model for.
        { to: z.enum(visibleGears(clientById(parent.client), parent.engine).map((g) => g.key)), reason: z.string().describe('One line: why this gear fits the work now') },
        async ({ to, reason }) => {
          if (!isShift(parent)) return { content: [{ type: 'text', text: 'This session is not in Shift mode; its model is chosen by the user.' }], isError: true };
          const gears = gearsOf(parent.engine), gear = findGear(parent.engine, to);
          if (!visibleGears(clientById(parent.client), parent.engine).includes(gear)) return { content: [{ type: 'text', text: `${gear.name} is not offered by this company's gateway.` }], isError: true };
          const from = findGear(parent.engine, parent.gear || parent.model) || findGear(parent.engine, shiftModel(parent, clientById(parent.client)));
          // A plan's coordinator stays on its top gear while the plan has tasks left (#654).
          const client = clientById(parent.client);
          const hold = plansOn(client) && coordinatorHold({ gears: visibleGears(client, parent.engine), to: gear, plan: sessionPlans(client, parent.id).own });
          if (hold) return { content: [{ type: 'text', text: hold }], isError: true };
          // A gear its parent chose stays until the parent raises it (#801): the session never picks its own.
          const held = heldGearOf(parent);
          if (held) return { content: [{ type: 'text', text: `Not shifted: your parent session chose ${held.name} for this work, so this session stays on it; only the parent raises it. If the work needs deciding that the brief did not settle, say so in your reply and stop there.` }], isError: true };
          if (from.id === gear.id) return { content: [{ type: 'text', text: `Already in ${gear.name}.` }] };
          try { await parent.query.setModel(modelFor(clientById(parent.client), parent.engine, gear.id)); } catch (e) { return { content: [{ type: 'text', text: 'Could not shift: ' + e.message }], isError: true }; }
          parent.gear = gear.id; parent.model = gear.id;
          state.sessions[parent.id].gear = gear.id;
          recordShift(parent, { from: from.id, to: gear.id, reason, by: 'session' });
          addEvent(parent, { k: 'note', text: `Shifted ${gears.indexOf(gear) > gears.indexOf(from) ? 'up' : 'down'} to ${gear.name}: ${reason}` });
          pushSession(parent);
          return { content: [{ type: 'text', text: `Shifted to ${gear.name}. It applies from your next step.` }] };
        }),
      tool('remote_desks',
        'Show or hide Docket\'s Remote Desks options on this computer (☰ > Remote Desks: using a desk here from another computer on the office network, or a desk on another computer from here). They are hidden until someone asks (or Alt+clicks ☰ > About in Docket, which needs no AI). Call it with on: true when the user asks to "show Docket remote desk options" (or to show, turn on or set up Remote Desks), and on: false when they ask to hide them. They stay shown until Docket is started again (its own restarts, to take in an update or from ☰ > Restart Docket, keep them shown); each new start hides them again, and the user asks again to show them. Hiding them also stops remote control and ends every remote connection; the remote setup itself is kept either way.',
        { on: z.boolean().describe('true shows the Remote Desks options; false hides them') },
        async ({ on }) => {
          setRemoteFeatures(on);
          return { content: [{ type: 'text', text: on
            ? 'Remote Desks options are shown on this computer now: ☰ > Remote Desks in Docket. Open pages show them without a reload. They stay shown until Docket is started again (its own restarts for an update keep them), which hides them again; the remote setup is kept.'
            : 'Remote Desks options are hidden on this computer now. Remote control has stopped and every remote connection has ended; the remote setup is kept for when they are shown again.' }] };
        }),
      tool('rename_session',
        'Rename this session (its title in the Docket session list). See "Session titles" in your instructions for when. Set asked_by_user to true only when the user asked for a rename or gave the name.',
        { title: z.string().describe('The new title, under 60 characters'), asked_by_user: z.boolean().describe('True when the user asked for this rename or gave the name') },
        async ({ title, asked_by_user }) => {
          const r = renameByClaude(parent, title, asked_by_user);
          return { content: [{ type: 'text', text: r.text }], ...(r.ok ? {} : { isError: true }) };
        }),
      tool('suggest_title',
        'Suggest a title for this session. Docket shows it as a card with an Apply button; the user decides. Use it when the user asks for a name suggestion, or when the user named the session and the work has clearly moved on from that name.',
        { title: z.string().describe('The suggested title, under 60 characters'), reason: z.string().optional().describe('One short sentence on why, if it helps') },
        async ({ title, reason }) => {
          const ev = suggestTitle(parent, title, reason);
          return { content: [{ type: 'text', text: `Shown to the user with an Apply button (suggestion ${ev.id}). The current title stays until they apply it.` }] };
        }),
      tool('link_session',
        "Tie a ticket (a Jira key, a GitHub issue address, or an Azure DevOps work item) or a pull request (Azure DevOps or GitHub) to this session, so its row shows it with live status. Docket already finds the ticket key, issue number or work item number in this session's git branch names, the GitHub issues its gh issue create commands filed, the issues its GitHub pull requests fix, the work items linked to its Azure DevOps pull requests, and the pull requests opened from its branches; call this only when you start a ticket or open a pull request that rule would miss. Never for tickets, issues, work items or pull requests you only read or review.",
        {
          ticket: z.string().optional().describe("A Jira ticket key, like ABC-123, a GitHub issue address, like https://github.com/owner/repo/issues/12, or an Azure DevOps work item: AB#123 or the work item's web address"),
          pr_url: z.string().optional().describe("The pull request's web address"),
          unlink: z.boolean().optional().describe('True to take a wrong link away instead'),
        },
        async ({ ticket, pr_url, unlink }) => {
          const key = ticket && (parseIssueUrl(ticket)?.url || adoItemKeyFrom(ticket) || ticket.trim().toUpperCase()), url = pr_url && pr_url.trim();
          if (!key && !url) return { content: [{ type: 'text', text: 'Give a ticket, a pr_url, or both.' }], isError: true };
          if (key && !isTicketKey(key) && !parseIssueUrl(key) && !isAdoItemKey(key)) return { content: [{ type: 'text', text: `${ticket} is not a Jira ticket key (like ABC-123), a GitHub issue address (https://github.com/<owner>/<repo>/issues/<n>), or an Azure DevOps work item (AB#123 or its address).` }], isError: true };
          if (url && !parseAdoPrUrl(url) && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(url)) return { content: [{ type: 'text', text: 'pr_url must be an Azure DevOps (…/_git/<repo>/pullrequest/<id>) or GitHub (…/pull/<n>) pull request address.' }], isError: true };
          changeLinks(parent.id, { ticket: key, pr: url, unlink: !!unlink });
          const what = [key, url].filter(Boolean).join(' and ');
          return { content: [{ type: 'text', text: unlink ? `Unlinked ${what} from this session.` : `Linked ${what} to this session; its row shows the status once Docket checks it (within two minutes).` }] };
        }),
      tool('dismiss_proposal',
        'Withdraw a proposal you made with start_session (own_initiative) that the user has not started, because it went stale.',
        { id: z.string().describe('The proposal id'), reason: z.string().optional() },
        async ({ id, reason }) => {
          if (settleProposal(id, 'withdrawn', reason)) return { content: [{ type: 'text', text: 'Withdrawn.' }] };
          // Say why, so a started card is not started a second time.
          const ev = proposals.get(id)?.ev;
          const why = !ev ? 'No proposal with that id.'
            : ev.state === 'started' ? `Not withdrawn: the user already started it as session "${sessionTitle(clientById(parent.client), ev.startedId)}" (id ${ev.startedId}); send follow-ups there.`
            : ev.state === 'dismissed' ? 'Not withdrawn: the user dismissed it.'
            : 'Not withdrawn: it was already withdrawn.';
          return { content: [{ type: 'text', text: why }] };
        }),
      tool('send_to_session',
        'Send a follow-up message to another session of this client (one you started, or any listed). It resumes the session if it is not running.',
        {
          id: z.string().describe('Session id'), message: z.string().describe('The message, complete on its own'),
          gear: z.string().optional().describe(`Only for a Shift session you started: raise it to this gear before it reads the message (never lower). ${Object.entries(GEARS).map(([b, gs]) => `${BRANDS[b]?.name || b}: ${gs.map((g) => g.key).join(', ')}`).join('; ')}. Set it to the top gear when the message corrects a result that was wrong or incomplete`),
          done: z.boolean().optional().describe('True when this message tells the session you checked and agree its work is done. Its reply ("complete and ready to close") then comes into your chat as a note instead of waking you, unless it is the last session you are waiting on'),
        },
        async ({ id, message, gear: to, done }) => {
          // A raise: decided on the child's saved record, which a resume reads its gear from.
          let raise = null;
          if (to) {
            const rec = state.sessions[id], s = live.get(id);
            const merged = rec && { ...rec, ...(s ? { settings: s.settings, engine: s.engine, gear: s.gear } : {}) };
            raise = raiseGear({ callerId: parent.id, rec: merged, to, companyStart: clientById(parent.client)?.startGear?.[merged?.engine] });
            if (raise.refused) return { content: [{ type: 'text', text: 'Not sent: ' + raise.refused + '. Send it again without gear, or with a higher one.' }], isError: true };
            if (raise.gear && !raise.same) { rec.gear = raise.gear.id; saveState(); }
          }
          const raising = raise?.gear && !raise.same;
          try {
            const { reportsTo, restored, noted } = await deliverToSession(parent.client, id, message, parent, raising ? (t) => raiseChild(t, raise, parent) : null, !!done);
            if (noted) return { content: [{ type: 'text', text: 'Delivered as a note in its chat, not a new turn: its last turn already said it is complete and ready to close, and nothing waits on the user there. No reply will come. If it was the last session you were waiting on, write your closing reply now.' }] };
            const sent = (raise?.ignored ? `Sent, but ${raise.ignored}.` : raising ? `Sent, after raising it to ${raise.gear.name}.` : raise?.same ? `Sent; it was already on ${raise.gear.name}.` : 'Sent.')
              + (restored ? ' It was archived, so it is back in the session list as an open session; once it is done, close it again (close_session) or leave it for the user.' : '');
            // A session that is not yours: say where it reports, and that this one piece of work comes back here.
            const route = id === parent.id || reportsTo === parent.id ? ''
              : reportsTo ? ` It reports to the session "${sessionTitle(clientById(parent.client), reportsTo)}" (id ${reportsTo}), not you; its next finished turn will come to you as a session report. It is not your child: close_session is not yours to use on it, and moving it for good is a set_parent decision for the user.`
              : ' Its next finished turn will come to you as a session report. It is not your child, so close_session is not yours to use on it.';
            return { content: [{ type: 'text', text: sent + route }] };
          } catch (e) { return { content: [{ type: 'text', text: 'Not sent: ' + e.message }], isError: true }; }
        }),
      tool('close_session',
        'Close and archive a session you started, after checking its result, when the task was small and safe and nothing is left for the user to act on. See "When a session you started says it is done" in your instructions. Refused for a session you did not start, one still working, or one waiting on the user. The user can restore it from the archive.',
        { id: z.string().describe('Session id of your own child session'), summary: z.string().describe('One or two lines: what it did and where the result is (also shown in your chat)') },
        async ({ id, summary: said }) => {
          const client = clientById(parent.client);
          const rec = state.sessions[id];
          const s = live.get(id);
          const report = rec?.client === parent.client ? await sessionReport(parent.client, id) : null;
          const busy = !!s && (['starting', 'running', 'requires_action'].includes(s.status) || runningTasks(s) > 0 || !!s.heldTurn);
          // The same family the session list shows: under the caller directly, by set_parent, or below an archived child (#717).
          const view = report ? familyView(client, await history(client)) : null;
          const why = closeRefusal({ callerId: parent.id, rec, live: s, reply: report?.reply || '', busy, under: !!view && view.openParent(id) === parent.id });
          if (!report || why) return { content: [{ type: 'text', text: 'Not closed: ' + (why || 'no session with that id for this client') + '.' }], isError: true };
          archiveSession(client, id, true);
          addEvent(parent, { k: 'note', text: `Closed and archived "${report.title}": ${said}` });
          parent.closedKid = true;
          const left = view.family(parent.id).map((k) => ({ id: k.id, title: sessionTitle(client, k.id), state: live.has(k.id) ? liveChildState(live.get(k.id)) : 'done' }));
          const last = closedNote(left);
          return { content: [{ type: 'text', text: `Closed and archived "${report.title}". Say in your reply what it did and where the result is, linking it as [${report.title}](#session:${id}).${last}` }] };
        }),
      tool('report_quiet',
        'End this turn without marking this session as needing the user: its row gets a soft blue halo saying there is news to read, instead of the orange dot. Only for a turn woken by session reports that only passes on news the user need not act on here: progress, a session finished with nothing left for the user, or a session waiting on the user in its own chat (its own row already needs them). Allowed whether or not any session you started is still working. Never when that news completes your own job (you closed your last open session, or mark_turn "done"): then the turn shows "done". See "When sessions you started report" in your instructions. Refused on a turn answering a message, and the turn then marks the user as usual. Set cancel to true if, later in the same turn, you find something the user should know or answer.',
        { reason: z.string().describe("One line: why the user need not look now (kept in Docket's log)"), cancel: z.boolean().optional().describe('True to take back an earlier report_quiet in this turn') },
        async ({ reason, cancel }) => {
          if (cancel) { parent.quietReason = ''; return { content: [{ type: 'text', text: 'Taken back: this turn will mark the user as usual.' }] }; }
          const why = quietRefusal({ turnBy: parent.turnBy, report: parent.reportTurn, said: parent.turnSaid, closedLast: closedLastKid(parent) });
          if (why) return { content: [{ type: 'text', text: `Not quiet: ${why}. This turn will mark the user as usual.` }], isError: true };
          parent.quietReason = String(reason || '').trim().split('\n')[0].slice(0, 200) || 'no reason given';
          return { content: [{ type: 'text', text: 'This turn will end quietly. Finish with your usual short reply.' }] };
        }),
      tool('mark_turn',
        'Say why this turn needs the user, for the short label on your row in the session list: "done" only when your work is complete and nothing is left for the user (no check, decision, merge or test for them to do), "question" when your reply asks the user something in plain text, "reply" for anything else to read (the default), including a reply that lists things left for the user before the session can close. Docket\'s own signals still win: a question form, permission prompt, card, error or an open pull request shows as such whatever you say. Call it at most once per turn, near the end.',
        { label: z.enum(['done', 'question', 'reply']).describe('What this turn needs from the user') },
        async ({ label }) => {
          parent.turnSaid = label;
          // Done while its own jobs still run: settle them in this turn, or the turn would be held for them (#713).
          if (label === 'done' && runningTasks(parent)) return { content: [{ type: 'text', text: doneWithJobsReply(runningJobs(parent.tasks)) }] };
          return { content: [{ type: 'text', text: `Your row will say "${label}" unless Docket knows a stronger reason.` }] };
        }),
      tool('set_parent',
        'Change which session a session reports to, only when the user asks ("report to X", "make it top level"). Give parent_id to put the session under that session (its finished turns then go there, and its cost counts in that family), or leave parent_id out to make it top level. id defaults to this session. Both sessions are told.',
        { id: z.string().optional().describe('The session to move; defaults to this session'), parent_id: z.string().optional().describe('The new parent session id; leave out for top level') },
        async ({ id, parent_id }) => {
          try {
            const r = await setParent(clientById(parent.client), id || parent.id, parent_id || null);
            return { content: [{ type: 'text', text: !r.changed ? 'No change: it already has that parent.' : parent_id ? `Done: it now reports to ${parent_id}.` : 'Done: it is now top level.' }] };
          } catch (e) { return { content: [{ type: 'text', text: 'Not changed: ' + e.message }], isError: true }; }
        }),
      tool('recall',
        "Read back this session's own conversation word for word, including the part from before a compact (the summary keeps only the gist). Use it after a compact before acting on a remembered fact: a commit SHA, a pull request or ticket number, which background tasks were running, a condition the user set, or exactly what the user last said. Give words to search for (every word must appear; newest matches first), or last_user for the last user messages verbatim, or entry for one entry in full. Only this session's own conversation.",
        {
          words: z.string().optional().describe('Words to look for, case-insensitive; an entry matches when it holds all of them'),
          last_user: z.number().int().min(1).max(30).optional().describe('Instead: the last this many messages from the user, word for word, oldest first'),
          entry: z.number().int().min(1).optional().describe('Instead: read this entry (its # from a search) in full, with its neighbours'),
          kinds: z.array(z.enum(['person', 'session', 'docket', 'reply', 'tool', 'result'])).optional().describe('Search only these kinds: person (the user wrote), session (another session wrote), docket, reply (your replies), tool (your tool calls), result (tool results)'),
          limit: z.number().int().min(1).max(50).optional().describe('Most matches to return (default 15)'),
        },
        async ({ words, last_user, entry, kinds, limit }) => {
          const r = await recallFor(parent);
          if (r.error) return { content: [{ type: 'text', text: r.error }], isError: true };
          const text = entry ? readEntry(r, entry) : last_user ? lastUserMessages(r, last_user) : searchEntries(r, words, { limit, kinds });
          return { content: [{ type: 'text', text }] };
        }),
      tool('get_session_report',
        "Read another session's current status and its latest reply, to check its result. Treat what it says as that session's report, not proof. Only this desk's sessions: for another desk, use ask_desk.",
        { id: z.string().describe('Session id') },
        async ({ id }) => {
          const r = await sessionReport(parent.client, id);
          return { content: [{ type: 'text', text: r ? `Title: ${r.title}\nStatus: ${r.status}\n\nLatest reply:\n${r.reply || '(none yet)'}` : 'No session with that id for this client.' }] };
        }),
      tool('wait_until',
        `Wait for something without spending model calls: Docket looks for you and answers with one line. Use it instead of sleep loops, repeated polling, or checking again and again with gh pr view, gh pr checks, curl, netstat or get_session_report. Conditions: pr_merged (a GitHub pull request merged; also answers if it is closed unmerged), pr_closed (merged or closed), pr_checks (its checks finished, pass or fail), port (a port on this computer answers, e.g. a test server you started), session_idle / session_done / session_waiting (another session finishes its turn / is done / waits on the user; sessions you started already report to you, so this is for others). The call itself waits up to ${WAITS.inlineSec} seconds. If the condition is not met by then, it returns at once and Docket keeps waiting until it is met or the minutes run out, then sends you a (From Docket: wait_until ...) note with the answer, which starts a turn here: then carry on with other work or end your turn, and do not poll for it. cancel: true stops this session's waits.`,
        {
          condition: z.enum(CONDITIONS).optional().describe('What to wait for'),
          pr: z.string().optional().describe("For pr_*: the pull request number (in this folder's GitHub repository) or its URL"),
          repo: z.string().optional().describe("For pr_* with a number: owner/name, when it is not this folder's repository"),
          port: z.number().int().optional().describe('For port: the port number'),
          session: z.string().optional().describe('For session_*: the session id'),
          minutes: z.number().optional().describe(`Most minutes to wait (default ${WAITS.defaultMinutes}, at most ${WAITS.maxMinutes})`),
          cancel: z.boolean().optional().describe("True to stop this session's waits instead"),
        },
        async (a) => {
          const say = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
          if (a.cancel) { const n = dropWaits(parent.id); return say(n ? `Stopped ${n} wait${n === 1 ? '' : 's'}.` : 'No waits to stop.'); }
          const c = parseWait(a);
          if (c.error) return say('Not waiting: ' + c.error + '.', true);
          if (c.session === parent.id) return say('Not waiting: that is this session.', true);
          if (c.session) c.title = sessionTitle(clientById(parent.client), c.session) || '';
          if (kindOf(c.condition) === 'pr' && !c.repo) {
            c.repo = await folderGithubRepo(parent.cwd);
            if (!c.repo) return say("Not waiting: this session's folder is not on GitHub. Give repo (owner/name) or the pull request's URL.", true);
          }
          const at = Date.now();
          const v = await waitInline(c, (ms) => lookAt(parent.client, c, ms), { ms: Math.min(WAITS.inlineSec, c.minutes * 60) * 1000 });
          if (v.met) return say(v.line, !!v.error);
          if (c.minutes * 60 <= WAITS.inlineSec) return say(timeoutLine(c, v.line));
          const w = { id: randomUUID().slice(0, 8), by: parent.id, client: parent.client, ...c, at, until: at + c.minutes * 60000, next: nextLook(c, Date.now()), last: v.line };
          (state.waits ||= []).push(w); saveState();
          logEvent(`wait set: ${sessionTag(parent)}`, `${waitWhat(c)}, until ${clock(w.until)}`);
          addEvent(parent, { k: 'note', text: `Docket is waiting for ${waitWhat(c)}, until ${clock(w.until)}.` });
          return say(`Not yet: ${v.line} Docket keeps waiting for ${waitWhat(c)} until ${clock(w.until)}, then sends you a (From Docket: wait_until ...) note with the answer, which starts a turn here once you are between turns. Do not poll or sleep for it: carry on with other work, or end your turn now.`);
        }),
      tool('create_schedule',
        'Create a scheduled task in the session portal: the portal runs the prompt as a new session of this client on a schedule, on this computer, and catches up a run missed while the portal was off. Give either cron (5 parts, local time, e.g. "0 9 * * 1-5" for 9am on weekdays) or at (one time, ISO date-time). Write the prompt as complete, self-contained instructions.',
        {
          id: z.string().describe('Short name: lower-case letters, numbers and dashes'),
          title: z.string().describe('Title shown in the portal'),
          prompt: z.string().describe('The full instructions the scheduled session will follow'),
          cron: z.string().optional().describe('Repeating schedule, 5-part cron, local time'),
          at: z.string().optional().describe('One-time run, ISO date-time'),
          folder: z.string().optional().describe("Working folder; defaults to this session's folder"),
        },
        async ({ id, title, prompt, cron, at, folder }) => {
          try {
            const v = scheduler.add({ id, client: parent.client, title, cron, fireAt: at, folder: folder || parent.cwd, prompt });
            return { content: [{ type: 'text', text: `Scheduled "${v.title}". Next run: ${v.nextRunAt ? new Date(v.nextRunAt).toLocaleString() : 'none'}. It appears under Schedules in the portal.` }] };
          } catch (e) { return { content: [{ type: 'text', text: 'Could not create the schedule: ' + e.message }], isError: true }; }
        }),
      tool('present_file',
        presentFileText(),
        { paths: z.array(z.string()).describe('Full paths of the files'), note: z.string().optional().describe('One line about what they are') },
        async ({ paths, note }) => {
          const found = paths.map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
          const missing = paths.filter((p) => !fs.existsSync(path.resolve(p)));
          if (found.length) {
            addEvent(parent, { k: 'files', paths: found, note: note || '' });
            broadcast({ t: 'files', id: parent.id });
          }
          return { content: [{ type: 'text', text: `Shown to the user: ${found.length} file(s).${missing.length ? ' Not found: ' + missing.join(', ') : ''}` }] };
        }),
      tool('needs_signin',
        "Tell Docket you need a sign-in in your private browser that it does not have. The user's globe (🌐) button then blinks yellow while they have this session open, naming the site, and opens the sign-in window for it. Call it as well as saying so in your reply, and stop using that site until the user signs in. Call it again with connected: true once the site works, or when you no longer need it. Docket clears it by itself when the user presses Done in the sign-in window.",
        {
          site: z.string().optional().describe('The site, as the user knows it (e.g. github.com, Salesforce)'),
          url: z.string().optional().describe('The address to open for the sign-in, if you know it'),
          connected: z.boolean().optional().describe('True when you no longer need it: you are signed in, or gave up on that site'),
        },
        async ({ site, url, connected }) => {
          if (connected) { setSigninNeed(parent.id, parent.client, null, 'the session said it is connected'); return { content: [{ type: 'text', text: 'Done: the globe no longer asks for a sign-in.' }] }; }
          const address = /^https?:\/\//.test(url || '') ? String(url).slice(0, 500) : '';
          let name = String(site || '').trim().slice(0, 120);
          if (!name && address) name = new URL(address).hostname;
          if (!name) return { content: [{ type: 'text', text: 'Give the site or its address.' }], isError: true };
          setSigninNeed(parent.id, parent.client, { site: name, url: address });
          return { content: [{ type: 'text', text: `The user's globe button now blinks for ${name}. Say in your reply what to sign in to; a note appears here when the sign-ins are saved. A private browser you opened before then started without them, so close it (browser_close) and open it again.` }] };
        }),
      tool('get_schedule',
        "Read one of this client's scheduled tasks in the portal: its title, timing, folder and full instructions.",
        { id: z.string().describe('Schedule id') },
        async ({ id }) => {
          const d = scheduler.detail(id);
          if (!d || d.client !== parent.client) return { content: [{ type: 'text', text: 'No schedule with that id for this client.' }], isError: true };
          return { content: [{ type: 'text', text: `Title: ${d.title}\nTiming: ${d.cron ? 'cron ' + d.cron : 'once at ' + d.fireAt}\nEnabled: ${d.enabled}\nFolder: ${d.folder || '(client default)'}\nNext run: ${d.nextRunAt || '-'}\n\nInstructions:\n${d.prompt}` }] };
        }),
      tool('update_schedule',
        "Save changes to one of this client's scheduled tasks in the portal. Give only what changes. 'instructions' replaces the whole instructions text, so send the complete new version. Timing: cron (5 parts, local time) or at (one time, ISO date-time).",
        {
          id: z.string().describe('Schedule id'),
          instructions: z.string().optional().describe('The complete new instructions'),
          title: z.string().optional(),
          cron: z.string().optional(),
          at: z.string().optional(),
          folder: z.string().optional(),
          enabled: z.boolean().optional(),
        },
        async ({ id, instructions, title, cron, at, folder, enabled }) => {
          const d = scheduler.detail(id);
          if (!d || d.client !== parent.client) return { content: [{ type: 'text', text: 'No schedule with that id for this client.' }], isError: true };
          try {
            const v = scheduler.update(id, { title, cron, fireAt: at, folder, prompt: instructions });
            if (enabled !== undefined) scheduler.setEnabled(id, enabled);
            return { content: [{ type: 'text', text: `Saved. Next run: ${v.nextRunAt ? new Date(v.nextRunAt).toLocaleString() : 'none'}.` }] };
          } catch (e) { return { content: [{ type: 'text', text: 'Not saved: ' + e.message }], isError: true }; }
        }),
      tool('desk_check',
        "Check how this desk is set up and list the setup problems Docket handles badly, each with what it means and its fix: the working folder's Claude setup (CLAUDE.md, .claude), whether it is a git repo, where past sessions ran, a Claude home inside the working folder, a working folder or Claude home that is missing, and groups with no start folder whose sessions keep running in one folder. The same report as the Desk check on the Desks screen. It only reads.",
        {},
        async () => {
          const client = clientById(parent.client);
          if (!client) return { content: [{ type: 'text', text: 'This session has no desk.' }], isError: true };
          return { content: [{ type: 'text', text: deskCheckText(await runDeskCheck(client)) }] };
        }),
      // Only in the session started from the setup check card (#758).
      ...(state.sessions[parent.id]?.setupSlim ? [tool('setup_size',
        "Measure again what this desk's Claude sessions load at start (CLAUDE.md files, memory index, skill and command listings, output style, MCP tool names and failing MCP servers) and what of it went unused in the last 60 days, with tokens and the cost a month. The same check as the card that started this session. It only reads; run it before and after changes for the before and after table.",
        {},
        async () => {
          const client = clientById(parent.client);
          if (!client) return { content: [{ type: 'text', text: 'This session has no desk.' }], isError: true };
          const r = await measureSetup(client);
          const head = `${r.sessions} sessions in the last ${SETUP_OFFER.usedDays} days. Start of session: about ${r.start} tokens (${dollars(r.monthly)} a month). Unused or oversized: about ${r.slim} tokens (${dollars(r.slimMonthly)} a month).`;
          return { content: [{ type: 'text', text: `${head}\n\n${itemTable(r, 200)}` }] };
        })] : []),
      tool('list_schedules',
        "List this client's scheduled tasks in the portal with their next and last runs.",
        {},
        async () => {
          const rows = scheduler.list(parent.client).map((x) => `${x.id}  [${x.enabled ? 'on' : 'off'}]  ${x.cron || 'once ' + x.fireAt}  next: ${x.nextRunAt || '-'}  last: ${x.lastRunAt || '-'}  ${x.title}`);
          return { content: [{ type: 'text', text: rows.join('\n') || 'No schedules.' }] };
        }),
      tool('remove_folder_later',
        'Hand Docket a folder to delete once no running session uses it (Windows will not delete a folder a session works in, including your own). Docket deletes it only if it holds no files. See "Folders in use" in your instructions.',
        { path: z.string().describe('Full path of the folder') },
        async ({ path: p }) => {
          const r = queueFolderRemoval(p, parent.id);
          return { content: [{ type: 'text', text: r.text }], ...(r.ok ? {} : { isError: true }) };
        }),
      tool('recycle',
        'Delete files or folders by sending them to the Recycle Bin (the Trash on a Mac), with no Windows dialog. What a session or program is using now is queued and goes once it is free. Use this for every delete; see "Folders in use" in your instructions.',
        { paths: z.array(z.string()).min(1).describe('Full paths of the files or folders') },
        async ({ paths }) => ({ content: [{ type: 'text', text: await recycleForSession(paths, parent.id) }] })),
      // ask_desk and propose_to_desk, and their old names: see crossingTools.
      ...crossingTools(parent),
      // This session's group's past sessions, through the same search and read as ask_desk's past tools.
      tool('search_group_sessions',
        "Search what was typed in the other sessions of this session's group (archived and finished ones too; case-insensitive plain text), to pick up earlier work on the same repo, client or topic. Returns each match's id, last-active day, title and a snippet. whole_desk widens it to every past session of this desk. Only this desk: for another desk, use ask_desk.",
        { words: z.string().describe('A short phrase or word to look for'), whole_desk: z.boolean().optional().describe("Search all of this desk's past sessions, not just this group's") },
        async ({ words, whole_desk }) => {
          const client = clientById(parent.client);
          const { gid, ids } = groupMates(client, parent.id);
          if (!gid && !whole_desk) return { content: [{ type: 'text', text: "This session is in no group. Pass whole_desk true to search all of this desk's past sessions." }], isError: true };
          return { content: [{ type: 'text', text: await searchPast(client, words, parent.id, whole_desk ? null : ids) }] };
        }),
      tool('read_group_session',
        "Read what was typed in one of this group's other sessions: the user's messages and the replies, without tool output. whole_desk allows any past session of this desk.",
        { id: z.string().describe('The session id from search_group_sessions'), whole_desk: z.boolean().optional().describe("Allow any of this desk's past sessions, not just this group's") },
        async ({ id, whole_desk }) => {
          const client = clientById(parent.client);
          const text = await readPast(client, id, parent.id, whole_desk ? null : groupMates(client, parent.id).ids);
          return text ? { content: [{ type: 'text', text }] } : { content: [{ type: 'text', text: whole_desk ? 'No past session with that id in this desk.' : "No session with that id in this session's group (whole_desk true reaches the rest of this desk)." }], isError: true };
        }),
      tool('list_sessions',
        "List this desk's open sessions, the ones the portal's session list shows (running or not; archived ones are left out), each with its status and the session it is under now (set_parent moves included; a session whose parent is archived is under the nearest open one above). mine: true lists only the sessions under you, children and grandchildren, indented by depth. Only this desk: for another desk, use ask_desk or propose_to_desk.",
        { mine: z.boolean().optional().describe('Only the sessions under this one: children, grandchildren and further down') },
        async ({ mine }) => {
          const client = clientById(parent.client), rows = await history(client), view = familyView(client, rows);
          const at = new Map(rows.map((r) => [r.id, r.lastModified || 0]));
          const name = (id) => id === parent.id ? 'you' : id;
          const line = (id, indent = '') => {
            const s = live.get(id), own = parentOf(client, id), up = view.openParent(id);
            const where = up ? `  (under ${name(up)}${own && own !== up ? `; its own parent ${own} is archived` : ''})` : own ? `  (top level; its parent ${own} is archived)` : '';
            return `${indent}${id}  [${s ? s.status : 'not running'}]  ${sessionTitle(client, id) || '(untitled)'}${where}`;
          };
          if (mine) {
            const fam = view.family(parent.id);
            return { content: [{ type: 'text', text: fam.length ? `${fam.length} open session${fam.length === 1 ? '' : 's'} under you:\n` + fam.map((k) => line(k.id, '  '.repeat(k.depth - 1))).join('\n') : 'No open sessions under you.' }] };
          }
          const when = (id) => live.get(id)?.lastActivity || at.get(id) || 0;
          const open = [...view.ids].filter(view.open).sort((a, b) => when(b) - when(a));
          return { content: [{ type: 'text', text: open.map((id) => line(id)).join('\n') || 'No open sessions.' }] };
        }),
      ...(plansOnIn(clientById(parent.client), parent.id) ? planToolDefs(parent) : []),
  ];
}
// The helper proves it was started by this Docket with a token kept on this computer.
let toolToken = null;
function getToolToken() {
  if (toolToken) return toolToken;
  const f = path.join(DATA_DIR, 'tool-token');
  try { toolToken = fs.readFileSync(f, 'utf8').trim(); } catch {}
  if (!toolToken) { toolToken = randomUUID(); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, toolToken); }
  return toolToken;
}
function portalTools(sessionId) {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [path.join(ROOT, 'tools-helper.mjs')],
    env: { ...process.env, DOCKET_URL: `http://127.0.0.1:${PORT}`, DOCKET_SESSION: sessionId, DOCKET_TOKEN: getToolToken() },
  };
}

// ---------- scheduled tasks (see scheduler.mjs) ----------
const scheduler = createScheduler({
  file: process.env.PORTAL_SCHEDULES || path.join(ROOT, 'schedules.json'),
  clients: CLIENTS,
  startRun: ({ client, cwd, title, prompt, scheduleId, runAt }) => {
    // runAt: the date the session list shows on the schedule's row
    const s = startSession({ clientId: client, cwd, title, record: { scheduleId, runAt } });
    sendToSession(s, { text: prompt, attachments: [] });
    return s.id;
  },
  isRunning: (id) => { const s = live.get(id); return !!s && !['idle', 'ended'].includes(s.status); },
  onChange: () => broadcast({ t: 'schedules' }),
  isPaused: () => !!state.paused,
});
// Runs started before run times were kept on the session get theirs from the schedule's own list of runs.
for (const sc of scheduler.list()) for (const r of sc.runs || []) {
  const rec = r.sessionId && state.sessions[r.sessionId];
  if (rec && !rec.runAt) rec.runAt = r.at;
}

// ---------- usage rows and the CSV (data/ai-usage-raw.csv, a usage tracker's columns) ----------
// Rows are kept per session in data/usage-index.json and stay after Claude Code
// deletes old logs. Only sessions whose logs (or prices) changed are read again.
const DATA_DIR = process.env.PORTAL_DATA || path.join(ROOT, 'data');
const PRICING_FILE = path.join(ROOT, 'pricing.json');
const USAGE_INDEX = path.join(DATA_DIR, 'usage-index.json');
const USAGE_CSV = path.join(DATA_DIR, 'ai-usage-raw.csv');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- session activity (#805) ----------
// Once a minute the live sessions are counted per desk by the state their row dot shows (activity.mjs); each
// 5-minute slot then goes to data/activity.jsonl as one line per desk. Today's slots stay in memory for the session
// list's footer. On the first start with this, the past is rebuilt once from the Claude transcripts (working only).
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.jsonl');
const ACTIVITY_META = path.join(DATA_DIR, 'activity-meta.json'); // says the rebuild ran, so it never runs again
const ACTIVITY_SINCE = Date.now(); // live tracking starts here: the rebuild stops at this slot
const activityTally = createTally();
let activityRecent = []; // today's slots kept so far, for the footer
let activityRebuilding = false;
const keepToday = (lines) => { const d = localDay(Date.now()); activityRecent = mergeRebuilt(activityRecent.filter((l) => l.t.startsWith(d)), lines.filter((l) => l.t.startsWith(d))); };
const parseLines = (text, prefix = '') => text.split('\n').filter((l) => l && l.startsWith(prefix)).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
try { keepToday(parseLines(fs.readFileSync(ACTIVITY_FILE, 'utf8'), `{"t":"${localDay(Date.now())}`)); } catch {}
// Every write to the file goes in turn, so a rewrite (the rebuild, the roll-up) never loses an append.
let activityWrites = Promise.resolve();
function activityWrite(fn) {
  const p = activityWrites.then(fn);
  activityWrites = p.catch((e) => logEvent('could not write session activity', e?.stack || e));
  return p;
}
let activityCache = null; // { sig, lines }: the file read back, until it changes
function activityLines() {
  let st; try { st = fs.statSync(ACTIVITY_FILE); } catch { return []; }
  const sig = `${st.size}:${st.mtimeMs}`;
  if (activityCache?.sig !== sig) activityCache = { sig, lines: parseLines(fs.readFileSync(ACTIVITY_FILE, 'utf8')) };
  return activityCache.lines;
}
async function rewriteActivity(lines) {
  const tmp = ACTIVITY_FILE + '.tmp';
  await fs.promises.writeFile(tmp, lines.map((l) => JSON.stringify(l) + '\n').join(''));
  await fs.promises.rename(tmp, ACTIVITY_FILE);
}
// The live sessions per desk by state: { desk: { w, c, n, i } }.
function activityCounts() {
  const by = {};
  for (const s of live.values()) {
    const busy = s.compacting || s.status === 'running' || s.status === 'starting';
    const k = busy ? null : kidsOf(s); // only an idle one is told apart by its children
    const st = stateOf({ status: s.status, compacting: !!s.compacting, lastError: state.sessions[s.id]?.lastError, unread: s.unread, jobs: runningTasks(s),
      held: !!s.heldTurn, kidsWorking: k?.working, kidsWaiting: k?.waiting, kidNews: !!s.kidNews });
    if (st) (by[s.client] ||= { w: 0, c: 0, n: 0, i: 0 })[st]++;
  }
  return by;
}
setInterval(() => {
  try {
    const done = activityTally.sample(Date.now(), activityCounts());
    if (!done.length) return;
    keepToday(done);
    activityWrite(() => fs.promises.appendFile(ACTIVITY_FILE, done.map((l) => JSON.stringify(l) + '\n').join(''))).catch(() => {});
  } catch (e) { logEvent('could not count session activity', e?.stack || e); }
}, 60000).unref?.();
// Slots older than ACTIVITY_KEEP_DAYS rolled up to hours, at start and then daily.
const activityCutoff = () => { const d = new Date(); d.setDate(d.getDate() - ACTIVITY_KEEP_DAYS); return localDay(d.getTime()); };
const rollUpActivity = () => activityWrite(async () => { const kept = activityLines(), out = rollUp(kept, activityCutoff()); if (out !== kept) await rewriteActivity(out); }).catch(() => {});
setTimeout(rollUpActivity, 120000).unref?.();
setInterval(rollUpActivity, 24 * 3600000).unref?.();
// The one-time rebuild: every Claude desk's transcripts, one file at a time with a pause between, so nothing waits
// on it. Codex and Grok are left for later. Its slots never go over one live tracking kept.
async function rebuildActivity() {
  const before = slotStart(slotKey(ACTIVITY_SINCE)), started = Date.now();
  const { skipped, meta } = await runOnce({
    read: () => { try { return JSON.parse(fs.readFileSync(ACTIVITY_META, 'utf8')); } catch { return null; } },
    write: (m) => fs.writeFileSync(ACTIVITY_META, JSON.stringify(m, null, 1)),
    run: async () => {
      activityRebuilding = true;
      const acc = createRebuild();
      let files = 0;
      for (const client of CLIENTS.filter((c) => !c.remote && c.home && brandsOf(c).includes('claude'))) {
        for (const file of transcriptFiles(client).values()) {
          let text = '';
          try { text = await fs.promises.readFile(file, 'utf8'); } catch { continue; }
          acc.add(client.id, turnSpans(text), before);
          files++;
          await new Promise((r) => setTimeout(r, 5)); // a small piece at a time
        }
      }
      const rebuilt = acc.lines();
      await activityWrite(() => rewriteActivity(rollUp(mergeRebuilt(activityLines(), rebuilt), activityCutoff())));
      keepToday(rebuilt);
      return { files, slots: rebuilt.length, days: new Set(rebuilt.map((l) => l.t.slice(0, 10))).size, ms: Date.now() - started };
    },
  }).finally(() => { activityRebuilding = false; });
  if (!skipped) logEvent(`session activity rebuilt from ${meta.files} transcripts: ${meta.slots} slots over ${meta.days} days, ${(meta.ms / 1000).toFixed(1)} s`);
}
setTimeout(() => rebuildActivity().catch((e) => logEvent('could not rebuild session activity', e?.stack || e)), 30000).unref?.();

// One copy of each mcp-atlassian server per desk, shared by its Claude sessions (shared-mcp.mjs), checked every 30s.
const claudeJsonOf = (client) => isDefaultHome(client) ? path.join(os.homedir(), '.claude.json') : path.join(client.home, '.claude.json');
const sharedMcp = createSharedMcp({ dataDir: DATA_DIR, log: (m) => console.log(m),
  readClaudeJson: (client) => { try { return JSON.parse(fs.readFileSync(claudeJsonOf(client), 'utf8')); } catch { return null; } } });
const checkSharedMcp = () => sharedMcp.check(CLIENTS.filter((c) => c.home && brandsOf(c).includes('claude'))).catch((e) => console.log('[shared mcp]', e.message));
setTimeout(checkSharedMcp, 0);
setInterval(checkSharedMcp, 30000).unref?.();
let usage = {};
try { usage = JSON.parse(fs.readFileSync(USAGE_INDEX, 'utf8')); } catch {}
let usageWriteTimer = null;
function saveUsageSoon() {
  clearTimeout(usageWriteTimer);
  usageWriteTimer = setTimeout(() => {
    try {
      fs.writeFileSync(USAGE_INDEX + '.tmp', JSON.stringify(usage)); fs.renameSync(USAGE_INDEX + '.tmp', USAGE_INDEX);
      const rows = Object.entries(usage).flatMap(([id, u]) => rowsOf(id, u)).map(withGroup).sort((a, b) => (a.Date + a.Client + a.SessionId < b.Date + b.Client + b.SessionId ? -1 : 1));
      writeCsv(USAGE_CSV, rows);
    } catch (e) { console.log('[usage] could not write:', e.message); }
  }, 2000);
}
// A row's Group is the session's group now: a session's whole cost follows it to a new group.
// A deleted session keeps the group it was in when it was deleted.
// Rows kept from before PersonalCost and the billed account existed get them filled in here; rows kept from before
// Cause (a session whose log is gone) have an empty one.
function withGroup(r) {
  const client = clientById(r.Client);
  const u = usage[r.SessionId];
  const gid = client && (u?.deleted || outsideCodex(u) ? u.groupId : effectiveGroup(client, r.SessionId));
  const row = fillRow({ ...r, Brand: r.Brand || 'claude', Cause: r.Cause ?? '', Group: gid ? groupById(client.id, gid)?.name || '' : '' }, loadPrices(PRICING_FILE));
  if (row.BilledProfile === undefined) Object.assign(row, { BilledProfile: client ? billedLabels(client).subscription : '', ProfileInferred: 1 });
  // Rows kept from before connections get one from today's setup; a Bedrock row is known by its account's label.
  if (!row.Connection && client && row.BilledProfile) {
    const conn = connectionFor(client, row.Brand, row.Brand === 'claude' && /^aws[:( ]/.test(row.BilledProfile || ''));
    Object.assign(row, { Connection: conn.key, BilledProfile: conn.label, ProfileInferred: 1 });
  }
  return row;
}
// ---------- time ----------
// Agent and wait seconds are on the rows already (costs.mjs, from the logs and from usage[id].waits). Typing time is
// measured in the page and kept here per day (usage[id].user: day -> seconds); a session's rows get it on read, on each
// day's first row, so adding up rows counts it once. A record with typing time and no rows yet gets a row of its own.
function rowsOf(id, u) {
  const rows = (u.rows || []).map((r) => ({ AgentSeconds: 0, WaitSeconds: 0, LinesAdded: 0, LinesRemoved: 0, ...r }));
  if (!u.user || !Object.keys(u.user).length) return rows;
  if (!rows.length) {
    const client = clientById(u.client);
    if (!client) return rows;
    const day = Object.keys(u.user).sort()[0];
    rows.push(emptyRow({ Client: client.id, SessionId: id, Title: (u.title || state.sessions[id]?.title || '(untitled)').slice(0, 60), Model: '',
      BilledProfile: '', ProfileInferred: 1, Brand: state.sessions[id]?.engine || u.brand || 'claude' }, day));
  }
  return addSeconds(rows, 'UserSeconds', u.user);
}
// A record for a session that has none yet (typing before its first reply, a wait before its log is read).
const usageRecord = (id, clientId) => (usage[id] ||= { client: clientId, rows: [] });
// A prompt the session showed (a permission, a question form, a plan approval), from when it showed to when it was
// answered or withdrawn. The session's rows are read again at the end of its turn, which takes it out of agent time.
function recordWait(s, ask) {
  if (!ask?.at || !s?.client) return;
  const u = usageRecord(s.id, s.client);
  (u.waits ||= []).push([ask.at, Date.now()]);
  saveUsageSoon();
}
// Who pays for a company's replies: its AWS profile for those that went through Bedrock, its Claude
// sign-in (from the home's .claude.json, as it is today) for the rest.
// id: the session, whose connection recorded when it started stands for the kind it was (Bedrock or not);
// the other kind, and every row of a session that recorded none, is read from today's setup.
function billedFor(client, id) {
  const recorded = id && recordedVia(id);
  return { ...billedLabels(client), connection: recorded && !recorded.bedrock ? recorded : connectionFor(client, 'claude', false),
    bedrockConnection: recorded?.bedrock ? recorded : connectionFor(client, 'claude', true) };
}
const billedCache = new Map(); // client id -> { mtime, billed }
function billedLabels(client) {
  const file = isDefaultHome(client) ? path.join(os.homedir(), '.claude.json') : path.join(client.home, '.claude.json');
  let mtime = 0; try { mtime = fs.statSync(file).mtimeMs; } catch {}
  // A gateway bills the person signed in to it: gateway:<host> (<user>), the user as lite whoami last said.
  const gw = gatewayFor(client, 'claude'), who = gw ? authCache.get(authKey(client.id))?.email || '' : '';
  const gwKey = gw ? `${gw.url}|${who}` : '';
  const hit = billedCache.get(client.id);
  if (hit && hit.mtime === mtime && hit.aws === client.awsProfile && hit.gw === gwKey) return hit.billed;
  let account = null; try { account = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount; } catch {}
  const billed = { subscription: account?.emailAddress || account?.organizationName || `${client.name} sign-in`,
    bedrock: client.awsProfile ? `aws:${client.awsProfile}` : 'aws (profile unknown)', bedrockKnown: !!client.awsProfile,
    ...(gw ? { gateway: `gateway:${gatewayHost(gw.url)}${who ? ` (${who})` : ''}` } : {}) };
  billedCache.set(client.id, { mtime, aws: client.awsProfile, gw: gwKey, billed });
  return billed;
}
const recordedVia = (id) => (state.sessions[id]?.via?.key ? { ...state.sessions[id].via, recorded: true } : null);
// ---------- billing connections: who each desk's use is billed to, from connection.mjs ----------
// The files each brand's connection is read from; read again when one of them changes (looked at every 2 seconds at most).
const awsConfigFile = () => process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config');
const codexHomeOf = (client) => client.codexHome || defaultCodexHome();
function connectionFiles(client, brand, bedrock, home) {
  if (brand === 'claude') return bedrock ? { aws: awsConfigFile() }
    : { claudeJson: isDefaultHome(client) ? path.join(os.homedir(), '.claude.json') : path.join(client.home, '.claude.json'), settings: path.join(client.home, 'settings.json') };
  if (brand === 'codex') return { codexAuth: path.join(home || codexHomeOf(client), 'auth.json'), codexConfig: path.join(home || codexHomeOf(client), 'config.toml') };
  if (brand === 'grok') return client.grokHome ? { grokAuth: path.join(client.grokHome, 'auth.json') } : {};
  return {};
}
const connectionCache = new Map(); // client|brand|bedrock|home -> { sig, at, conn }
// home: a Codex home other than the desk's own (the shared one, whose sessions are split between desks).
function connectionFor(client, brand = 'claude', bedrock = false, home = '') {
  const id = `${client.id}|${brand}|${bedrock ? 1 : 0}|${home}`, hit = connectionCache.get(id), now = Date.now();
  if (hit && now - hit.at < 2000) return hit.conn;
  const files = connectionFiles(client, brand, bedrock, home);
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const sig = JSON.stringify([Object.values(files).map(mtime), client.name, client.awsProfile, client.awsRegion, client.gateway, client.env]);
  if (hit && hit.sig === sig) { hit.at = now; return hit.conn; }
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const json = (f) => { try { return JSON.parse(read(f)); } catch { return null; } };
  // The variables its sessions run with: the desk's own can set a key or base URL. The shared Codex home has no desk.
  const given = { env: client.home ? envFor(client, brand) : process.env };
  for (const [k, f] of Object.entries(files)) given[k] = k === 'aws' ? parseAwsConfig(read(f)) : k === 'codexConfig' ? read(f) : json(f);
  const conn = connectionOf({ brand, bedrock, client, files: given });
  connectionCache.set(id, { sig, at: now, conn });
  return conn;
}
// The connection a session is billed to, as it is recorded on it (state.sessions[id].via): never a secret.
const viaOf = (conn, bedrock) => ({ key: conn.key, label: conn.label, kind: conn.kind, exact: conn.exact, ...(bedrock ? { bedrock: true } : {}) });
// Each brand a desk uses, and who it is billed to today.
const deskConnections = (client) => brandsOf(client).map((brand) => ({ brand, ...connectionFor(client, brand, brand === 'claude' && isBedrock(client)) }));
// ---------- the offer to switch a company to the 1-hour prompt cache ----------
// At the start and every few minutes, each Claude company's last week of sessions is measured (cache-offer.mjs).
// The answers are kept in portal-state.json (state.cacheOffer: id -> { answer, at }); the open offers go to the page.
state.cacheOffer ||= {};
const CACHE_CHECK_MINUTES = 5;
let cacheOffers = [];
// Whether the company pays per use: Bedrock, or an API key (one saved at sign-in, or a key helper in its settings).
function paysPerUse(client) {
  if (isBedrock(client) || gatewayFor(client, 'claude')) return true;
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  const account = read(isDefaultHome(client) ? path.join(os.homedir(), '.claude.json') : path.join(client.home, '.claude.json'));
  return !account.oauthAccount && !!(account.primaryApiKey || read(path.join(client.home, 'settings.json')).apiKeyHelper);
}
function cacheTallyFor(client, now = Date.now()) {
  const from = now - CACHE_OFFER.days * 864e5, lists = [];
  for (const [, f] of transcriptFiles(client)) {
    try { if (fs.statSync(f).mtimeMs < from) continue; } catch { continue; }
    lists.push(fileReplies(f));
  }
  return tally(lists, now);
}
async function checkCacheOffers() {
  const out = [];
  for (const c of CLIENTS) {
    if (!brandsOf(c).includes('claude')) continue; // Codex and Grok are left alone
    const t = cacheTallyFor(c);
    const kind = offerKind({ setting: c.promptCacheTtl, answer: state.cacheOffer[c.id], t });
    if (kind) out.push({ client: c.id, name: c.name, kind, replies: t.replies, misses: t.misses, share: Math.round(t.share * 100), paysPerUse: paysPerUse(c) });
    await new Promise((r) => setImmediate(r));
  }
  if (JSON.stringify(out) !== JSON.stringify(cacheOffers)) { cacheOffers = out; broadcast({ t: 'cache-offers', offers: out }); }
  return out;
}
setTimeout(() => checkCacheOffers().catch(() => {}), 20000);
setInterval(() => checkCacheOffers().catch(() => {}), CACHE_CHECK_MINUTES * 60000);

// ---------- the setup check: what each desk's sessions load at start, and the offer to slim it (#758, setup-size.mjs) ----------
// Every hour each Claude desk's start size is measured from its files alone; weekly, or when that jumped, the full
// check reads the last 60 days of transcripts too. state.setupCheck: id -> { last: the latest full check's numbers and
// folders, answer: { answer: 'later'|'started', at, slim, start, session } }. The full list of the latest check is
// kept here only (setupReports), and measured again when a session needs it after a restart.
state.setupCheck ||= {};
const SETUP_CHECK_MINUTES = 60;
const OWN_MCP = ['portal', 'playwright']; // Docket's own servers, in every session: not the desk's to slim
const setupReports = new Map();
let setupOffers = [], setupBusy = false;
const accountFile = (client) => (isDefaultHome(client) ? path.join(os.homedir(), '.claude.json') : path.join(client.home, '.claude.json'));
const setupDesks = () => CLIENTS.filter((c) => !c.remote && brandsOf(c).includes('claude'));
// Dollars a month per token in every session's start, from the desk's own calls of the last 30 days.
function setupCost(client, now = Date.now()) {
  const from = new Date(now - SETUP_OFFER.costDays * 864e5).toLocaleDateString('en-CA'), prices = loadPrices(PRICING_FILE);
  const rows = Object.entries(usage).filter(([, u]) => u.client === client.id).flatMap(([id, u]) => rowsOf(id, u)).filter((r) => r.Date >= from);
  return costPerToken(rows, (m) => modelRates(prices, m));
}
async function measureSetup(client, now = Date.now()) {
  const from = now - SETUP_OFFER.usedDays * 864e5, sessions = [];
  for (const [, f] of transcriptFiles(client)) {
    try { if (fs.statSync(f).mtimeMs < from) continue; } catch { continue; }
    sessions.push({ project: path.basename(path.dirname(f)), scan: await scanFile(f) });
    await new Promise((r) => setImmediate(r));
  }
  const use = measureUse(sessions, from, now);
  const folders = use.folders.length ? use.folders : [{ dir: client.folder, sessions: 1 }];
  const files = measureFiles({ home: client.home, config: accountFile(client), folders });
  const cost = setupCost(client, now);
  const report = { ...assess(files, use, { perToken: cost.perToken, own: OWN_MCP, now }), quick: quickStart(files), perToken: cost.perToken };
  setupReports.set(client.id, report);
  state.setupCheck[client.id] = { ...state.setupCheck[client.id], last: { at: now, start: report.start, slim: report.slim, monthly: report.monthly, slimMonthly: report.slimMonthly,
    sessions: report.sessions, quick: report.quick, heads: headlines(report), folders: folders.map((f) => ({ dir: f.dir, sessions: f.sessions, project: f.project })) } };
  saveState();
  logEvent('setup check', `${client.name}: start ${kTokens(report.start)} tokens, ${kTokens(report.slim)} could go (${dollars(report.slimMonthly)} a month), ${report.sessions} sessions`);
  return report;
}
// force: a desk id to check in full now, whatever the schedule says.
async function checkSetup({ force = '' } = {}) {
  if (setupBusy && !force) return setupOffers;
  while (setupBusy) await new Promise((r) => setTimeout(r, 500));
  setupBusy = true;
  try {
    for (const c of setupDesks()) {
      const rec = state.setupCheck[c.id] || {};
      let quick = 0;
      try { quick = quickStart(measureFiles({ home: c.home, config: accountFile(c), folders: rec.last?.folders?.length ? rec.last.folders : [{ dir: c.folder, sessions: 1 }] })); } catch {}
      if (force === c.id || checkDue({ last: rec.last, quick })) await measureSetup(c).catch((e) => console.log(`[setup check] ${c.id}: ${e.message}`));
      await new Promise((r) => setImmediate(r));
    }
  } finally { setupBusy = false; }
  const out = [];
  for (const c of setupDesks()) {
    const rec = state.setupCheck[c.id] || {};
    const kind = setupOfferKind({ report: rec.last, answer: rec.answer });
    if (kind) out.push({ client: c.id, name: c.name, kind, start: rec.last.start, slim: rec.last.slim, monthly: rec.last.monthly, slimMonthly: rec.last.slimMonthly, sessions: rec.last.sessions, heads: rec.last.heads || [] });
  }
  if (JSON.stringify(out) !== JSON.stringify(setupOffers)) { setupOffers = out; broadcast({ t: 'setup-offers', offers: out }); }
  return out;
}
// The session the card starts: on the desk, in its folder, with the shipped prompt and this check's numbers.
async function startSetupSession(client) {
  const report = setupReports.get(client.id) || await measureSetup(client);
  const template = optionalPrompt('setup-slim.md');
  if (!template) throw new Error('Docket is missing prompts/optional/setup-slim.md');
  const backup = path.join(client.home, 'setup-backup', new Date().toLocaleDateString('en-CA'));
  const brief = setupBrief(template, { desk: client.name, home: client.home, config: accountFile(client), folder: client.folder, backup, report, perToken: report.perToken });
  const s = startSession({ clientId: client.id, cwd: client.folder, title: `Slim ${client.name}'s session setup`.slice(0, 60) });
  // Set before the session's tools are listed, so it has setup_size.
  state.sessions[s.id].setupSlim = true;
  state.sessions[s.id].titleBy = 'you';
  state.setupCheck[client.id] = { ...state.setupCheck[client.id], answer: { answer: 'started', at: Date.now(), slim: report.slim, start: report.start, session: s.id } };
  saveState();
  sendToSession(s, { text: brief, attachments: [], context: "(From Docket: the user started this session from Docket's setup check card for this desk.)" });
  touchSession(client.id, s.id);
  logEvent('setup check', `${client.name}: slimming session ${sessionTag(s)}`);
  return s;
}
setTimeout(() => checkSetup().catch(() => {}), 90000);
setInterval(() => checkSetup().catch(() => {}), SETUP_CHECK_MINUTES * 60000);

// ---------- the start-cost check: the offer to turn splitting off where most children were short (#802, start-offer.mjs) ----------
// On the setup check's cadence, each Claude desk with splitting on is measured from its usage rows of the last week.
// state.startOffer: id -> { answer: 'later'|'applied', at, shortCost }; the open offers go to the page.
state.startOffer ||= {};
let startOffers = [];
function startTallyFor(client, now = Date.now()) {
  const from = new Date(now - (START_OFFER.days - 1) * 864e5).toLocaleDateString('en-CA');
  const rows = Object.entries(usage).filter(([, u]) => u.client === client.id).flatMap(([id, u]) => rowsOf(id, u)).filter((r) => (r.Brand || 'claude') === 'claude');
  return startTally(rows, { from, gearIds: gearsOf('claude').map((g) => g.id) });
}
function checkStartOffers() {
  const out = [];
  for (const c of setupDesks()) {
    const t = startTallyFor(c);
    const kind = startOfferKind({ tally: t, split: splitOn(c), answer: state.startOffer[c.id] });
    if (kind) out.push({ client: c.id, name: c.name, kind, ...t, ...startOfferWords(c.name, t) });
  }
  if (JSON.stringify(out) !== JSON.stringify(startOffers)) { startOffers = out; broadcast({ t: 'start-offers', offers: out }); }
  return out;
}
setTimeout(() => { try { checkStartOffers(); } catch {} }, 95000);
setInterval(() => { try { checkStartOffers(); } catch {} }, SETUP_CHECK_MINUTES * 60000);

// A company's Grok sessions, by the id their usage is filed under: the Docket session that ran them (state.sessions[id].grokIds),
// else Grok's own id for a session run outside Docket. Each holds its Grok folders and Grok's title for it.
function grokUsageSessions(client) {
  const out = new Map();
  if (!client?.grokHome) return out;
  const docketOf = new Map();
  for (const [id, rec] of Object.entries(state.sessions)) if (rec.client === client.id) for (const g of rec.grokIds || []) docketOf.set(g, id);
  for (const [gid, dir] of grokSessionDirs(client.grokHome)) {
    const key = docketOf.get(gid) || gid;
    const e = out.get(key) || { dirs: [], title: '' };
    e.dirs.push(dir); e.title ||= grokTitle(dir);
    out.set(key, e);
  }
  return out;
}
// Every session id this company has a usage log for now, Claude's and Grok's.
const usageLogIds = (client) => new Set([...transcriptFiles(client).keys(), ...grokUsageSessions(client).keys()]);
function refreshGrokUsage(client, id, entry = grokUsageSessions(client).get(id), title) {
  if (!entry?.dirs.length) return false;
  try {
    const sig = grokSignature(entry.dirs, PRICING_FILE);
    if (usage[id]?.sig === sig && (!title || usage[id].title === title)) return false;
    const name = title || live.get(id)?.title || state.sessions[id]?.title || entry.title;
    usage[id] = { ...usage[id], client: client.id, sig, title: name || usage[id]?.title, rows: grokRows(client.id, id, entry.dirs, PRICING_FILE, name, { connection: recordedVia(id) || connectionFor(client, 'grok') }) };
    saveUsageSoon();
    return true;
  } catch (e) { console.log(`[usage] grok ${id}: ${e.message}`); return false; }
}
function refreshUsage(client, id, file = sessionFile(client, id), title) {
  if (!file && (state.sessions[id]?.engine === 'grok' || live.get(id)?.engine === 'grok' || usage[id]?.rows?.[0]?.Brand === 'grok')) return refreshGrokUsage(client, id, undefined, title);
  if (!file && (state.sessions[id]?.engine === 'codex' || live.get(id)?.engine === 'codex')) return refreshCodexUsage(id, title);
  if (!file) return false;
  try {
    const billed = billedFor(client, id);
    // A session billed to a gateway: the gateway's model names are priced as the gears they stand for.
    if (billed.connection?.kind === 'gateway' || billed.bedrockConnection?.kind === 'gateway') billed.models = gearModelMap(client);
    const sig = sessionSignature(file, id, PRICING_FILE) + '|w' + (usage[id]?.waits?.length || 0) + (billed.models ? `|${JSON.stringify(billed.models)}` : '');
    if (usage[id]?.sig === sig && (!title || usage[id].title === title)) return false;
    usage[id] = { ...usage[id], client: client.id, sig, title: title || usage[id]?.title, rows: sessionRows(client.id, file, id, PRICING_FILE, title || live.get(id)?.title || state.sessions[id]?.title, billed, usage[id]?.waits || []) };
    saveUsageSoon();
    return true;
  } catch (e) { console.log(`[usage] ${id}: ${e.message}`); return false; }
}
// Codex sessions, from Codex's own files (codex-usage.mjs), whether run in Docket, the Codex app or a terminal.
// A company with its own Codex home ("codexHome") owns every session in it. The shared home (CODEX_HOME, else
// ~/.codex) is split by each session's working folder: the company or group whose folder holds it, the longest
// match winning, so a group's start folder also sets the group. A session in nobody's folder goes to the first company.
function codexHomes() {
  const homes = new Map(); // home -> owning client, or null for the shared one
  for (const c of CLIENTS) if (c.codexHome) homes.set(path.resolve(c.codexHome).toLowerCase(), { home: c.codexHome, client: c });
  const shared = defaultCodexHome();
  if (!homes.has(path.resolve(shared).toLowerCase())) homes.set(path.resolve(shared).toLowerCase(), { home: shared, client: null });
  return [...homes.values()];
}
function codexPlace(cwd) {
  let best = null;
  const consider = (client, groupId, folder) => {
    if (!folder || !cwd || !samePathOrInside(cwd, folder)) return;
    const len = path.resolve(folder).length;
    if (!best || len > best.len) best = { client, groupId, len };
  };
  for (const c of CLIENTS) { consider(c, null, c.folder); for (const g of groupsOf(c.id)) consider(c, g.id, g.folder); }
  return best || { client: CLIENTS[0], groupId: null };
}
const codexSeen = new Set(); // the Codex sessions whose files were there at the last look (and the Docket sessions that ran them)
let codexSwept = false;
// A Codex session Docket ran is filed under Docket's own id (state.sessions[id].codexIds, as for Grok), in the
// Docket session's company, and listed and grouped like any Docket session (docket: true). The rest are handled as before.
function codexDocketIds() {
  const out = new Map();
  for (const [id, rec] of Object.entries(state.sessions)) for (const c of rec.codexIds || []) out.set(c, id);
  return out;
}
// only: one Docket session's entry, read from its company's Codex home alone (where Docket ran it).
function codexUsageEntries(only) {
  const docketOf = codexDocketIds(), out = new Map();
  const mine = only && clientById(state.sessions[only]?.client)?.codexHome;
  for (const { home, client: owner } of only ? (mine ? [{ home: mine, client: clientById(state.sessions[only].client) }] : []) : codexHomes()) {
    if (!fs.existsSync(path.join(home, 'sessions'))) continue;
    // Who the home is billed to; the shared home is no one desk's, so a sign-in it cannot read is its own line.
    const homeConn = connectionFor(owner || { id: 'shared-codex', name: 'Shared Codex' }, 'codex', false, home);
    for (const s of codexSessions(home).values()) {
      const did = docketOf.get(s.id), rec = did && state.sessions[did];
      const key = did || s.id;
      if (only && key !== only) continue;
      const place = rec && clientById(rec.client) ? { client: clientById(rec.client), groupId: null } : owner ? { client: owner, groupId: null } : codexPlace(s.cwd);
      if (!place.client) continue;
      const e = out.get(key) || { place, docket: !!did, billed: { connection: (did && recordedVia(did)) || homeConn }, threads: [], codexIds: [] };
      e.threads.push(s); e.codexIds.push(s.id);
      out.set(key, e);
    }
  }
  return out;
}
function storeCodexUsage(key, e, title) {
  const name = title || live.get(key)?.title || state.sessions[key]?.title || e.threads.map((t) => t.title).find(Boolean) || '';
  const sig = `codex|t2|${e.threads.map((t) => t.sig).join(';')}|${pricesVersionOf()}|${e.place.client.id}|${e.place.groupId || ''}|${name}|w${usage[key]?.waits?.length || 0}`;
  // A sweep before Docket knew the thread was its own filed it under Codex's id: that record moves here, not counted twice.
  let moved = false;
  for (const c of e.codexIds) if (c !== key && usage[c]) { delete usage[c]; moved = true; }
  if (usage[key]?.sig === sig) return moved;
  try {
    usage[key] = { ...usage[key], client: e.place.client.id, brand: 'codex', ...(e.docket ? { docket: true } : {}), groupId: e.place.groupId, sig, title: name || usage[key]?.title,
      rows: e.threads.flatMap((t) => codexRows(e.place.client.id, { ...t, id: key }, PRICING_FILE, name, e.billed, usage[key]?.waits || [])) };
    return true;
  } catch (err) { console.log(`[usage] codex ${key}: ${err.message}`); return false; }
}
function sweepCodex() {
  let changed = 0;
  codexSeen.clear(); codexSwept = true;
  for (const [key, e] of codexUsageEntries()) {
    codexSeen.add(key); for (const c of e.codexIds) codexSeen.add(c);
    if (storeCodexUsage(key, e)) changed++;
  }
  if (changed) saveUsageSoon();
  return changed;
}
// One Docket-run Codex session brought up to date, after its turn.
function refreshCodexUsage(id, title) {
  const e = codexUsageEntries(id).get(id);
  if (!e) return false;
  codexSeen.add(id);
  const changed = storeCodexUsage(id, e, title);
  if (changed) saveUsageSoon();
  return changed;
}
const outsideCodex = (u) => u?.brand === 'codex' && !u.docket; // a Codex session Docket did not run: not in Docket's list
const pricesVersionOf = () => { try { return fs.statSync(PRICING_FILE).mtimeMs; } catch { return 0; } };
// Everything the Usage page (usage.html) draws from: every row, each with its session's family (the top
// session it was started from), its group, and whether the session was deleted or its log removed;
// plus the companies, their groups and the models' friendly names.
function usageReport() {
  const prices = loadPrices(PRICING_FILE);
  const logs = new Map(CLIENTS.map((c) => [c.id, usageLogIds(c)]));
  const parentFor = (client, id) => (outsideCodex(usage[id]) ? null : usage[id]?.deleted ? usage[id].parentId || null : parentOf(client, id));
  const titleOf = (id) => live.get(id)?.title || usage[id]?.title || state.sessions[id]?.title || usage[id]?.rows?.[0]?.Title || 'Untitled';
  const rows = [], models = {}, shift = {};
  for (const [id, u] of Object.entries(usage)) {
    const client = clientById(u.client);
    const own = client ? rowsOf(id, u) : [];
    if (!own.length) continue;
    // A Shift session: its record says so, and keeps its gear and history, so a deleted one still counts.
    const rec = state.sessions[id];
    if (shiftOf(rec)) u.shift = shiftOf(rec);
    const gearIds = u.shift && gearsOf(rec?.engine || u.brand || own[0].Brand).map((g) => g.id);
    if (gearIds) shift[id] = sessionShiftFacts(own, gearIds, u.shift.shifts, u.shift.gear);
    let root = id;
    for (let p = parentFor(client, id), seen = new Set([id]); p && !seen.has(p); p = parentFor(client, p)) { seen.add(p); root = p; }
    const gone = u.deleted ? 'deleted' : !u.rows?.length || (u.brand === 'codex' ? codexSeen.has(id) || !codexSwept : logs.get(client.id)?.has(id)) ? '' : 'log removed';
    const gid = (u.deleted || outsideCodex(u) ? u.groupId : effectiveGroup(client, id)) || '';
    const extra = { Title: titleOf(id), GroupId: gid, Family: root, FamilyTitle: titleOf(root), Gone: gone };
    for (const r of own) {
      if (r.Model) models[r.Model] ||= modelName(prices, r.Model);
      const top = gearIds && topGearCost(r, gearIds, modelRates(prices, gearIds.at(-1), Date.parse(r.Date + 'T12:00:00')));
      rows.push({ ...withGroup(r), ...extra, ...(top ? { TopGearCost: top.cost, ...(top.priced ? {} : { TopGearUnpriced: 1 }) } : {}) });
    }
  }
  return {
    rows,
    shift, // Shift sessions: id -> { shifted, shifts, reachedTop }
    topGears: Object.fromEntries(Object.entries(GEARS).map(([b, g]) => [b, g.at(-1).name])),
    shortTurns: SHORT_TURNS, // a child with this many turns or fewer is short (the Start cost card)
    connections: usageConnections(rows),
    models,
    baseline: modelRates(prices, prices.routingBaseline || 'claude-opus'),
    compactionEstimate: prices.compactionEstimate?.note || '',
    bigOutput: bigOutputUse(), // the big-output hook's cuts and reads back, per day and desk (#748)
    companies: CLIENTS.map((c) => ({ id: c.id, name: c.name, color: c.color || null, groups: groupsOf(c.id).map((g) => ({ id: g.id, name: g.name, color: g.color })) })),
  };
}
// The billing connections in the rows, each with what today's setup says of it (its label, kind and detail, every
// desk's detail when several desks reach it differently), and the brands and desks whose rows are on it.
function usageConnections(rows) {
  const today = new Map();
  for (const c of CLIENTS) for (const x of deskConnections(c)) {
    const t = today.get(x.key) || { ...x, details: new Set() };
    if (x.detail) t.details.add(x.detail);
    today.set(x.key, t);
  }
  const out = new Map();
  for (const r of rows) {
    if (!r.Connection) continue;
    let e = out.get(r.Connection);
    if (!e) {
      const t = today.get(r.Connection);
      e = { key: r.Connection, label: t?.label || r.BilledProfile, kind: t?.kind || kindOfKey(r.Connection), detail: t ? [...t.details].join('; ') : '',
        exact: t ? t.exact : !/^(aws-profile|unknown):/.test(r.Connection), brands: new Set(), desks: new Set() };
      out.set(r.Connection, e);
    }
    e.brands.add(r.Brand || 'claude'); e.desks.add(r.Client);
  }
  return [...out.values()].map((e) => ({ ...e, brands: [...e.brands], desks: [...e.desks] }));
}
// A session's cost, agent seconds and typing seconds from Docket's own record (data/usage-index.json), which stays
// after its log is gone: the same rows the Usage page reads (rowsOf adds the typing time), so the numbers match.
// A session that still has a log is brought up to date first, so a reply that just finished counts.
function recordedCost(client, id, refresh = true) {
  if (refresh) refreshUsage(client, id);
  const out = { cost: 0, agent: 0, user: 0 };
  if (usage[id]) for (const r of rowsOf(id, usage[id])) { out.cost += r.Cost || 0; out.agent += r.AgentSeconds || 0; out.user += r.UserSeconds || 0; }
  return out;
}
const addTimes = (xs) => xs.reduce((a, x) => ({ cost: a.cost + x.cost, agent: a.agent + x.agent, user: a.user + x.user }), { cost: 0, agent: 0, user: 0 });
// Sessions of this company that Docket has a cost record for but no log any more: deleted in Docket
// (they keep the group and parent they had then), or their log removed by Claude Code itself.
// `known` holds the ids still listed, so nothing is counted twice.
function goneSessions(client, known) {
  const out = [];
  let files = null;
  for (const [id, u] of Object.entries(usage)) {
    if (u.client !== client.id || known.has(id) || outsideCodex(u)) continue; // Codex sessions run outside Docket are not in its list
    if (!u.rows?.length) continue; // only typing or wait time so far: a new session, not a gone one
    if (u.brand === 'codex' && !u.deleted && (codexSeen.has(id) || !codexSwept)) continue; // its Codex files are still there
    if (!u.deleted) { files ||= usageLogIds(client); if (files.has(id)) continue; }
    out.push({ id, title: u.title || u.rows?.[0]?.Title || 'Untitled', deleted: !!u.deleted,
      groupId: u.deleted ? u.groupId || null : effectiveGroup(client, id),
      parentId: u.deleted ? u.parentId || null : parentOf(client, id) });
  }
  return out;
}
// A parent session's family: every session started from it, all the way down, with each one's
// cost, using the same parent links the session list nests by (portal and desktop app).
// ---------- groups: one per session, per client; children inherit their parent's group ----------
// state.groups[client] is the ordered list; state.sessions[id].groupId is a session's own choice:
// a group id, '' for "no group", or absent to follow its parent.
const GROUP_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d', '#7c3aed', '#ea580c'];
state.groups ||= {};
const groupsOf = (clientId) => (state.groups[clientId] ||= []);
const groupById = (clientId, gid) => groupsOf(clientId).find((g) => g.id === gid) || null;
// A group's start folder: where a session started in that group works. Blank means the company's folder.
// Throws a plain message when the folder is not there, so a start fails here and not in the runner.
function checkFolder(folder) {
  const dir = path.resolve(String(folder));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('That folder does not exist: ' + dir);
  return dir;
}
const groupFolder = (b) => { const f = String(b.folder || '').trim(); return f ? checkFolder(f) : ''; };
// A session's parent: the portal's own record, then the desktop app's. '' means "none" (its parent
// was deleted), which also hides any desktop app link.
const parentOf = (client, id) => { const own = state.sessions[id]?.parentId; return own === '' ? null : own || desktopParents(client).get(id) || null; };
// The desk's sessions the list can show: rows (its saved conversations, history), the running ones, and stopped
// sessions of another brand that only Docket's own record knows (as savedRow finds them).
function deskIds(client, rows) {
  const ids = new Set(rows.filter((r) => !r.editFor).map((r) => r.id));
  for (const s of live.values()) if (s.client === client.id && !state.sessions[s.id]?.editFor) ids.add(s.id);
  for (const [id, rec] of Object.entries(state.sessions)) if (rec.client === client.id && rec.engine && rec.engine !== 'claude' && !rec.editFor) ids.add(id);
  for (const id of ids) if (wasDeleted(id)) ids.delete(id);
  return ids;
}
// A desk's family links as the session list nests them (#717): open = shown in the list (running, or not archived);
// openParent = the nearest open session above one; family(root) = every open session below root. With rows (history),
// only sessions the desk has count; without, any id not archived or deleted does (kidsOf, which runs on every push).
function familyView(client, rows) {
  const ids = rows ? deskIds(client, rows) : null;
  const open = (id) => (!ids || ids.has(id)) && !wasDeleted(id) && (live.has(id) || !isArchived(client, id));
  const up = (id) => parentOf(client, id);
  return { ids, open, openParent: (id) => openParent(id, up, open), family: (root) => openFamily(root, ids || [], up, open) };
}
function effectiveGroup(client, id) {
  const seen = new Set();
  for (let cur = id; cur && !seen.has(cur); cur = parentOf(client, cur)) {
    seen.add(cur);
    const own = state.sessions[cur]?.groupId;
    if (own !== undefined) return own && groupById(client.id, own) ? own : null;
  }
  return null;
}
// Where session rows were dragged to in the list's Natural order: per company, session ids top to bottom.
// Only the dragged order is kept; sessions not in it sit where their start time puts them.
state.places ||= {};
// What keeps a read, idle session in the ✦ Needs attention list (index.html, keepSince): when you last touched it
// (sent it a message or started it; opening it does not count), and your pins. Per desk: session id -> time, and pinned ids.
// Touches older than TOUCH_DAYS are let go; archiving a session takes its pin away, deleting it takes both.
state.touched ||= {};
state.pins ||= {};
const TOUCH_DAYS = 60;
const keepChanged = (clientId) => { saveState(); broadcast({ t: 'keep', client: clientId }); };
function touchSession(clientId, id) {
  if (!clientId || !id) return;
  const now = Date.now(), all = state.touched[clientId] ||= {};
  all[id] = now;
  for (const [k, at] of Object.entries(all)) if (now - at > TOUCH_DAYS * 864e5) delete all[k];
  keepChanged(clientId);
}
function setPinned(clientId, id, pinned) {
  const had = (state.pins[clientId] || []).includes(id);
  if (had === !!pinned) return;
  state.pins[clientId] = pinned ? [...(state.pins[clientId] || []), id].slice(-1000) : state.pins[clientId].filter((x) => x !== id);
  keepChanged(clientId);
}
const keepOf = (clientId) => ({ touched: state.touched[clientId] || {}, pins: state.pins[clientId] || [] });
// ---------- filling in touch times
// Touches were only recorded from 1.123.0 on, so once per desk they are filled in from the saved conversations (#617):
// for each session not archived, the last message the person typed (touches.mjs, lastTyped), the later of that and
// any touch already recorded. In the background after startup, one file at a time; state.touchesFilled marks a desk done.
state.touchesFilled ||= {};
async function fillTouches(client) {
  const now = Date.now(), found = {};
  const files = [...transcriptFiles(client), ...keptChatFiles(client)];
  for (const [id, file] of files) {
    if (wasDeleted(id) || isArchived(client, id)) continue;
    try {
      if (now - (await fs.promises.stat(file)).mtimeMs > TOUCH_DAYS * 864e5) continue; // nothing in it is recent enough
      const at = lastTyped((await fs.promises.readFile(file, 'utf8')).split('\n'), { scheduled: !!state.sessions[id]?.scheduleId });
      if (at) found[id] = at;
    } catch {}
  }
  state.touched[client.id] = mergeTouches(state.touched[client.id], found, Date.now(), TOUCH_DAYS);
  state.touchesFilled[client.id] = true;
  logEvent(`touch times filled in: ${client.id}`, `${Object.keys(found).length} of ${files.length} sessions`);
  keepChanged(client.id);
}
async function fillAllTouches() {
  for (const c of CLIENTS) if (!state.touchesFilled[c.id]) await fillTouches(c).catch((e) => logEvent(`filling in touch times failed: ${c.id}`, e.message));
}
// end of filling in touch times
function groupChanged(clientId) { historyCache.delete(clientId); saveState(); saveUsageSoon(); broadcast({ t: 'groups', client: clientId }); }
async function membersOf(client, gid) {
  const rows = [...(await history(client)), ...[...live.values()].filter((x) => x.client === client.id).map(summary)];
  return [...new Map(rows.map((r) => [r.id, r])).values()].filter((r) => effectiveGroup(client, r.id) === gid);
}
// Auto Group: a one-off request to a fast model that reads a session (title, first message, a slice of
// the start and the latest reply) and the company's group names, and suggests where it belongs.
// Runs with the company's sign-in, saves no conversation, and never touches the session itself.
const AUTO_GROUP_MODEL = 'claude-haiku-5-5';
// The session whose own choice sets this one's group: itself if it has one, else up its parents to the top.
function groupOwner(client, id) {
  const seen = new Set([id]); let cur = id;
  for (let p; state.sessions[cur]?.groupId === undefined && (p = parentOf(client, cur)) && !seen.has(p);) { seen.add(p); cur = p; }
  return cur;
}
const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
async function suggestGroup(client, id) {
  const s = live.get(id);
  const events = s ? s.events : await loadTranscript(client, id).catch(() => []);
  const title = s?.title || (await history(client)).find((r) => r.id === id)?.title || state.sessions[id]?.title || 'Untitled';
  const says = events.filter((e) => (e.k === 'user' || e.k === 'text') && e.text);
  const first = says.find((e) => e.k === 'user');
  const start = says.slice(says.indexOf(first) + 1, says.indexOf(first) + 3).map((e) => clip(e.text, 400));
  const latest = [...says].reverse().find((e) => e.k === 'text');
  const groups = groupsOf(client.id).filter((g) => !g.archived);
  const prompt = [
    `Existing groups: ${groups.length ? groups.map((g) => JSON.stringify(g.name)).join(', ') : '(none yet)'}`,
    '', `Session title: ${title}`,
    `First message: ${clip(first?.text, 1500) || '(none)'}`,
    start.length ? `Start of the conversation:\n${start.join('\n')}` : '',
    latest && latest !== says[says.indexOf(first) + 1] ? `Latest reply: ${clip(latest.text, 800)}` : '',
  ].filter(Boolean).join('\n');
  const system = 'You sort work sessions into groups (a project or area of work). Answer with JSON only, no other text: '
    + '{"best": "<existing group name or null>", "others": ["<up to two other existing group names that could also fit>"], "newName": "<a short new group name, 1 to 3 words>"}. '
    + 'Use exact existing names. Set best to null when no existing group clearly fits. Always give newName, named for the project or area, not the single task.';
  const q = query({ prompt, options: {
    env: envFor(client), ...claudeSettings(client), cwd: client.folder, model: modelFor(client, 'claude', AUTO_GROUP_MODEL), systemPrompt: system,
    tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [], maxTurns: 1, persistSession: false,
  } });
  let text = '', cost = 0;
  try {
    for await (const m of q) {
      if (m.type === 'result') { cost = m.total_cost_usd || 0; if (m.subtype !== 'success') throw new Error(m.errors?.[0] || 'The reading did not finish'); text = m.result || ''; }
    }
  } finally { q.close(); }
  const j = JSON.parse((text.match(/\{[\s\S]*\}/) || [])[0] || 'null');
  if (!j) throw new Error('The answer could not be read');
  const find = (n) => n && groups.find((g) => g.name.toLowerCase() === String(n).trim().toLowerCase());
  const best = find(j.best);
  const others = [...new Set((Array.isArray(j.others) ? j.others : []).map(find).filter((g) => g && g !== best))].slice(0, 2);
  let newName = clip(j.newName, 40).replace(/^["']|["']$/g, '');
  if (find(newName)) newName = '';
  logEvent('auto-group', `${id} best=${best?.name || '-'} new=${newName || '-'} $${cost.toFixed(4)}`);
  return { id, best: best ? { id: best.id, name: best.name } : null, others: others.map((g) => ({ id: g.id, name: g.name })), newName, cost };
}
// The folder a path really is: a junction or shortcut folder counts as its target.
const realKey = (p) => { let r; try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); } return r.toLowerCase(); };
const samePath = (a, b) => !!a && !!b && realKey(a) === realKey(b);
// A group's cost: each member session's own cost (children are members too, so nothing counts twice).
async function groupCost(client, gid) {
  const g = groupById(client.id, gid);
  if (!g) return null;
  const sessions = [];
  const listed = (await membersOf(client, gid)).filter((m) => !wasDeleted(m.id));
  for (const m of listed) {
    sessions.push({ id: m.id, title: m.title || 'Untitled', ...recordedCost(client, m.id), archived: !!m.archived });
    await new Promise((r) => setImmediate(r));
  }
  const known = new Set([...(await history(client)), ...live.values()].map((r) => r.id).filter((x) => !wasDeleted(x)));
  for (const x of goneSessions(client, known)) if (x.groupId === gid) sessions.push({ id: x.id, title: x.title, ...recordedCost(client, x.id, false), gone: x.deleted ? 'deleted' : 'log removed' });
  const t = addTimes(sessions);
  return { id: g.id, name: g.name, color: g.color, total: t.cost, agent: t.agent, user: t.user, sessions: sessions.sort((a, b) => b.cost - a.cost) };
}
// The top of a session's family (itself if it has no parent).
function familyRoot(client, id) {
  const seen = new Set([id]);
  let cur = id;
  for (let p = parentOf(client, cur); p && !seen.has(p); p = parentOf(client, p)) { seen.add(p); cur = p; }
  return cur;
}

async function familyCost(client, id) {
  const rows = [...(await history(client)), ...[...live.values()].filter((s) => s.client === client.id).map(summary)];
  const byId = new Map(rows.filter((r) => !wasDeleted(r.id)).map((r) => [r.id, r]));
  for (const x of goneSessions(client, new Set(byId.keys()))) byId.set(x.id, { ...x, gone: x.deleted ? 'deleted' : 'log removed' });
  const kids = new Map();
  for (const r of byId.values()) if (r.parentId && r.parentId !== r.id) (kids.get(r.parentId) || kids.set(r.parentId, []).get(r.parentId)).push(r);
  const members = [], seen = new Set([id]);
  const walk = (pid, depth) => { for (const k of kids.get(pid) || []) if (!seen.has(k.id)) { seen.add(k.id); members.push({ ...k, depth }); walk(k.id, depth + 1); } };
  walk(id, 1);
  if (!members.length) return null;
  const children = [];
  for (const m of members) {
    children.push({ id: m.id, title: m.title || 'Untitled', depth: m.depth, ...recordedCost(client, m.id, !m.gone), archived: !!m.archived, oneShot: !!m.oneShot, ...(m.gone ? { gone: m.gone } : {}) });
    await new Promise((r) => setImmediate(r));
  }
  const own = recordedCost(client, id), sum = addTimes(children), all = addTimes([own, sum]);
  return { own: own.cost, ownAgent: own.agent, ownUser: own.user, childTotal: sum.cost, childAgent: sum.agent, childUser: sum.user,
    total: all.cost, agent: all.agent, user: all.user, children: children.sort((a, b) => b.cost - a.cost) };
}

// Look at every session of every client, a few at a time so the portal stays responsive.
let sweeping = false;
async function sweepUsage() {
  if (sweeping) return; sweeping = true;
  let changed = 0;
  try {
    for (const client of CLIENTS) {
      // the titles the session list shows (the desktop app keeps them outside the log)
      const titles = new Map((await history(client).catch(() => [])).map((r) => [r.id, r.title]));
      for (const [id, f] of transcriptFiles(client)) {
        if (refreshUsage(client, id, f, titles.get(id))) changed++;
        await new Promise((r) => setImmediate(r));
      }
      for (const [id, entry] of grokUsageSessions(client)) {
        if (refreshGrokUsage(client, id, entry, titles.get(id))) changed++;
        await new Promise((r) => setImmediate(r));
      }
    }
    changed += sweepCodex();
  } finally { sweeping = false; }
  if (changed) console.log(`[usage] updated ${changed} session(s) in ${USAGE_CSV}`);
}
setTimeout(sweepUsage, 15000);            // shortly after start-up
setInterval(sweepUsage, 60 * 60 * 1000);  // and hourly, for sessions run in the desktop app or a terminal

// ---------- one remembered browser per client ----------
// The person signs in once in a visible window the portal opens for that client;
// the portal saves those sign-ins (cookies and site storage) to a file. Every
// session gets its own invisible Playwright browser that starts from that file,
// so sessions share sign-ins without fighting over tabs. "Forget" deletes it all.
const BROWSER_ROOT = path.join(ROOT, 'browser');
const PLAYWRIGHT_MCP = path.join(ROOT, 'node_modules', '@playwright', 'mcp', 'cli.js');
const browserDir = (client) => path.join(BROWSER_ROOT, client.id);
const storageFile = (client) => path.join(browserDir(client), 'sign-ins.json');
const signInWindows = new Map(); // clientId -> { context, timer }

// A cookie domain or host name as the site it belongs to: www.google.com and .google.com are both google.com.
const siteOf = (host) => host.replace(/^\./, '').split('.').slice(-2).join('.');

function browserStatus(client) {
  let sites = [];
  try {
    const st = JSON.parse(fs.readFileSync(storageFile(client), 'utf8'));
    const domains = [...(st.cookies || []).map((c) => c.domain), ...(st.origins || []).map((o) => new URL(o.origin).hostname)];
    sites = [...new Set(domains.map(siteOf))].sort();
  } catch {}
  return { sites, open: signInWindows.has(client.id) };
}

// Save the window's sign-ins. `full` asks Playwright for everything, which opens a
// short-lived tab per site to read its storage: only on Done, never while the person
// is typing (those tabs flash and take the focus). The quick save reads cookies and
// the storage of pages already open, so nothing new appears in the window.
// Both keep the site storage saved earlier for sites not visited this time.
function saveSignIns(client, { full = false } = {}) {
  const w = signInWindows.get(client.id);
  if (!w) return Promise.resolve();
  w.saving = (w.saving || Promise.resolve()).then(async () => {
    let state;
    if (full) state = await w.context.storageState().catch(() => null);
    if (!state) {
      const cookies = await w.context.cookies().catch(() => null);
      if (!cookies) return; // the window is already gone: keep the last save
      const origins = [];
      for (const page of w.context.pages()) for (const frame of page.frames()) {
        const o = await frame.evaluate(() => ({ origin: location.origin, localStorage: Object.keys(localStorage).map((name) => ({ name, value: localStorage.getItem(name) })) })).catch(() => null);
        if (o && /^https?:/.test(o.origin)) origins.push(o);
      }
      state = { cookies, origins };
    }
    if (signInWindows.get(client.id) !== w) return; // closed or forgotten meanwhile
    const file = storageFile(client);
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const byOrigin = new Map((saved.origins || []).map((o) => [o.origin, o]));
    for (const o of state.origins || []) byOrigin.set(o.origin, o);
    fs.mkdirSync(browserDir(client), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ ...state, origins: [...byOrigin.values()] }, null, 2));
    fs.renameSync(file + '.tmp', file);
  }).catch(() => {});
  return w.saving;
}

async function openSignInWindow(client, url) {
  if (signInWindows.has(client.id)) return;
  const options = {
    headless: false, viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
  };
  let context;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { context = await chromium.launchPersistentContext(path.join(browserDir(client), 'profile'), { ...options, ...(channel ? { channel } : {}) }); break; } catch {}
  }
  if (!context) throw new Error('Could not open a browser window');
  // Quick saves every few seconds, after each page loads, and whenever a tab closes, so closing the window
  // with its X (which gives no warning before the browser is gone) keeps the sign-ins.
  const w = { context, timer: setInterval(() => saveSignIns(client), 5000) };
  signInWindows.set(client.id, w);
  const watch = (p) => { p.on('load', () => saveSignIns(client)); p.on('close', () => saveSignIns(client)); };
  context.pages().forEach(watch);
  context.on('page', watch);
  context.on('close', () => {
    clearInterval(w.timer);
    signInWindows.delete(client.id);
    broadcast({ t: 'browser', client: client.id, ...browserStatus(client) });
    signInsSaved(client);
  });
  const page = context.pages()[0] || await context.newPage();
  if (url) await page.goto(url).catch(() => {});
  broadcast({ t: 'browser', client: client.id, ...browserStatus(client) });
}

// A session waiting on a private browser sign-in (needs_signin, #678). The page blinks the 🌐 while that session is
// the one open; it stops when the session says it is connected, or when the sign-in window closes (Done or its X),
// since that is when the sign-ins are saved. The need is kept in the session's saved record, not on the live session,
// so it lasts through an app restart, rest and reloads, and a saved session still blinks when opened (#775).
const signinNeeds = (clientId) => Object.fromEntries(Object.entries(state.sessions)
  .filter(([, r]) => r.client === clientId && r.needsSignin).map(([id, r]) => [id, r.needsSignin]));
function setSigninNeed(id, clientId, need, why) {
  const rec = state.sessions[id];
  if (!rec?.needsSignin && !need) return;
  if (need) (state.sessions[id] ||= { client: clientId }).needsSignin = need; else delete rec.needsSignin;
  saveState();
  const s = live.get(id);
  logEvent(`sign-in need ${need ? 'on' : 'off'}: ${sessionTag(s || { id, title: rec?.title })}`, need ? `${need.site}${need.url ? ' ' + need.url : ''}` : why);
  broadcast({ t: 'signin-needs', client: clientId, needs: signinNeeds(clientId) });
  if (s) pushSession(s);
}
function signInsSaved(client) {
  for (const [id, need] of Object.entries(signinNeeds(client.id))) {
    const s = live.get(id);
    if (s) addEvent(s, { k: 'note', text: `Private browser sign-ins saved (this session asked for ${need.site}).` });
    setSigninNeed(id, client.id, null, 'the sign-in window closed and its sign-ins were saved');
  }
}

async function closeSignInWindow(client) {
  const w = signInWindows.get(client.id);
  if (!w) return;
  clearInterval(w.timer);
  await saveSignIns(client, { full: true });
  await w.context.close().catch(() => {});
}

async function forgetBrowser(client) {
  const w = signInWindows.get(client.id);
  if (w) { clearInterval(w.timer); await w.context.close().catch(() => {}); }
  fs.rmSync(browserDir(client), { recursive: true, force: true });
  keepStorageFile(client); // the desk's server reads it for each session that starts browsing
  broadcast({ t: 'browser', client: client.id, ...browserStatus(client) });
}

// Forget one site: its cookies and site storage go from the saved file and from the sign-in window's
// own profile, which holds them too and would put them back on its next save. With the window
// closed, the profile is opened unseen for a moment to clear them. Sessions already running keep
// the copy they started with until they end.
async function clearSiteIn(context, site, origins) {
  await context.clearCookies({ domain: new RegExp(`(^|\\.)${site.replace(/\./g, '\\.')}$`) }).catch(() => {});
  if (!origins.length) return;
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page).catch(() => null);
  for (const origin of origins) await cdp?.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
  await cdp?.detach().catch(() => {});
}

async function forgetSite(client, site) {
  let st = null;
  try { st = JSON.parse(fs.readFileSync(storageFile(client), 'utf8')); } catch {}
  const origins = (st?.origins || []).map((o) => o.origin).filter((o) => siteOf(new URL(o).hostname) === site);
  const w = signInWindows.get(client.id);
  const profile = path.join(browserDir(client), 'profile');
  if (w) await clearSiteIn(w.context, site, origins);
  else if (fs.existsSync(profile)) {
    for (const channel of ['chrome', 'msedge', undefined]) {
      let context;
      try { context = await chromium.launchPersistentContext(profile, { headless: true, ...(channel ? { channel } : {}) }); } catch { continue; }
      await clearSiteIn(context, site, origins);
      await context.close().catch(() => {});
      break;
    }
  }
  // Read again: the open window may have saved while its copy was being cleared.
  try { st = JSON.parse(fs.readFileSync(storageFile(client), 'utf8')); } catch { st = null; }
  if (st) {
    st.cookies = (st.cookies || []).filter((c) => siteOf(c.domain) !== site);
    st.origins = (st.origins || []).filter((o) => siteOf(new URL(o.origin).hostname) !== site);
    fs.writeFileSync(storageFile(client), JSON.stringify(st, null, 2));
  }
  broadcast({ t: 'browser', client: client.id, ...browserStatus(client) });
}

// The Playwright tool server of a session that cannot use its desk's (below): its own process and invisible browser,
// started from the client's saved sign-ins.
function browserTools(client, sessionId) {
  const st = storageFile(client);
  return {
    type: 'stdio',
    command: process.execPath,
    args: [PLAYWRIGHT_MCP, '--isolated', '--headless',
      ...(fs.existsSync(st) ? ['--storage-state', st] : []),
      '--output-dir', path.join(UPLOADS, sessionId, 'browser')],
  };
}

// One Playwright tool server per desk, kept running by the runner, that the desk's sessions connect to over HTTP
// (desk-browser.mjs, #757). Codex sessions keep their own: Codex may not tell an MCP server its folder.
const PLAYWRIGHT_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(PLAYWRIGHT_MCP), 'package.json'), 'utf8')).version; } catch { return ''; } })();
const deskBrowserOut = (client) => path.resolve(DATA_DIR, 'browser-output', client.id); // whole: it is also the server's folder
const deskBrowserStarts = new Map(); // server name -> its start under way, so sessions starting together share it
const DESK_BROWSER_GRACE_MS = 10 * 60_000; // a server this new is kept even with no session on it yet: one may be starting
// The server reads the sign-ins file for each session that starts browsing, so it has to be there, empty if need be.
function keepStorageFile(client) {
  const st = storageFile(client);
  if (fs.existsSync(st)) return st;
  fs.mkdirSync(browserDir(client), { recursive: true });
  fs.writeFileSync(st, JSON.stringify({ cookies: [], origins: [] }));
  return st;
}
const browserAnswers = (port) => fetch(mcpUrl(port), { signal: AbortSignal.timeout(5000) }).then(() => true, () => false);
// Whether the server on port answers within ms. A busy app (sessions starting together) can miss one answer, and
// starting a new server in place of one that runs ends the browsing of the sessions on it, so it asks until then.
async function browserAnswersWithin(port, ms) {
  for (const end = Date.now() + ms; ;) {
    if (await browserAnswers(port)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}
// The desk's server, started if it is not running. Its name changes with its command line or Playwright's version,
// so a session already on an older one keeps it (stopOldDeskBrowsers stops it once nothing uses it).
async function deskBrowser(client) {
  const args = deskServerArgs({ cli: PLAYWRIGHT_MCP, storage: keepStorageFile(client), outDir: deskBrowserOut(client) });
  const name = `playwright-${client.id}-${createHash('sha1').update(JSON.stringify([PLAYWRIGHT_VERSION, args])).digest('hex').slice(0, 10)}`;
  if (deskBrowserStarts.has(name)) return deskBrowserStarts.get(name);
  const started = (async () => {
    const have = (await runnerCall('/helpers')).find((h) => h.name === name);
    if (have && await browserAnswersWithin(have.meta.port, 20000)) return { name, url: mcpUrl(have.meta.port) };
    if (have) logEvent('starting the private browser server again', `${name} did not answer on port ${have.meta.port}`);
    fs.mkdirSync(deskBrowserOut(client), { recursive: true });
    const port = await freePort();
    await runnerCall('/helpers', { name, command: process.execPath, args: [...args, '--port', String(port)], cwd: deskBrowserOut(client), meta: { port, desk: client.id, at: Date.now() } });
    if (!await browserAnswersWithin(port, 10000)) throw new Error(`it did not answer on port ${port}`); // the session waits for it
    logEvent('started the private browser server', `${client.id} on port ${port}`);
    return { name, url: mcpUrl(port) };
  })().finally(() => deskBrowserStarts.delete(name));
  deskBrowserStarts.set(name, started);
  return started;
}
// The desk's server in place of the session's own, in the options it starts with; its name, or '' when it cannot
// be had (an older runner, or it did not start), and the session keeps its own.
async function useDeskBrowser(s, client, options) {
  if (s.engine === 'codex' || !client) return '';
  let desk;
  try { desk = await deskBrowser(client); }
  catch (err) { logEvent('private browser server not used', `${client.id}: ${err.message}`); return ''; }
  if (s.engine === 'grok') options.mcpHttp = { playwright: desk.url }; // engines/acp.mjs uses it when Grok can
  else options.mcpServers.playwright = { type: 'http', url: desk.url };
  return desk.name;
}
// A server no open session uses stops (older ones, and those of desks with no session open): Playwright then closes
// its browser too. The next session of the desk starts it again.
async function stopOldDeskBrowsers() {
  const helpers = await runnerCall('/helpers').catch(() => []);
  const inUse = new Set([...live.values()].filter((s) => s.status !== 'ended').map((s) => state.sessions[s.id]?.browserHelper));
  for (const h of helpers) {
    if (!h.name.startsWith('playwright-') || inUse.has(h.name) || Date.now() - (h.meta?.at || 0) < DESK_BROWSER_GRACE_MS) continue;
    await runnerCall('/helpers/stop', { name: h.name }).catch(() => {});
    logEvent('stopped the private browser server', `${h.name}: no open session uses it`);
  }
}
setInterval(() => stopOldDeskBrowsers().catch(() => {}), 5 * 60_000).unref();
// Files a browser tool saved in the desk's folder go in the session's own too (a link, not a second copy), where its
// Files list looks.
function keepBrowserFiles(s, text) {
  const client = clientById(s.client);
  if (!client) return;
  for (const f of savedFiles(text, deskBrowserOut(client))) {
    const to = path.join(UPLOADS, s.id, 'browser', path.basename(f));
    if (fs.existsSync(to) || !fs.existsSync(f)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.linkSync(f, to); } catch { try { fs.copyFileSync(f, to); } catch {} }
  }
}

// ---------- sessions starting other sessions (rules in prompts/*.md) ----------
const proposals = new Map(); // proposal id -> { parentId, client, title, prompt, cwd, ev }
// Cards that wait on the person: suggested sessions, offers (New session / Do it here) and title suggestions
// are saved on their session's record (cards: [{ anchor, ev }]), like handoffs and the folder card, because the chat
// is read again from the conversation file after Docket restarts (to take in an update), and that file holds no cards.
// The saved ev is the same object the chat shows, so a change to it plus saveState() saves the answer too. Answered
// cards stay as a record of what was chosen; past KEEP_CARDS a session drops its oldest answered ones.
const KEEP_CARDS = 50;
const isOpenCard = (ev) => ev.state === 'open' || ev.state === 'pending';
function saveCard(s, ev) {
  const rec = state.sessions[s.id] ||= { client: s.client };
  const anchor = [...s.events].reverse().find((e) => e.k === 'text')?.text?.slice(0, 200) || '';
  // The Docket tool call it comes from, still running while the card is made: the card goes back in after it.
  const tool = [...s.events].reverse().find((e) => e.k === 'tool' && e.status === 'running' && e.name?.startsWith('mcp__portal__'))?.id;
  (rec.cards ||= []).push({ anchor, ev, ...(tool ? { tool } : {}) });
  while (rec.cards.length > KEEP_CARDS) { const i = rec.cards.findIndex((c) => !isOpenCard(c.ev)); if (i < 0) break; rec.cards.splice(i, 1); }
  saveState();
}
const savedCard = (sessionId, k, id) => state.sessions[sessionId]?.cards?.find((c) => c.ev.k === k && c.ev.id === id)?.ev;
for (const [id, rec] of Object.entries(state.sessions)) for (const { ev } of rec.cards || [])
  if (ev.k === 'proposal') proposals.set(ev.id, { parentId: id, client: rec.client, title: ev.title, prompt: ev.brief, cwd: ev.cwd, brand: ev.brand, startGear: ev.startGear, ev });
// byUser: the person started it from the page, under that session (the new-session form with a parent),
// rather than the parent's Claude with start_session. Everything else is the same; only who started it,
// in what the child is told, differs, and the parent is told it now has this child.
// engine: the brand the person picked on the page; otherwise a child runs on its parent's brand, since it carries
// on the parent's work, or on the company default if the parent's brand is no longer set up.
// settings: what the person picked on the page; a child a session starts is in Shift, with its parent's effort.
// startGear: the gear a Shift child starts on (start_session's start_gear); left out, a child a session starts begins
// on its parent's current gear, and one the person starts from the page on its company's start gear.
function startChild(parent, { title, prompt, cwd, attachments = [], settings = {}, byUser = false, engine, startGear, note = '', groupId }) {
  const client = clientById(parent.client);
  const parentBrand = parent.engine || live.get(parent.id)?.engine || state.sessions[parent.id]?.engine;
  engine ||= keptEngine(client, parentBrand);
  if (!byUser && !Object.keys(settings).length) {
    settings = childSettings(live.get(parent.id)?.settings || state.sessions[parent.id]?.settings, parentBrand, engine || defaultEngineOf(client));
  }
  const chosenGear = startGear;
  if (!byUser && !startGear) {
    const ps = live.get(parent.id) || state.sessions[parent.id] || {};
    startGear = parentGear(engine || defaultEngineOf(client), parentBrand, ps.gear || (ps.settings?.model !== 'shift' ? ps.settings?.model : ''));
  }
  // A lower start gear the parent asked for holds the child there, and its parent checks its reports harder (#801).
  const heldBy = !byUser && chosenGear && belowTop(engine || defaultEngineOf(client), chosenGear);
  const record = { ...(groupId !== undefined ? { groupId } : {}), ...(heldBy ? { gearBy: 'parent' } : {}) };
  const child = startSession({ clientId: parent.client, cwd, title, parentId: parent.id, settings, engine, gear: startGear, record: Object.keys(record).length ? record : undefined });
  state.sessions[child.id].reportsTo = parent.id;
  if (groupId !== undefined) groupChanged(client.id);
  if (byUser && title) state.sessions[child.id].titleBy = 'you';
  saveState();
  const parentTitle = sessionTitle(client, parent.id);
  const who = byUser ? `The user started this session from the portal, under the session "${parentTitle}" (id ${parent.id})`
    : `This session was started by the session "${parentTitle}" (id ${parent.id}) and is listed under it`;
  sendToSession(child, { text: prompt, attachments, from: byUser ? '' : 'session', context: [`(From Docket: ${who}. When you finish a turn, that session gets a short report of your reply.)`, note].filter(Boolean).join('\n\n') });
  if (byUser) noticeToSession(client.id, parent.id, `The user started the session "${child.title || title || 'Untitled'}" (id ${child.id}) under this one from the portal. Its finished turns will come to you as session reports, and you can message it with mcp__portal__send_to_session. Nothing to do now; reply in one line at most.`, { byPerson: true }).catch(() => {});
  else { // the session started it: its second with no plan brings the card that offers one (#605)
    const rec = state.sessions[parent.id];
    if (rec) { rec.childStarts = (rec.childStarts || 0) + 1; saveState(); }
    const ps = live.get(parent.id);
    if (ps) offerPlan(ps);
  }
  return child;
}
function updateCard(s, ev) { broadcast({ t: 'card', id: s.id, ev }); }
// A title suggestion card, from the chat of the running session or from the saved cards of one that is not running.
const titleCard = (s, id, sid) => s?.events.find((e) => e.k === 'title-suggestion' && e.id === sid) || savedCard(id, 'title-suggestion', sid);

// ---------- session titles ----------
// state.sessions[id].titleBy: 'you' (typed, renamed or a suggestion applied), 'first-message' (made from the
// start of the first message), 'claude' (renamed by the session on its own). Unknown counts as 'you'.
const titleBy = (id) => state.sessions[id]?.titleBy || 'you';
const wasDeleted = (id) => (state.deleted || []).includes(id);
function setTitle(client, id, title, by) {
  if (wasDeleted(id)) return; // renaming writes into its conversation file, which would bring it back
  const s = live.get(id);
  if (s) { s.title = title; pushSession(s); }
  state.sessions[id] = { ...(state.sessions[id] || { client: client.id }), title, titleBy: by };
  saveState();
  withHome(client, () => renameSession(id, title, {})).catch(() => {});
  historyCache.delete(client.id);
  broadcast({ t: 'renamed', id, title, client: client.id });
}
function renameByClaude(s, title, asked) {
  title = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!title) return { ok: false, text: 'Give a title.' };
  const by = titleBy(s.id);
  if (!asked && by === 'you') return { ok: false, text: `Not renamed: the user named this session ("${s.title}"). Use suggest_title if the work has clearly moved on from that name.` };
  if (!asked && by === 'claude') return { ok: false, text: `Not renamed: you already renamed this session once ("${s.title}"). Use suggest_title instead.` };
  setTitle(clientById(s.client), s.id, title, asked ? 'you' : 'claude');
  return { ok: true, text: `Renamed to "${title}".` };
}
function suggestTitle(s, title, reason) {
  const ev = { k: 'title-suggestion', id: 'title_' + randomUUID().slice(0, 8), title: String(title || '').trim().slice(0, 80), reason: reason || '', from: s.title, state: 'open' };
  saveCard(s, ev);
  addEvent(s, ev);
  return ev;
}
// brand: the AI the card starts the session on; left out, the parent's brand, as for any child. startGear: as for startChild.
function proposeSession(parent, { title, prompt, cwd, brand, startGear }) {
  const id = 'prop_' + randomUUID().slice(0, 8);
  const ev = { k: 'proposal', id, title, brief: prompt, cwd, state: 'open', ...(brand ? { brand } : {}), ...(startGear ? { startGear } : {}) };
  proposals.set(id, { parentId: parent.id, client: parent.client, title, prompt, cwd, brand, startGear, ev });
  saveCard(parent, ev);
  addEvent(parent, ev);
  return ev;
}
// open -> started | dismissed (by the person) | withdrawn (by Claude)
function settleProposal(id, how, note, startedId) {
  const p = proposals.get(id);
  if (!p || p.ev.state !== 'open') return false;
  p.ev.state = how; if (startedId) p.ev.startedId = startedId; if (note) p.ev.note = note;
  saveState();
  updateCard({ id: p.parentId }, p.ev);
  return true;
}
function startProposal(id) {
  const p = proposals.get(id);
  if (!p || p.ev.state !== 'open') throw new Error('That proposal is no longer open');
  const parent = live.get(p.parentId) || { id: p.parentId, client: p.client, cwd: p.cwd };
  const child = startChild(parent, { title: p.title, prompt: p.prompt, cwd: p.cwd, engine: p.brand, startGear: p.startGear });
  settleProposal(id, 'started', '', child.id);
  touchSession(p.client, child.id); // the person pressed Start
  // Tell the proposer, so it does not start the same work again with start_session.
  noticeToSession(p.client, p.parentId, `The user started your proposal "${p.title || 'Untitled'}" as session ${child.id}; do not start this work again. Its finished turns will come to you as session reports. Nothing to do now; reply in one line at most.`, { byPerson: true }).catch(() => {});
  return child;
}
// ---------- handing a session off to a fresh one (matching rules in handoff.mjs) ----------
// open -> started (then archive offered: archived | kept) | here (Keep going here)
// Each card is also saved on its session's record (handoffs: [{ cwd, anchor, ev }]), because the chat is
// read again from the conversation file after Docket restarts, and that file holds no cards.
const handoffs = new Map(); // handoff id -> { sessionId, client, brief, title, cwd, ev }
const handoffEntry = (sessionId, client, { cwd, ev }) => ({ sessionId, client, brief: ev.brief, title: ev.title, cwd, ev });
for (const [id, rec] of Object.entries(state.sessions)) for (const h of rec.handoffs || []) handoffs.set(h.ev.id, handoffEntry(id, rec.client, h));
function proposeHandoff(s, { brief, title }) {
  const rec = state.sessions[s.id];
  if (!rec) return null;
  brief = String(brief || '').trim();
  title = String(title || '').trim().slice(0, 80) || titleFromBrief(brief) || s.title || 'Handoff';
  const id = 'handoff_' + randomUUID().slice(0, 8);
  const ev = { k: 'handoff', id, title, brief, state: 'open' };
  // The reply it was raised from, for a card raised by a company's handoffPattern (no tool call to follow).
  const anchor = [...s.events].reverse().find((e) => e.k === 'text')?.text?.slice(0, 200) || '';
  const saved = { cwd: s.cwd, anchor, ev };
  (rec.handoffs ||= []).push(saved);
  saveState();
  handoffs.set(id, handoffEntry(s.id, s.client, saved));
  addEvent(s, ev);
  setUnread(s, 'handoff');
  pushSession(s);
  return ev;
}
function handoffCard(id) {
  const h = handoffs.get(id);
  if (!h) throw new Error('That handoff card is no longer open');
  return h;
}
function settleHandoff(h, patch) {
  Object.assign(h.ev, patch);
  saveState(); // the saved record holds this same ev
  const s = live.get(h.sessionId);
  if (s) updateCard(s, h.ev);
}
// Continue: the new session takes the old one's place, with the brief as its first message.
async function continueHandoff(id) {
  const h = handoffCard(id);
  if (h.ev.state !== 'open') throw new Error('That handoff card is no longer open');
  const client = clientById(h.client);
  const old = live.get(h.sessionId);
  const rec = state.sessions[h.sessionId] || {};
  const place = handoffPlace(rec, parentOf(client, h.sessionId));
  // The new session takes the old one's place, so it runs on the same brand.
  const record = { titleBy: 'claude', handoffFrom: h.sessionId };
  if (!place.parentId) record.parentId = ''; // top level on purpose, not a child found some other way
  if (place.reportsTo) record.reportsTo = place.reportsTo;
  if (place.groupId !== undefined) record.groupId = place.groupId;
  const next = startSession({ clientId: client.id, cwd: h.cwd, title: h.title, parentId: place.parentId, settings: rec.settings || {}, engine: keptEngine(client, rec.engine || old?.engine), record });
  const kids = moveHandoffChildren(client, h.sessionId, next);
  const plans = moveHandoffPlans(client, h.sessionId, next);
  sendToSession(next, { text: h.brief, attachments: [], from: 'session', context:`(From Docket: this session continues the work of the session "${old?.title || rec.title || h.sessionId}" (id ${h.sessionId}), handed off to a fresh session. The message above is its handoff brief.${kids.context}${plans.context})` });
  settleHandoff(h, { state: 'started', startedId: next.id, archive: 'offered' });
  logEvent('handoff', `${h.sessionId} -> ${next.id}`);
  // The parent gets the new id as a fact, so its follow-ups reach the session doing the work now.
  if (place.parentId) {
    noticeToSession(client.id, place.parentId, `The session "${old?.title || rec.title || 'Session'}" (id ${h.sessionId}) handed its work off to a new session "${h.title}" (id ${next.id}), which continues the same work under you. Send follow-ups for that work to id ${next.id}. Nothing to do now; reply in one line at most.`)
      .catch((e) => console.log('[handoff]', e.message));
  }
  return next;
}
// The old session's children (saved records, and ones known only to the desktop app, as deleteSession finds them)
// move under the new session (handoffChildren in handoff.mjs); the running ones are told where their reports go now.
function moveHandoffChildren(client, oldId, next) {
  const ids = new Set();
  for (const [cid, r] of Object.entries(state.sessions)) if (cid !== next.id && r.client === client.id && parentOf(client, cid) === oldId) ids.add(cid);
  for (const [cid, pid] of desktopParents(client)) if (pid === oldId && cid !== next.id && !wasDeleted(cid)) ids.add(cid);
  const kids = [...ids].map((cid) => { const k = live.get(cid); return { id: cid, title: sessionTitle(client, cid), rec: state.sessions[cid], running: !!k && k.status !== 'ended' }; });
  const { moved, context } = handoffChildren(kids, oldId, next.id);
  if (!moved.length) return { context };
  const was = live.get(oldId);
  for (const m of moved) {
    state.sessions[m.id] = { client: client.id, ...m.rec };
    const k = live.get(m.id);
    if (k) { k.parentId = next.id; pushSession(k); }
    // a report the old session had not taken in yet goes to the new one, which takes it in after its first turn
    if (was?.waitingChildren?.has(m.id)) { (next.waitingChildren ||= new Map()).set(m.id, was.waitingChildren.get(m.id)); was.waitingChildren.delete(m.id); }
    const queued = was?.pendingReports?.filter((r) => r.childId === m.id) || [];
    if (queued.length) { was.pendingReports = was.pendingReports.filter((r) => r.childId !== m.id); (next.pendingReports ||= []).push(...queued); }
  }
  groupChanged(client.id); // saves too
  logEvent('handoff children', `${oldId} -> ${next.id}: ${moved.map((m) => m.id).join(', ')}`);
  for (const m of moved) if (m.running) {
    noticeToSession(client.id, m.id, `The session that started you ("${sessionTitle(client, oldId)}", id ${oldId}) handed its work off to a new session "${next.title || 'Session'}" (id ${next.id}). You are now listed under it, and your reports go to id ${next.id}. Nothing to do now; reply in one line at most.`)
      .catch((e) => console.log('[handoff]', e.message));
  }
  return { context };
}
// The plans the old session coordinates and the tasks it holds move to the new session (handoffPlans in handoff.mjs,
// #667), through the plan store so its locking and file writes stay as they are. A plan that fails to move is logged
// and left as it was: the new session can still take it over with plan_take_over.
function moveHandoffPlans(client, oldId, next) {
  if (!plansOn(client)) return { context: '' };
  const store = plansOf(client);
  const { coordinated, held, context } = handoffPlans(store.list(), oldId);
  let changed = false;
  for (const p of coordinated) {
    try { store.setCoordinator(p.id, next.id, next.title || ''); changed = true; } catch (e) { console.log('[handoff plans]', p.id, e.message); }
  }
  for (const h of held) {
    try { if (store.passTasks(h.plan, h.tasks, oldId, next.id, next.title || '').length) changed = true; } catch (e) { console.log('[handoff plans]', h.plan, e.message); }
  }
  if (!changed) return { context: '' };
  broadcast({ t: 'plans', client: client.id });
  logEvent('handoff plans', `${oldId} -> ${next.id}: ${[...coordinated.map((p) => p.id), ...held.map((h) => `${h.plan}/${h.tasks.join(',')}`)].join(' ')}`);
  return { context };
}
function keepHandoffHere(id) {
  const h = handoffCard(id);
  if (h.ev.state !== 'open') throw new Error('That handoff card is no longer open');
  settleHandoff(h, { state: 'here' });
}
// After Continue the card offers to archive the old session; nothing is archived without that click.
function archiveAfterHandoff(id, archive) {
  const h = handoffCard(id);
  if (h.ev.state !== 'started' || h.ev.archive !== 'offered') throw new Error('That archive offer is no longer open');
  settleHandoff(h, { archive: archive ? 'archived' : 'kept' });
  if (archive) archiveSession(clientById(h.client), h.sessionId, true);
}
// An offer waits for the person: New session, or Do it here.
// The card is saved (see saveCard). A restart of the app cuts the tool call off, and Docket's tool program sends
// the same call again once the app is back: that finds the saved card and waits on it, rather than showing a second.
function offerSession(parent, { title, prompt, cwd, brand, startGear }) {
  return new Promise((resolve) => {
    let ev = state.sessions[parent.id]?.cards?.find((c) => c.ev.k === 'offer' && c.ev.state === 'pending' && c.ev.title === title && c.ev.brief === prompt)?.ev;
    const again = !!ev;
    ev ||= { k: 'offer', id: 'offer_' + randomUUID().slice(0, 8), title, brief: prompt, cwd, state: 'pending', ...(brand ? { brand } : {}), ...(startGear ? { startGear } : {}) };
    parent.pendingAsks = parent.pendingAsks || new Map();
    parent.pendingAsks.set(ev.id, { ev, resolve: (choice) => resolve(settleOffer(parent, ev, choice)) });
    if (!again) saveCard(parent, ev);
    if (!parent.events.includes(ev)) addEvent(parent, ev);
    setUnread(parent, 'offer');
    setStatus(parent, 'requires_action');
    pushSession(parent);
  });
}
function settleOffer(parent, ev, choice) {
  if (choice === 'new') { const child = startChild(parent, { title: ev.title, prompt: ev.brief, cwd: ev.cwd || parent.cwd, engine: ev.brand, startGear: ev.startGear }); ev.state = 'new'; ev.startedId = child.id; touchSession(parent.client, child.id); }
  else ev.state = 'here';
  saveState();
  updateCard(parent, ev); // a page showing that chat redraws the card, running or not
  return { started: ev.startedId || null, id: ev.id };
}
// An offer answered after its tool call was cut off (Docket restarted while it waited, and the call was not sent
// again): the choice still happens, and the session is told it, since nothing is waiting there to hear it.
async function answerOfferLate(client, sessionId, id, choice) {
  const ev = savedCard(sessionId, 'offer', id);
  if (!ev || ev.state !== 'pending') return false;
  const parent = live.get(sessionId) || { id: sessionId, client: client.id, cwd: ev.cwd || state.sessions[sessionId]?.cwd };
  const { started } = settleOffer(parent, ev, choice === 'new' ? 'new' : 'here');
  const said = `The user answered your earlier offer "${ev.title}" (New session / Do it here), which reached them after Docket restarted:`;
  await noticeToSession(client.id, sessionId, started
    ? `${said} they chose a new session, now started as "${ev.title}" (id ${started}). Do not also do this work here.`
    : `${said} they chose to do it here. Do that work in this session now.`, { byPerson: true });
  return true;
}
function answerOffer(s, id, choice) {
  const ask = s.pendingAsks?.get(id);
  if (!ask || ask.ev.k !== 'offer') return false;
  s.pendingAsks.delete(id);
  ask.resolve(choice === 'new' ? 'new' : 'here');
  if (!s.pendingAsks.size) setStatus(s, 'running');
  return true;
}
// A session of this client ready to take a message: the running one, or the saved one resumed.
async function sessionToMessage(clientId, id) {
  const client = clientById(clientId);
  let target = live.get(id);
  if (target && target.client !== clientId) throw new Error('That session belongs to another desk. To reach another desk, use ask_desk or propose_to_desk');
  if (!target || target.status === 'ended') {
    const old = target;
    if (old) live.delete(id);
    const row = await savedRow(client, id);
    if (!row && !old) throw new Error('No session with that id for this client');
    target = startSession({ clientId, cwd: row?.cwd || old.cwd, title: row?.title || old.title, resumeId: id });
    target.events = old ? old.events.slice() : await loadTranscript(client, id).catch(() => []);
  }
  return target;
}
// A session of this company that is not running, as a row like history's. Claude's come from its saved
// conversations (history); a session of another brand (Grok) has none Docket can list, so Docket's own
// record of it stands in, and it is picked up again on the brand it started on.
async function savedRow(client, id) {
  const row = (await history(client)).find((r) => r.id === id);
  if (row) return row;
  const rec = state.sessions[id];
  if (!rec || rec.client !== client.id || !rec.engine || rec.engine === 'claude' || wasDeleted(id)) return null;
  return { id, client: client.id, title: rec.title || 'Untitled', cwd: rec.cwd, createdAt: rec.createdAt, engine: rec.engine, live: false };
}
// before: run on the session once it is live, before it gets the message (a parent raising its gear).
// A sender that is not the session's parent is saved as its replyTo, so its next finished turn reports
// to the sender rather than waking a parent that did not ask for the work. Returns the parent's id.
// done: the sender's send_to_session done flag (it checked and agrees the work is done), so the reply is only news.
// Agreeing with a child that already said it is ready to close, with nothing waiting on the person, runs no turn:
// the message goes into its chat as a note (agreedAsNote, #755), and noted is true.
async function deliverToSession(clientId, id, message, from, before, done = false) {
  const news = from ? turnNewsFor({ message, done }) : '';
  const was = live.get(id);
  if (news === 'agreed' && was && was.status !== 'ended' && state.sessions[id]?.lastDone && !before) {
    if (!stateSnaps.has(id)) await refreshStateSnap(was).catch(() => {});
    if (agreedAsNote({ news, lastDone: true, state: liveChildState(was), pr: stateSnaps.get(id)?.pr })) {
      addEvent(was, { k: 'note', text: `"${from.title || from.id}" checked and agrees the work is done (no turn ran, since this session had already said it is ready to close): ${message}` });
      logEvent(`agreed as a note: ${sessionTag(was)}`, `from ${sessionTag(from)}`);
      return { reportsTo: state.sessions[id]?.reportsTo || null, restored: false, noted: true };
    }
  }
  const target = await sessionToMessage(clientId, id);
  // Work sent to an archived session brings it back to the list for good, so it shows open and close_session works
  // on it again (#717); left archived, it ran and showed as open but could not be closed.
  const restored = isArchived(clientById(clientId), id);
  if (restored) setArchived(clientId, id, false);
  if (before) await before(target);
  const rec = (state.sessions[id] ||= { client: clientId });
  const reportsTo = rec.reportsTo || null;
  if (from && from.id !== id && from.id !== reportsTo) rec.replyTo = from.id;
  else delete rec.replyTo;
  saveState();
  const back = from && rec.replyTo ? ' When you finish this work, that session gets a short report of your reply.' : '';
  sendToSession(target, { text: message, attachments: [], from: 'session', context: from ?`(Sent by the session "${from.title || from.id}" in the portal, id ${from.id}.${back})` : '', news });
  return { reportsTo, restored };
}
// A notice from Docket itself: a line in the chat, and the same words to Claude (not shown as the person's message).
// byPerson: the notice comes from a button the person pressed, so it counts as the person acting (wake limit).
async function noticeToSession(clientId, id, text, { byPerson = false } = {}) {
  const target = await sessionToMessage(clientId, id);
  addEvent(target, { k: 'note', text });
  sendToSession(target, { text: '', system: true, byPerson, context: `(From Docket: ${text})`, news: turnNewsFor({ notice: text }) });
}
// The Summary button in the send box (#724): the session says where its work stands, as an outline. Top is this
// session only; Deep also reads the open sessions under it (children, their children, and so on), read only: it
// reads what they already wrote and never wakes, messages or resumes them. The chat shows it as Docket's message.
const SUMMARY_RULES = `Answer where things stand. **Do no new work** - no edits, commits, builds, or writes to outside services.
Read-only calls only to check a fact you are about to state; prefer "unconfirmed" over a sweep.

**Outline, not prose.** Bullets throughout. One line each, under about 15 words. No paragraphs, no
lead-ins, no closing recap. Nested bullets only where a point genuinely has sub-points. If a bullet
needs a second sentence, it is two bullets or it is detail that can be dropped.

**Every bullet leads with a bold subject, then a colon, then the point.** The subject is the thing
being talked about - a file, a component, a decision, a person, a state. Two or three words, not a
sentence, never a restatement of the point that follows.

\`\`\`
- **Recipient mapping:** all 14 PII fields asserted, was 8.
- **Integration tests:** 47 still failing at the socket, needs a live API.
- **Release date:** assumed Friday, confirm at next stop.
\`\`\`

Four sections, these headings, this order:

## What this is

Written for the person coming back days later with none of this in their head. Enough to pick
the thread back up without rereading the session.

- **Job:** what this session set out to do, and why, in one line.
- **Asked by:** who started it and what prompted it - an issue, a review comment, a bug seen.
- **Where:** issue, pull request, plan, worktree and branch, each only if one exists.
- **Background:** the two to four facts a cold reader needs - the constraint, the earlier
  decision, the thing that turned out not to be true. One bullet each.
- **Shape of the work:** how far it went - read only, edited, built, pushed, merged.

No history of the session. What a stranger needs to know before reading the next section.

## Where it stands

- Done, in bullets. What is now true, not the story of getting there.
- Anything broken, failing, skipped or assumed gets its own bullet, marked.
- Something shared broken goes first, before this heading, as one line.

## Questions for you

Only questions whose answer changes what happens next. Each as:

- **The question in one sentence.**
  - the two or three facts needed to answer it, one bullet each
  - options, one marked recommended
  - what happens once answered

Assume anything assumable, say so under Where it stands, and drop the question. Nothing left means
\`None.\` - never manufacture one to fill the section.

## Next steps

- Numbered, in order, each startable without further input.
- Mark blocked ones with the question they wait on.
- Finished work says \`Nothing outstanding.\` rather than inventing steps.

---

Standing rules apply: no em dashes, hyphens instead. Issue and pull request mentions are links whose text is
the number, the title and the status. No number that looks measured without measuring it. Another
session's claim is a lead - keep the "unconfirmed" wording.

No substantial work to wrap means one sentence saying so. Three empty headings are worse than
nothing.`;
function summaryText(kids) {
  if (!kids) return `Summary: the user pressed Summary. Say where this session's work stands.

Source is this conversation, plus your Docket plan's open items if they are already in context. Do
not go looking for one.

${SUMMARY_RULES}`;
  const list = kids.map((k) => `${'  '.repeat(k.depth - 1)}- "${k.title}" (id ${k.id}, ${k.status})`).join('\n');
  return `Deep summary: the user pressed Deep summary. Say where the work of this session and the ${kids.length} session${kids.length === 1 ? '' : 's'} under it stands, in one outline.

The sessions under this one, indented by depth:
${list}

Source is this conversation plus what those sessions have already written. Read each one with
mcp__portal__get_session_report (its status and latest reply), and where that is not enough, with
mcp__portal__read_group_session and whole_desk true (its messages and replies). **Read only:** never
wake, message, resume, start or close any of them - no send_to_session, start_session, close_session
or set_parent. What a session says is its report, not proof: keep its claims "unconfirmed" unless you
checked them. Fold it all into the one outline below, and say which session each point came from,
linking it as [title](#session:<id>).

${SUMMARY_RULES}`;
}
// The open sessions under id, as the session list shows them: [{ id, title, status, depth }].
async function summaryKids(client, id) {
  return familyView(client, await history(client)).family(id)
    .map((k) => ({ id: k.id, depth: k.depth, title: sessionTitle(client, k.id) || 'Untitled', status: live.get(k.id)?.status || 'not running' }));
}
async function sendSummary(client, id, mode) {
  const kids = mode === 'deep' ? await summaryKids(client, id) : [];
  const now = live.get(id);
  if (now && (['running', 'starting'].includes(now.status) || now.compactingSince)) throw new Error('This session is working. Ask for a summary once its turn ends.');
  const target = await sessionToMessage(client.id, id);
  sendToSession(target, { text: '', from: 'docket', byPerson: true, context: `(From Docket: ${summaryText(kids.length ? kids : null)})` });
}
const sessionTitle = (client, id) => live.get(id)?.title || state.sessions[id]?.title || (historyCache.get(client.id)?.rows || []).find((r) => r.id === id)?.title || 'Untitled';
// Change a session's parent: under another session of the same company, or to the top level
// (parent null). The parent link (parentId) nests it in the list and counts its cost in that family;
// reportsTo sends its finished turns to that parent. Both move together. Its group stays as it was
// showing: one that followed its old parent keeps that group as its own choice.
async function setParent(client, id, parentId) {
  parentId = parentId || null;
  const rows = [...(await history(client)), ...[...live.values()].filter((x) => x.client === client.id).map(summary)];
  const known = new Set(rows.map((r) => r.id).filter((x) => !wasDeleted(x)));
  for (const x of [id, parentId]) if (x && !known.has(x) && await savedRow(client, x)) known.add(x); // a stopped Grok session
  if (!known.has(id)) throw new Error('No session with that id for this desk');
  if (parentId) {
    if (parentId === id) throw new Error('A session cannot be its own parent');
    if (!known.has(parentId)) throw new Error("That parent is not one of this desk's sessions");
    for (let cur = parentId, seen = new Set(); cur && !seen.has(cur); seen.add(cur), cur = parentOf(client, cur))
      if (cur === id) throw new Error('That session was started from this one (a child or grandchild of it), so it cannot become its parent');
  }
  const old = parentOf(client, id);
  const rec = (state.sessions[id] ||= { client: client.id });
  if (old === parentId && (rec.reportsTo || null) === parentId) return { changed: false };
  if (rec.groupId === undefined) rec.groupId = effectiveGroup(client, id) || '';
  rec.parentId = parentId || '';
  if (parentId) rec.reportsTo = parentId; else delete rec.reportsTo;
  const s = live.get(id);
  if (s) s.parentId = parentId;
  const was = old && live.get(old);
  if (was) { was.waitingChildren?.delete(id); if (was.pendingReports) was.pendingReports = was.pendingReports.filter((r) => r.childId !== id); }
  groupChanged(client.id);
  if (s) pushSession(s);
  logEvent('parent changed', `${id}: ${old || '(top level)'} -> ${parentId || '(top level)'}`);
  const childTitle = sessionTitle(client, id);
  if (was && was.status !== 'ended') addEvent(was, { k: 'note', text: `"${childTitle}" was moved ${parentId ? 'under another session' : 'to the top level'} and no longer reports to this session.` });
  if (parentId) {
    const parentTitle = sessionTitle(client, parentId);
    const notes = [
      noticeToSession(client.id, parentId, `The session "${childTitle}" (id ${id}) now reports to you. Its finished turns will come to you as session reports, and you can message it with mcp__portal__send_to_session. Nothing to do now; reply in one line at most.`),
      noticeToSession(client.id, id, `This session now reports to the session "${parentTitle}" (id ${parentId}). When you finish a turn, that session gets a short report of your reply. Nothing to do now; reply in one line at most.`),
    ];
    for (const r of await Promise.allSettled(notes)) if (r.status === 'rejected') logEvent('parent change notice not sent', r.reason?.message || String(r.reason));
  } else if (s && s.status !== 'ended') addEvent(s, { k: 'note', text: 'Moved to the top level: this session no longer reports to another session.' });
  return { changed: true, from: old, to: parentId };
}
// A session dragged in the list: under parentId (it then follows that parent's group), or to the
// top level of group gid ('' for No group). Every session under it, all the way down, drops its
// own group choice so it follows along and stays under it. Returns how many went with it.
async function moveFamily(client, id, parentId, gid) {
  await setParent(client, id, parentId);
  const rows = [...(await history(client)), ...[...live.values()].filter((x) => x.client === client.id).map(summary)];
  const below = familyBelow([...new Set(rows.map((r) => r.id))].map((x) => ({ id: x, parentId: parentOf(client, x) })), id);
  const rec = (state.sessions[id] ||= { client: client.id });
  if (parentId) delete rec.groupId; else rec.groupId = gid;
  for (const x of below) if (state.sessions[x]) delete state.sessions[x].groupId;
  groupChanged(client.id);
  for (const x of [id, ...below]) if (live.get(x)) pushSession(live.get(x));
  logEvent('session dragged', `${id} (+${below.length}): ${parentId ? 'under ' + parentId : 'group ' + (gid || '(none)')}`);
  return { moved: below.length };
}
async function sessionReport(clientId, id) {
  const client = clientById(clientId);
  const s = live.get(id);
  const row = s ? summary(s) : await savedRow(client, id);
  if (!row || row.client !== clientId) return null;
  // A stopped Grok session has no saved conversation Docket can read: its status, with no reply.
  const events = s ? s.events : await loadTranscript(client, id).catch(() => row.engine && row.engine !== 'claude' ? [] : null);
  if (!events) return null;
  const reply = [...events].reverse().find((e) => e.k === 'text')?.text || '';
  return { title: row.title, status: s ? s.status : 'not running', reply: reply.slice(0, 6000) };
}
// When a session a parent started finishes a turn, the parent's chat gets a short note.
// When a session a parent started finishes a turn, the parent is woken with the report and
// acts on it, as in the desktop app. A busy parent gets it when it finishes; a parent that is
// not running is resumed. After WAKE_LIMIT wake-ups in a row with no message from the person,
// reports are held (with a note saying so) until the person writes again, so sessions cannot keep
// each other busy. A report from a child turn the person started counts as the person acting (wakeDecision).
// A child whose turn ended waiting on the person (a question in its reply, a form or permission
// ask still open) only leaves the note: the question is the person's to answer in the child,
// which stays marked unread, and a woken parent would ask it a second time.
const WAKE_LIMIT = 8;
// Work sent with send_to_session by a session that is not the parent reports to that sender
// instead (reportRoute): the sender is woken as a parent would be, and the parent gets only a note.
// leftover: the jobs still running when a turn marked done reported anyway ("label, N min"), named in the report.
async function reportToParent(child, leftover = []) {
  const rec = state.sessions[child.id];
  const reply = [...child.events].reverse().find((e) => e.k === 'text')?.text || '';
  const route = reportRoute({ reportsTo: rec?.reportsTo, replyTo: rec?.replyTo, waiting: waitingOnUser(child, reply) });
  if (!route.to) return;
  if (route.clearReplyTo) { delete rec.replyTo; saveState(); }
  const client = clientById(child.client);
  const lowGear = heldGearOf(child); // named in the report, so the parent checks it harder (#801)
  // A report for a session that was closed goes to the nearest open session above the child, where the list now
  // shows it (#717): waking the closed one would run it again while its record says archived. With none, it stays here.
  const view = client && familyView(client);
  const to = view && !view.open(route.to) ? view.openParent(child.id) : route.to;
  if (!to) return;
  // A turn with no reply text (an error before any answer) says so in a line, not as an empty report (#759).
  const report = { childId: child.id, title: child.title || 'Session', text: reportText(reply, { error: rec?.lastError?.text }).slice(0, 400), at: Date.now(), ...(lowGear ? { gear: lowGear.name, top: topGearOf(child.engine).key } : {}), ...(route.sent ? { sent: true } : {}), ...(child.turnBy === 'person' ? { byPerson: true } : {}), ...(leftover.length ? { jobs: leftover } : {}) };
  if (route.waiting) {
    const parent = live.get(to);
    if (parent && parent.status !== 'ended') {
      addEvent(parent, { k: 'child-report', ...report, waiting: true });
      (parent.waitingChildren ||= new Map()).set(child.id, report.title); // named, without its question, in the next wake-up
      flushReports(parent); // freed plan tasks that waited for this turn go now
    }
    return;
  }
  // Only news (#734): a note with the halo, and it reaches the parent with its next turn rather than waking it now.
  const others = kidsOf({ id: to, client: child.client }).list.filter((k) => k.id !== child.id);
  const news = reportIsNews({ cause: child.reportNews, lastOpen: !others.length, lowGear: !!lowGear }) && holdNews(to, report, child.reportNews);
  if (!news && !await wakeWith(client, to, report)) return;
  const own = route.noteTo !== to && route.noteTo && live.get(route.noteTo);
  if (own && own.status !== 'ended') addEvent(own, { k: 'note', text: `"${report.title}" finished work sent by the session "${sessionTitle(client, to)}"; its report went there.` });
}
// A news-only report (reportIsNews): kept on the parent's record until its next turn (heldNewsText), and shown in its
// chat with the halo when it is open here. A parent not running here gets it with its next turn all the same.
function holdNews(id, report, cause) {
  const rec = state.sessions[id];
  if (!rec) return false;
  rec.heldNews = [...(rec.heldNews || []), { childId: report.childId, title: report.title, text: report.text }].slice(-20);
  saveState();
  const p = live.get(id);
  if (p && p.status !== 'ended') {
    addEvent(p, { k: 'child-report', ...report, news: true });
    if (!p.unread) p.kidNews = true;
    pushSession(p);
  }
  logEvent(`news held for ${sessionTag({ id, title: p?.title || rec.title })}`, `from "${report.title}" (${report.childId}), ${cause}`);
  return true;
}
// Queue a report (a child's finished turn, or freed plan tasks) for a session and wake it, resuming it when it
// is not running. `note` is shown in its chat instead of the child-report card. False when there is no such session.
async function wakeWith(client, id, report, note = '') {
  let parent = live.get(id);
  if (!parent || parent.status === 'ended') {
    const row = await savedRow(client, id).catch(() => null);
    if (!row && !parent) return false;
    const old = parent;
    if (old) live.delete(id);
    parent = startSession({ clientId: client.id, cwd: row?.cwd || old.cwd, title: row?.title || old.title, resumeId: id });
    parent.events = old ? old.events.slice() : await loadTranscript(client, id).catch(() => []);
  }
  addEvent(parent, note ? { k: 'note', text: note } : { k: 'child-report', ...report });
  (parent.pendingReports ||= []).push(report);
  flushReports(parent);
  return true;
}
// A session's turn ended: reports that waited for it (freed plan tasks) go to the sessions holding them.
function flushWaitingOn(s) {
  for (const p of live.values()) if (p !== s && p.pendingReports?.some((r) => r.waitFor === s.id)) flushReports(p);
}
// PORTAL_REPORT_DEBOUNCE (JSON, e.g. {"quietMs":0,"maxMs":0}) changes it; the tests that wait for a report turn it off.
const reportDebounce = (() => { try { return { ...REPORT_DEBOUNCE, ...JSON.parse(process.env.PORTAL_REPORT_DEBOUNCE || '{}') }; } catch { return REPORT_DEBOUNCE; } })();
function flushReports(parent) {
  if (!parent.pendingReports?.length) return;
  if (parent.pendingAsks?.size || !['idle', 'starting'].includes(parent.status)) return; // busy: delivered when it finishes
  const ready = readyReports(parent.pendingReports, (id) => live.get(id)?.status === 'running');
  if (!ready.length) return;
  // Children that finish close together share one wake-up (REPORT_DEBOUNCE in reports.mjs).
  const left = debounceLeft(ready, Date.now(), reportDebounce);
  if (left > 0) { clearTimeout(parent.flushTimer); parent.flushTimer = setTimeout(() => flushReports(parent), left + 50); return; }
  const d = wakeDecision({ autoWakes: parent.autoWakes || 0, reports: ready, limit: WAKE_LIMIT });
  if (!d.wake) {
    const fresh = ready.filter((r) => !r.heldNoted);
    if (fresh.length) { for (const r of fresh) r.heldNoted = true; addEvent(parent, { k: 'note', text: heldNote(fresh, WAKE_LIMIT) }); }
    setUnread(parent, 'wake-limit'); pushSession(parent); return;
  }
  const reports = ready;
  parent.pendingReports = parent.pendingReports.filter((r) => !ready.includes(r));
  parent.autoWakes = d.autoWakes;
  for (const r of reports) if (r.childId) parent.waitingChildren?.delete(r.childId);
  const waiting = [...(parent.waitingChildren || [])].map(([id, title]) => `- "${title}" (id ${id}) is waiting on the user in its own chat.`);
  parent.waitingChildren?.clear();
  const line = (r) => r.kind === 'plan'
    ? `- Plan "${r.title}" (${r.planId}), which you coordinate: ${r.tasks.map((t) => `${t.id} ${t.title}`).join('; ')} ${r.tasks.length === 1 ? 'is' : 'are'} now free to start. Start ${r.tasks.length === 1 ? 'it' : 'them'} as the plan's rules say, unless the user said to wait${r.tasks.some((t) => t.title.endsWith(userTag({ forUser: true }))) ? "; for the user's step, tell the user in a line or two what to do now" : ''}.`
    : `- "${r.title}" (id ${r.childId}) finished ${r.sent ? 'the work you sent it with send_to_session (it reports to another session, so close_session is not yours to use on it)' : 'a turn'}.${r.jobs ? ' ' + leftoverJobsText(r.jobs) : ''}${r.gear ? ' ' + lowGearNote(r.gear, r.top) : ''} Its latest reply begins: ${r.text}`;
  const body = [...reports.map(line), ...waiting].join('\n');
  sendToSession(parent, { text: '', system: true, report: true, reported: reports.map((r) => r.childId).filter(Boolean), context: `<session-report>
${body}
These are reports from sessions you started or sent work to, not messages from the user. Handle them as "When a session you started says it is done" and "When sessions you started report" in your instructions say.
</session-report>` });
}
// ---------- wait_until (waits.mjs, #749) ----------
// The waits a session left with Docket after the call's own minute ran out, kept in state.waits so an app restart
// picks them up again. Each is looked at on its own clock (every few seconds for a port or a session, every 30-60
// seconds on GitHub). Once met, or out of time, its line goes to the session as a (From Docket: ...) note when the
// session is between turns, which starts a turn there; a session in a turn gets it when the turn ends.
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// One look at a condition: a verdict from waits.mjs ({ met, line }). ms: how long the wait has run.
async function lookAt(clientId, c, ms) {
  const kind = kindOf(c.condition), client = clientById(clientId);
  if (kind === 'port') return portVerdict(c, await portAnswers(c.port, c.host));
  if (kind === 'session') {
    const s = live.get(c.session);
    const st = s && s.client === clientId ? (s.status === 'ended' ? 'done' : liveChildState(s))
      : s ? 'gone' : await savedRow(client, c.session).catch(() => null) ? 'done' : 'gone';
    return sessionVerdict(c, st);
  }
  const [owner, name] = c.repo.split('/');
  const json = await ghAsk(client, owner, `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${Number(c.number)}) { state ${CHECKS} } } }`);
  if (!json?.data) return { met: false, line: `GitHub did not answer the last look at pull request #${c.number}.` }; // looked at again next time
  const pr = json.data.repository?.pullRequest;
  return prVerdict(c, pr && { state: pr.state, checks: checksOf(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup) }, ms);
}
function dropWaits(sessionId) {
  const before = (state.waits || []).length;
  state.waits = (state.waits || []).filter((w) => w.by !== sessionId);
  if (state.waits.length !== before) saveState();
  return before - state.waits.length;
}
const waitsBusy = new Set(); // wait ids with a look or a delivery under way
function tickWaits() {
  for (const w of state.waits || []) {
    if (waitsBusy.has(w.id) || (!w.line && w.next > Date.now() && Date.now() < w.until)) continue;
    waitsBusy.add(w.id);
    (async () => {
      if (!w.line) {
        const v = Date.now() < w.until ? await lookAt(w.client, w, Date.now() - w.at).catch((e) => ({ met: false, line: w.last, why: e.message })) : null;
        if (v?.met) w.line = v.line;
        else if (Date.now() >= w.until) w.line = timeoutLine(w, v?.line || w.last);
        else { w.last = v.line; w.next = nextLook(w, Date.now()); return; }
        saveState();
      }
      await deliverWait(w);
    })().catch((e) => logEvent('wait failed', e.message)).finally(() => waitsBusy.delete(w.id));
  }
}
// The answer goes once the session is between turns. A session closed or deleted since gets nothing.
async function deliverWait(w) {
  const client = clientById(w.client);
  const drop = () => { state.waits = (state.waits || []).filter((x) => x !== w); saveState(); };
  if (!client || wasDeleted(w.by) || isArchived(client, w.by)) { logEvent('wait dropped', `${w.by} is closed or gone: ${w.line}`); return drop(); }
  const s = live.get(w.by);
  if (s && s.status !== 'ended' && (s.status !== 'idle' || s.pendingAsks?.size)) return; // in a turn: goes when it ends
  drop();
  logEvent(`wait over: ${s ? sessionTag(s) : w.by}`, w.line);
  await noticeToSession(w.client, w.by, `wait_until: ${w.line}`);
}
setInterval(tickWaits, 2000);

// ---------- the state line on Docket's notes (waits.mjs, #749) ----------
// Reports and notices end with one line saying the session's branch, the pull request from it and the sessions
// under it still working or waiting on the user, so it need not run git status, gh pr view or list_sessions to
// learn them again. The branch and pull request come from what the session list's links already know (asked
// again at the end of each turn, and every two minutes while a pull request is open); the children as the note goes.
const stateSnaps = new Map(); // session id -> { at, branch, pr }
async function refreshStateSnap(s) {
  const client = clientById(s.client);
  if (!client || s.stateBusy) return;
  s.stateBusy = true;
  try {
    const ask = async () => (await sessionLinks(client, [s.id]))[s.id];
    let links = await ask();
    const branch = links?.current || await branchNow(s.cwd) || '';
    // A pull request opened in the turn just ended: by branch, "none" is otherwise kept for ten minutes.
    const stale = [...ghByBranch].filter(([k, v]) => branch && k.endsWith('|' + branch.toLowerCase()) && Date.now() - v.at > 60000);
    if (stale.length && !branchPr(links?.prs, branch)) { for (const [k] of stale) ghByBranch.delete(k); links = await ask(); }
    stateSnaps.set(s.id, { at: Date.now(), branch, pr: branchPr(links?.prs, branch) });
  } finally { s.stateBusy = false; }
}
function stateLineFor(s, reported = []) {
  const snap = stateSnaps.get(s.id);
  if (!snap || Date.now() - snap.at > 120000) refreshStateSnap(s).catch((e) => console.log('[state line]', e.message));
  return stateLine({ branch: snap?.branch, pr: snap?.pr, kids: kidsOf(s).list.filter((k) => !reported.includes(k.id)), at: snap?.at || Date.now() });
}
setInterval(() => {
  for (const s of live.values()) {
    const pr = stateSnaps.get(s.id)?.pr;
    if (s.status === 'idle' && !s.resting && pr && (pr.status === 'open' || pr.status === 'conflict')) refreshStateSnap(s).catch(() => {});
  }
}, 120000);

// ---------- keeping a waiting parent's prompt cache warm (keep-warm.mjs, #734) ----------
// PORTAL_KEEP_WARM (JSON, e.g. {"afterMin":1,"minTokens":1000}) changes the thresholds, for trying it on the test copy.
const keepWarmCfg = (() => { try { return { ...KEEP_WARM, ...JSON.parse(process.env.PORTAL_KEEP_WARM || '{}') }; } catch { return KEEP_WARM; } })();
// A tiny turn that only reads the cache: nothing in the chat, no report to its parent, no mark, not a wake.
function pingSession(s) {
  s.pingTurn = true; s.quietTurn = true;
  s.turnBy = 'docket'; s.reportTurn = false; s.turnNews = '';
  if (state.sessions[s.id]) { state.sessions[s.id].pingAt = Date.now(); saveState(); } // so a restarted app knows its last reply was a ping
  logEvent(`keep-warm ping: ${sessionTag(s)}`, `last reply ${Math.round((Date.now() - s.stats.at) / 60000)} min ago, ${s.stats.tokens} tokens, ${kidsOf(s).working} working`);
  setStatus(s, 'running');
  s.input.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: PING_TEXT }] }, parent_tool_use_id: null });
}
// The ping's turn ended: the log keeps what it cost and whether it read the cache rather than writing it again.
function endPing(s, m) {
  s.pingTurn = false; s.quietTurn = false;
  const u = m.usage || {}, err = m.is_error || m.subtype !== 'success';
  // total_cost_usd counts the whole run of the session's process, so the ping's own cost is what it added.
  const total = m.total_cost_usd || 0, cost = total >= (s.costSeen || 0) ? total - (s.costSeen || 0) : total;
  s.costSeen = total;
  logEvent(`keep-warm ping done: ${sessionTag(s)}`, `${err ? 'error: ' + (m.result || m.subtype) + '; ' : ''}$${cost.toFixed(4)}, cache read ${u.cache_read_input_tokens || 0}, cache write ${u.cache_creation_input_tokens || 0}, input ${u.input_tokens || 0}, output ${u.output_tokens || 0}`);
  s.stats = statsFor(clientById(s.client), sessionFile(clientById(s.client), s.id)) || s.stats;
  setStatus(s, 'idle');
  pushSession(s);
  setTimeout(() => flushReports(s), 500); // a report that came in during the ping
  return true;
}
function keepWarmTick() {
  const now = Date.now();
  for (const s of live.values()) {
    if (s.status !== 'idle' || !state.sessions[s.id]) continue;
    const busy = !!(s.pendingAsks?.size || s.pendingReports?.length || s.heldTurn || s.compacting || s.reloading || s.waking || runningTasks(s));
    const realReplyAt = s.realReplyAt || realReplyFrom({ lastReplyAt: s.stats?.at, pingAt: state.sessions[s.id].pingAt, cfg: keepWarmCfg });
    const d = keepWarmDue({ engine: s.engine, status: s.status, resting: !!s.resting, paused: !!state.paused, busy, cacheTtl: s.stats?.cacheTtl, tokens: s.stats?.tokens, lastReplyAt: s.stats?.at, realReplyAt, working: kidsOf(s).working, warmSince: s.warmSince || null, now, cfg: keepWarmCfg });
    s.warmSince = d.warmSince;
    if (d.ping) { try { pingSession(s); } catch (e) { s.pingTurn = false; s.quietTurn = false; logEvent(`keep-warm ping failed: ${sessionTag(s)}`, e.message); } }
    else if (!busy) breakCompact(s, now);
  }
}
setInterval(keepWarmTick, keepWarmCfg.checkSec * 1000);
// ---------- compacting at a break, while the cache is warm (recall.mjs, #747) ----------
// PORTAL_COMPACT_BREAK (JSON, e.g. {"share":10,"idleMin":1}) changes the thresholds, for trying it on the test copy.
const breakCfg = (() => { try { return { ...COMPACT_AT_BREAK, ...JSON.parse(process.env.PORTAL_COMPACT_BREAK || '{}') }; } catch { return COMPACT_AT_BREAK; } })();
function breakCompact(s, now = Date.now()) {
  if (live.get(s.id) !== s || (s.engine && s.engine !== 'claude') || s.status !== 'idle' || s.resting || state.paused || s.pendingAsks?.size || s.compacting) return;
  const rec = state.sessions[s.id];
  if (!rec) return;
  const due = breakCompactDue({ tokens: s.stats?.tokens, compactAt: s.stats?.compactAt, lastReplyAt: s.stats?.at, cacheTtl: s.stats?.cacheTtl, compactedAt: rec.compactedAt, sentAt: rec.breakCompactAt,
    saved: !saveShare(clientById(s.client)) || !!rec.savePrompted, now, cfg: breakCfg });
  if (!due) return;
  rec.breakCompactAt = now; saveState();
  const pct = Math.round((s.stats.tokens / s.stats.compactAt) * 100);
  const unread = s.unread, why = s.unreadWhy, said = s.unreadSaid; // the person's unread reply stays unread
  addEvent(s, { k: 'note', text: `Docket compacted this session at a break, at ${pct}% of the point where it compacts, while its cache was still warm.` });
  s.quietTurn = true; s.turnBy = 'docket'; s.reportTurn = false; s.turnNews = '';
  setStatus(s, 'running');
  s.input.push({ type: 'user', message: { role: 'user', content: BREAK_COMPACT }, parent_tool_use_id: null });
  if (unread) { s.unread = true; s.unreadWhy = why; s.unreadSaid = said; }
  logEvent('compact at a break', `${sessionTag(s)} at ${pct}%, ${Math.round((now - s.stats.at) / 60000)} min after its last reply`);
  pushSession(s);
}
// A turn that compacted: what the compaction cost, from the SDK's running totals (costs.mjs usageLeft), kept on its
// chat line and in the log. Only a turn with one compaction can be split this way; the totals are kept for the next.
function compactCost(s, m) {
  const calls = [...(s.turnCalls?.values() || [])], comps = s.turnCompacts || [];
  const seen = s.usageSeen; s.usageSeen = m.modelUsage || s.usageSeen; s.turnCalls = null; s.turnCompacts = null;
  if (comps.length !== 1 || !seen || !m.modelUsage || !s.model) return;
  const ttl = s.stats?.cacheTtl || 300, usage = usageLeft(seen, m.modelUsage, calls, s.model, ttl);
  if (!usage) return;
  let cost = null;
  try { cost = priceReply({ model: s.model, at: Date.now(), usage }, loadPrices(PRICING_FILE)).cost; } catch {}
  const { ev, preTokens } = comps[0];
  const cold = !usage.cache_read_input_tokens && usage.cache_creation_input_tokens > preTokens / 2;
  if (ev && cost != null) { ev.cost = Math.round(cost * 1000) / 1000; ev.cold = cold || undefined; broadcast({ t: 'compact', id: s.id, ev }); }
  logEvent(`compaction cost: ${sessionTag(s)}`, `$${cost?.toFixed(4)}${cold ? ' (cold cache)' : ''}; before ${preTokens}, cache read ${usage.cache_read_input_tokens}, cache write ${usage.cache_creation_input_tokens}, input ${usage.input_tokens}, output ${usage.output_tokens}`);
}
// Save before compact: once a session passes its company's share of the auto-compact point, it is asked once,
// between turns, to write down what a compact summary would lose. One per compact cycle; a session mid-turn gets it
// when the turn ends. savePrompted is kept in the state file so an app restart does not ask again.
function saveBeforeCompact(s) {
  if (live.get(s.id) !== s || (s.engine && s.engine !== 'claude')) return;
  const rec = state.sessions[s.id];
  if (!rec || (rec.compactedAt && !(s.stats?.at > rec.compactedAt))) return;
  const own = saveShare(clientById(s.client)), share = own && breakCfg.share ? Math.min(own, breakCfg.share) : own; // the save goes before Docket's compact at a break
  const due = saveDue({ tokens: s.stats?.tokens, compactAt: s.stats?.compactAt, share, prompted: rec.savePrompted });
  if (due === 'rearm') { delete rec.savePrompted; saveState(); return; }
  if (due !== 'send' || s.status !== 'idle' || s.pendingAsks?.size || s.compacting) return;
  rec.savePrompted = Date.now(); saveState();
  const pct = Math.round((s.stats.tokens / s.stats.compactAt) * 100);
  const unread = s.unread, why = s.unreadWhy, said = s.unreadSaid; // the person's unread reply stays unread
  addEvent(s, { k: 'note', text: `Docket asked this session to save its state: it is at ${pct}% of the point where it compacts.` });
  s.quietTurn = true;
  sendToSession(s, { text: '', system: true, context: SAVE_PROMPT(pct) });
  if (unread) { s.unread = true; s.unreadWhy = why; s.unreadSaid = said; }
  logEvent('save-before-compact', `${sessionTag(s)} at ${pct}%`);
  pushSession(s);
}
// ---------- crossing into another company (the rules are in crossings.mjs) ----------
// A session reaches another company in two ways only, each approved by the person: ask_company (a short read-only
// session in that company answers from its own past sessions; only the answer comes back) and propose_to_company
// (a card in that company's list, run only when the person presses Start there, on that company's sign-in).
const companyName = (id) => clientById(id)?.name || id;
const ASK_MINUTES = 5;
function crossTarget(s, company) {
  const want = String(company || '').trim().toLowerCase();
  const to = CLIENTS.find((c) => c.id.toLowerCase() === want || String(c.name || '').toLowerCase() === want);
  const others = CLIENTS.filter((c) => c.id !== s.client).map((c) => `${c.name} (${c.id})`).join(', ') || 'none';
  if (!to) throw new Error(`There is no desk "${company}" in Docket. The other desks are: ${others}.`);
  if (to.id === s.client) throw new Error(`${to.name} is this session's own desk: use the usual session tools instead.`);
  if (!canPair(s.client, to.id)) throw new Error(`Docket does not let ${companyName(s.client)} send anything to ${to.name}.`);
  return to;
}
function logCrossing(kind, fields) {
  const l = crossingLog({ kind, ...fields });
  logEvent(l.what, l.detail);
}
// The person approves the first crossing from this session into that company, on a card that shows the company and
// the exact text. A later one into the same company goes through and leaves a line in the chat saying what was sent.
// The card is saved (see saveCard), so a call sent again after an app restart waits on the same card.
function approveCrossing(s, { kind, to, title = '', text }) {
  if (isApproved(s, to.id)) {
    addEvent(s, { k: 'note', text: `${kind === 'ask' ? 'Asked' : 'Handed to'} ${to.name} without asking again (you approved ${to.name} earlier in this session): ${clip(title ? `${title}: ${text}` : text, 400)}` });
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let ev = state.sessions[s.id]?.cards?.find((c) => c.ev.k === 'cross' && c.ev.state === 'pending' && c.ev.kind === kind && c.ev.to === to.id && c.ev.title === title && c.ev.text === text)?.ev;
    const again = !!ev;
    ev ||= { k: 'cross', id: 'cross_' + randomUUID().slice(0, 8), kind, to: to.id, toName: to.name, fromName: companyName(s.client), title, text, state: 'pending' };
    s.pendingAsks ||= new Map();
    s.pendingAsks.set(ev.id, { ev, resolve: (ok) => {
      ev.state = ok ? 'sent' : 'stopped';
      if (ok) approve(s, to.id);
      saveState();
      updateCard(s, ev);
      resolve(ok);
    } });
    if (!again) saveCard(s, ev);
    if (!s.events.includes(ev)) addEvent(s, ev);
    setUnread(s, 'cross');
    setStatus(s, 'requires_action');
    pushSession(s);
  });
}
function answerCrossing(s, id, send) {
  const ask = s?.pendingAsks?.get(id);
  if (!ask || ask.ev.k !== 'cross') return false;
  s.pendingAsks.delete(id);
  ask.resolve(!!send);
  if (!s.pendingAsks.size) setStatus(s, 'running');
  return true;
}
// A card whose tool call is gone (Docket restarted and the call was not sent again): nothing crosses.
function expireCrossing(sessionId, id) {
  const ev = savedCard(sessionId, 'cross', id);
  if (!ev || ev.state !== 'pending') return false;
  ev.state = 'expired';
  saveState();
  updateCard({ id: sessionId }, ev);
  return true;
}

// What ask_company's question session can search and read: Claude's saved conversations, and every session
// whose chat Docket keeps (one another AI runs), each with its title and the day it was last active. skip is the
// question session itself.
async function pastRows(client) {
  const rows = [...await history(client).catch(() => [])];
  const seen = new Set(rows.map((r) => r.id));
  for (const [id, file] of keptChatFiles(client)) {
    if (seen.has(id)) continue;
    let at = state.sessions[id].createdAt || 0;
    try { at = fs.statSync(file).mtimeMs; } catch {}
    rows.push({ id, title: state.sessions[id].title || 'Untitled', lastModified: at });
  }
  return rows;
}
const dayOf = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '?');
// only: a set of session ids to keep to (a group's sessions), or nothing for every past session.
async function searchPast(client, words, skip, only) {
  await refreshText(client).catch(() => {});
  const hits = Object.entries(textIndex(client).search(words)).filter(([sid]) => sid !== skip && (!only || only.has(sid)));
  const rows = await pastRows(client);
  const out = hits.slice(0, 25).map(([sid, snip]) => {
    const r = rows.find((x) => x.id === sid);
    return `${sid}  ${dayOf(r?.lastModified)}  ${r?.title || '(untitled)'}\n  ${snip}`;
  });
  return out.length ? `${hits.length} session(s) match${hits.length > 25 ? ', showing 25' : ''}:\n${out.join('\n')}` : 'No past session holds those words.';
}
// A past session's typed chat, or null when it is not one of this company's past sessions.
async function readPast(client, sid, skip, only) {
  const r = sid !== skip && (!only || only.has(sid)) && (await pastRows(client)).find((x) => x.id === sid);
  if (!r) return null;
  const evs = await loadTranscript(client, sid).catch(() => []);
  let text = evs.filter((e) => (e.k === 'user' || e.k === 'text') && e.text).map((e) => `${e.k === 'user' ? 'Person' : 'Reply'}: ${e.text}`).join('\n\n');
  if (text.length > 40000) text = text.slice(0, 15000) + '\n\n[... middle left out ...]\n\n' + text.slice(-25000);
  return `Title: ${r.title}\nLast active: ${dayOf(r.lastModified)}\n\n${text}`;
}

// A session's group mates: the other sessions of its desk in the same group, archived and finished ones
// included, from the last session list built (read from disk when none is in memory), the sessions running now
// and Docket's own records. Kept in step so the first-message note can use it.
function groupMates(client, id) {
  const gid = client && effectiveGroup(client, id);
  if (!gid) return { gid: null, ids: new Set() };
  let rows = historyCache.get(client.id)?.rows;
  if (!rows) try { rows = JSON.parse(fs.readFileSync(historyDisk(client.id), 'utf8')); } catch {}
  const ids = new Set([...(Array.isArray(rows) ? rows : []).map((r) => r.id),
    ...[...live.values()].filter((x) => x.client === client.id).map((x) => x.id),
    ...Object.entries(state.sessions).filter(([, r]) => r.client === client.id).map(([k]) => k)]);
  ids.delete(id);
  for (const x of ids) if (wasDeleted(x) || effectiveGroup(client, x) !== gid) ids.delete(x);
  return { gid, ids };
}
// The one-off note naming a session's group, on its first message and again after a move to another group.
// Nothing when it has no group or the group has no other sessions.
function groupNote(s) {
  const client = clientById(s.client);
  if (!client) return '';
  const rec = (state.sessions[s.id] ||= { client: client.id });
  const { gid, ids } = groupMates(client, s.id);
  if (rec.groupNoted !== undefined && rec.groupNoted === (gid || '')) return '';
  rec.groupNoted = gid || '';
  saveState();
  if (!gid || !ids.size) return '';
  const n = ids.size;
  return `(From Docket: this session is in the group "${groupById(client.id, gid).name}", with ${n} earlier session${n === 1 ? '' : 's'}. To find earlier work from this group, use mcp__portal__search_group_sessions / read_group_session.)`;
}

// ask_company: a short session in the target company, on its own home, sign-in and memory, that can only search and
// read that company's past sessions and the files in its own home and folder. It is saved like any session, so it
// shows in that company's list as a record. Only its final reply goes back.
// The tools the answering session has: search and read the company's past sessions, and (codex: a Codex session,
// which reaches them through tools-helper.mjs like Docket's own tools) read a file in the company's own folders.
function pastTools(to, id, codex) {
  return [
    tool('search_past_sessions', `Search what was typed in ${to.name}'s past sessions (case-insensitive plain text). Returns matching sessions with a snippet.`,
      { words: z.string().describe('A short phrase or word to look for') },
      async ({ words }) => ({ content: [{ type: 'text', text: await searchPast(to, words, id) }] })),
    tool('read_past_session', `Read what was typed in one of ${to.name}'s past sessions: the person's messages and the replies, without tool output.`,
      { id: z.string().describe('The session id from search_past_sessions') },
      async ({ id: sid }) => {
        const text = await readPast(to, sid, id);
        return text ? { content: [{ type: 'text', text }] } : { content: [{ type: 'text', text: `No past session with that id in ${to.name}.` }], isError: true };
      }),
    ...(codex ? [tool('read_desk_file', `Read a text file in ${to.name}'s own folder or home folder (the first 100,000 characters).`,
      { path: z.string().describe(`A full path, or one inside ${to.name}'s folder`) },
      async ({ path: p }) => {
        if (!insideCompany(p, to)) return { content: [{ type: 'text', text: `This session can only read ${to.name}'s own files.` }], isError: true };
        try { return { content: [{ type: 'text', text: fs.readFileSync(path.resolve(to.folder || to.home, p), 'utf8').slice(0, 100000) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `Could not read it: ${e.message}` }], isError: true }; }
      })] : []),
  ];
}
// Tool lists for sessions that are not in Docket's list of live ones (a Codex question session), by session id.
const askToolSets = new Map();
let appJobs = 0; // ask_desk runs going in this app
async function askCompany(from, to, question, s) {
  const id = randomUUID();
  const title = clip(`Question from ${from.name}: ${question}`, 70);
  const cwd = to.folder && fs.existsSync(to.folder) ? to.folder : undefined;
  // The answering session runs on the company's default brand when that is Codex and Codex is signed in; else Claude.
  const codex = defaultEngineOf(to) === 'codex' && await authStatus(to, false, 'codex');
  state.sessions[id] = { client: to.id, title, titleBy: 'you', crossFrom: { client: from.id, session: s.id }, createdAt: Date.now(), ...(codex ? { engine: 'codex', cwd: cwd || to.folder } : {}) };
  saveState();
  appJobs++; // runs in this app: a restart now would cut it off
  try {
    const answer = codex ? await askCompanyOnCodex(from, to, question, id, cwd) : await askCompanyOnClaude(from, to, question, id, cwd, title);
    return { id, answer };
  } finally { appJobs--; }
}
// The Codex question session: Codex's own command and file tools turned off and its sandbox read-only, so it has only
// the past tools (through tools-helper.mjs); it is refused anything else without asking. Docket keeps its chat, as for
// any Codex session, so it shows in that company's list as a record.
async function askCompanyOnCodex(from, to, question, id, cwd) {
  askToolSets.set(id, pastTools(to, id, true));
  const [command, args] = codexCommand(findCodexExe(), ['app-server', '--disable', 'shell_tool', '--disable', 'unified_exec']);
  const message = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: question }] }, parent_tool_use_id: null };
  keepChat(id, { type: 'docket_start' }); keepChat(id, message);
  const q = startCodex({
    options: { command, args, env: envFor(to, 'codex'), cwd: cwd || to.codexHome, sandbox: 'read-only', permissionMode: 'default',
      allowTools: pastTools(to, id, true).map((t) => `mcp__past__${t.name}`), denyOthers: true,
      rules: answerInstructions(from.name, to.name, { fileTool: true }),
      config: { mcp_servers: { past: codexServer(portalTools(id)) } } },
    input: (async function* () { yield message; })(),
    canUseTool: async () => ({ behavior: 'deny' }),
  });
  let answer = '', timedOut = false;
  const timer = setTimeout(() => { timedOut = true; q.close(); }, ASK_MINUTES * 60000);
  try {
    for await (const m of q) {
      if (m.session_id && !(state.sessions[id].codexIds || []).includes(m.session_id)) { Object.assign(state.sessions[id], { codexIds: [...(state.sessions[id].codexIds || []), m.session_id], codexConversation: m.session_id }); saveState(); }
      if (['assistant', 'user', 'result'].includes(m.type)) keepChat(id, m);
      if (m.type !== 'result') continue;
      answer = m.subtype === 'success' ? (m.result || '') : '';
      if (!answer) throw new Error(m.result || `${to.name}'s session did not finish an answer`);
      break;
    }
    if (!answer) throw new Error(`${to.name}'s session did not finish an answer`);
  } catch (e) {
    throw new Error(timedOut ? `${to.name}'s session took longer than ${ASK_MINUTES} minutes and was stopped` : e.message);
  } finally {
    clearTimeout(timer); q.close(); askToolSets.delete(id);
    historyCache.delete(to.id); broadcast({ t: 'history-ready', client: to.id });
    setTimeout(() => refreshCodexUsage(id), 1000);
  }
  logEvent('ask_desk finished', `${id} in ${to.id} on Codex`);
  return answer;
}
async function askCompanyOnClaude(from, to, question, id, cwd, title) {
  const past = createSdkMcpServer({ name: 'past', version: '1.0.0', tools: pastTools(to, id, false) });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASK_MINUTES * 60000);
  const q = query({ prompt: question, options: {
    env: envFor(to), ...claudeSettings(to), ...(cwd ? { cwd } : {}), sessionId: id, title, abortController: abort,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: answerInstructions(from.name, to.name) },
    tools: ['Read', 'Grep', 'Glob'], mcpServers: { past }, strictMcpConfig: true, settingSources: ['user', 'project', 'local'],
    permissionMode: 'default', maxTurns: 25,
    // Read-only, and only inside the company's own home and folder.
    canUseTool: async (name, input) => {
      if (name.startsWith('mcp__past__')) return { behavior: 'allow', updatedInput: input };
      if (['Read', 'Grep', 'Glob'].includes(name) && insideCompany(input.file_path || input.path, to)) return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: `This session can only read ${to.name}'s own past sessions and files.` };
    },
  } });
  let answer = '', cost = 0;
  try {
    for await (const m of q) {
      if (m.type !== 'result') continue;
      cost = m.total_cost_usd || 0;
      answer = m.subtype === 'success' ? (m.result || '') : '';
      if (!answer) throw new Error(m.errors?.[0] || `${to.name}'s session did not finish an answer`);
    }
  } catch (e) {
    throw new Error(abort.signal.aborted ? `${to.name}'s session took longer than ${ASK_MINUTES} minutes and was stopped` : e.message);
  } finally {
    clearTimeout(timer); q.close();
    historyCache.delete(to.id); broadcast({ t: 'history-ready', client: to.id });
  }
  logEvent('ask_desk finished', `${id} in ${to.id}, $${cost.toFixed(4)}`);
  return answer;
}

// propose_to_company: a card in the target company's list (state.inbox), started only by the person there.
const inboxOf = (clientId) => ((state.inbox ||= {})[clientId] ||= []);
function proposeToCompany(s, to, { title, brief, folder }) {
  const cwd = folder && insideCompany(folder, to) && fs.existsSync(folder) ? folder : to.folder;
  const item = addToInbox(inboxOf(to.id), {
    id: 'inbox_' + randomUUID().slice(0, 8), from: s.client, fromName: companyName(s.client), fromSession: s.id, fromTitle: s.title || '',
    title: clip(title, 80) || 'Handed over', brief, cwd, at: Date.now(),
  });
  saveState();
  broadcast({ t: 'inbox', client: to.id });
  return item;
}
function startInbox(clientId, id) {
  const to = clientById(clientId);
  const it = inboxOf(clientId).find((x) => x.id === id);
  if (!to || !it || it.state !== 'open') throw new Error('That card is no longer open');
  const child = startSession({ clientId: to.id, cwd: it.cwd, title: it.title });
  state.sessions[child.id].titleBy = 'you';
  state.sessions[child.id].crossFrom = { client: it.from, session: it.fromSession };
  sendToSession(child, { text: it.brief, attachments: [], context: `(From Docket: this work was handed over from the desk "${it.fromName}" and the user pressed Start in ${to.name}'s list. It runs on ${to.name}'s own sign-in and is billed to ${to.name}. Nothing you write here goes back to ${it.fromName}.)` });
  settleInbox(inboxOf(clientId), id, 'started', child.id);
  saveState();
  logCrossing('start', { from: it.from, to: to.id, session: it.fromSession, title: it.fromTitle, text: `${it.title}\n(started as ${child.id})` });
  broadcast({ t: 'inbox', client: to.id });
  return child;
}
function dismissInbox(clientId, id) {
  const it = settleInbox(inboxOf(clientId), id, 'dismissed');
  if (!it) throw new Error('That card is no longer open');
  saveState();
  logEvent('handoff from another company dismissed', `${it.from} -> ${clientId}: ${it.title}`);
  broadcast({ t: 'inbox', client: clientId });
}

// Instructions only some sessions read: prompts/optional/<name>.
function optionalPrompt(name) {
  try { return fs.readFileSync(path.join(ROOT, 'prompts', 'optional', name), 'utf8').trim(); } catch { return ''; }
}
// A desk sends real work to child sessions on its own unless it turned that off (splitWork false: the Switches on
// the Inspector, or the setup wizard), with prompts/optional/split-work.md. Starting one when the user asks stays for every desk.
const splitOn = (client) => client?.splitWork !== false;
// Everything Docket adds to a session's instructions, in order.
const sessionRules = (s) => [APPEND_PROMPT, promptAppends(), splitOn(clientById(s.client)) ? optionalPrompt('split-work.md') : '', shiftRules(s), planRules(s)].filter(Boolean).join('\n\n');
// Extra instructions every session reads when it starts: prompts/*.md, in name order.
function promptAppends() {
  const dir = path.join(ROOT, 'prompts');
  try { return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => fs.readFileSync(path.join(dir, n), 'utf8').trim()).join('\n\n'); }
  catch { return ''; }
}

const APPEND_PROMPT = `You are running inside Docket, the user's session portal, a page on their computer that shows many sessions side by side.
You also have a private browser (the mcp__playwright__ tools). It starts with the sign-ins the user saved for this client. If a site needs a sign-in it does not have, call mcp__portal__needs_signin with the site (the globe button in the portal then blinks so the user can sign in there) and say so in your reply; never type their passwords.
When you create or update a file the user should look at (a report, page, spreadsheet, document, image or export), call mcp__portal__present_file with its full path so it shows in the portal's Files list, where the user opens it.`;

// The AI brands a session can run on. A company has a brand set up when its entry in the company
// list has that brand's home folder, which holds its sign-in: Claude by "home" (every company has one), Grok by
// "grokHome", Codex by "codexHome". Each brand signs in on its own, and each session runs on the brand
// picked when it started; "defaultEngine" is what a new session gets when nobody picks. "brandsOff" lists the
// brands unticked on the Companies screen: their home folder stays in the entry (and on disk, with its sign-in), so
// ticking the brand again picks it back up, but no new session runs on it.
// A Grok session runs `grok agent stdio` through engines/acp.mjs in the runner.
const GROK_EXE = process.env.PORTAL_GROK_EXE || path.join(os.homedir(), '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok');
// A stand-in agent written in JavaScript (the tests' fixtures/fake-acp-agent.mjs) is run with node.
const grokCommand = (args) => /\.m?js$/i.test(GROK_EXE) ? [process.execPath, [GROK_EXE, ...args]] : [GROK_EXE, args];
// A Codex session runs `codex app-server` through engines/codex.mjs.
// shortTools: the brand names Docket's tools server__tool rather than the Claude way (forEngine).
const BRANDS = { claude: { name: 'Claude', home: 'home' }, grok: { name: 'Grok', home: 'grokHome', shortTools: true }, codex: { name: 'Codex', home: 'codexHome' } };
// Every brand but Claude: Docket keeps its chat (keepChat), files its usage under Docket's id from the brand's own ids
// (<brand>Ids), and keeps the brand's id for its conversation (<brand>Conversation) to pick it up again.
const keepsChat = (engine) => !!engine && engine !== 'claude';
const brandIdsKey = (engine) => `${engine}Ids`;
const conversationKey = (engine) => `${engine}Conversation`;
const brandsOf = (client) => Object.keys(BRANDS).filter((e) => client?.[BRANDS[e].home] && !client.brandsOff?.includes(e));
const defaultEngineOf = (client) => brandsOf(client).includes(client?.defaultEngine) ? client.defaultEngine : brandsOf(client)[0] || 'claude';
// A brand to carry over from another session, if this company still has it set up (else the company default).
const keptEngine = (client, engine) => brandsOf(client).includes(engine) ? engine : undefined;
// The brand a new session runs on: the one asked for, which the company must have set up, else the company default.
function engineFor(client, asked) {
  if (!asked) return defaultEngineOf(client);
  if (!BRANDS[asked]) throw new Error(`Unknown brand ${asked}`);
  if (!brandsOf(client).includes(asked)) throw new Error(`${client.name} does not use ${BRANDS[asked].name}. Tick Use ${BRANDS[asked].name} for it in ☰ > Desks`);
  return asked;
}
// Why a session can't be started on this brand for this company, or null when it can: set up, and signed in.
async function brandProblem(client, engine) {
  const name = BRANDS[engine]?.name || engine;
  try { engineFor(client, engine); } catch (e) { return `${e.message}, then sign it in there. No session was started.`; }
  if (!(await authStatus(client, false, engine))) return `${client.name} is not signed in to ${name}. Sign it in beside Use ${name} in ☰ > Desks, then try again. No session was started.`;
  return null;
}
// Sessions of one company talk to each other freely, whatever brand each runs on: these tools never ask
// the person, in any permission mode. Reaching another company (ask_company, propose_to_company) still does.
// Reading the group's past sessions stays inside the desk too, so it never asks either.
const MESSAGING_TOOLS = ['send_to_session', 'list_sessions', 'get_session_report', 'search_group_sessions', 'read_group_session'].map((n) => `mcp__portal__${n}`);
// Docket's instructions name tools the Claude way (mcp__portal__start_session), as Codex does too; Grok calls them
// portal__start_session.
const forEngine = (engine, text) => BRANDS[engine]?.shortTools ? text.replace(/\bmcp__(\w+?)__/g, '$1__') : text;
// An MCP server in the list shape ACP takes: env as [{ name, value }] instead of an object.
const acpServer = (name, t) => ({ name, command: t.command, args: t.args || [], env: Object.entries(t.env || {}).map(([k, v]) => ({ name: k, value: String(v) })) });
// resume: Grok's own id for the conversation to pick up again (grokConversation), if any.
function grokOptions(s, client, resume) {
  // The Docket hooks, as a hook file in the company's Grok home (grok-home.mjs). A failure here must not stop the session.
  try { writeGrokHooks(client.grokHome || path.join(os.homedir(), '.grok'), PLUGIN_DIR); }
  catch (err) { addEvent(s, { k: 'note', text: `The Docket hooks could not be set up for this Grok session: ${err.message}` }); }
  const model = isShift(s) ? shiftModel(s, client) : s.settings.model && !/^(claude|shift|opus|sonnet|haiku)/i.test(s.settings.model) ? s.settings.model : '';
  // -m is an option of grok itself, before `agent`: `grok agent stdio -m` is refused (Grok 1.0.41, checked 2026-10-28).
  const [command, args] = grokCommand([...(model ? ['-m', model] : []), '--permission-mode', 'default', 'agent', 'stdio']);
  return {
    // Grok asks before each tool and engines/acp.mjs answers by Docket's permission mode, so a change of mode mid-session works.
    engine: 'acp', command, args,
    allowTools: MESSAGING_TOOLS,
    ...(resume ? { resume } : {}),
    env: { ...envFor(client, 'grok'), ...shiftHookEnv(s.id) }, cwd: s.cwd,
    permissionMode: s.settings.permissionMode,
    ...(s.settings.effort ? { effort: s.settings.effort } : {}),
    // `grok agent stdio` does not read --rules (checked 2026-10-27), so the engine sends these ahead of the first message.
    rules: forEngine('grok', sessionRules(s)),
    mcpServers: [acpServer('portal', portalTools(s.id)), acpServer('playwright', browserTools(client, s.id))],
  };
}
// An MCP server as a Codex setting (mcp_servers.<name>). Codex gives up on a tool call after 60 seconds unless told
// otherwise, and a Docket tool can wait far longer (an approval card, ask_company), so it is given a day.
const codexServer = (t, extra = {}) => ({ command: t.command, args: t.args || [], env: Object.fromEntries(Object.entries(t.env || {}).map(([k, v]) => [k, String(v)])),
  startup_timeout_sec: 120, tool_timeout_sec: 86400, ...extra });
// A model name for Codex: one picked for Claude (or Shift) means Codex's own default.
const codexModel = (m) => m && !/^(claude|shift|opus|sonnet|haiku|grok)/i.test(m) ? m : '';
// resume: Codex's own id for the conversation to pick up again (codexConversation), if any.
function codexOptions(s, client, resume) {
  const [command, args] = codexCommand(findCodexExe(), ['app-server']);
  return {
    // Codex asks before each command, file change and MCP tool, and engines/codex.mjs answers by Docket's permission mode.
    engine: 'codex', command, args,
    allowTools: MESSAGING_TOOLS,
    ...(resume ? { resume } : {}),
    env: envFor(client, 'codex'), cwd: s.cwd,
    permissionMode: s.settings.permissionMode,
    ...(isShift(s) ? { model: shiftModel(s, client) } : codexModel(s.settings.model) ? { model: s.settings.model } : {}),
    ...(s.settings.effort ? { effort: s.settings.effort } : {}),
    // Codex takes Docket's instructions as its own "developer instructions", at every start and pickup.
    rules: forEngine('codex', sessionRules(s)),
    config: { mcp_servers: { portal: codexServer(portalTools(s.id)), playwright: codexServer(browserTools(client, s.id)) } },
  };
}
const engineOptions = { grok: grokOptions, codex: codexOptions };

// "Shift" sessions start on a gear of their brand (gears.mjs) and change model with the shift_gear tool.
const isShift = (s) => s.settings?.model === 'shift';
// The lower gear a Shift child is held on because its parent chose it (gears.mjs parentHeldGear, #801), or null.
const heldGearOf = (s) => parentHeldGear({ settings: s.settings, brand: s.engine, gear: s.gear || s.model, gearBy: state.sessions[s.id]?.gearBy });
// What the usage record keeps of a Shift session, so a deleted one still counts on the Usage page; null for any other.
const shiftOf = (rec) => (rec && isShift(rec) ? { gear: rec.gear || '', shifts: rec.shifts || [] } : null);
// Every shift goes through here: kept in memory (s.shifts) and in the session's saved record, so its history
// (from, to, when, reason, and who: 'session', 'parent' or 'docket') lasts past a restart and the Usage page can count it.
function recordShift(s, { from, to, reason, by }) {
  const e = shiftEntry({ from, to, reason, by });
  s.shifts = withShift(s.shifts, e);
  const rec = state.sessions[s.id];
  if (rec) rec.shifts = withShift(rec.shifts, e);
  saveState();
  return e;
}
// A parent raising its Shift child's gear (send_to_session's gear), the way shift_gear shifts a session itself.
// The saved record already has the new gear, so a child just picked up again started on it.
async function raiseChild(s, { from, gear }, parent) {
  if (s.gear !== gear.id && s.query) await s.query.setModel(modelFor(clientById(s.client), s.engine, gear.id));
  s.gear = gear.id; s.model = gear.id;
  state.sessions[s.id].gear = gear.id;
  if (state.sessions[s.id].gearBy) { delete state.sessions[s.id].gearBy; s.gearFreed = true; } // raised: no longer held on the gear its parent chose (#801)
  const reason = `Raised by parent session: ${parent.title || parent.id}`;
  recordShift(s, { from: from.id, to: gear.id, reason, by: 'parent' });
  addEvent(s, { k: 'note', text: `Shifted up to ${gear.name}: ${reason}` });
  pushSession(s);
}
// Docket raising a Shift session to its top gear before a file edit or git commit (shift-up.mjs): the plugin
// hook asks before the tool runs (Claude, Grok), and the chat stream catches what no hook asked about (Codex), which
// then runs on the next step. s.shiftedFor: the tool calls chosen on the lower gear, which the hook turns down.
// Returns whether it raised the gear.
async function shiftUpForWork(s, tool, input, toolUseId) {
  const d = shiftUpFor({ settings: s.settings, brand: s.engine, gear: s.gear || s.model, tool, input, held: !!heldGearOf(s) });
  if (!d) return false;
  const { from, to, why } = d;
  // At once, before the model changes: a second call in the same reply does not raise again, and the hook asking
  // about this call meanwhile finds it.
  s.gear = to.id; s.model = to.id;
  if (toolUseId) (s.shiftedFor ||= new Set()).add(toolUseId);
  try { if (s.query) await (s.shiftingUp = s.query.setModel(to.id)); }
  catch (e) { s.gear = from.id; s.model = from.id; s.shiftedFor?.delete(toolUseId); addEvent(s, { k: 'note', text: `Could not shift up to ${to.name} before a ${why}: ${e.message}` }); return false; }
  if (state.sessions[s.id]) state.sessions[s.id].gear = to.id;
  recordShift(s, { from: from.id, to: to.id, reason: why, by: 'docket' });
  addEvent(s, { k: 'note', text: `Shifted up to ${to.name}: ${why}` });
  pushSession(s);
  return true;
}
// The line a plan tool's reply adds for a Shift session that just became a coordinator (#654).
function coordinatorNote(s) {
  if (!isShift(s)) return '';
  const top = usableGear(clientById(s.client), s.engine, topGearOf(s.engine));
  return ` As its coordinator this session runs on ${top.name}, and shift_gear keeps it there until every task is done or dropped.`;
}
// What the hook is told: turn the call down when it was chosen on the lower gear, so the top gear makes it again.
function shiftUpReply(s, raised, toolUseId, subagent) {
  if (subagent || !(raised || s.shiftedFor?.has(toolUseId))) return {};
  const gear = findGear(s.engine, s.gear);
  return { deny: `Docket shifted this session up to ${gear?.name || 'its top gear'} before this change, because it was chosen on a lower gear, so it was not made. Check it and make it again now; this step runs on ${gear?.name || 'the top gear'}.` };
}
// The environment Docket's hook scripts use to reach the app for this session; the token is good for this session's
// hook calls only.
const hookToken = (id) => createHmac('sha256', getToolToken()).update('hook:' + id).digest('hex');
const shiftHookEnv = (id) => ({ DOCKET_URL: `http://127.0.0.1:${PORT}`, DOCKET_SESSION: id, DOCKET_HOOK_TOKEN: hookToken(id) });
// The model a Shift session runs on now: its gear, else (one from before gears were saved) its company's start gear.
const shiftModel = (s, client) => s.gear || usableGear(client, s.engine, startGearOf(s.engine, null, client?.startGear?.[s.engine])).id;
// The shifting rules (prompts/optional/model-shifting.md), with this brand's gears in place of {gears}, {start},
// {mid} and {top}.
// Docket's plan rules (prompts/optional/plans.md), only on a desk whose plan system is Docket's own (#180), and then
// only for a session that uses a plan; any other session there gets two lines (PLAN_HINT, #605). s.planRules records
// which it started with, so the first plan tool it calls can hand it the full rules (withPlanRules).
const planRules = (s) => {
  const use = planUseOf(s);
  s.planRules = use;
  return use === 'full' ? optionalPrompt('plans.md') : use === 'short' ? PLAN_HINT : '';
};
function shiftRules(s) {
  if (!isShift(s)) return '';
  const gears = visibleGears(clientById(s.client), s.engine), start = findGear(s.engine, shiftModel(s, clientById(s.client))) || gears[0];
  // A child held on the lower gear its parent chose gets the rules for staying there instead (#801).
  const held = heldGearOf(s);
  if (held) return optionalPrompt('parent-gear.md').replaceAll('{start}', held.name).replaceAll('{top}', gears[gears.length - 1].key);
  return optionalPrompt('model-shifting.md').replaceAll('{gears}', gears.map((g) => `${g.key} (${g.name})`).join(', '))
    .replaceAll('{start}', start.name).replaceAll('{mid}', gears[Math.min(1, gears.length - 1)].key).replaceAll('{top}', gears[gears.length - 1].key);
}
const PERMISSION_MODES = new Set(['bypassPermissions', 'auto', 'acceptEdits', 'default', 'plan']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
function cleanSettings(b = {}) {
  const out = {};
  if (b.model !== undefined) out.model = b.model === 'shift' || /^[\w.\-\[\]]{0,60}$/.test(b.model) ? b.model : '';
  if (b.effort !== undefined) out.effort = EFFORTS.has(b.effort) ? b.effort : '';
  if (b.permissionMode !== undefined && PERMISSION_MODES.has(b.permissionMode)) out.permissionMode = b.permissionMode;
  return out;
}

// Questions a session asks before acting (every mode except Bypass permissions can ask).
// They show in the chat as Allow / Deny; the session waits, marked as needing the person.
function askPermission(s, toolName, input, opts) {
  return new Promise((resolve) => {
    const reqId = opts.reqId || randomUUID();
    const ev = { k: 'permission', id: reqId, tool: toolName, title: opts.title || '', label: toolLabel(toolName, input), input, state: 'pending' };
    s.pendingAsks = s.pendingAsks || new Map();
    s.pendingAsks.set(reqId, { resolve, input, ev, suggestions: opts.suggestions, at: Date.now() });
    addEvent(s, ev);
    setUnread(s, 'permission');
    setStatus(s, 'requires_action');
    pushSession(s);
    opts.signal?.addEventListener('abort', () => { const ask = s.pendingAsks.get(reqId); if (s.pendingAsks.delete(reqId)) { recordWait(s, ask); ev.state = 'cancelled'; broadcast({ t: 'permission', id: s.id, ev }); } });
  });
}
// answers: the person's picks for an AskUserQuestion form, keyed by question text (skip = deny, so Claude asks in the chat).
function answerPermission(s, reqId, allow, always, answers) {
  const ask = s.pendingAsks?.get(reqId);
  if (!ask) return false;
  const isForm = ask.ev.tool === 'AskUserQuestion';
  if (isForm && allow && !(answers && typeof answers === 'object')) return false;
  s.pendingAsks.delete(reqId);
  recordWait(s, ask);
  ask.ev.state = isForm ? (allow ? 'answered' : 'skipped') : allow ? (always ? 'always' : 'allowed') : 'denied';
  if (isForm && allow) ask.ev.answers = Object.fromEntries(Object.entries(answers).map(([q, a]) => [String(q), String(a)]));
  broadcast({ t: 'permission', id: s.id, ev: ask.ev });
  ask.resolve(isForm
    ? (allow ? { behavior: 'allow', updatedInput: { ...ask.input, answers: ask.ev.answers } }
      : { behavior: 'deny', message: 'The user chose to answer in the chat instead of the form. Ask these questions again as plain text in your reply and wait for their answer.' })
    : allow
    ? { behavior: 'allow', updatedInput: ask.input, ...(always && ask.suggestions ? { updatedPermissions: ask.suggestions } : {}) }
    : { behavior: 'deny', message: 'The user declined this.' });
  if (!s.pendingAsks.size) setStatus(s, 'running');
  return true;
}

// The session as the app knows it (what the page shows), without starting anything.
// engine: the brand a new session runs on (engineFor). A session picked up again keeps the one it started on, and one
// Docket has no record of is a Claude conversation (the only brand whose saved sessions Docket lists).
// record: more of the app's record for it (groupId, scheduleId, editFor...), saved before the page first hears of it,
// so the page never sees it without them (a new session in a group briefly had none, and opened No group).
// A new session given no model is in Shift; one picked up again keeps its saved model, the account default
// included. gear: the gear a Shift session starts on (start_session's start_gear); left out, its company's start
// gear for that brand, else its top gear.
function makeSession({ clientId, cwd, title, parentId, resumeId, settings = {}, engine, record = {}, gear }) {
  const client = clientById(clientId);
  if (!client) throw new Error(`Unknown client ${clientId}`);
  const id = resumeId || randomUUID();
  const saved = state.sessions[id] || {};
  const brand = saved.engine || (resumeId ? 'claude' : engineFor(client, engine));
  const s = {
    id, client: client.id, cwd: cwd || saved.cwd || client.folder, title: title || saved.title || '',
    parentId: parentId ?? saved.parentId ?? (resumeId ? desktopParents(client).get(resumeId) : null) ?? null, status: 'starting', unread: false,
    events: [], tasks: new Map(), textCounter: {}, streamCounter: {}, curText: null,
    createdAt: saved.createdAt || Date.now(), lastActivity: Date.now(), input: new InputQueue(),
  };
  s.settings = sessionSettings(saved.settings, cleanSettings(settings), !!resumeId);
  s.engine = brand;
  s.gear = firstGear({ settings: s.settings, brand, saved: saved.gear, asked: gear, companyStart: client.startGear?.[brand] });
  if (s.gear) s.gear = usableGear(client, brand, findGear(brand, s.gear))?.id || s.gear; // a gear its gateway has no model for
  live.set(id, s);
  if (resumeId) s.stats = statsFor(client, sessionFile(client, id));
  // Where it sits in the list: when it last turned orange, else when it last spoke (an older
  // saved session), else when it was started.
  s.readyAt = saved.readyAt || (resumeId && lastMessageTime(sessionFile(client, id))) || s.createdAt;
  state.sessions[id] = { ...saved, engine: s.engine, settings: s.settings, client: s.client, cwd: s.cwd, title: s.title, parentId: s.parentId, createdAt: s.createdAt, readyAt: s.readyAt, running: true, ...(s.gear ? { gear: s.gear } : {}), ...(!resumeId && brand === 'claude' ? { firstPending: true } : {}), ...record };
  // Who it is billed to, recorded when it starts with no spend yet, so a later change to the desk's sign-in or
  // AWS profile does not move its spend. A session from before this keeps reading today's setup (marked inferred).
  if (!state.sessions[id].via && !usage[id]?.rows?.length) { const bedrock = brand === 'claude' && isBedrock(client); state.sessions[id].via = viaOf(connectionFor(client, brand, bedrock), bedrock); }
  interrupted.delete(id);
  delete state.sessions[id].cutOff; // picked up again
  saveState();
  return s;
}

// The gh account a session runs as: its repo's owner, else its group's last, else the company's default
// (ghDefault in clients.local.json). Returns the token for GH_TOKEN, or '' to leave gh on its active account.
async function ghForSession(s, client) {
  try {
    const env = envFor(client);
    const r = await runCommand('git', ['-C', s.cwd, 'remote', 'get-url', 'origin'], gitEnv(), 10000);
    const owner = r.code === 0 ? githubRepo(r.out).split('/')[0] : '';
    await ghOtherAccounts(env, ''); // fills the account list for this gh config
    const accounts = ghAccountList.get(env.GH_CONFIG_DIR || '')?.accounts || [];
    const gid = effectiveGroup(client, s.id) || '', last = ((state.ghLast ||= {})[client.id] ||= {});
    const pick = ghPick({ owner, accounts, groupLast: last[gid], companyDefault: client.ghDefault });
    if (!pick.login) { logEvent('gh account', `${s.id}: ${pick.why}`); return ''; }
    const token = await ghTokenFor(env, pick.login);
    if (!token) { logEvent('gh account', `${s.id}: no token for ${pick.login}, so the active account`); return ''; }
    if (pick.why.startsWith('repo owner') && last[gid] !== pick.login) { last[gid] = pick.login; saveState(); }
    if (state.sessions[s.id]) { state.sessions[s.id].ghAccount = { login: pick.login, why: pick.why }; saveState(); }
    logEvent('gh account', `${s.id}: ${pick.login} (${pick.why})`);
    const note = ghNote({ owner, ...pick });
    if (note) addEvent(s, { k: 'note', text: note });
    return token;
  } catch (e) { logEvent('gh account failed', e.message); return ''; }
}
// Claude Code's Artifact tool (publishes a file to a claude.ai artifact page) is off by default in the SDK; this
// undocumented variable turns it on, with no browser tab on publish. Artifacts need a claude.ai sign-in, so not on
// Bedrock or a gateway. Set before the desk's own env, which can still turn it off.
const artifactEnv = (client) => isBedrock(client) || gatewayFor(client, 'claude') ? {} : { CLAUDE_CODE_ARTIFACT: '1', CLAUDE_CODE_ARTIFACT_AUTO_OPEN: '0' };
// ---------- big tool results kept on disk (plugin/hooks/big-output.mjs, #748) ----------
// Each Claude session's saved outputs go in data/tool-output/<session>; the hook does nothing without the folder.
const TOOL_OUTPUT = path.join(DATA_DIR, OUTPUT_FOLDER);
const TOOL_OUTPUT_USE = path.join(DATA_DIR, 'tool-output-use.json'); // the counts of folders already removed
const outputEnv = (id) => ({ DOCKET_TOOL_OUTPUT_DIR: path.resolve(TOOL_OUTPUT, id) }); // whole, as the hook runs in the session's folder
const sessionClient = (id) => state.sessions[id]?.client || usage[id]?.client || '';
const doneOutputUse = () => { try { return JSON.parse(fs.readFileSync(TOOL_OUTPUT_USE, 'utf8')); } catch { return []; } };
// Per day and desk: results cut, their characters and what was kept, and reads back (big-output-use.mjs).
const bigOutputUse = () => addRows(doneOutputUse(), ...outputFolders(TOOL_OUTPUT).map((f) => outputUseRows(readLog(path.join(f.dir, OUTPUT_LOG)), sessionClient(f.id))));
// A session folder nothing was written to for KEEP_DAYS goes to the Recycle Bin, its counts kept first.
async function pruneToolOutput() {
  const old = outputFolders(TOOL_OUTPUT).filter((f) => f.newest && Date.now() - f.newest > KEEP_DAYS * 86400000 && !live.get(f.id)?.running);
  if (!old.length) return;
  const rows = addRows(doneOutputUse(), ...old.map((f) => outputUseRows(readLog(path.join(f.dir, OUTPUT_LOG)), sessionClient(f.id))));
  fs.writeFileSync(TOOL_OUTPUT_USE + '.tmp', JSON.stringify(rows)); fs.renameSync(TOOL_OUTPUT_USE + '.tmp', TOOL_OUTPUT_USE);
  await toTrash(old.map((f) => f.dir)).catch((e) => logEvent('old tool output left', e.message));
}
setTimeout(() => pruneToolOutput().catch(() => {}), 5 * 60_000).unref();
setInterval(() => pruneToolOutput().catch(() => {}), 6 * 3600_000).unref();
// fresh: start a new conversation under this id even if Claude Code may have one (a resume of it just failed); last:
// the message that resume was sending, sent again after the first one (#759).
function startSession({ clientId, cwd, title, parentId, resumeId, settings = {}, engine, record, gear, fresh = false, last = null }) {
  const s = makeSession({ clientId, cwd, title, parentId, resumeId, settings, engine, record, gear });
  const client = clientById(s.client), id = s.id;
  // Picked up again with no conversation to resume: its first message never reached Claude Code. A new conversation
  // under the same id, so the row, its parent and links stay as they are; the next message sends the first one first.
  const mode = startMode({ engine: s.engine, resumeId, hasTranscript: !!(resumeId && client && sessionFile(client, id)), fresh });
  if (mode === 'fresh') s.freshStart = { last };
  // A session running again is open: an archived one leaves the archive, so the list and its record agree (#717).
  if (resumeId && client && isArchived(client, id)) setArchived(client.id, id, false);
  if (resumeId && s.cwd && !fs.existsSync(s.cwd) && !protectedFolder(s.cwd)) {
    // Its conversation is filed under that folder, so it has to exist; Docket removes it again afterwards.
    fs.mkdirSync(s.cwd, { recursive: true });
    queueFolderRemoval(s.cwd, id);
  }
  // A Grok or Codex session picks up its earlier conversation when Docket has the brand's id for it: sessions
  // from before that cannot. The chat itself shows either way, from Docket's copy (keepChat).
  const conversation = keepsChat(s.engine) && resumeId ? state.sessions[id]?.[conversationKey(s.engine)] : '';
  if (keepsChat(s.engine) && resumeId && !conversation) brandNote(s, newConversationNote(s.engine));
  const options = engineOptions[s.engine] ? engineOptions[s.engine](s, client, conversation) : {
    cwd: s.cwd,
    env: { ...artifactEnv(client), ...envFor(client, 'claude', id), ...shiftHookEnv(id), ...outputEnv(id) },
    ...claudeSettings(client),
    // The settings layers the desk turned off on its profile page; left out, Claude Code loads all three.
    ...(client.settingSources ? { settingSources: client.settingSources } : {}),
    ...(mode === 'resume' ? { resume: resumeId } : { sessionId: id, ...(s.title ? { title: s.title } : {}) }),
    permissionMode: s.settings.permissionMode,
    allowDangerouslySkipPermissions: true,
    allowedTools: MESSAGING_TOOLS,
    ...(s.settings.model ? { model: modelFor(client, 'claude', isShift(s) ? shiftModel(s, client) : s.settings.model) } : {}),
    ...(s.settings.effort ? { effort: s.settings.effort } : {}),
    includePartialMessages: true,
    includeHookEvents: true, // when hooks run, so the step times can show them apart (#743)
    agentProgressSummaries: true,
    promptSuggestions: true,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: sessionRules(s) },
    mcpServers: { ...sharedMcp.forSession(client, s.cwd), portal: portalTools(id), playwright: browserTools(client, id) },
    plugins: [{ type: 'local', path: PLUGIN_DIR }],
  };
  const print = (s.engine || 'claude') === 'claude' ? configNow(s) : null; // the config this process starts with (config-watch.mjs)
  // The runner starts it, or reconnects if it is still running there (s.runnerSeq: read from the start).
  s.asyncHooks = asyncHookEvents(hookSettings(client, s.cwd)); // the hook events the step times leave out (#743)
  let browserHelper = '';
  s.ready = ensureRunner().then(() => ghForSession(s, client)).then((gh) => { if (gh) options.env = { ...options.env, GH_TOKEN: gh }; })
    .then(() => useDeskBrowser(s, client, options)).then((name) => { browserHelper = name; })
    // A start that never got an answer (the runner restarting, or too busy to answer) is tried again for about a
    // minute, starting the runner if it is gone; the runner attaches to a start that did get there (#759).
    .then(() => withRetries((i) => (i ? ensureRunner() : Promise.resolve()).then(() => runnerCall(`/sessions/${id}/start`, { options })), {
      onRetry: (err, n, wait) => {
        if (n === 1) addEvent(s, { k: 'note', text: `Could not reach the session runner (${netText(err)}), so Docket is trying again` });
        logEvent(`start retry ${n}: ${sessionTag(s)}`, `${netText(err)}; again in ${wait / 1000}s`);
      },
    }))
    .then((r) => {
      if (r.attached) s.runnerSeq = r.seq;
      else if (state.sessions[id]) { state.sessions[id].processStart = Date.now(); state.sessions[id].browserHelper = browserHelper; if (print) state.sessions[id].configPrint = print; saveState(); } // see repairTasks
      if (!r.attached && keepsChat(s.engine)) keepChat(id, { type: 'docket_start' }); // the runner numbers this run's messages from 1
      s.configReady = true;
    });
  s.ready.catch(() => {});
  Object.assign(s, remoteSession(s));
  runLoop(s);
  pushSession(s);
  return s;
}

function saveUploads(id, attachments) {
  const dir = path.join(UPLOADS, id);
  const files = [];
  for (const a of attachments) {
    fs.mkdirSync(dir, { recursive: true });
    const safe = (a.name || 'pasted').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const file = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(file, Buffer.from(a.data, 'base64'));
    files.push({ ...a, file });
  }
  return files;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// ---------- a session whose first message never reached Claude Code (the rules are in first-start.mjs, #759) ----------
// Kept from the first send until Claude Code answers, so a start the runner never got can be made again.
const firsts = firstStore(path.join(DATA_DIR, 'first-messages'));
// Claude Code has the session's conversation now: nothing to start afresh any more.
function gotThrough(s) {
  s.freshStart = null;
  const rec = state.sessions[s.id];
  if (!rec?.firstPending && !rec?.freshTried) return;
  delete rec.firstPending; delete rec.freshTried; saveState();
  firsts.drop(s.id);
}
// A session started afresh sends its first message before anything else, once. True when it sent one.
function sendFirst(s) {
  const fresh = s.freshStart;
  if (!fresh || fresh.sent) return false;
  fresh.sent = true;
  const kept = firsts.read(s.id);
  const msg = firstMessage({ kept, events: s.events, last: fresh.last });
  if (!msg) return false;
  const text = (msg.message?.content || []).find((b) => b.type === 'text')?.text || '';
  if (text && !s.events.some((e) => e.k === 'user')) addEvent(s, { k: 'user', text: text.split('\n\n(From Docket')[0] }); // the chat shows the brief it runs
  addEvent(s, { k: 'note', text: `Its first message never reached Claude Code, so Docket started this session afresh${kept ? ' with that message' : ', with the first message its chat shows'}` });
  logEvent(`started afresh with its first message: ${sessionTag(s)}`, kept ? 'the kept first message' : fresh.last && msg === fresh.last ? 'the last message sent' : 'the first message in its chat');
  s.titleNoted = true; // the kept message has the title line already
  s.unread = false; setLastError(s, null); setStatus(s, 'running');
  s.lastMessage = msg; s.lastNudge = false;
  s.input.push(msg);
  // A resume that failed was sending something else (not a mere "carry on"): it goes next.
  if (fresh.last && fresh.last !== msg) s.input.push(fresh.last);
  return true;
}
// from: 'session' when another session wrote the text, so the page can tell it from what the person typed
// news: what makes this turn's report only news for its parent (turnNewsFor in reports.mjs), '' for none.
// reported: the children whose finished turns this report carries, not counted as working in the state line.
function sendToSession(s, { text, attachments = [], context = '', system = false, from = '', byPerson = false, report = false, news = '', reported = [] }) {
  if (holdsMessage(state.paused, { system, from })) { // waits for Resume all
    state.paused.held.push({ id: s.id, client: s.client, text, attachments, context, system, from, byPerson, report, news });
    saveState();
    return;
  }
  if (state.paused && !system && noteMessaged(state.paused, s.id)) { saveState(); broadcastPause(); }
  // Resting: started again first, and the message goes to the new process.
  if (s.resting) { s.reloadQueue.push({ text, attachments, context, system, from, byPerson, report, news }); wakeSession(s).catch((e) => logEvent(`wake failed: ${sessionTag(s)}`, e.message)); return; }
  // Its Claude config changed and it may restart now: restarted first, and the message goes to the new process.
  if (s.reloading || checkConfig(s) === 'reload') { s.reloadQueue.push({ text, attachments, context, system, from, byPerson, report, news }); return; }
  // Started afresh: its first message goes first, and a mere "carry on" after it means nothing (#759).
  if (sendFirst(s) && continueNudge({ text, system, context })) return;
  const files = saveUploads(s.id, attachments);
  const blocks = [];
  const images = [];
  const notes = [];
  for (const f of files) {
    if (IMAGE_TYPES.has(f.type)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: f.type, data: f.data } });
      images.push(`data:${f.type};base64,${f.data}`);
      notes.push(`(Image also saved at ${f.file})`);
    } else {
      notes.push(`Attached file "${f.name}" saved at: ${f.file}`);
    }
  }
  const full = [text, ...notes].filter(Boolean).join('\n\n');
  if (full) blocks.push({ type: 'text', text: full });
  if (context) blocks.push({ type: 'text', text: context }); // for Claude only; the chat shows just what the person typed
  const held = state.sessions[s.id]?.heldNews;
  if (held?.length && blocks.length) { blocks.push({ type: 'text', text: heldNewsText(held) }); delete state.sessions[s.id].heldNews; saveState(); } // news-only reports ride along (#734)
  if (state.sessions[s.id]?.moveNote) { blocks.push({ type: 'text', text: state.sessions[s.id].moveNote }); delete state.sessions[s.id].moveNote; saveState(); }
  if (state.sessions[s.id]?.restartNote) { blocks.push({ type: 'text', text: RUNNER_RESTART_NOTE }); delete state.sessions[s.id].restartNote; saveState(); }
  if (state.sessions[s.id]?.recallNote) { blocks.push({ type: 'text', text: RECALL_NOTE }); delete state.sessions[s.id].recallNote; saveState(); }
  if (s.gearFreed && isShift(s)) { blocks.push({ type: 'text', text: '(From the session portal: your parent session raised this session, so it is no longer held on the gear it chose. These rules replace "Your gear" in your instructions.)\n\n' + shiftRules(s) }); s.gearFreed = false; }
  if (s.shiftRulesPending && isShift(s)) { blocks.push({ type: 'text', text: '(From the session portal: this session was switched to Shift mode.)\n\n' + shiftRules(s) }); s.shiftRulesPending = false; }
  if (!blocks.length) return;
  if (system) { const line = stateLineFor(s, reported); if (line) blocks.push({ type: 'text', text: line }); } // reports and notices (#749)
  s.turnBy = turnStarter({ system, from, byPerson }); // whether its report counts toward the parent's wake limit
  s.reportTurn = !!report; // woken by session reports: the only turn that may end quietly (quietRefusal)
  s.turnNews = news; // its report is only news for the parent (#734)
  if (state.sessions[s.id]?.lastDone) { delete state.sessions[s.id].lastDone; saveState(); } // a turn runs: done again only if it says so (#755)
  s.turnSaid = '';
  s.startedKids = 0; // start_session (user_asked) this turn: see endTurnMark (#777)
  s.closedKid = false; // close_session this turn: with no other child open, the job is done (#694)
  if (byPerson) s.autoWakes = 0; // a button the person pressed: wake-ups may continue
  if (state.sessions[s.id]?.reloadNote) { blocks.push({ type: 'text', text: state.sessions[s.id].reloadNote }); delete state.sessions[s.id].reloadNote; saveState(); }
  const rules = rulesToReread(s);
  if (rules.length) blocks.push({ type: 'text', text: rulesNote(rules) });
  if (!s.title && text && !system) { s.title = text.split('\n')[0].slice(0, 60); state.sessions[s.id].title = s.title; state.sessions[s.id].titleBy = 'first-message'; saveState(); }
  if (!s.titleNoted && s.title) {
    const how = { 'first-message': 'made from the start of the first message. In this reply, once you know what the work is, call mcp__portal__rename_session (asked_by_user false) with a short title that names the work', claude: 'one you chose earlier', you: 'one the user chose' }[titleBy(s.id)];
    blocks.push({ type: 'text', text: `(From Docket: this session's title is "${s.title}", ${how}.)` });
    s.titleNoted = true;
  }
  const group = groupNote(s);
  if (group) blocks.push({ type: 'text', text: group });
  if (!system) {
    dropRetries(s);
    s.queuedAt = Date.now(); // a step that started before this has someone waiting on it (stalledSteps)
    addEvent(s, { k: 'user', text, images, files: files.filter((f) => !IMAGE_TYPES.has(f.type)).map((f) => f.name), ...(from ? { from } : {}), ...(from && context ? { context } : {}) }); // context: who sent it, for the page (#708)
    s.autoWakes = 0; // the person wrote: wake-ups may continue
    s.kidNews = false; // the person is in this session: the report it took in quietly is seen
  }
  s.unread = false;
  if (state.sessions[s.id]?.readWhy) { delete state.sessions[s.id].readWhy; saveState(); } // a new turn: the reason read before no longer fits (#771)
  s.suggestion = '';
  setLastError(s, null);
  setStatus(s, 'running');
  const content = blocks.map((b) => b.type === 'text' ? { ...b, text: forEngine(s.engine, b.text) } : b);
  const message = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  if (keepsChat(s.engine)) keepChat(s.id, message);
  if (state.sessions[s.id]?.firstPending) firsts.save(s.id, message); // until Claude Code answers (gotThrough)
  s.lastMessage = message; s.lastNudge = continueNudge({ text, system, context });
  s.input.push(message);
}

// ---------- automatic pause on sleep, hibernate and shutdown ----------
// A small helper (power-watch.ps1 on Windows, power-watch-mac.js on a Mac; see platform.mjs) says when the
// computer is about to sleep or shut down, and when it wakes: Docket runs pauseAll before and resumeAll
// after. Back-ups for a warning that never came or came too late: the wake check (a 30 second timer that
// finds 5+ minutes passed) and the restart check (an automatic pause still saved when Docket starts).
// A pause the person made with the button is never ended by any of these. ☰ > Settings > Pause on sleep turns it off.
const autoPauseOn = () => state.autoPause !== false;
let wokeAt = 0, shutdownTimer = null;
function onWake(source) {
  if (!autoPauseOn() || Date.now() - wokeAt < 120000) return; // the helper and the clock both noticed
  wokeAt = Date.now();
  if (autoPaused(state.paused)) {
    logEvent(`woke (${source})`, 'resuming the automatic pause in a few seconds');
    setTimeout(() => { if (autoPaused(state.paused)) resumeAll('wake').catch((e) => logEvent('resume after wake failed', e.message)); }, 5000);
  } else if (!state.paused && source === 'clock' && workingSessions().length) {
    // It slept with no warning: steps that were running may be stuck on what the sleep cut off.
    logEvent('woke (clock) with no sleep warning', 'pausing and resuming the sessions that were working');
    pauseAll('slept').then(() => new Promise((r) => setTimeout(r, 3000))).then(() => resumeAll('wake')).catch((e) => logEvent('pause after unwarned sleep failed', e.message));
  }
}
function onPower(ev) {
  if (ev === 'ready') return logEvent('power watch started');
  logEvent(`power: ${ev}`);
  if (ev === 'wake') return onWake('helper');
  if (!autoPauseOn()) return;
  pauseAll(ev).catch((e) => logEvent('automatic pause failed', e.message)); // saves the list at once, before anything waits
  if (ev === 'shutdown') { // a shutdown can be cancelled, and then nothing wakes: resume if Docket is still here
    clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => { if (state.paused?.reason === 'shutdown') resumeAll('shutdown cancelled').catch(() => {}); }, 3 * 60000);
  }
}
let powerWatch = null;
function startPowerWatch() {
  const c = powerWatchCommand({ root: ROOT, parentPid: process.pid });
  if (!c) return;
  const child = spawn(c.cmd, c.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  child[c.stream].on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) { const ev = powerEvent(buf.slice(0, i)); if (ev) onPower(ev); }
  });
  child.on('error', (e) => logEvent('power watch could not start', e.message));
  child.on('exit', (code) => { if (powerWatch !== child) return; powerWatch = null; logEvent('power watch stopped', `exit ${code}; trying again in 5 minutes`); setTimeout(startPowerWatch, 5 * 60000); });
  powerWatch = child;
}
process.on('exit', () => { const c = powerWatch; powerWatch = null; c?.kill(); });
startPowerWatch();
let lastTick = Date.now();
setInterval(() => { const now = Date.now(); if (clockJumped(lastTick, now)) onWake('clock'); lastTick = now; }, 30000);

// ---------- the runner: a separate program that holds the live sessions (runner.mjs) ----------
// ---------- ☰ > Gauges > Memory and Disk ----------
// Memory and CPU come from one process listing (about a second), kept 10 seconds so the gauges on every open page
// and the window share it; CPU is the change in processor time since the listing before. Folder sizes take
// longer: they are counted in the background every 20 minutes and saved in the data folder (diskKeeper), so the
// window and the gauges show the last count at once, even straight after a restart.
const DISK_EVERY_MS = 20 * 60_000, MACHINE_KEEP_MS = 10_000;
// The window's breakdown needs the command lines as well, so only its listing takes them (machineNow({ commands })).
let machine = null, machineReading = null, cpuBefore = null;
async function memoryUse(commands) {
  const { cmd, args } = processListCommand(process.platform, { commands });
  const out = await new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, maxBuffer: 64 << 20, timeout: 20_000 },
    (err, stdout) => (err ? reject(err) : resolve(stdout))));
  const runnerPid = (await runnerHealth())?.pid;
  const list = parseProcessList(out);
  return { memory: { ...groupProcesses(list, { appPid: process.pid, runnerPid }), free: os.freemem(), size: os.totalmem() }, list, runnerPid };
}
// { memory, memoryError, cpu (a percent, or null until there are two listings), at }, and for the breakdown the
// list itself (with command lines when asked for: never sent to a page), the runner's pid, and the processor
// times of the listing before ({ byPid, at }).
function machineNow({ commands = false } = {}) {
  if (machine && Date.now() - machine.at < MACHINE_KEEP_MS && (!commands || machine.commands)) return Promise.resolve(machine);
  if (machineReading && (!commands || machineReading.commands)) return machineReading;
  const reading = (machineReading || Promise.resolve()).catch(() => {}).then(() => memoryUse(commands)).then(({ memory, list, runnerPid }) => {
    const now = { cpu: memory.cpu, at: Date.now(), byPid: new Map(list.map((p) => [p.pid, p.cpu])) };
    const cpu = cpuPercent(cpuBefore, now, os.cpus().length);
    const before = cpuBefore;
    cpuBefore = now;
    return machine = { memory, memoryError: '', cpu, at: now.at, commands, list, runnerPid, before };
  }, (err) => (machine = { memory: null, memoryError: err.message, cpu: null, at: Date.now() }))
    .finally(() => { if (machineReading === reading) machineReading = null; });
  reading.commands = commands;
  return machineReading = reading;
}
// The window's breakdown of the reading (machine-use.mjs: breakdown): what the runner already says about its
// helpers, the shared MCP servers of this Docket and of the test copies in docket-work, and the live sessions'
// titles and desks. Read only while the window asks.
async function machineBreakdown(m) {
  if (!m.list) return null;
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  let dirs = [];
  try { dirs = fs.readdirSync(WORK_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(WORK_DIR, e.name)); } catch {}
  const copies = dirs.filter((d) => path.resolve(d) !== path.resolve(ROOT))
    .map((folder) => ({ folder, servers: ['data-dev', 'data'].flatMap((x) => sharedServers(readJson(path.join(folder, x, 'shared-mcp.json')))) }));
  const helpers = m.runnerPid ? await runnerCall('/helpers').catch(() => []) : [];
  const deskName = (id) => clientById(id)?.name || id;
  const sessions = new Map([...live.values()].map((s) => [s.id, { title: s.title || state.sessions[s.id]?.title || 'Untitled', desk: deskName(s.client) }]));
  const b = breakdown(m.list, { appPid: process.pid, runnerPid: m.runnerPid, root: ROOT, sessions, helpers, copies,
    shared: sharedServers(readJson(path.join(DATA_DIR, 'shared-mcp.json'))), before: m.before, at: m.at, cores: os.cpus().length });
  for (const x of b.shared) x.desks = x.desks.map(deskName);
  return b;
}

// ---------- Starting Docket after a restart ----------
// A page pinned in the browser cannot start Docket, so the only time Docket can make sure it starts again after this
// computer restarts is while it runs. At each start it checks (platform.mjs: startupState); the page offers the fix
// (a banner, and ☰ > Settings > Starting Docket), and the install and remove scripts do the work, so the page and
// the scripts never disagree. state.startup = { choice, at } keeps the person's answer: 'signin', 'shortcut' (no
// banner; missing shortcuts are made again here) or 'none' (don't ask again).
let startupNow = null;
// A test copy only reports how Docket starts; it never asks, never repairs and never runs the scripts.
const TEST_COPY = isTestCopy({ root: ROOT, port: PORT });
const runScript = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, timeout: 60_000 },
  (err, stdout, stderr) => (err ? reject(new Error(String(stderr || stdout || err.message).trim())) : resolve(String(stdout).trim()))));
async function checkStartup() {
  try {
    let found;
    if (process.platform === 'win32') { const c = startupReadCommand(process.platform, ROOT); found = parseStartupRead(await runScript(c.cmd, c.args)); }
    else if (process.platform === 'darwin') found = Object.fromEntries(Object.entries(startupFiles(os.homedir())).map(([k, f]) => { try { return [k, fs.readFileSync(f, 'utf8')]; } catch { return [k, null]; } }));
    else return startupNow = null;
    let launcher = null; try { launcher = fs.readFileSync(path.join(ROOT, 'signin-launcher.ps1'), 'utf8'); } catch {}
    startupNow = startupState({ root: ROOT, found, launcher });
  } catch (err) { startupNow = { error: err.message }; }
  return startupNow;
}
async function setStartup(to) { // 'signin', 'shortcut' or 'off'
  if (TEST_COPY) throw new Error('this is a test copy of Docket. Set up how Docket starts from your real Docket (port 4400), so the Start menu and sign-in keep opening it.');
  const c =startupScriptCommand({ root: ROOT, to, port: PORT });
  if (!c) throw new Error('Docket can only set this up on Windows or a Mac.');
  logEvent(`starting Docket: ${to}`, await runScript(c.cmd, c.args));
}
const startupView = () => ({ supported: !!startupScriptCommand({ root: ROOT, to: 'off' }), now: startupNow, choice: state.startup?.choice || null,
  testCopy: TEST_COPY, ...(TEST_COPY ? { ask: false, remake: null } : startupNeeds(startupNow, state.startup?.choice)) });
async function startupAtStart() {
  await checkStartup();
  if (TEST_COPY) return;
  const { remake } = startupNeeds(startupNow, state.startup?.choice);
  if (remake) { // a sign-in start that would fail, or shortcuts the person chose that went missing
    try { await setStartup(remake); } catch (err) { logEvent(`setting up how Docket starts (${remake}) failed`, err.message); }
    await checkStartup();
  }
  if (startupNow?.error) logEvent('could not check whether Docket starts after a restart', startupNow.error);
  else if (startupView().ask) logEvent('Docket will not start by itself after a restart', 'the page offers to set it up');
}
// Where the working copies are: ../docket-work beside the Docket folder, or, when this is a working copy
// itself (the test copy), the folder it sits in.
const WORK_DIR = path.basename(path.dirname(ROOT)) === 'docket-work' ? path.dirname(ROOT) : path.join(path.dirname(ROOT), 'docket-work');
async function countDisk() {
  const started = Date.now();
  const parts = [
    ['Program libraries (node_modules)', path.join(ROOT, 'node_modules')],
    [`Saved data (${path.basename(DATA_DIR)}/)`, path.resolve(DATA_DIR)],
    ['Uploads (uploads/)', UPLOADS],
    ['Private browser sign-ins (browser/)', BROWSER_ROOT],
    ['Git history (.git)', path.join(ROOT, '.git')],
  ];
  const docket = await folderSize(ROOT);
  const rows = [];
  for (const [label, dir] of parts) { const s = await folderSize(dir); if (s) rows.push({ label, ...s }); }
  const logs = await folderSize(ROOT, { filter: (n) => n.endsWith('.log') });
  if (logs?.files) rows.push({ label: 'Logs', ...logs });
  const inParts = rows.reduce((a, r) => ({ bytes: a.bytes + r.bytes, files: a.files + r.files }), { bytes: 0, files: 0 });
  if (docket) rows.push({ label: 'The program and the rest', bytes: Math.max(0, docket.bytes - inParts.bytes), files: Math.max(0, docket.files - inParts.files) });
  let copies = null;
  try {
    const dirs = (await fs.promises.readdir(WORK_DIR, { withFileTypes: true })).filter((e) => e.isDirectory());
    const sizes = [];
    for (const e of dirs) sizes.push(await folderSize(path.join(WORK_DIR, e.name)));
    copies = { path: WORK_DIR, count: dirs.length, bytes: sizes.reduce((a, s) => a + (s?.bytes || 0), 0), files: sizes.reduce((a, s) => a + (s?.files || 0), 0) };
  } catch {}
  // Each company's Claude home, and Claude's own (~/.claude) when no company uses it.
  const homes = new Map();
  for (const c of CLIENTS) if (c.home && !homes.has(path.resolve(c.home))) homes.set(path.resolve(c.home), c.name || c.id);
  if (!homes.has(path.resolve(DEFAULT_HOME))) homes.set(path.resolve(DEFAULT_HOME), 'Claude on this computer (~/.claude)');
  const history = [];
  for (const [home, label] of homes) { const s = await folderSize(path.join(home, 'projects')); if (s) history.push({ label, path: path.join(home, 'projects'), ...s }); }
  let drive = null;
  try { const st = await fs.promises.statfs(ROOT); drive = { free: st.bavail * st.bsize, size: st.blocks * st.bsize }; } catch {}
  return { docket: docket && { path: ROOT, ...docket, rows }, copies, history, drive, at: Date.now(), took: Date.now() - started };
}
const diskUse = diskKeeper({ file: path.join(DATA_DIR, 'disk-use.json'), count: countDisk, log: (err) => logEvent('could not count folder sizes', err?.stack || err) });
// The first count a minute after starting, unless the saved one is recent; then every 20 minutes.
setTimeout(() => { if (!diskUse.get() || Date.now() - diskUse.get().at > DISK_EVERY_MS) diskUse.refresh(); }, 60_000).unref();
setInterval(() => diskUse.refresh(), DISK_EVERY_MS).unref();

// The app can restart while the runner keeps every session working. The app starts the runner
// when it is not running, talks to it on this computer, and reads each session's messages as a
// numbered stream, so after a restart it reconnects and carries on from where it was.
const RUNNER_PORT = Number(process.env.DOCKET_RUNNER_PORT || PORT + 10);
const RUNNER = `http://127.0.0.1:${RUNNER_PORT}`;
let runnerToken = '';
let docketRestarting = false; // ☰ > Restart Docket is under way: the runner's sessions ending is the restart, not a cut-off
async function runnerHealth() {
  try { const r = await fetch(RUNNER + '/health', { signal: AbortSignal.timeout(2000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function ensureRunner() {
  if (docketRestarting) throw new Error('Docket is restarting'); // the new app starts the fresh runner
  if (!(await runnerHealth())) {
    const child = spawn(process.execPath, [path.join(ROOT, 'runner.mjs')], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_DATA: path.resolve(DATA_DIR) },
    });
    child.unref();
    for (let i = 0; i < 60 && !(await runnerHealth()); i++) await new Promise((r) => setTimeout(r, 250));
    logEvent('started the session runner', `port ${RUNNER_PORT}`);
  }
  runnerToken = fs.readFileSync(path.join(path.resolve(DATA_DIR), 'runner-token'), 'utf8').trim();
}
async function runnerCall(pathname, body) {
  const r = await fetch(RUNNER + pathname, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-docket-token': runnerToken },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
// Stand-ins for the Claude library's query and its message queue, so the rest of the app drives a
// session in the runner exactly as it drove one in this process. s.ready settles once the runner
// has the session; s.runnerSeq is the number of the last message read.
function remoteSession(s) {
  const id = s.id;
  const ctl = async (op, arg) => { if (s.resting) return; await s.ready; // resting: what was set is in its saved record, read when it wakes
 return (await runnerCall(`/sessions/${id}/control`, { op, arg })).out; };
  // A message is marked unsent until the runner has it, so one cut off by an app restart is shown as
  // such afterwards (unsentNote) instead of looking sent and unanswered.
  const input = {
    push: (message) => {
      const mark = { at: Date.now(), text: messageText(message).slice(0, 300) };
      if (state.sessions[id]) { state.sessions[id].unsent = mark; saveState(); }
      const clear = () => { if (state.sessions[id]?.unsent === mark) { delete state.sessions[id].unsent; saveState(); } };
      // One at a time, in order (a fresh start sends its first message first); a send the runner refused is tried
      // again, as it cannot have got there.
      const kept = () => (state.sessions[id]?.firstPending && firsts.has(id) ? '. Docket keeps its first message and sends it when the session starts again' : '');
      return s.sending = (s.sending || Promise.resolve()).then(() => s.ready)
        .then(() => withRetries(() => runnerCall(`/sessions/${id}/send`, { message }), { retryIf: refused })).then(clear)
        // Not idle once ended: a start that failed ends it, and the next message must start it again, not push into it.
        .catch((err) => { clear(); stoppedNote(s, 'Could not send: ' + netText(err) + kept()); if (s.status !== 'ended') setStatus(s, 'idle'); });
    },
    close: () => {},
  };
  const q = {
    setModel: (m) => ctl('setModel', m),
    applyFlagSettings: (f) => ctl('applyFlagSettings', f),
    setPermissionMode: (m) => ctl('setPermissionMode', m),
    interrupt: () => ctl('interrupt'),
    mcpServerStatus: () => ctl('mcpServerStatus'),
    close: () => { s.closing = true; s.ready.then(() => runnerCall(`/sessions/${id}/end`, {})).catch((e) => logEvent(`could not end ${sessionTag(s)} in the runner`, e.message)); },
    async *[Symbol.asyncIterator]() {
      await s.ready;
      const res = await withRetries(() => fetch(`${RUNNER}/sessions/${id}/stream?since=${s.runnerSeq || 0}`, { headers: { 'x-docket-token': runnerToken } }));
      if (!res.ok) throw new Error('The session runner does not have this session');
      let buf = '';
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const { seq, msg } = JSON.parse(line);
          s.runnerSeq = seq;
          if (msg.type === 'docket_ended') { if (msg.restart) s.runnerRestarted = true; else if (msg.error && !s.closing) throw new Error(msg.error); return; }
          if (msg.type === 'docket_permission') { remoteAsk(s, msg); continue; }
          if (msg.type === 'docket_permission_cancel') { cancelAsk(s, msg.reqId); continue; }
          yield msg;
        }
      }
      if (!s.closing) throw new Error('Lost contact with the session runner');
    },
  };
  return { query: q, input };
}
// A permission question from the runner: shown here, answered back to the runner.
function remoteAsk(s, a) {
  askPermission(s, a.toolName, a.input, { title: a.title, suggestions: a.suggestions, reqId: a.reqId })
    .then((result) => runnerCall(`/sessions/${s.id}/answer`, { reqId: a.reqId, result }))
    .catch(() => {});
}
function cancelAsk(s, reqId) {
  const ask = s.pendingAsks?.get(reqId);
  if (!ask) return;
  s.pendingAsks.delete(reqId);
  recordWait(s, ask);
  ask.ev.state = 'cancelled';
  broadcast({ t: 'permission', id: s.id, ev: ask.ev });
  if (!s.pendingAsks.size && s.status === 'requires_action') setStatus(s, 'running');
}
// The loop that turns a session's messages into what the page shows.
function runLoop(s) {
  let done;
  s.finished = new Promise((r) => { done = r; }); // settles once the session has stopped for good
  (async () => {
    try {
      for await (const m of s.query) handleSdkMessage(s, m);
      if (s.noConversation && live.get(s.id) === s) return restartFresh(s);
      if (s.runnerRestarted) return; // the runner is taking in a change; the check below puts it back
      if (s.reloading || s.resting) return; // reloadSession or wakeSession puts it back
      if (docketRestarting) return; // Restart Docket: left as it was, so the new app finds it was open
      if (live.get(s.id) !== s) return; // archived or ended from here: already taken off the list
      // It stopped by itself with a message unanswered: say so, rather than look read and finished.
      if (!s.closing && ['starting', 'running', 'requires_action'].includes(s.status)) stoppedNote(s, 'Session stopped before it answered. Send the message again to start it afresh.');
      setStatus(s, 'ended');
      markRunning(s.id, false);
    } catch (err) {
      if (live.get(s.id) !== s || s.reloading || s.resting || docketRestarting) return;
      if (s.noConversation) return restartFresh(s); // the resume found no conversation: once more, afresh (#759)
      // The runner went away partway through a turn (a crash, or it was killed): a cut-off, as after a start.
      // So is a first start that never reached it, even once it answers again: its first message is kept (#759).
      const midTurn = !s.closing && ['starting', 'running'].includes(s.status);
      stoppedNote(s, `Session stopped: ${netText(err)}`);
      const neverRan = !!state.sessions[s.id]?.firstPending && firsts.has(s.id) && !!netError(err);
      if (midTurn && (neverRan || !(await runnerHealth()))) markCutOff(s.id, s.client, 'runner');
      setStatus(s, 'ended');
      markRunning(s.id, false);
    }
  })().finally(() => done());
}
// A resume Claude Code answered with "No conversation found": started again once as a new conversation under the same
// id, with its first message and then what the resume was sending (#759). freshTried stops a second go until one gets through.
function restartFresh(old) {
  const rec = state.sessions[old.id];
  if (rec) { rec.freshTried = true; saveState(); }
  live.delete(old.id);
  const s = startSession({ clientId: old.client, cwd: old.cwd, title: old.title, resumeId: old.id, fresh: true, last: old.lastNudge ? null : old.lastMessage });
  s.events = old.events; s.tasks = old.tasks; s.readyAt = old.readyAt;
  logEvent(`no conversation to resume, starting afresh: ${sessionTag(s)}`, rec?.firstPending && firsts.has(s.id) ? 'with its kept first message' : 'with the first message its chat shows');
  if (!sendFirst(s)) { stoppedNote(s, 'Claude Code has no conversation for this session and Docket has no first message for it, so send a message to start it afresh'); setStatus(s, 'idle'); }
  pushSession(s);
}
// After the app starts: pick up every session the runner is still holding.
let reattached = Promise.resolve(); // settles once reattachSessions has finished, after a start
async function reattachSessions() {
  let list = [];
  try { await ensureRunner(); list = await runnerCall('/sessions'); }
  catch (e) { logEvent('could not reach the session runner', e.message); return false; }
  for (const r of list.filter((x) => !x.ended && !live.has(x.id))) {
    const client = clientById(state.sessions[r.id]?.client);
    if (!client) continue;
    // Closed in Docket (close_session, Archive) but the runner still has it: its end did not get there. End it now,
    // rather than show an archived session as open (#717).
    if (state.sessions[r.id]?.archived === true) { runnerCall(`/sessions/${r.id}/end`, {}).catch(() => {}); continue; }
    const wasWaiting = !!state.sessions[r.id]?.waiting; // makeSession starts it as seen; read this first
    const s = makeSession({ clientId: client.id, resumeId: r.id });
    s.events = await loadTranscript(client, r.id).catch(() => []);
    const now = (await runnerCall('/sessions')).find((x) => x.id === r.id) || r; // read after the transcript, so nothing is shown twice
    // Docket's copy of a Grok or Codex chat says how far it got: read on from there, so what came while the app was away is not lost.
    s.runnerSeq = keepsChat(s.engine) ? Math.min(chatSeq(r.id), now.seq) : now.seq;
    // The runner has the message after all (it is working on it): no need to say it may not have arrived.
    if (state.sessions[r.id]?.unsent && now.busy) { delete state.sessions[r.id].unsent; saveState(); s.events = s.events.filter((e) => !e.unsent); }
    s.ready = Promise.resolve(); s.configReady = true;
    Object.assign(s, remoteSession(s));
    // A session that was orange before the restart stays orange, in the same place in the list.
    if (unreadAfterRestart({ asks: now.asks.length, wasWaiting, busy: now.busy, unsent: state.sessions[r.id]?.unsent })) { setUnread(s, 'restart'); s.wasWaiting = wasWaiting; const was = state.sessions[r.id]?.waitingWhy; if (was?.why) { s.unreadWhy = was.why; s.unreadSaid = was.said || ''; } } // keeps its reason (#671)
    setStatus(s, now.asks.length ? 'requires_action' : now.busy ? 'running' : 'idle');
    // The jobs it had running are not in the messages read from here on: find them again on disk, and
    // hold the turn for them as before the restart, so the session neither reads idle nor reports early.
    repairTasks(s);
    s.heldTurn = s.status === 'idle' && runningTasks(s) > 0;
    updateBusy(s); // and tell the runner whether it still holds a restart
    for (const a of now.asks) remoteAsk(s, a);
    runLoop(s);
    pushSession(s);
  }
  if (list.length) logEvent('reconnected to running sessions', `${list.filter((x) => !x.ended).length} in the runner`);
  return true;
}
// Until the runner's sessions are back, a session still working there looks like one cut off by the restart:
// in Docket's saved records it was running, and its transcript may end on a step still under way. So nothing is
// called interrupted, and the session list and a session's messages wait for this, rather than show red on every
// page that reconnects. Tried again until the runner answers; only then are real cut-offs looked for.
let reattachDone = false;
async function reattachUntilDone() {
  while (!(await reattachSessions().catch((e) => { logEvent('reconnecting to running sessions failed', e.message); return false; }))) await new Promise((r) => setTimeout(r, 5000));
  reattachDone = true;
  // A list built before this may have called some of them interrupted: build it again.
  for (const c of CLIENTS) if (historyCache.has(c.id)) { historyCache.delete(c.id); buildHistory(c).then(() => broadcast({ t: 'history-ready', client: c.id })).catch(() => {}); }
}
const settledOr = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
const cutAtStart = (id) => reattachDone && interrupted.has(id);

// ---------- continuing a session cut off by an unplanned stop ----------
// The rules are in cut-off.mjs. The cut-off stays in the session's saved record until it is picked up again, so the
// page shows its banner; autoContinued marks its one automatic try as used, until a turn gets through.
const autoContinueOn = () => state.autoContinue !== false;
const fileTime = (client, id) => { try { const f = client && sessionFile(client, id); return f ? fs.statSync(f).mtimeMs : null; } catch { return null; } };
function markCutOff(id, clientId, how) {
  const rec = state.sessions[id];
  if (!rec) return;
  rec.cutOff = newCutOff(how, fileTime(clientById(clientId), id));
  saveState();
  queueAutoContinue(id);
}
// One at a time with a gap, not every desk at once: continues after a cut-off and after a sign-in share the queue.
// The first wait also gives the runner check time to start it again. key: one entry per session and kind.
const autoQueue = [];
let autoDraining = false;
function queueAuto(key, run) {
  if (!autoQueue.some((x) => x.key === key)) autoQueue.push({ key, run });
  if (autoDraining) return;
  autoDraining = true;
  (async () => {
    while (autoQueue.length) {
      await new Promise((r) => setTimeout(r, GAP_MS));
      const x = autoQueue.shift();
      await x.run().catch((e) => logEvent(`continue by itself failed (${x.key})`, e.message));
    }
  })().finally(() => { autoDraining = false; });
}
const queueAutoContinue = (id) => queueAuto(`cut-off ${id}`, () => autoContinue(id));
async function autoContinue(id) {
  const rec = state.sessions[id], client = clientById(rec?.client);
  if (!rec?.cutOff || !client) return;
  const tag = `"${rec.title || 'Untitled'}" (${id})`;
  const check = autoContinueCheck({ on: autoContinueOn(), rec, mtime: fileTime(client, id), paused: !!state.paused, archived: isArchived(client, id) });
  if (!check.go) { logEvent(`cut off, left for the user: ${tag}`, check.why); return; }
  await ensureRunner();
  const cut = rec.cutOff;
  rec.autoContinued = true; // before it starts, so a turn that takes the runner down again is not continued a second time
  saveState();
  const target = await sessionToMessage(client.id, id);
  if (target.freshStart) sendFirst(target); // its first message never got there: sent now, with no "carry on" after it (#759)
  else {
    addEvent(target, { k: 'note', text: 'Docket stopped unexpectedly partway through this turn, so it continued it by itself' });
    sendToSession(target, { text: '', system: true, context: cutOffNote(cut) });
  }
  logEvent(`continued by itself after a cut-off: ${tag}`, `cut off ${new Date(cut.at).toLocaleString()}, ${cut.how === 'runner' ? 'the runner stopped' : 'found at start'}`);
}
// ---------- carrying on a session after its desk signs in again (#719) ----------
// The rules are in signin-resume.mjs. The desk's setting (resumeAfterSignIn, on unless false) is on the Inspector's
// Switches; off, the session offers Send again as before. signinTried marks the one automatic try as used, so a try
// that fails on the sign-in again waits for the next sign-in; a turn that gets through, or a message, clears it.
const resumeOn = (client) => client?.resumeAfterSignIn !== false;
// The last 256 KB of a Claude session's transcript, or '' (another brand, or no file).
function transcriptEnd(client, id, bytes = 256 * 1024) {
  let fd;
  try {
    const f = sessionFile(client, id);
    if (!f) return '';
    fd = fs.openSync(f, 'r');
    const size = fs.fstatSync(fd).size, n = Math.min(size, bytes), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
// A sign-in by the person counts over one Docket noticed for the same wait in the queue.
const signInHow = new Map();
function queueSignInResume(id, how) {
  signInHow.set(id, how === 'user' || signInHow.get(id) === 'user' ? 'user' : 'seen');
  queueAuto(`sign-in ${id}`, () => { const h = signInHow.get(id); signInHow.delete(id); return resumeAfterSignIn(id, h); });
}
async function resumeAfterSignIn(id, how) {
  const rec = state.sessions[id], client = clientById(rec?.client);
  const f = rec?.signinFail;
  if (!f || !client) return;
  const tag = `"${rec.title || 'Untitled'}" (${id})`;
  const s = live.get(id);
  const working = !!s && !s.resting && !['idle', 'ended'].includes(s.status);
  const on = resumeOn(client);
  const check = signinResumeCheck({ on, rec, how, messaged: messagedSince(transcriptEnd(client, id), f.at), paused: !!state.paused, archived: isArchived(client, id), working });
  if (!check.go) {
    if (!on && s && f.text) addEvent(s, { k: 'retry', id: `retry-${Date.now()}`, text: f.text }); // the Send again offer
    if (dropsMark(check.why)) delete rec.signinFail;
    saveState();
    logEvent(`failed on its sign-in, left for the user: ${tag}`, check.why);
    return;
  }
  await ensureRunner();
  delete rec.signinFail;
  rec.signinTried = true; // before it starts, so a try that fails on the sign-in again waits for the next sign-in
  saveState();
  const target = await sessionToMessage(client.id, id);
  addEvent(target, { k: 'note', text: SIGNIN_NOTE });
  sendToSession(target, { text: f.text || '', system: true, context: signinNote(f) });
  logEvent(`continued by itself after signing in again: ${tag}`, `failed ${new Date(f.at).toLocaleString()}; ${f.midTurn ? 'told to carry on' : 'its message sent again'}; sign-in ${how === 'user' ? 'by the user' : 'seen by Docket'}`);
}
// After Resume all: sessions held back by the pause whose desk is known to be signed in again.
function resumeSignInsAfterPause() {
  for (const [id, rec] of Object.entries(state.sessions)) {
    if (rec.signinFail && authCache.get(authKey(rec.client, rec.engine || 'claude'))?.loggedIn === true) queueSignInResume(id, 'seen');
  }
}
// At start, once the runner's sessions are back: those still interrupted mid-reply were cut off, and ones cut off
// before this start that were never picked up get their check again.
function findCutOffs() {
  for (const id of interrupted) {
    const rec = state.sessions[id];
    if (rec?.busy && !rec.cutOff && clientById(rec.client)) markCutOff(id, rec.client, 'start');
  }
  for (const [id, rec] of Object.entries(state.sessions)) if (rec.cutOff && !live.has(id)) queueAutoContinue(id);
}

// ---------- picking up changes by itself ----------
// After a pull (or any edit in this folder) the app takes the change in on its own:
// - its own code changed: check it for mistakes, then restart (start-docket.cmd starts it again
//   when it exits with RESTART_CODE; sessions keep working in the runner meanwhile);
// - the library list changed: run npm install first;
// - only the page changed: open pages reload themselves (version below).
const RESTART_CODE = 75;
const APP_FILES = ['server.mjs', 'costs.mjs', 'scheduler.mjs', 'pause.mjs', 'cut-off.mjs', 'first-start.mjs', 'signin-resume.mjs', 'runner-idle.mjs', 'profile.mjs', 'tasks.mjs', 'crossings.mjs', 'codex-usage.mjs', 'grok-usage.mjs', 'codex-home.mjs', 'update-mode.mjs', 'platform.mjs', 'remote.mjs', 'feedback.mjs', 'plans.mjs', 'plan-folder.mjs', 'plan-review.mjs'];
const PAGE_FILES = ['index.html', 'view.html', 'usage.html', 'plans.html'];
const LIB_FILES = ['package.json', 'package-lock.json'];
// While a restart waits for a quiet moment this app keeps serving the pages it started with, which go with
// its own code; the new pages come with the new app. pageSnap: what the pages held at start or the last page reload.
const pageSnap = {};
const snapPages = () => { for (const f of PAGE_FILES) try { pageSnap[f] = fs.readFileSync(path.join(ROOT, f)); } catch {} };
snapPages();
const restartHeld = () => !!restartWait.pending || restarting;
const pageBody = (f) => (restartHeld() && pageSnap[f]) || fs.readFileSync(path.join(ROOT, f));
const pageVersion = () => restartHeld() && pageSnap['index.html'] ? createHash('sha1').update(pageSnap['index.html']).digest('hex') : fileHash('index.html');
// What each watched file held when this app started: only a real difference counts (Windows reports
// the same save several times, and npm install rewrites the lock file with what it already had).
const fileHash = (f) => { try { return createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'); } catch { return ''; } };
const startHashes = Object.fromEntries([...APP_FILES, ...PAGE_FILES, ...LIB_FILES].map((f) => [f, fileHash(f)]));
const changedFiles = new Set();
let changeTimer = null;
try {
  fs.watch(ROOT, (type, name) => {
    if (!name || !(name in startHashes)) return;
    changedFiles.add(name);
    clearTimeout(changeTimer);
    changeTimer = setTimeout(takeChanges, 3000); // a pull writes several files; wait until it is done
  });
} catch (e) { logEvent('cannot watch for changes', e.message); }
function run(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, windowsHide: true, env: env || process.env, shell: cmd === 'npm' && process.platform === 'win32' }); // npm is a .cmd file on Windows
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out })); p.on('error', (e) => resolve({ code: -1, out: e.message }));
  });
}
// Docket's own pull sets ownPull ('auto' or 'now'); any other change came from outside, most often a pull run
// in this folder by hand or by a session. That is still taken in (the new code is already on disk, and old code
// running against new files is worse), even in manual mode, but the log and the ☰ menu say so.
let ownPull = null;
let startHead = '';
async function takeChanges() {
  const files = [...changedFiles].filter((f) => fileHash(f) !== startHashes[f]); changedFiles.clear();
  const pulledBy = ownPull; ownPull = null;
  const anyway = pulledBy === 'now' && updateAnyway; if (pulledBy === 'now') updateAnyway = false;
  if (!files.length) return;
  const head = pulledBy ? '' : (await git(['rev-parse', 'HEAD'])).out.trim();
  const why = changeReason({ pulledBy, from: startHead, to: head });
  const whyDetail = `${why.detail}\n${files.join(', ')}`;
  if (why.moved) { updateStatus.waiting = null; noteUpdate('updated', why.detail, false); await readCommit(); broadcast({ t: 'update', update: updateInfo() }); }
  if (files.some((f) => APP_FILES.includes(f) || LIB_FILES.includes(f))) {
    restartWait.want({ why, whyDetail }); // restarts at once when nothing is working, else once it is quiet
    if (anyway) restartWait.now(); // Update now anyway
    broadcast({ t: 'update', update: updateInfo() });
    return;
  }
  if (restartHeld()) return; // a page change while a restart waits comes with the new app
  if (files.some((f) => PAGE_FILES.includes(f))) {
    logEvent(`reloading pages: ${why.short}`, whyDetail);
    for (const f of PAGE_FILES) startHashes[f] = fileHash(f);
    snapPages();
    broadcast({ t: 'version', page: pageVersion() });
  }
  if (head) startHead = head; // a page-only change keeps this app running: later changes are measured from here
}

// A restart cuts nothing in the runner, but it does cut what runs in this app (an ask_desk run, a tool call a
// session is making to Docket), and every open page reconnects. So, like the runner's own restart, it waits for a
// quiet moment (runner-idle.mjs): no reply in progress, no question waiting, no background commands or subagents,
// no ask_desk run, nothing said for a minute. It looks every 5 seconds and never forces it; Update now anyway (the card, ☰ > About) skips the wait.
// A scheduled run is a session like any other, so one mid-run holds it too. So does typing in a session: a
// restart reloads every open page, which would cut into what is being typed.
// lastTyping: the last time a page said you were typing in a session (POST /api/typing-now, at most every 5
// seconds while you type).
let lastTyping = 0;
function restartHolds() {
  if (!reattachDone) return 'still reconnecting to the running sessions';
  if (typingNow(lastTyping, Date.now())) return 'you are typing in a session';
  const sessions = [...live.values()].filter((s) => s.status !== 'ended').map((s) => ({
    busy: ['starting', 'running', 'requires_action'].includes(s.status) || !!s.compacting,
    held: holdsRunner(s, runningTasks(s)),
    asks: s.pendingAsks?.size || 0,
    lastAt: s.lastActivity,
    scheduled: !!state.sessions[s.id]?.scheduleId,
  }));
  return notQuiet(sessions, Date.now(), { jobs: appJobs });
}
let restarting = false, exiting = false;
let updateAnyway = false; // Update now anyway: the pull it asked for restarts without waiting
const restartWait = restartWaiter({
  check: restartHolds,
  log: (why) => logEvent('waiting for a quiet moment to restart', why),
  changed: () => broadcast({ t: 'update', update: updateInfo() }),
  go: (p, how) => {
    restarting = true;
    restartAfterWait(p, how).catch((e) => logEvent('restart failed', e.message))
      .finally(() => { if (!exiting) { restarting = false; broadcast({ t: 'update', update: updateInfo() }); } });
  },
});
async function restartAfterWait(p, how) {
  const { why, whyDetail } = p.reasons.at(-1);
  const changed = [...APP_FILES, ...LIB_FILES].filter((f) => fileHash(f) !== startHashes[f]);
  if (!changed.length) {
    logEvent('restart no longer needed', 'the changed files are back as they were');
    for (const f of PAGE_FILES) if (fileHash(f) !== startHashes[f]) changedFiles.add(f);
    if (changedFiles.size) setTimeout(takeChanges, 0); // a page change held back while it waited
    return;
  }
  if (changed.some((f) => LIB_FILES.includes(f))) {
    logEvent('library list changed: installing', changed.join(', '));
    const r = await run('npm', ['install', '--no-audit', '--no-fund']);
    if (r.code !== 0) { logEvent('npm install failed, not restarting', r.out.slice(-800)); notTakenIn('npm install failed', r.out); return; }
  }
  for (const f of APP_FILES) {
    const r = await run(process.execPath, ['--check', path.join(ROOT, f)]);
    if (r.code !== 0) { logEvent(`not restarting: ${f} has a mistake`, r.out.slice(-800)); notTakenIn(`${f} has a mistake`, r.out); return; }
  }
  logEvent(`restarting: ${why.short}`, `${how}\n${whyDetail}`);
  exiting = true;
  keepRemoteShownOverRestart();
  setTimeout(() => process.exit(RESTART_CODE), 200);
}

// ---------- ☰ > Restart Docket ----------
// Starts over to free everything Docket holds, unlike the restart above, which leaves the runner and its sessions
// alone: every program this app and the runner started, at any depth (session programs, their connected services,
// the private browser), and the runner itself are stopped; then this app exits with RESTART_CODE and supervisor.mjs
// (or start-docket.cmd) starts it again, and it starts a fresh runner. Sessions that were working or waiting on the
// person are marked cut off by the restart, so they show under "Open when the portal stopped" with Continue and
// never continue by themselves; idle ones start again on their next message. Nothing here starts the app again
// when something else started it (node server.mjs by hand, a test copy): then it only stops, and the page says so.
// What the page's warning names: sessions working or waiting on the person, and how many are idle.
function restartRisk() {
  const working = [], waiting = []; let idle = 0;
  for (const s of live.values()) {
    if (s.status === 'ended' || s.resting) continue;
    const item = { id: s.id, title: s.title || 'Untitled', desk: clientById(s.client)?.name || '' };
    if (s.status === 'requires_action' || s.pendingAsks?.size) waiting.push(item);
    else if (s.compacting || holdsRunner(s, runningTasks(s))) working.push(item);
    else idle++;
  }
  return { working, waiting, idle };
}
const ownHelpers = new Set(); // the listings and stops below, and what they start (a console host): children of this app too, never in what is stopped
const outOf = ({ cmd, args }) => new Promise((resolve) => ownHelpers.add(execFile(cmd, args, { windowsHide: true, maxBuffer: 64 << 20, timeout: 20_000 }, (err, stdout) => resolve(String(stdout || ''))).pid));
async function restartDocket() {
  docketRestarting = true; exiting = true; restarting = true;
  const risk = restartRisk(), cut = [...risk.working, ...risk.waiting];
  const relaunch = relaunchesApp(await outOf(commandLineCommand(process.ppid)));
  broadcast({ t: 'restarting', relaunch });
  for (const x of cut) { const rec = state.sessions[x.id]; if (rec) rec.cutOff = newCutOff('restart', fileTime(clientById(rec.client), x.id)); }
  saveState(); // written on exit
  const runnerPid = (await runnerHealth())?.pid;
  const before = parseTreeList(await outOf(treeListCommand()));
  const stopped = new Set([...descendants(before, [process.pid, runnerPid].filter(Boolean), ownHelpers), ...(runnerPid ? [runnerPid] : [])].filter((p) => !ownHelpers.has(p)));
  const stop = (pids) => { const c = killCommand(pids); return c ? outOf(c) : null; };
  await stop([...stopped]);
  // Look again, up to three times a second apart, for anything still there or started meanwhile (a browser can take
  // a moment to go).
  let again = 0, left = [];
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const after = parseTreeList(await outOf(treeListCommand()));
    left = [...new Set([...leftBehind(before, after, stopped), ...descendants(after, [process.pid], ownHelpers)])].filter((p) => !ownHelpers.has(p));
    if (!left.length) break;
    again += left.length; await stop(left); for (const p of left) stopped.add(p);
  }
  const detail = [`stopped the runner${runnerPid ? ` (pid ${runnerPid})` : ' (not running)'} and ${stopped.size - (runnerPid ? 1 : 0)} program(s) below it and the app${again ? `, ${again} on a second look` : ''}${left.length ? `; still there after three looks: pid ${left.join(', ')}` : ''}`,
    cut.length ? `cut off, left for Continue: ${cut.map((x) => `"${x.title}" (${x.id})`).join(', ')}` : 'nothing was working or waiting', `${risk.idle} idle session(s) start again on their next message`].join('\n');
  logEvent(relaunch ? 'restarted (Restart Docket)' : 'stopped (Restart Docket; nothing here starts the app again, so start it by hand)', detail);
  if (relaunch) keepRemoteShownOverRestart();
  setTimeout(() => process.exit(relaunch ? RESTART_CODE : 0), 300);
}

// ---------- updates from GitHub ----------
// Every few minutes (state.updates.minutes, 0 = off) look for new git commits on master and, when there
// are some, fast-forward this folder to them; takeChanges above then takes them in, as after a pull by hand.
// It never pulls over local work: a folder on another git branch, with edits not in a git commit, or with
// git commits GitHub doesn't have is left alone, and ☰ > About says why.
// Only in auto mode (state.updates.mode) does it pull by itself; otherwise it notes the update as waiting
// and the page offers Update now (and, before a mode is chosen, asks which mode to use).
// The repo can be private on a personal GitHub account while this computer's default git sign-in is another
// account, so the fetch signs in with `gh auth token --user <owner>` (the account in the origin address, or
// DOCKET_GITHUB_USER), handed to git for that one command only. gh's active account is never switched.
const UPDATE_BRANCH = 'master';
const updateStatus = { checking: false, commit: '', waiting: null, ...(state.updates?.last || {}) }; // last: { at, result, detail }; waiting: { from, to, files }
const updateMode = () => cleanMode(state.updates?.mode);
const updateMinutes = () => (Number.isFinite(state.updates?.minutes) ? state.updates.minutes : 5);
let updateTimer = null;
// typingHeld: the last check found an update and held it because you are typing (lastTyping, above), so the
// timer looks again in TYPING_RETRY_MS rather than at the next timed check.
let typingHeld = false;
// logAs: what the log line says, when it says more than the menu's result ('updated (auto)'); false: no log line
// (the caller writes its own).
function noteUpdate(result, detail = '', logAs = result) {
  detail = String(detail).trim().slice(-800);
  const same = result === updateStatus.result && detail === updateStatus.detail; // the log gets a repeat only once
  Object.assign(updateStatus, { at: Date.now(), result, detail });
  state.updates = { ...state.updates, last: { at: updateStatus.at, result, detail } };
  saveState();
  if (logAs && result !== 'up to date' && !same) logEvent(`update check: ${logAs}`, detail);
}
// From takeChanges: code on disk changed but can't be taken in, so the menu shows that rather than "updated".
function notTakenIn(why, out) { noteUpdate('not taken in', `${why}\n${String(out).slice(-400)}`); }
const gitEnv = (extra = {}) => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...extra }); // never wait on a sign-in prompt
const git = (args, env = gitEnv()) => run('git', args, env);
async function githubSignIn() {
  const url = (await git(['remote', 'get-url', 'origin'])).out.trim();
  const owner = url.match(/^https:\/\/github\.com\/([^/]+)\//i)?.[1];
  if (!owner) return { args: [], env: gitEnv() }; // not GitHub over https: git's own sign-in
  const user = process.env.DOCKET_GITHUB_USER || owner;
  const { GH_TOKEN, GITHUB_TOKEN, ...env } = process.env; // so gh answers for that account, not a token set for something else
  const t = await run('gh', ['auth', 'token', '--user', user], env);
  const token = t.code === 0 ? t.out.trim().split(/\s+/).pop() : '';
  if (!token) return { args: [], env: gitEnv(), note: `gh has no sign-in for ${user} (${t.out.trim().split('\n')[0] || 'gh not found'}), so git's own sign-in was tried. Fix: gh auth login, signed in as ${user}.` };
  return {
    args: ['-c', 'credential.helper=', '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$DOCKET_GIT_TOKEN"; }; f'],
    env: gitEnv({ DOCKET_GIT_TOKEN: token }), // the token goes through the environment, never on a command line
  };
}
// One check at a time: asking while one runs (Check now during the timer's) waits for that one.
let updateRun = null;
// pull: take a waiting update now (Update now), whatever the mode; it waits for a check already running first.
const checkForUpdate = async (pull = false) => {
  if (pull && updateRun) await updateRun;
  return (updateRun ||= lookForUpdate(pull).finally(() => { updateRun = null; broadcast({ t: 'update', update: updateInfo() }); }));
};
async function lookForUpdate(pull) {
  updateStatus.checking = true; typingHeld = false;
  try {
    updateStatus.waiting = null;
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
    if (branch !== UPDATE_BRANCH) return noteUpdate('skipped', `This folder is on git branch ${branch}, not ${UPDATE_BRANCH}, so it is not updated by itself.`);
    const auth = await githubSignIn();
    const f = await run('git', [...auth.args, 'fetch', 'origin', UPDATE_BRANCH], auth.env);
    if (f.code !== 0) return noteUpdate('failed', `Could not get updates from GitHub: ${f.out.trim()}${auth.note ? `\n${auth.note}` : ''}`);
    const head = (await git(['rev-parse', 'HEAD'])).out.trim();
    const theirs = (await git(['rev-parse', 'FETCH_HEAD'])).out.trim();
    if ((await git(['merge-base', '--is-ancestor', theirs, head])).code === 0) return noteUpdate('up to date');
    if ((await git(['merge-base', '--is-ancestor', head, theirs])).code !== 0) return noteUpdate('skipped', `This folder has git commits that are not on GitHub's ${UPDATE_BRANCH}, so the update is not a fast-forward. Sort it out by hand.`);
    const dirty = (await git(['status', '--porcelain', '--untracked-files=no'])).out.trim();
    if (dirty) return noteUpdate('skipped', `This folder has edits that are not in a git commit:\n${dirty}`);
    const files = (await git(['diff', '--name-only', head, theirs])).out.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!pull && !pullsByItself(updateMode())) {
      updateStatus.waiting = { from: head.slice(0, 7), to: theirs.slice(0, 7), files };
      return noteUpdate('update waiting', `${head.slice(0, 7)} → ${theirs.slice(0, 7)}: ${files.join(', ')}`);
    }
    if (!pull && typingNow(lastTyping, Date.now())) { // auto, but you are typing: Update now is never held
      updateStatus.waiting = { from: head.slice(0, 7), to: theirs.slice(0, 7), files };
      typingHeld = true; scheduleUpdates(TYPING_RETRY_MS);
      return noteUpdate('held', `${head.slice(0, 7)} → ${theirs.slice(0, 7)}: ${TYPING_HOLD}.`);
    }
    const by = pull ? 'now' : 'auto';
    ownPull = by; // set before the merge: the folder watch can fire while it is still writing files
    const m = await git(['merge', '--ff-only', theirs]);
    if (m.code !== 0) { ownPull = null; return noteUpdate('failed', `The pull did not go through: ${m.out.trim()}`); }
    startHead = theirs; // Docket's own pull: not a change from outside
    const how = by === 'now' ? 'Pulled on Update now' : 'Pulled by itself (Updates: automatic)';
    noteUpdate('updated', `${how}: ${head.slice(0, 7)} → ${theirs.slice(0, 7)}: ${files.join(', ')}`, by === 'now' ? 'updated (Update now)' : 'updated (auto)');
    // Take it in now rather than counting on the folder watch alone.
    for (const x of files) if (x in startHashes) changedFiles.add(x);
    clearTimeout(changeTimer); changeTimer = setTimeout(takeChanges, 3000);
  } catch (e) { noteUpdate('failed', e.message); }
  finally { updateStatus.checking = false; await readCommit(); }
}
async function readCommit() { const r = await git(['rev-parse', '--short', 'HEAD']); if (r.code === 0) updateStatus.commit = r.out.trim(); }
function scheduleUpdates(wait) {
  clearTimeout(updateTimer);
  const min = updateMinutes(); if (!(min > 0)) return;
  updateTimer = setTimeout(async () => {
    // Held for typing: look again shortly, and only go back to GitHub once the minute with no typing is up.
    if (typingHeld && typingNow(lastTyping, Date.now())) return scheduleUpdates(TYPING_RETRY_MS);
    await checkForUpdate();
    if (!typingHeld) scheduleUpdates(); // a check held for typing set its own short retry
  }, wait ?? min * 60000);
}
function updateInfo() {
  let version = ''; try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch {}
  // what is waiting to be deleted, so nothing on that list is silently forgotten
  const toDelete = (state.cleanup || []).map((x) => ({ path: x.path, at: x.at, recycle: !!x.recycle }));
  const { checking, commit, at, result, detail, waiting } = updateStatus, mode = updateMode();
  const w = restartWait.pending, restartWaiting = w || restarting ? { since: w?.since || Date.now(), why: w ? w.why : '', restarting } : null;
  // busyNow: what is working right now, so Update now can offer to wait for it
  return { version, commit, branch: UPDATE_BRANCH, minutes: updateMinutes(), checking, at, result, detail, mode, waiting, prompt: updatePrompt({ waiting, mode }), toDelete, restartWaiting, busyNow: restartHolds() };
}
readCommit();
git(['rev-parse', 'HEAD']).then((r) => { if (r.code === 0 && !startHead) startHead = r.out.trim(); }); // the commit this app started on
scheduleUpdates(30000); // the first check soon after starting, then on the timer

// The runner stops by itself to take in its own changes once nothing is working (see runner.mjs).
// Check on it every few seconds: start it again when it is gone, and put back the sessions it was holding.
let runnerCheck = false;
setInterval(async () => {
  if (runnerCheck || !runnerToken || docketRestarting) return; // runnerToken: the runner has been reached at least once
  runnerCheck = true;
  try {
    if (await runnerHealth()) return;
    await ensureRunner();
    const restart = [...live.values()].filter((s) => s.runnerRestarted);
    for (const old of restart) {
      live.delete(old.id);
      const s = startSession({ clientId: old.client, resumeId: old.id });
      s.events = old.events; s.tasks = old.tasks; s.stats = old.stats; s.unread = old.unread;
      s.readyAt = old.readyAt; s.wasWaiting = old.wasWaiting;
      if (state.sessions[s.id]) { state.sessions[s.id].restartNote = true; saveState(); } // told with its next message
      setStatus(s, 'idle');
      pushSession(s);
    }
    if (restart.length) logEvent('runner restarted; sessions put back', String(restart.length));
  } catch (e) { logEvent('could not restart the session runner', e.message); }
  finally { runnerCheck = false; }
}, 5000);

// ---------- folders to remove once no session uses them ----------
// Windows won't delete a folder a running session works in (its own folder included), so a session
// that can't finish a cleanup hands the folder to Docket (remove_folder_later). Every minute Docket
// deletes each listed folder that no running session uses, and only if it holds no files. What the recycle tool
// couldn't send yet is on the same list (recycle: true) and goes to the Recycle Bin, files and all, once free.
state.cleanup ||= []; // [{ path, by, at, recycle? }]
const samePathOrInside = (p, folder) => { const a = path.resolve(p).toLowerCase(), b = path.resolve(folder).toLowerCase(); return a === b || a.startsWith(b + path.sep); };
// Folders Docket must never remove, whatever a session asks.
function protectedFolder(p) {
  const r = path.resolve(p).toLowerCase();
  if (r === path.parse(r).root.toLowerCase()) return true; // a drive
  const keep = [ROOT, os.homedir(), ...CLIENTS.flatMap((c) => [c.home, c.folder])].map((x) => path.resolve(x).toLowerCase());
  return keep.some((k) => k === r || k.startsWith(r + path.sep)); // that folder, or anything holding it
}
function hasFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || hasFiles(path.join(dir, e.name))) return true;
  }
  return false;
}
function queueFolderRemoval(p, by) {
  const full = path.resolve(p);
  if (protectedFolder(full)) return { ok: false, text: `Docket won't remove ${full}: it is a drive, a home folder, a desk folder or Docket itself.` };
  if (!state.cleanup.some((x) => x.path.toLowerCase() === full.toLowerCase())) { state.cleanup.push({ path: full, by, at: Date.now() }); saveState(); }
  return { ok: true, text: `Queued: Docket deletes ${full} once no session is using it, as long as it holds no files. Nothing to tell the user or list as a next step.` };
}
const cwdsInUse = () => [...live.values()].filter((s) => s.status !== 'ended').map((s) => s.cwd).filter(Boolean);
// Sends paths to the Recycle Bin (the Trash on a Mac) without a dialog: [{ path, status }], see parseTrashOutput.
function recyclePaths(paths) {
  return trash(paths, (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 120000, windowsHide: true },
    (e, out) => resolve({ ok: !e, out }))));
}
// The recycle tool: what isn't in use goes to the Recycle Bin now; what is (a session works in it, a program
// has a file in it open) waits on state.cleanup and goes once it is free. Files and full folders alike: the Recycle
// Bin keeps them, so the "holds no files" rule of remove_folder_later doesn't apply.
async function recycleForSession(paths, by) {
  const lines = [], now = [], inUse = cwdsInUse();
  let queued = 0;
  const queue = (full) => {
    if (!state.cleanup.some((x) => x.path.toLowerCase() === full.toLowerCase())) state.cleanup.push({ path: full, by, at: Date.now(), recycle: true });
    else state.cleanup.find((x) => x.path.toLowerCase() === full.toLowerCase()).recycle = true;
    queued++; lines.push(`${full}: in use, queued; Docket sends it to the Recycle Bin once it is free.`);
  };
  for (const p of paths) {
    if (!isFullPath(p)) { lines.push(`${p}: not done, give the full path.`); continue; }
    const full = path.resolve(p);
    if (protectedFolder(full)) { lines.push(`${full}: not done, it is a drive, a home folder, a desk folder or Docket itself (or holds one).`); continue; }
    if (!fs.existsSync(full)) { lines.push(`${full}: not there (nothing to do).`); continue; }
    if (inUse.some((cwd) => samePathOrInside(cwd, full))) queue(full); else now.push(full);
  }
  for (const r of await recyclePaths(now)) {
    if (r.status === 'recycled') { lines.push(`${r.path}: in the Recycle Bin.`); logEvent('sent to the Recycle Bin for a session', r.path); }
    else if (r.status === 'gone') lines.push(`${r.path}: not there (nothing to do).`);
    else if (r.status === 'locked') queue(r.path);
    else lines.push(`${r.path}: not done, ${r.status === 'nobin' ? 'that drive has no Recycle Bin; leave it or ask the user' : 'the Recycle Bin refused it'}.`);
  }
  if (queued) { saveState(); logEvent('queued for the Recycle Bin', `${queued} for ${by}`); lines.push('Queued items need nothing more: nothing to tell the user or list as a next step.'); }
  return lines.join('\n');
}
let recycling = false; // a sweep waiting on the Recycle Bin
async function sweepFolders() {
  if (!state.cleanup.length || recycling) return;
  const inUse = cwdsInUse(), done = new Set(), bin = [];
  for (const item of state.cleanup) {
    if (!fs.existsSync(item.path)) { done.add(item); continue; } // gone already
    if (inUse.some((cwd) => samePathOrInside(cwd, item.path))) continue;
    if (item.recycle) { bin.push(item); continue; }
    try {
      if (hasFiles(item.path)) { if (!item.hasFiles) { item.hasFiles = true; logEvent('not removing a folder that still holds files', item.path); } continue; }
      fs.rmSync(item.path, { recursive: true });
      done.add(item); logEvent('removed a folder a session handed over', item.path);
    } catch (e) { if (!item.failed) { item.failed = true; logEvent('could not remove a folder yet', `${item.path}: ${e.message}`); } }
  }
  if (bin.length) {
    recycling = true;
    try {
      const results = new Map((await recyclePaths(bin.map((i) => i.path))).map((r) => [r.path, r.status]));
      for (const item of bin) {
        const st = results.get(item.path);
        if (st === 'recycled' || st === 'gone') { done.add(item); if (st === 'recycled') logEvent('sent a queued item to the Recycle Bin', item.path); }
        else if (st === 'nobin') { done.add(item); logEvent('dropped from the Recycle Bin list: its drive has no Recycle Bin', item.path); }
        else if (!item.failed) { item.failed = true; logEvent('could not send to the Recycle Bin yet', `${item.path}: ${st}`); }
      }
    } finally { recycling = false; }
  }
  // filtered, not rebuilt, so what a session added while the Recycle Bin worked stays on the list
  if (done.size) { state.cleanup = state.cleanup.filter((x) => !done.has(x)); saveState(); }
}
setInterval(sweepFolders, 60000);

// ---------- saved sessions on disk ----------
const historyCache = new Map(); // clientId -> { at, rows }
const lastList = new Map(); // clientId -> the rows of the last list built, kept when historyCache is cleared
// ---------- one-shot runs: sessions another session started with `claude -p` in its terminal ----------
// Nothing records who ran them, so they are matched by content: the command in the parent's log
// contains the prompt that became the run's first message, and the run started within minutes of
// it. A matched run is nested under that session and archived (unless the person restored it).
// Conversation files only grow, so each is read from where the last read stopped, and what was found
// is kept on disk (command-runs.json): after the first time, a restart reads almost nothing here.
const RUNS_FILE = path.join(DATA_DIR, 'command-runs.json');
const runCache = new Map(); // file -> { size, scanned, runs: [{ at, text }] }
try { for (const [f, v] of Object.entries(JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8')))) runCache.set(f, v); } catch {}
let runCacheChanged = false;
function saveRunCache() {
  if (!runCacheChanged) return;
  runCacheChanged = false;
  fs.promises.mkdir(DATA_DIR, { recursive: true }).then(() => fs.promises.writeFile(RUNS_FILE, JSON.stringify(Object.fromEntries(runCache)))).catch(() => {});
}
const squash = (t) => String(t || '').replace(/\\(["'`\\])/g, '$1').replace(/["'`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const RUN_RE = /(^|[\s;&|(])claude(\.exe)?"?\s+(-p|--print)\b/;
function commandRuns(file) {
  try {
    const { size } = fs.statSync(file);
    let hit = runCache.get(file);
    if (hit && hit.size === size) return hit.runs;
    if (!hit || hit.scanned === undefined || size < hit.scanned) hit = { size: 0, scanned: 0, runs: [] }; // new, or rewritten: read it all
    // read only what was added since last time, up to the last complete line
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - hit.scanned);
    try { fs.readSync(fd, buf, 0, buf.length, hit.scanned); } finally { fs.closeSync(fd); }
    const end = buf.lastIndexOf(10) + 1; // just past the last newline
    const runs = [...hit.runs];
    for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.includes('tool_use') || !line.includes('claude')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      for (const b of e.message?.content || []) {
        const cmd = b.type === 'tool_use' ? b.input?.command || '' : '';
        if (cmd && RUN_RE.test(cmd)) runs.push({ at: Date.parse(e.timestamp) || 0, text: squash(cmd) });
      }
    }
    runCache.set(file, { size, scanned: hit.scanned + end, runs });
    runCacheChanged = true;
    return runs;
  } catch { return []; }
}
function linkOneShots(client, rows, files) {
  const sources = []; // [{ id, runs }]
  for (const [id, f] of files) { const runs = commandRuns(f); if (runs.length) sources.push({ id, runs }); }
  saveRunCache();
  if (!sources.length) return;
  let changed = false;
  for (const r of rows) {
    const saved = state.sessions[r.sessionId];
    if (saved?.parentId || !r.firstPrompt) continue;
    const key = squash(r.firstPrompt).slice(0, 80);
    if (key.length < 20) continue;
    const at = r.createdAt || 0;
    const src = sources.find((x) => x.id !== r.sessionId && x.runs.some((run) => run.text.includes(key) && Math.abs(run.at - at) < 15 * 60 * 1000));
    if (!src) continue;
    const prev = state.sessions[r.sessionId] || { client: client.id };
    state.sessions[r.sessionId] = { ...prev, client: client.id, parentId: src.id, oneShot: true, ...(prev.archived === undefined ? { archived: true } : {}) };
    changed = true;
  }
  if (changed) saveState();
}

// Building a company's session list from scratch reads every saved conversation (seconds for a
// few hundred). The last list built is kept on disk, so right after Docket starts the page gets
// that one at once while a fresh one is built; pages are told when it is ready (history-ready).
// ---------- Desk check (#619): how a desk is set up, and the problems to fix ----------
// Run when Docket starts (so after every update), when a desk is added, and on demand. It only reads; the last
// report of each desk is kept in memory. Its one fix with a button (a group's start folder) goes through the
// groups' own folder route, like right-click > Set start folder…
const deskChecks = new Map(); // client id -> the last report
async function runDeskCheck(client) {
  let sessions = [];
  try { sessions = (await history(client)).map((r) => ({ id: r.id, cwd: r.cwd, lastModified: r.lastModified, groupId: r.groupId })); } catch {}
  const r = deskCheck({ desk: { id: client.id, name: client.name, folder: client.folder, home: client.home || DEFAULT_HOME }, sessions,
    groups: groupsOf(client.id).filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name, folder: g.folder || '' })),
    otherDesks: CLIENTS.filter((c) => c.id !== client.id).map((c) => ({ name: c.name, folder: c.folder })) });
  deskChecks.set(client.id, r);
  logEvent('desk-check', `${client.id}: ${r.findings.map((f) => f.key).join(', ') || 'nothing to fix'}`);
  return r;
}
async function checkAllDesks() { for (const c of CLIENTS) { try { await runDeskCheck(c); } catch (e) { logEvent('desk-check failed', `${c.id}: ${e.message}`); } } }
const historyDisk = (id) => path.join(DATA_DIR, `history-${id}.json`);
const historyBuilt = new Set(); // companies whose list has been built since this start
async function history(client, force) {
  const c = historyCache.get(client.id);
  if (c && !force && Date.now() - c.at < 20000) return c.rows;
  if (!force && !historyBuilt.has(client.id)) {
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(historyDisk(client.id), 'utf8')); } catch {}
    if (Array.isArray(saved)) {
      if (!historyBuilding.has(client.id)) buildHistory(client).then(() => broadcast({ t: 'history-ready', client: client.id })).catch(() => {});
      return saved;
    }
  }
  return buildHistory(client);
}
const historyBuilding = new Map(); // client id -> the build in progress, shared by everyone asking
function buildHistory(client) {
  if (!historyBuilding.has(client.id)) historyBuilding.set(client.id, buildHistoryNow(client).finally(() => historyBuilding.delete(client.id)));
  return historyBuilding.get(client.id);
}
async function buildHistoryNow(client) {
  const rows = await withHome(client, () => listSessions({}));
  const files = transcriptFiles(client);
  const parents = desktopParents(client);
  linkOneShots(client, rows, files);
  const gone = new Set(state.deleted || []);
  const out = rows.filter((r) => !gone.has(r.sessionId)).map((r) => ({
    id: r.sessionId, client: client.id, title: r.customTitle || r.summary || r.firstPrompt || '(untitled)',
    stats: statsFor(client, files.get(r.sessionId)),
    cwd: state.sessions[r.sessionId]?.movedTo || r.cwd, lastModified: lastMessageTime(files.get(r.sessionId)) || r.lastModified, createdAt: r.createdAt, live: false,
    said: transcriptTail(files.get(r.sessionId)).said || '',
    parentId: parentOf(client, r.sessionId),
    interrupted: cutAtStart(r.sessionId),
    archived: isArchived(client, r.sessionId),
    scheduleId: state.sessions[r.sessionId]?.scheduleId || null,
    runAt: state.sessions[r.sessionId]?.runAt || null,
    oneShot: !!state.sessions[r.sessionId]?.oneShot,
    groupId: effectiveGroup(client, r.sessionId),
    ownGroupId: state.sessions[r.sessionId]?.groupId ?? null,
    editFor: state.sessions[r.sessionId]?.editFor || null,
    midReply: !!state.sessions[r.sessionId]?.cutOff || (cutAtStart(r.sessionId) && !!state.sessions[r.sessionId]?.busy),
    cutBy: state.sessions[r.sessionId]?.cutOff?.how || null,
    waiting: !!state.sessions[r.sessionId]?.waiting || desktopWaits(r.sessionId, files.get(r.sessionId)),
    unreadWhy: state.sessions[r.sessionId]?.waitingWhy?.why || null, // why it was waiting when it stopped (#671)
    unreadSaid: state.sessions[r.sessionId]?.waitingWhy?.said || null,
    awaitingAnswer: transcriptTail(files.get(r.sessionId)).awaiting,
    lastError: state.sessions[r.sessionId]?.lastError || null,
    engine: state.sessions[r.sessionId]?.engine || 'claude',
  })).concat(ownHomeRows(client, gone)).sort((a, b) => b.lastModified - a.lastModified);
  historyCache.set(client.id, { at: Date.now(), rows: out });
  lastList.set(client.id, out);
  historyBuilt.add(client.id);
  try { desktopSeenSets.set(client.id, desktopSet(client)); } catch {}
  fs.promises.mkdir(DATA_DIR, { recursive: true }).then(() => fs.promises.writeFile(historyDisk(client.id), JSON.stringify(out))).catch(() => {});
  return out;
}

// Codex and Grok sessions in the company's own Codex or Grok home that Docket did not run: started from its
// Terminal, say. Listed like a Claude session started in a terminal, and opened as far as Docket supports that brand.
// The shared ~/.codex stays unlisted, since its sessions belong to no one company.
function ownHomeRows(client, gone) {
  const ran = new Set();
  for (const rec of Object.values(state.sessions)) for (const x of [...(rec.grokIds || []), ...(rec.codexIds || [])]) ran.add(x);
  const rows = [];
  const add = (id, engine, title, cwd, at, createdAt) => {
    if (ran.has(id) || gone.has(id) || state.sessions[id]?.engine) return;
    rows.push({ id, client: client.id, title: state.sessions[id]?.title || title || '(untitled)', cwd, lastModified: at, createdAt: createdAt || at, live: false,
      parentId: null, archived: isArchived(client, id), groupId: effectiveGroup(client, id), ownGroupId: state.sessions[id]?.groupId ?? null, engine, outside: true });
  };
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  if (client.grokHome) for (const [gid, dir] of grokSessionDirs(client.grokHome)) {
    let cwd = ''; try { cwd = decodeURIComponent(path.basename(path.dirname(dir))); } catch {}
    add(gid, 'grok', grokTitle(dir), cwd, Math.max(mtime(path.join(dir, 'usage.json')), mtime(path.join(dir, 'summary.json'))), mtime(dir));
  }
  const codex = client.codexHome && path.resolve(client.codexHome).toLowerCase() !== path.resolve(defaultCodexHome()).toLowerCase() ? client.codexHome : null;
  if (codex && fs.existsSync(path.join(codex, 'sessions'))) for (const s of codexSessions(codex).values()) add(s.id, 'codex', s.title, s.cwd, mtime(s.files[0]) || s.started, s.started);
  return rows;
}
// One of those rows, by id: Docket lists it but does not read or resume a Grok or Codex session it did not run.
// Read from the last list built, of any age: the row the person clicked came from it, and building the list again
// (seconds on a desk with hundreds of sessions) would hold up every session opened 20 s after the last build (#642).
const outsideRow = async (client, id) => (lastList.get(client.id) || await history(client)).find((r) => r.id === id && r.outside) || null;
const outsideNote = (r) => `This ${BRANDS[r.engine]?.name || r.engine} session was started outside Docket${r.cwd ? `, in ${r.cwd}` : ''}. Docket lists it with the desk's sessions, but shows and continues only the ${BRANDS[r.engine]?.name || r.engine} sessions it runs itself. To continue it, open a Terminal for this desk (it uses this desk's ${BRANDS[r.engine]?.name || r.engine} home) and resume it there${r.engine === 'codex' ? ` with: codex resume ${r.id}` : ''}.`;

// File dates are not reliable (other programs touch transcript files), so a
// session's age comes from the timestamp of the last entry written in it.
function transcriptFiles(client) {
  const map = new Map();
  const dir = path.join(client.home, 'projects');
  for (const p of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, p)); } catch { continue; }
    for (const n of names) if (n.endsWith('.jsonl')) map.set(n.slice(0, -6), path.join(dir, p, n));
  }
  return map;
}
// ---------- searching what was said ----------
// Per company, the typed text of every conversation (search.mjs), built in the background after a
// start and brought up to date when a search comes in, so a new message is found on the next search.
const textIndexes = new Map(); // client id -> index
const textChecked = new Map(); // client id -> when its files were last looked at
function textIndex(client) {
  if (!textIndexes.has(client.id)) textIndexes.set(client.id, createIndex());
  return textIndexes.get(client.id);
}
function refreshText(client) {
  textChecked.set(client.id, Date.now());
  const idx = textIndex(client), started = Date.now(), first = !idx.built;
  return idx.refresh(new Map([...transcriptFiles(client), ...keptChatFiles(client)])).then(() => {
    if (first) { const st = idx.stats(); logEvent(`search index built for ${client.id}: ${st.sessions} sessions, ${(st.chars / 1e6).toFixed(1)} M characters, ${((Date.now() - started) / 1000).toFixed(1)} s, Docket now using ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB`); }
  });
}
async function searchText(client, q) {
  const idx = textIndex(client);
  if (!idx.built) { if (!idx.building) refreshText(client).catch(() => {}); }
  else if (Date.now() - (textChecked.get(client.id) || 0) > 2000) await refreshText(client).catch(() => {});
  const started = performance.now();
  const hits = idx.search(q);
  return { building: !idx.built, hits, ms: Math.round(performance.now() - started) };
}
// Built one company at a time after the start, so it never competes with the first page load.
setTimeout(async () => { for (const c of CLIENTS) await refreshText(c).catch(() => {}); }, 3000);

// ---------- bringing in past sessions ----------
// Claude Code conversations from before Docket, in a Claude home other than the company's, copied into its home
// (bring-in.mjs). The user folder can be a made-up one on a test copy (PORTAL_USER_HOME), so no real session is copied.
const BRING_USER_HOME = process.env.PORTAL_USER_HOME || os.homedir();
const bringing = new Set(); // company ids with a copy or undo under way
function bringInSources(client) {
  return sourceHomes({ userHome: BRING_USER_HOME, target: client.home, env: process.env,
    others: CLIENTS.filter((c) => c.id !== client.id).map((c) => ({ name: c.name, home: c.home })), extra: state.bringInHomes || [] });
}
// Sends files to the Recycle Bin (the Trash on a Mac) without a dialog. A copy something holds open is left
// where it is, and the Undo reports it as not done.
async function toTrash(paths) {
  const bad = (await recyclePaths(paths)).filter((r) => r.status !== 'recycled' && r.status !== 'gone');
  if (bad.length) throw new Error(bad.some((r) => r.status === 'locked') ? 'A program has it open (a session working in its folder?); left where it is' : `The Recycle Bin refused ${bad.map((r) => r.path).join(', ')}`);
}
// Remove's "also move its folders to the Recycle Bin", for a company already off the list: only the folders
// Docket made for it (madeFolders), its browser profile and its saved session list. Never its working folder, nor a
// folder another company still uses (protectedFolder), and never a permanent delete. [{ path, status }].
async function recycleDesk(c) {
  const w = signInWindows.get(c.id);
  if (w) { clearInterval(w.timer); await w.context.close().catch(() => {}); signInWindows.delete(c.id); }
  const work = c.folder && path.resolve(c.folder);
  const paths = [...(c.madeFolders || []).filter((p) => path.isAbsolute(p)), browserDir(c), historyDisk(c.id)]
    .filter(Boolean).map((p) => path.resolve(p)).filter((p) => fs.existsSync(p) && !protectedFolder(p) && !(work && (samePathOrInside(work, p))));
  const out = await recyclePaths(paths);
  historyCache.delete(c.id);
  logEvent('desk folders to the Recycle Bin', `${c.name}: ${out.map((r) => `${r.status} ${r.path}`).join(', ') || 'none'}`);
  return out;
}
const runView = (r) => ({ id: r.id, at: r.at, copied: r.items.filter((i) => i.status === 'copied').length,
  undone: r.items.filter((i) => i.status === 'undone').length, total: r.items.length, undoneAt: r.undoneAt || null });
async function bringInView(client) {
  const { homes, refused } = bringInSources(client);
  const groups = findGroups({ homes, target: client.home });
  return { target: client.home, homes, refused, offered: !!state.bringInOffered?.[client.id],
    groups: groups.map(({ sessions, ...g }) => ({ ...g, sessions: sessions.map(({ file, ...s }) => s) })),
    runs: readReports(DATA_DIR, client.id).map(runView) };
}
// After a copy or an undo: the session list, search and costs read the company's home again, without a restart.
function bringInChanged(client) {
  filesCache.delete(client.id); historyCache.delete(client.id);
  buildHistory(client).then(() => broadcast({ t: 'history-ready', client: client.id })).catch(() => {});
  refreshText(client).catch(() => {});
  sweepUsage().catch(() => {});
}
// The picked groups (found again here, never taken from the page) are written to the report first; the copy starts
// only once it is saved.
async function bringIn(client, picked) {
  if (bringing.has(client.id)) throw new Error('Docket is already bringing sessions in for this desk');
  bringing.add(client.id);
  try {
    const { homes } = bringInSources(client);
    const run = planRun({ groups: findGroups({ homes, target: client.home }), picked, target: client.home, client: client.id });
    if (!run.items.length) throw new Error('There is nothing new to bring in from the folders picked');
    const report = writeReport(DATA_DIR, run);
    logEvent('bringing in past sessions', `${client.id}: ${run.items.length} from ${picked.length} folder(s), report ${report.json}`);
    await copyRun(run, { save: (r) => writeReport(DATA_DIR, r), trash: toTrash });
    bringInChanged(client);
    return { run: runView(run), failed: run.items.filter((i) => i.status === 'failed').map((i) => ({ title: i.title, error: i.error })), report: report.html };
  } finally { bringing.delete(client.id); }
}
function bringInRun(client, id) {
  const run = readReports(DATA_DIR, client.id).find((r) => r.id === id);
  if (!run) throw new Error('That report was not found');
  return run;
}
// ids: the copies the person ticked; changed ones among them go too, the rest stay.
async function bringInUndo(client, id, ids) {
  if (bringing.has(client.id)) throw new Error('Docket is already bringing sessions in for this desk');
  bringing.add(client.id);
  try {
    const run = bringInRun(client, id);
    const r = await undoRun(run, { force: ids, trash: toTrash, keep: (sid) => live.has(sid) ? 'open' : !ids.includes(sid) && 'kept', save: (x) => writeReport(DATA_DIR, x) });
    logEvent('undid bringing in past sessions', `${client.id} run ${id}: ${r.done.length} to the Recycle Bin, ${r.skipped.length} left`);
    bringInChanged(client);
    return { ...r, run: runView(run) };
  } finally { bringing.delete(client.id); }
}

// ---------- model, context use and cache timer per session ----------
// From the last reply Claude made in the session's file: the model, how many tokens
// the conversation now holds, when that reply came (the prompt cache counts from
// there), and which cache length was written (1 hour or 5 minutes).
const statsCache = new Map(); // file -> { size, stats }
// One reply's model, tokens and cache length (null when the reply only read the cache).
function replyStats(m, at) {
  if (!m?.usage || !m.model || m.model.startsWith('<')) return null;
  const u = m.usage, cc = u.cache_creation || {};
  return {
    model: m.model,
    tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0),
    at,
    cacheTtl: cc.ephemeral_1h_input_tokens > 0 ? 3600 : cc.ephemeral_5m_input_tokens > 0 ? 300 : null,
  };
}
function sessionStats(file) {
  if (!file) return null;
  try {
    const { size } = fs.statSync(file);
    const hit = statsCache.get(file);
    if (hit && hit.size === size) return hit.stats;
    let stats = null, ttl = null;
    for (const len of [262144, 2097152]) { // most files answer from the last 256 KB
      const n = Math.min(size, len);
      const buf = Buffer.alloc(n);
      const fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, n, size - n); fs.closeSync(fd);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0 && !(stats && ttl); i--) {
        if (!lines[i].includes('"assistant"') || !lines[i].includes('"usage"')) continue;
        let e; try { e = JSON.parse(lines[i]); } catch { continue; }
        if (e.type !== 'assistant' || e.isSidechain) continue;
        const r = replyStats(e.message, Date.parse(e.timestamp) || 0);
        if (!r) continue;
        if (!stats) stats = { model: r.model, tokens: r.tokens, at: r.at };
        // A reply that only read the cache refreshes it but does not say which length; look further back.
        if (!ttl) ttl = r.cacheTtl;
      }
      if (stats && ttl) break;
      if (n === size) break;
    }
    if (stats) stats.cacheTtl = ttl || 300;
    statsCache.set(file, { size, stats });
    return stats;
  } catch { return null; }
}

// Where auto-compact starts, per client and model, as Claude Code itself reports it.
// Asked once (no message is sent), then remembered.
const compactPoints = new Map(); // "client|model" -> tokens
const compactAsking = new Set();
function compactPoint(client, model) {
  const key = `${client.id}|${model}`;
  if (compactPoints.has(key)) return compactPoints.get(key);
  if (!compactAsking.has(key)) {
    compactAsking.add(key);
    (async () => {
      async function* never() { await new Promise(() => {}); }
      const q = query({ prompt: never(), options: { env: envFor(client), ...claudeSettings(client), cwd: client.folder, model } });
      try {
        const u = await q.getContextUsage();
        compactPoints.set(key, u.isAutoCompactEnabled ? u.autoCompactThreshold || null : null);
        historyCache.delete(client.id);
        broadcast({ t: 'stats-ready', client: client.id });
      } catch {} finally { q.close(); compactAsking.delete(key); }
    })();
  }
  return null;
}
function withLimits(client, st) {
  return { ...st, compactAt: compactPoint(client, st.model), cacheExpiresAt: st.at + st.cacheTtl * 1000 };
}
function statsFor(client, file) {
  const st = sessionStats(file);
  return st ? withLimits(client, st) : null;
}

// The end of a saved conversation: when its last entry was written, and whether its latest reply is
// waiting on the user's answer (reports.mjs), and how its last turn ended when Claude Desktop wrote it (needs-you.mjs).
// Read from the last 64 KB, kept until the file's size or modified time changes.
const tailCache = new Map(); // file -> { size, mtime, time, awaiting, desktop }
function transcriptTail(file) {
  if (!file) return { time: 0, awaiting: false, desktop: null };
  try {
    const { size, mtimeMs: mtime } = fs.statSync(file);
    const hit = tailCache.get(file);
    if (hit && hit.size === size && hit.mtime === mtime) return hit;
    const len = Math.min(size, 65536);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const stamps = text.match(/"timestamp":"([^"]+)"/g) || [];
    const time = stamps.length ? Date.parse(stamps[stamps.length - 1].slice(13, -1)) || 0 : 0;
    const lines = text.split('\n').slice(len < size ? 1 : 0); // the first line may be cut in half
    const msgs = lines.flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
    const out = { size, mtime, time, awaiting: awaitingAnswer(msgs), desktop: desktopTurn(msgs), said: lastSaid(msgs) };
    tailCache.set(file, out);
    return out;
  } catch { return { time: 0, awaiting: false, desktop: null }; }
}
const lastMessageTime = (file) => transcriptTail(file).time;
// The start of the last reply's words, for the hover card on a list row (#691).
const SAID_LEN = 240;
const saidStart = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, SAID_LEN);
function lastSaid(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type !== 'assistant' || m.isSidechain || !Array.isArray(m.message?.content)) continue;
    const t = saidStart(m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join(' '));
    if (t) return t;
  }
  return '';
}

// A session Claude Desktop ran waits on the person when its last turn there finished after they last opened it in
// Docket (seenAt). Docket's own sessions keep their saved `waiting`; this only adds the Desktop ones.
const desktopWaits = (id, file) => !live.has(id) && desktopWaiting({ turn: transcriptTail(file).desktop, seenAt: state.sessions[id]?.seenAt });
// Nothing tells Docket when Claude Desktop writes a reply, so every 30 seconds each listed desk's conversation files
// are looked at (only a file whose size or modified time changed is read again). When the set of Desktop sessions
// waiting on the person changes, the list is built again and pages are told.
const desktopSeenSets = new Map(); // client id -> the waiting Desktop session ids, joined
const desktopSet = (client) => [...transcriptFiles(client)].filter(([id, f]) => !wasDeleted(id) && desktopWaits(id, f)).map(([id]) => id).sort().join(' ');
setInterval(() => {
  for (const c of CLIENTS) {
    if (!historyBuilt.has(c.id) || historyBuilding.has(c.id)) continue;
    let now; try { now = desktopSet(c); } catch { continue; }
    if (!desktopSeenSets.has(c.id)) { desktopSeenSets.set(c.id, now); continue; }
    if (desktopSeenSets.get(c.id) === now) continue;
    desktopSeenSets.set(c.id, now);
    historyCache.delete(c.id);
    buildHistory(c).then(() => broadcast({ t: 'history-ready', client: c.id })).catch(() => {});
  }
}, 30000).unref?.();

// ---------- parent links recorded by the Claude desktop app ----------
// The desktop app keeps a record per session in <profile>claude-code-sessions…local_*.json.
// "spawnedFrom" names the parent by the app's own id; each record also holds the
// Claude Code session id, so the two can be matched. Read-only.
const desktopCache = new Map(); // clientId -> { at, parents, archived }
const desktopParents = (client) => desktopInfo(client).parents;
function desktopInfo(client) {
  const hit = desktopCache.get(client.id);
  if (hit && Date.now() - hit.at < 60000) return hit;
  const root = path.join(client.desktop || path.dirname(client.home), 'claude-code-sessions');
  const records = [];
  const walk = (dir, depth) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      const full = path.join(dir, n.name);
      if (n.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (n.isFile() && /^local_.*\.json$/.test(n.name)) {
        try {
          const j = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (j.cliSessionId) records.push({ local: j.sessionId, cli: j.cliSessionId, parentLocal: j.spawnedFrom?.sessionId, archived: !!j.isArchived });
        } catch {}
      }
    }
  };
  walk(root, 0);
  const cliOf = new Map(records.map((r) => [r.local, r.cli]));
  const parents = new Map();
  for (const r of records) if (r.parentLocal && cliOf.get(r.parentLocal)) parents.set(r.cli, cliOf.get(r.parentLocal));
  const archived = new Set(records.filter((r) => r.archived).map((r) => r.cli));
  const info = { at: Date.now(), parents, archived };
  desktopCache.set(client.id, info);
  return info;
}

// Archived = the portal's own choice if there is one, otherwise what the desktop app says.
// The portal never writes to the desktop app's files.
function isArchived(client, id) {
  const own = state.sessions[id]?.archived;
  return own !== undefined ? own : desktopInfo(client).archived.has(id);
}
// The page's Archive button and the close_session tool: archiving closes a running session; it can
// be picked up again after restoring.
function archiveSession(client, id, archived) {
  const running = live.get(id);
  if (running && archived) {
    running.input.close(); running.query.close(); live.delete(id); markRunning(id, false);
    broadcast({ t: 'ended', id, client: client.id });
    pushParentOf(id); // its parent stops waiting on it
  }
  setArchived(client.id, id, archived);
}
function setArchived(clientId, id, archived) {
  state.sessions[id] = { ...(state.sessions[id] || { client: clientId }), archived };
  if (archived) setPinned(clientId, id, false);
  saveState();
  historyCache.delete(clientId);
  broadcast({ t: 'archived', id, client: clientId, archived });
}

// Delete = gone for good: the session is ended if it is running, its record leaves state.sessions,
// and its conversation file (and the folder beside it holding its agents' files) is removed from
// that company's Claude home. Sessions it started stay, moved up to the top level in the group
// they were showing in. Its id is remembered, so a list built before the delete never brings it back.
async function deleteSession(client, id) {
  const running = live.get(id);
  if (running) {
    running.input.close(); running.query.close(); live.delete(id);
    broadcast({ t: 'ended', id, client: client.id });
  }
  const file = sessionFile(client, id) || transcriptFiles(client).get(id);
  // Its cost stays in Docket's usage record with the group and parent it had, so totals keep counting it.
  const keep = { groupId: effectiveGroup(client, id) || null, parentId: parentOf(client, id) || null, ...(shiftOf(state.sessions[id]) ? { shift: shiftOf(state.sessions[id]) } : {}) };
  const title = running?.title || state.sessions[id]?.title || (historyCache.get(client.id)?.rows || []).find((r) => r.id === id)?.title;
  for (const [cid, rec] of Object.entries(state.sessions)) {
    if (cid === id || rec.client !== client.id || parentOf(client, cid) !== id) continue;
    if (rec.groupId === undefined) { const g = effectiveGroup(client, cid); if (g) rec.groupId = g; }
    rec.parentId = '';
    if (rec.reportsTo === id) delete rec.reportsTo;
    const kid = live.get(cid);
    if (kid) { kid.parentId = null; pushSession(kid); }
  }
  // children known only to the desktop app get a record of their own saying they have no parent
  for (const [cid, pid] of desktopParents(client)) {
    if (pid !== id || state.sessions[cid]) continue;
    const g = effectiveGroup(client, cid);
    state.sessions[cid] = { client: client.id, parentId: '', ...(g ? { groupId: g } : {}) };
  }
  delete state.sessions[id];
  interrupted.delete(id);
  setPinned(client.id, id, false);
  if (state.touched[client.id]?.[id]) { delete state.touched[client.id][id]; keepChanged(client.id); }
  fs.promises.rm(chatFile(id), { force: true }).catch(() => {});
  state.deleted = [...(state.deleted || []).filter((x) => x !== id), id].slice(-500);
  saveState();
  if (file) {
    // A session being ended writes its last lines to the file as it shuts down, so wait for that
    // (up to 15 seconds), and look again a little later in case a last write still lands.
    if (running?.finished) await Promise.race([running.finished, new Promise((r) => setTimeout(r, 15000))]);
    refreshUsage(client, id, file, title);
    const removeFiles = async () => {
      for (let tries = 0; ; tries++) { // a file just let go of can stay locked for a moment on Windows
        try { await fs.promises.rm(file, { force: true }); break; }
        catch (e) { if (tries >= 20) throw new Error(`Could not delete the conversation file: ${e.message}`); await new Promise((r) => setTimeout(r, 250)); }
      }
      await fs.promises.rm(file.slice(0, -6), { recursive: true, force: true }).catch(() => {});
    };
    await removeFiles();
    if (running) setTimeout(() => { if (fs.existsSync(file)) removeFiles().then(() => logEvent(`deleted session ${id} again: it wrote to its file after it was deleted`)).catch(() => {}); }, 5000);
  }
  if (usage[id]) { Object.assign(usage[id], keep, { deleted: true }); saveUsageSoon(); }
  filesCache.delete(client.id);
  historyCache.delete(client.id);
  // the saved copy of the list is what shows right after a restart, so it must not hold it either
  try { const f = historyDisk(client.id); const rows = JSON.parse(fs.readFileSync(f, 'utf8')); fs.writeFileSync(f, JSON.stringify(rows.filter((r) => r.id !== id))); } catch {}
  if (state.sessionLinks?.[id] || state.folderBranches?.[id]) { delete state.sessionLinks?.[id]; delete state.folderBranches?.[id]; saveState(); }
  logEvent(`deleted session ${id} (${client.id})`);
  broadcast({ t: 'deleted', id, client: client.id });
}

// ---------- pull requests per session ----------
// Claude Code writes a "pr-link" entry into a session's file for each pull
// request the session is tied to (the same list the desktop app shows).
const filesCache = new Map(); // clientId -> { at, map }
function sessionFile(client, id) {
  let c = filesCache.get(client.id);
  if (!c || Date.now() - c.at > 60000 || !c.map.has(id)) { c = { at: Date.now(), map: transcriptFiles(client) }; filesCache.set(client.id, c); }
  return c.map.get(id);
}
// The recall tool's view of a session's own file, read again only when the file has grown.
const recallCache = new Map(); // session id -> { file, size, entries, compacts }
async function recallFor(s) {
  if (s.engine && s.engine !== 'claude') return { error: `Docket can read back only Claude sessions' conversations; this one runs on ${BRANDS[s.engine]?.name || s.engine}.` };
  const client = clientById(s.client);
  const file = client && sessionFile(client, s.id);
  if (!file) return { error: "Docket could not find this session's conversation file." };
  const { size } = await fs.promises.stat(file);
  const hit = recallCache.get(s.id);
  if (hit && hit.file === file && hit.size === size) return hit;
  const r = { file, size, ...(await readEntries(file, { docketBlock: DOCKET_BLOCK, sessionBlock: SESSION_BLOCK })) };
  recallCache.delete(s.id); recallCache.set(s.id, r);
  if (recallCache.size > 20) recallCache.delete(recallCache.keys().next().value); // the least recently read
  return r;
}
// The file is read once, then only what it gained since (links.mjs: the pr-link entries and the branches).
const linkScans = new Map(); // file -> scan
function sessionScan(client, id) {
  const file = sessionFile(client, id);
  if (!file) return null;
  try {
    const { size } = fs.statSync(file);
    let scan = linkScans.get(file);
    if (!scan || size < scan.offset) scan = newLinkScan();
    if (size > scan.offset) {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(size - scan.offset);
        fs.readSync(fd, buf, 0, buf.length, scan.offset);
        const cut = buf.lastIndexOf(10) + 1; // whole lines only, so a character split across reads is never cut
        scanLinkText(scan, buf.subarray(0, cut).toString('utf8'));
        scan.offset += cut;
      } finally { fs.closeSync(fd); }
    }
    linkScans.set(file, scan);
    return scan;
  } catch { return null; }
}

// ---------- which gh account asks GitHub ----------
// gh answers as its active account, which may not see another account's private repos (a personal repo when the
// active one is the work account). When it cannot read a repo, the other accounts signed in to gh on this computer are
// tried, first the one named like the repo owner; a token goes only to that one command through GH_TOKEN, and gh's
// active account is never switched. The account that worked is remembered per owner.
const ghOwnerAccount = new Map(); // gh config folder|owner -> { at, login } (login '': the active account)
const ghAccountList = new Map(); // gh config folder -> { at, accounts }
const ghTokens = new Map(); // gh config folder|login -> { at, token }
const ghPlain = (env) => { const { GH_TOKEN, GITHUB_TOKEN, ...rest } = env; return rest; }; // so gh uses its own sign-ins
async function ghTokenFor(env, login) {
  const k = `${env.GH_CONFIG_DIR || ''}|${login}`, hit = ghTokens.get(k);
  if (fresh(hit, 600000)) return hit.token;
  const r = await runCommand('gh', ['auth', 'token', '--user', login], ghPlain(env), 10000);
  const token = r.code === 0 ? r.out.trim().split(/\s+/).pop() : '';
  ghTokens.set(k, { at: Date.now(), token });
  return token;
}
async function ghAccountsOf(env) {
  const k = env.GH_CONFIG_DIR || '';
  let hit = ghAccountList.get(k);
  if (!fresh(hit, 600000)) {
    const r = await runCommand('gh', ['auth', 'status'], ghPlain(env), 10000);
    hit = { at: Date.now(), accounts: ghAccounts(r.out) };
    ghAccountList.set(k, hit);
  }
  return hit.accounts;
}
async function ghOtherAccounts(env, owner) { return ghAccountOrder(owner, await ghAccountsOf(env)); }
// One GraphQL query about repos of one owner, as the account that can read them: its answer (data and errors), or null.
async function ghAsk(client, owner, query) {
  const env = envFor(client), key = `${env.GH_CONFIG_DIR || ''}|${owner.toLowerCase()}`;
  const ask = async (login) => {
    const token = login && await ghTokenFor(env, login);
    if (login && !token) return null;
    const r = await runCommand('gh', ['api', 'graphql', '-f', `query=${query}`], login ? { ...ghPlain(env), GH_TOKEN: token } : env);
    try { return JSON.parse(r.out); } catch { return null; }
  };
  const known = ghOwnerAccount.get(key);
  let first = null, asked = false;
  if (fresh(known, 3600000)) {
    const json = await ask(known.login);
    if (json && !ghUnreadable(json)) return json;
    if (known.none) return json; // no account could read it: the others are tried again when that is an hour old
    if (!known.login) { first = json; asked = true; }
  }
  if (!asked) first = await ask('');
  if (!first || !ghUnreadable(first)) { if (first) ghOwnerAccount.set(key, { at: Date.now(), login: '' }); return first; }
  for (const login of await ghOtherAccounts(env, owner)) {
    const json = await ask(login);
    if (json && !ghUnreadable(json)) { ghOwnerAccount.set(key, { at: Date.now(), login }); return json; }
  }
  ghOwnerAccount.set(key, { at: Date.now(), login: '', none: true });
  return first;
}
// Items (each with repo owner/name) in groups of up to n, one owner per group, so each group is asked as its own account.
function byOwner(items, n) {
  const groups = new Map();
  for (const x of items) { const o = x.repo.split('/')[0].toLowerCase(); groups.set(o, [...(groups.get(o) || []), x]); }
  return [...groups.values()].flatMap((g) => Array.from({ length: Math.ceil(g.length / n) }, (_, i) => g.slice(i * n, i * n + n)));
}

const prStatus = new Map(); // url -> { at, data }
function prFresh(url) {
  const hit = prStatus.get(url);
  if (!hit) return false;
  const ttl = hit.data.state === 'OPEN' ? 120000 : 3600000; // finished ones rarely change
  return Date.now() - hit.at < ttl;
}
// One GitHub request for many pull requests, signed in as that client's GitHub account.
async function fetchPRStatus(client, prs) {
  const todo = prs.filter((p) => p.repo && p.number && !prFresh(p.url));
  for (const chunk of byOwner(todo, 40)) {
    const parts = chunk.map((p, n) => {
      const [owner, name] = p.repo.split('/');
      return `p${n}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${Number(p.number)}) { state isDraft mergeable title headRefName author { login } ${CLOSES} ${CHECKS} } }`;
    });
    const data = (await ghAsk(client, chunk[0].repo.split('/')[0], `query { ${parts.join(' ')} }`))?.data || {};
    chunk.forEach((p, n) => {
      const pr = data[`p${n}`]?.pullRequest;
      prStatus.set(p.url, { at: Date.now(), data: pr ? pr : { state: 'UNKNOWN' } });
    });
  }
  return prs.map((p) => {
    const d = prStatus.get(p.url)?.data || { state: 'UNKNOWN' };
    // p.branch (the branch last seen before the link) only when GitHub could not say; closes: the issues it fixes
    return { ...p, status: ghStatus(d), draft: !!d.isDraft, title: d.title || '', branch: d.headRefName || p.branch || '', author: d.author?.login || '', closes: closesOf(d), checks: checksOf(d.commits?.nodes?.[0]?.commit?.statusCheckRollup) };
  });
}

// ---------- GitHub issues per session ----------
// client id|url -> { at, data } (data null: not an issue there, a pull request's number, or the sign-in cannot read
// it), per company since each has its own GitHub sign-in
const issueStatus = new Map();
const issueKey = (client, i) => `${client.id}|${i.url}`;
// One GitHub request for many issues, signed in as that client's GitHub account, the same way as pull requests.
async function fetchIssueStatus(client, issues) {
  const todo = issues.filter((i) => { const h = issueStatus.get(issueKey(client, i)); return !fresh(h, linkTtl(!h?.data || h.data.state === 'CLOSED')); });
  for (const chunk of byOwner(todo, 40)) {
    const parts = chunk.map((i, k) => {
      const [owner, name] = i.repo.split('/');
      return `i${k}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issue(number: ${Number(i.number)}) { state stateReason title } }`;
    });
    const data = (await ghAsk(client, chunk[0].repo.split('/')[0], `query { ${parts.join(' ')} }`))?.data || null;
    chunk.forEach((i, k) => {
      if (data) issueStatus.set(issueKey(client, i), { at: Date.now(), data: data[`i${k}`]?.issue || null });
      else if (!issueStatus.has(issueKey(client, i))) issueStatus.set(issueKey(client, i), { at: Date.now() - 3600000 + 120000, data: null }); // GitHub did not answer: again in two minutes
    });
  }
}
// One issue for the page: one it surely worked on (filed, fixed, linked) shows even when the sign-in cannot read it;
// a branch number GitHub does not confirm is left out.
function issueTicket(client, i) {
  const d = issueStatus.get(issueKey(client, i))?.data;
  return d ? githubTicket(i, d) : i.sure ? githubTicket(i, { state: 'UNKNOWN' }) : null;
}

// ---------- Jira tickets, Azure DevOps pull requests and work items per session ----------
// Found from the session's branches (links.mjs), plus what the session linked itself (link_session) less what the
// user unlinked (× in Details), kept in state.sessionLinks: id -> { tickets, prs, hidden }. The sign-ins stay here:
// they are never logged or sent to the page.
const jiraSignIns = new Map(); // client id -> { mtime, creds }
function jiraFor(client) {
  const file = isDefaultHome(client) ? path.join(os.homedir(), '.claude.json') : path.join(client.home, '.claude.json');
  let mtime = 0; try { mtime = fs.statSync(file).mtimeMs; } catch {}
  let hit = jiraSignIns.get(client.id);
  if (!hit || hit.mtime !== mtime) {
    let creds = null; try { creds = jiraFromClaudeJson(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
    hit = { mtime, creds }; jiraSignIns.set(client.id, hit);
  }
  if (!hit.creds) return null;
  const cfg = client.links?.jira || {};
  return { ...hit.creds, url: cfg.url || hit.creds.url, keys: cfg.keys || [] };
}
// The Azure DevOps token: this process's AZURE_DEVOPS_EXT_PAT, else the Windows user variable (set after Docket started).
let adoPatHit = { at: 0, pat: '' };
async function adoPat() {
  if (process.env.AZURE_DEVOPS_EXT_PAT) return process.env.AZURE_DEVOPS_EXT_PAT;
  if (Date.now() - adoPatHit.at < 600000) return adoPatHit.pat;
  let pat = '';
  if (process.platform === 'win32') {
    const r = await runCommand('reg', ['query', 'HKCU\\Environment', '/v', 'AZURE_DEVOPS_EXT_PAT'], process.env, 10000);
    pat = r.out.match(/AZURE_DEVOPS_EXT_PAT\s+REG_(?:EXPAND_)?SZ\s+(\S+)/)?.[1] || '';
  }
  adoPatHit = { at: Date.now(), pat };
  return pat;
}
async function adoFor(client) {
  const cfg = client.links?.azureDevOps, base = adoBase(cfg?.org);
  if (!base || !cfg.project) return null;
  const pat = await adoPat();
  return pat ? { base, project: cfg.project, pat } : null;
}
// A few requests at a time.
async function inTurn(items, fn, n = 6) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}
const adoByBranch = new Map(); // base|project|branch -> { at, ttl, prs }
const ghByBranch = new Map(); // owner/name|branch -> { at, ttl, prs }
const ghRepoOf = new Map(); // folder -> { at, repo }: its origin remote as owner/name, '' when not on GitHub
async function folderGithubRepo(dir) {
  const hit = ghRepoOf.get(dir);
  if (hit && Date.now() - hit.at < 600000) return hit.repo;
  const r = await runCommand('git', ['-C', dir, 'remote', 'get-url', 'origin'], process.env, 10000);
  const repo = r.code === 0 ? githubRepo(r.out) : '';
  ghRepoOf.set(dir, { at: Date.now(), repo });
  return repo;
}
// GitHub pull requests opened from the sessions' branches, whoever opened them: one query for many branches.
async function fetchGhByBranch(client, pairs) {
  const key = (x) => `${x.repo}|${x.branch}`.toLowerCase();
  const todo = [...new Map(pairs.map((x) => [key(x), x])).values()].filter((x) => !fresh(ghByBranch.get(key(x)), ghByBranch.get(key(x))?.ttl));
  for (const chunk of byOwner(todo, 30)) {
    const data = (await ghAsk(client, chunk[0].repo.split('/')[0], ghBranchQuery(chunk)))?.data || null;
    const got = ghBranchAnswer(chunk, data);
    chunk.forEach((x, n) => {
      const prs = got[n], old = ghByBranch.get(key(x));
      // could not ask: kept as it was, tried again in two minutes; none found: ten minutes; open ones two; all finished, hourly
      if (!prs) ghByBranch.set(key(x), { at: Date.now(), prs: old?.prs || [], ttl: 120000, failed: true });
      else ghByBranch.set(key(x), { at: Date.now(), prs, ttl: !prs.length ? 600000 : linkTtl(prs.every((p) => doneStatus(p.status))) });
    });
  }
  return (repo, branch) => ghByBranch.get(`${repo}|${branch}`.toLowerCase())?.prs || [];
}
const adoById = new Map(); // url -> { at, pr }
const jiraStatus = new Map(); // base|key -> { at, ticket } (ticket null: Jira does not know it)
const adoPrItems = new Map(); // pull request url -> { at, ids }: the work items linked to it
const adoItems = new Map(); // base|AB#id -> { at, item } (item null: Azure DevOps does not know it, or the token cannot see it)
let adoStates = { at: Date.now(), map: new Map() }; // project|type -> state name -> category, asked again daily
const doneStatus = (s) => s === 'merged' || s === 'closed';
const fresh = (hit, ttl) => hit && Date.now() - hit.at < ttl;
const savedLinks = (id) => state.sessionLinks?.[id] || { tickets: [], prs: [], hidden: [] };
// Who the Jira sign-in is (its accountId), asked once per sign-in; a failed ask is tried again in ten minutes.
const jiraMeHit = new Map(); // url|user -> { at, me }
async function jiraMeFor(jira) {
  const k = `${jira.url}|${jira.user}`, h = jiraMeHit.get(k);
  if (h && (h.me || Date.now() - h.at < 600000)) return h.me;
  let me = ''; try { me = await jiraMe(jira); } catch {}
  jiraMeHit.set(k, { at: Date.now(), me });
  return me;
}
// The branch each folder a session worked in is on now, asked briefly apart: Docket resets a session's shell to
// its own folder after every command, so work in a worktree (cd X && ..., git -C X, a script that makes one) never
// shows in the entries' gitBranch. Asked only while the session runs: a finished session's folders may be on other
// work since. The answers are kept in state.folderBranches (id -> { folder: branch }), so a restart still knows them.
// Read from the folder's HEAD file, never by starting git: with many sessions live, a git per folder per ask
// kept the app too busy to answer anything else.
const folderBranch = new Map(); // folder -> { at, branch }
async function branchNow(dir) {
  const hit = folderBranch.get(dir);
  if (fresh(hit, 10000)) return hit.branch;
  const branch = await currentBranch(dir); // null: not a git folder, or gone
  folderBranch.set(dir, { at: Date.now(), branch });
  return branch;
}
async function askFolders(ids, scans) {
  const asks = ids.filter((id) => live.has(id) && scans.get(id)).flatMap((id) => [...scans.get(id).folders].map((dir) => [id, dir]));
  await inTurn([...new Set(asks.map(([, d]) => d))], branchNow);
  let changed = false;
  for (const id of new Set(asks.map(([i]) => i))) {
    const saved = state.folderBranches?.[id] || {}, next = { ...saved };
    for (const [i, dir] of asks) { const b = folderBranch.get(dir)?.branch; if (i === id && b != null) { delete next[dir]; next[dir] = b; } }
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete next[k]; // the newest 30
    if (JSON.stringify(next) !== JSON.stringify(saved)) { (state.folderBranches ||= {})[id] = next; changed = true; }
  }
  if (changed) saveState();
}
async function sessionLinks(client, ids) {
  const jira = jiraFor(client), ado = await adoFor(client);
  const scans = new Map(ids.map((id) => [id, sessionScan(client, id)]));
  await askFolders(ids, scans);
  const per = ids.map((id) => {
    const scan = scans.get(id), saved = savedLinks(id), hidden = new Set(saved.hidden || []);
    const { branches, current } = scan ? sessionBranches(scan, new Map(Object.entries(state.folderBranches?.[id] || {}))) : { branches: [], current: '' };
    const gh = [...(scan?.prs.values() || [])], adoUrls = [];
    for (const u of saved.prs || []) {
      const g = u.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i);
      if (g) { if (!gh.some((x) => x.url === u)) gh.push({ url: u, number: Number(g[2]), repo: g[1] }); } else if (parseAdoPrUrl(u)) adoUrls.push(u);
    }
    const savedIssues = (saved.tickets || []).map(parseIssueUrl).filter(Boolean);
    const keys = jira ? [...new Set([...ticketKeys(branches, jira.keys), ...(saved.tickets || []).filter(isTicketKey)])] : [];
    // work items: from the branch names and link_session here, from the session's pull requests below
    const items = ado ? [...adoWorkItemIds(branches).map(adoItemKey), ...(saved.tickets || []).filter(isAdoItemKey)] : [];
    const folder = branches.length ? live.get(id)?.cwd || state.sessions[id]?.cwd || sessionFolder(client, id) || '' : '';
    return { id, scan, hidden, branches, current, folder, gh: gh.filter((x) => !hidden.has('pr:' + x.url)), adoUrls, savedIssues, keys: keys.filter((k) => !hidden.has('ticket:' + k)), items };
  });
  // GitHub by branch in the repos of the session's folder and of the pull requests it linked, then the status
  // of linked ones not found that way; Azure DevOps by branch and by link; Jira in one search.
  // and of the worktrees its branches were seen in
  const ghDirs = per.flatMap((x) => [x.folder, ...x.branches.map((b) => x.scan?.dirs.get(b))]);
  await inTurn([...new Set(ghDirs.filter((d) => d && fs.existsSync(d)))], async (d) => { await folderGithubRepo(d); });
  for (const x of per) {
    x.repos = [...new Set([ghRepoOf.get(x.folder)?.repo, ...x.gh.map((p) => p.repo), ...x.branches.map((b) => ghRepoOf.get(x.scan?.dirs.get(b))?.repo)].filter(Boolean))];
  }
  const byBranch = await fetchGhByBranch(client, per.flatMap((x) => x.repos.flatMap((repo) => x.branches.map((branch) => ({ repo, branch })))));
  for (const x of per) {
    x.ghFound = new Map();
    for (const repo of x.repos) for (const b of x.branches) for (const p of byBranch(repo, b)) x.ghFound.set(p.url.toLowerCase(), p);
  }
  const ghLinked = per.flatMap((x) => x.gh.filter((p) => !x.ghFound.has(p.url.toLowerCase())));
  const ghStatusOf = new Map((await fetchPRStatus(client, [...new Map(ghLinked.map((x) => [x.url, x])).values()])).map((x) => [x.url, x]));
  // GitHub issues: the ones it filed, the ones its pull requests fix (closes, read in the same queries as their
  // status), an issue number in a branch name (in the repository of the folder the branch was seen in, else the one
  // repository the session's pull requests and issues are in), and linked ones.
  const numbered = (x) => x.branches.filter((b) => branchIssue(b) && !(jira && ticketKeys([b], jira.keys).length));
  const dirs = [...new Set(per.flatMap((x) => numbered(x).map((b) => x.scan?.dirs.get(b)).filter((d) => d && fs.existsSync(d))))];
  await inTurn(dirs, async (d) => { await folderGithubRepo(d); });
  for (const x of per) {
    const found = new Map([...(x.scan?.issues.values() || []), ...x.savedIssues].map((i) => [i.url, { ...i, sure: true }]));
    const prsOf = [...x.gh.map((p) => ghStatusOf.get(p.url)), ...x.ghFound.values()].filter((p) => p && !x.hidden.has('pr:' + p.url));
    for (const p of prsOf) for (const i of p.closes || []) found.set(i.url, { ...i, sure: true });
    const repos = new Set([...x.repos, ...[...found.values()].map((i) => i.repo)].filter(Boolean));
    for (const b of numbered(x)) {
      const n = branchIssue(b), dir = x.scan?.dirs.get(b);
      // the folder's own answer wins, even "not on GitHub"; a folder that is gone falls back to the session's one repository
      const own = dir && fs.existsSync(dir) ? ghRepoOf.get(dir)?.repo || '' : null;
      const repo = own !== null ? own : repos.size === 1 ? [...repos][0] : '';
      const i = repo && parseIssueUrl(`https://github.com/${repo}/issues/${n}`);
      if (i && !found.has(i.url)) found.set(i.url, i);
    }
    x.issues = [...found.values()].filter((i) => !x.hidden.has('ticket:' + i.url));
  }
  await fetchIssueStatus(client, [...new Map(per.flatMap((x) => x.issues).map((i) => [i.url, i])).values()]);
  if (ado) {
    const bk = (b) => `${ado.base}|${ado.project}|${b}`;
    await inTurn([...new Set(per.flatMap((x) => x.branches))].filter((b) => !fresh(adoByBranch.get(bk(b)), adoByBranch.get(bk(b))?.ttl)), async (b) => {
      try {
        const prs = await adoPRsForBranch({ ...ado, branch: b });
        // none found: looked for again every ten minutes; open ones every two; all finished, hourly
        adoByBranch.set(bk(b), { at: Date.now(), prs, ttl: !prs.length ? 600000 : linkTtl(prs.every((p) => doneStatus(p.status))) });
      } catch { adoByBranch.set(bk(b), { at: Date.now(), prs: adoByBranch.get(bk(b))?.prs || [], ttl: 120000 }); }
    });
    await inTurn([...new Set(per.flatMap((x) => x.adoUrls))].filter((u) => { const h = adoById.get(u); return !fresh(h, linkTtl(doneStatus(h?.pr.status))); }), async (u) => {
      const p = parseAdoPrUrl(u);
      try { adoById.set(u, { at: Date.now(), pr: await adoPRById({ ...p, pat: ado.pat }) }); }
      catch { adoById.set(u, { at: Date.now(), pr: { kind: 'ado', url: u, number: p.number, repo: `${p.project}/${p.repo}`, status: 'unknown', draft: false, title: '', branch: '' } }); }
    });
    // Work items: those linked to the session's own Azure DevOps pull requests, then every item's title, type and state.
    const adoPrsOf = (x) => [...x.branches.flatMap((b) => adoByBranch.get(bk(b))?.prs || []), ...x.adoUrls.map((u) => adoById.get(u)?.pr).filter(Boolean)].filter((p) => !x.hidden.has('pr:' + p.url));
    await inTurn([...new Map(per.flatMap(adoPrsOf).map((p) => [p.url, p])).values()].filter((p) => !fresh(adoPrItems.get(p.url), linkTtl(doneStatus(p.status)))), async (p) => {
      const at = parseAdoPrUrl(p.url);
      try { adoPrItems.set(p.url, { at: Date.now(), ids: await adoPRWorkItemIds({ ...at, pat: ado.pat }) }); }
      catch { adoPrItems.set(p.url, { at: Date.now() - linkTtl(doneStatus(p.status)) + 120000, ids: adoPrItems.get(p.url)?.ids || [] }); }
    });
    for (const x of per) {
      const linked = adoPrsOf(x).flatMap((p) => adoPrItems.get(p.url)?.ids || []).map(adoItemKey);
      x.items = [...new Set([...x.items, ...linked])].filter((k) => !x.hidden.has('ticket:' + k));
    }
    const ik = (k) => `${ado.base}|${k}`;
    const todo = [...new Set(per.flatMap((x) => x.items))].filter((k) => { const h = adoItems.get(ik(k)); return !fresh(h, linkTtl(!h?.item || ticketFinished(h.item.category))); });
    if (todo.length) {
      if (Date.now() - adoStates.at > 86400000) adoStates = { at: Date.now(), map: new Map() };
      try {
        const got = new Map((await adoWorkItems({ base: ado.base, pat: ado.pat, ids: todo.map((k) => Number(k.slice(3))), categories: adoStates.map })).map((t) => [t.key, t]));
        for (const k of todo) adoItems.set(ik(k), { at: Date.now(), item: got.get(k) || null });
      } catch { // kept as it was, and tried again in two minutes
        for (const k of todo) { const t = adoItems.get(ik(k))?.item || null; adoItems.set(ik(k), { at: Date.now() - linkTtl(!t || ticketFinished(t.category)) + 120000, item: t }); }
      }
    }
  }
  if (jira) {
    const jk = (k) => `${jira.url}|${k}`;
    const todo = [...new Set(per.flatMap((x) => x.keys))].filter((k) => { const h = jiraStatus.get(jk(k)); return !fresh(h, linkTtl(!h?.ticket || ticketFinished(h.ticket.category))); });
    if (todo.length) {
      try {
        const got = new Map((await jiraTickets({ ...jira, keys: todo, me: await jiraMeFor(jira) })).map((t) => [t.key, t]));
        for (const k of todo) jiraStatus.set(jk(k), { at: Date.now(), ticket: got.get(k) || null });
      } catch { // kept as it was, and tried again in two minutes
        for (const k of todo) { const t = jiraStatus.get(jk(k))?.ticket || null; jiraStatus.set(jk(k), { at: Date.now() - linkTtl(!t || ticketFinished(t.category)) + 120000, ticket: t }); }
      }
    }
  }
  // whose pull requests are the user's, for mine (#807): the gh accounts signed in here, the Azure DevOps identity
  const anyGh = per.some((x) => x.gh.length || x.ghFound.size);
  const me = { github: anyGh ? (await ghAccountsOf(envFor(client)).catch(() => [])).map((a) => a.login) : [], ado: ado ? [await adoMeFor(ado)] : [] };
  const out = {};
  for (const x of per) {
    const prs = new Map();
    // closes is for the Tickets list only, not sent to the page
    for (const p of x.gh) { const { closes, ...pr } = ghStatusOf.get(p.url) || p; prs.set(p.url.toLowerCase(), { kind: 'github', ...pr }); }
    for (const [k, p] of x.ghFound) { const { closes, ...pr } = p; prs.set(k, pr); }
    if (ado) {
      for (const b of x.branches) for (const p of adoByBranch.get(`${ado.base}|${ado.project}|${b}`)?.prs || []) prs.set(p.url, p);
      for (const u of x.adoUrls) { const p = adoById.get(u)?.pr; if (p && !prs.has(p.url)) prs.set(p.url, p); }
    }
    // mine: one the session made or pushed to, the only kind its row says merge for; one it only reviews is listed too
    const made = { linked: new Set([...x.gh.map((p) => p.url), ...x.adoUrls]), own: x.scan?.own };
    const list = [...prs.values()].filter((p) => !x.hidden.has('pr:' + p.url))
      .map((p) => ({ ...p, mine: sessionMadePr(p, { ...made, me: me[p.kind === 'ado' ? 'ado' : 'github'] }) })).map(withTalk);
    // Jira ones are unread with a newer comment from someone else than when the user last opened them from Docket
    const tickets = [...(jira ? x.keys.map((k) => jiraStatus.get(`${jira.url}|${k}`)?.ticket).filter(Boolean)
      .map((t) => (ticketUnread(t, state.ticketSeen?.[t.key]) ? { ...t, unread: true } : t)) : []),
      ...x.issues.map((i) => issueTicket(client, i)).filter(Boolean).map((t) => withLastComment(t, t.ref, t.status === 'Open')),
      ...(ado ? x.items.map((k) => adoItems.get(`${ado.base}|${k}`)?.item).filter(Boolean).map((t) => withLastComment(t, `${ado.base}|${t.key}`, !ticketFinished(t.category))) : [])];
    // branches too, for the Details panel; links.mjs already leaves out master and main
    const wt = x.scan?.dirs.get(x.current) || '';
    if (list.length || tickets.length || x.branches.length) out[x.id] = { prs: list, tickets, branches: x.branches, current: x.current, worktree: fs.existsSync(wt) ? wt : '' };
  }
  talkSoon(client, ado, Object.values(out)); // never awaited: the comments are asked after this answer has gone
  return out;
}

// ---------- Comments waiting on the user ----------
// Asked only in the background, after a page's links request was answered from what is already known: nothing a page
// asks for waits on it, and a failed or slow ask just means no bubble. Only open pull requests and issues and work items
// not done; each at most every five minutes; GitHub in one query per owner; a work item only when its comment count
// changed. Who and when, never the text. A round that changes what waits tells the pages to ask again.
const talk = new Map(); // talkKey -> { at, data, count }: a pull request's { threads, comment }, a ticket's newest comment
const talkBusy = new Set(); // client ids with a round under way
const TALK_TTL = 300000;
const talkKey = (u) => String(u).toLowerCase();
const openPr = (p) => p.status === 'open' || p.status === 'conflict';
function withTalk(p) {
  const t = openPr(p) && prTalk(talk.get(talkKey(p.url))?.data, state.prSeen?.[talkKey(p.url)]);
  return t ? { ...p, talk: t } : p;
}
// A GitHub issue or work item with its newest comment, unread as Jira tickets are (seen under its ref or key).
function withLastComment(t, k, open) {
  const lastComment = open ? talk.get(talkKey(k))?.data || null : null;
  if (!lastComment) return t;
  const u = { ...t, lastComment };
  return ticketUnread(u, state.ticketSeen?.[t.ref || t.key]) ? { ...u, unread: true } : u;
}
const adoMeHit = new Map(); // base -> { at, me }: the signed-in Azure DevOps identity, asked again in ten minutes if it failed
async function adoMeFor(ado) {
  const h = adoMeHit.get(ado.base);
  if (h && (h.me || Date.now() - h.at < 600000)) return h.me;
  let me = ''; try { me = await adoMe(ado); } catch {}
  adoMeHit.set(ado.base, { at: Date.now(), me });
  return me;
}
function talkSoon(client, ado, links) {
  if (talkBusy.has(client.id)) return;
  const stale = (k) => !fresh(talk.get(talkKey(k)), TALK_TTL);
  const uniq = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
  const prs = uniq(links.flatMap((l) => l.prs).filter((p) => openPr(p) && stale(p.url)), (p) => talkKey(p.url));
  const tickets = links.flatMap((l) => l.tickets);
  const issues = uniq(tickets.filter((t) => t.kind === 'github' && t.status === 'Open' && stale(t.ref)), (t) => talkKey(t.ref));
  // a work item is asked again only when its comment count moved (the count comes with its status)
  const items = !ado ? [] : uniq(tickets.filter((t) => t.kind === 'ado' && !ticketFinished(t.category) && talk.get(talkKey(`${ado.base}|${t.key}`))?.count !== t.comments), (t) => t.key);
  const gh = [...prs.filter((p) => p.kind === 'github'), ...issues.map((i) => ({ ...parseIssueUrl(i.ref), issue: true })).filter((i) => i.url)];
  const adoPrs = ado ? prs.filter((p) => p.kind === 'ado') : [];
  if (!gh.length && !adoPrs.length && !items.length) return;
  talkBusy.add(client.id);
  let changed = false;
  const put = (k, data, count) => {
    if (JSON.stringify(talk.get(talkKey(k))?.data ?? null) !== JSON.stringify(data ?? null)) changed = true;
    talk.set(talkKey(k), { at: Date.now(), data, count });
  };
  const keep = (k) => { const old = talk.get(talkKey(k)); talk.set(talkKey(k), { at: Date.now(), data: old?.data ?? null, count: old?.count }); };
  (async () => {
    for (const chunk of byOwner(gh, 20)) {
      const parts = chunk.map((x, n) => {
        const [owner, name] = x.repo.split('/'), what = x.issue ? `issue(number: ${Number(x.number)}) { ${GH_TALK_ISSUE} }` : `pullRequest(number: ${Number(x.number)}) { ${GH_TALK_PR} }`;
        return `t${n}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${what} }`;
      });
      // viewer: the account that answered, which is who "me" is for these
      const data = (await ghAsk(client, chunk[0].repo.split('/')[0], `query { viewer { login } ${parts.join(' ')} }`).catch(() => null))?.data;
      const me = data?.viewer?.login || '';
      chunk.forEach((x, n) => {
        const d = data?.[`t${n}`]?.[x.issue ? 'issue' : 'pullRequest'];
        if (d) put(x.url, x.issue ? ghIssueLast(d, me) : ghPrTalkOf(d, me)); else keep(x.url);
      });
    }
    if (adoPrs.length || items.length) {
      const me = await adoMeFor(ado);
      await inTurn(adoPrs, async (p) => {
        try { put(p.url, { threads: adoThreadLasts(await adoPrThreads({ ...parseAdoPrUrl(p.url), pat: ado.pat }), me), comment: null }); } catch { keep(p.url); }
      }, 3);
      await inTurn(items, async (t) => {
        const k = `${ado.base}|${t.key}`;
        if (!t.comments) return put(k, null, 0);
        try { put(k, await adoItemNewestComment({ base: ado.base, project: t.project, id: t.id, pat: ado.pat, me }), t.comments); } catch { keep(k); }
      }, 3);
    }
  })().catch(() => {}).finally(() => {
    talkBusy.delete(client.id);
    if (changed) broadcast({ t: 'links' });
  });
}
// The user opened a ticket or pull request from Details: its comments up to now are seen. The newest 1000 are kept.
function markSeen(map, key) {
  const m = (state[map] ||= {});
  delete m[key]; m[key] = Date.now();
  const keys = Object.keys(m);
  for (const k of keys.slice(0, Math.max(0, keys.length - 1000))) delete m[k];
  saveState();
  broadcast({ t: 'links' }); // every page clears the marker
}
// What link_session and the × in Details change: a link the session made, or one the user took away.
function changeLinks(id, { ticket, pr, unlink }) {
  const cur = savedLinks(id), next = { tickets: [...(cur.tickets || [])], prs: [...(cur.prs || [])], hidden: [...(cur.hidden || [])] };
  const items = [ticket && ['ticket', ticket, 'tickets'], pr && ['pr', pr, 'prs']].filter(Boolean);
  for (const [kind, v, list] of items) {
    if (unlink) { next[list] = next[list].filter((x) => x !== v); if (!next.hidden.includes(`${kind}:${v}`)) next.hidden.push(`${kind}:${v}`); }
    else { if (!next[list].includes(v)) next[list].push(v); next.hidden = next.hidden.filter((x) => x !== `${kind}:${v}`); }
  }
  state.sessionLinks ||= {};
  if (next.tickets.length || next.prs.length || next.hidden.length) state.sessionLinks[id] = next; else delete state.sessionLinks[id];
  saveState();
  broadcast({ t: 'links', id });
}

// { code, out, err, timedOut }: out is stdout only; timedOut when it was stopped for running past timeout.
function runCommand(cmd, args, env, timeout = 30000) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env, windowsHide: true });
    let out = '', err = '', timedOut = false;
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeout);
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut }); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: '', err: e.message, timedOut }); });
  });
}

// ---------- the company list ----------
// One company as typed (in ☰ > Desks or the setup wizard), checked and tidied; { error } if it can't be saved.
// taken(id) says whether an id is already used, so a new company gets one of its own from its name.
function cleanCompany(c, taken) {
  const name = String(c.name || '').trim().slice(0, 40);
  const home = String(c.home || '').trim(), folder = String(c.folder || '').trim(), email = String(c.email || '').trim();
  const awsProfile = String(c.awsProfile || '').trim(), awsRegion = String(c.awsRegion || '').trim();
  if (!name) return { error: 'Every desk needs a name' };
  if (!path.isAbsolute(home)) return { error: `${name}: the Claude home folder must be a full path, like ${exampleFolder(process.platform, os.homedir(), name, 'claude-home')}` };
  if (folder && !path.isAbsolute(folder)) return { error: `${name}: the working folder must be a full path` };
  // An existing company keeps its id (its sessions, groups and usage are filed under it); a new one gets one from its name.
  let id = c.id && clientById(c.id) ? c.id : null;
  if (!id) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'company';
    id = base;
    for (let n = 2; taken(id); n++) id = `${base}_${n}`;
  }
  // handoffPattern is set by editing the company list file; an edit on the page keeps it.
  const handoffPattern = cleanHandoffPattern(c.handoffPattern !== undefined ? c.handoffPattern : clientById(id)?.handoffPattern);
  // planSystem (#180): which plan system the desk uses: docket (Docket's own), folder (an outside one, shown read-only), or
  // none. Set in the Inspector's Switches, the setup wizard and the card after the update; a save that leaves it out keeps it.
  const planSystem = ['docket', 'folder', 'none'].find((v) => v === (c.planSystem !== undefined ? c.planSystem : clientById(id)?.planSystem)) || '';
  // planFolder (#180 step 3): the plan folder's path and its optional marker file pattern, kept whatever the plan
  // system, so switching away and back loses nothing.
  const planFolder = cleanPlanFolder(c.planFolder !== undefined ? c.planFolder : clientById(id)?.planFolder);
  // planSwitch (#700): a switch of plan system waiting on its conversion session, { to, from, session, at }; only the
  // plan-switch route sets or clears it, so every other save keeps it.
  const ps = clientById(id)?.planSwitch, planSwitch = ps && ['docket', 'folder', 'none'].includes(ps.to) ? ps : undefined;
  // docketHooks.off: the Docket hooks this company turned off (the Companies screen); the wizard does not send it, so it is kept.
  const docketHooks = cleanDocketHooks(c.docketHooks !== undefined ? c.docketHooks : clientById(id)?.docketHooks);
  // grokHome sets Grok up for this company: its Grok home folder (its Grok sign-in and settings). defaultEngine
  // is the brand a new session gets when nobody picks one; Claude unless set. Both are set on the Companies
  // screen and in the setup wizard; one left out is kept. An "engine" sent by a page not yet reloaded
  // counts as the default.
  // brandsOff: the brands unticked on the Companies screen, or not picked in the wizard (which still sends a
  // Claude home, since every company has one); one left out is kept. At least one brand stays in use, and the
  // default is one in use.
  const before = upgradeCompany(clientById(id) || {});
  // settingSources: the Claude settings layers its sessions load, set on the profile page; kept when not sent.
  const settingSources = cleanSettingSources(c.settingSources !== undefined ? c.settingSources : before.settingSources);
  // splitWork: false when its sessions should not send work to child sessions on their own (splitOn); set in the
  // setup wizard and on the profile page, kept when not sent. On is the default and is not written.
  const splitWork = (c.splitWork !== undefined ? c.splitWork : before.splitWork) !== false;
  // resumeAfterSignIn: false when its sessions should not carry on by themselves once its sign-in is back (#719).
  const resumeSignIn = (c.resumeAfterSignIn !== undefined ? c.resumeAfterSignIn : before.resumeAfterSignIn) !== false;
  // configReload: 'ask' when a session whose Claude config changed waits for Reload; Automatic (not written) reloads it at its next idle moment.
  const configReload = (c.configReload !== undefined ? c.configReload : before.configReload) === 'ask';
  // hidden: the desk has no button at the top, so its sessions are out of the list, until it is shown again (☰ > Desks >
  // Manage). Nothing of it changes. The wizard does not send it, so it is kept; shown is the default and is not written.
  const hidden = (c.hidden !== undefined ? c.hidden : before.hidden) === true;
  const asked = c.defaultEngine !== undefined ? c.defaultEngine : c.engine !== undefined ? c.engine : before.defaultEngine;
  const grokHome = String((c.grokHome !== undefined ? c.grokHome : before.grokHome) || '').trim();
  if (grokHome && !path.isAbsolute(grokHome)) return { error: `${name}: the Grok home folder must be a full path, like ${exampleFolder(process.platform, os.homedir(), 'grok_home', name)}` };
  // codexHome sets Codex up the same way: its Codex home folder (CODEX_HOME: its sign-in, settings and sessions).
  const codexHome = String((c.codexHome !== undefined ? c.codexHome : before.codexHome) || '').trim();
  if (codexHome && !path.isAbsolute(codexHome)) return { error: `${name}: the Codex home folder must be a full path, like ${exampleFolder(process.platform, os.homedir(), 'codex_home', name)}` };
  const brandsOff = [...new Set((Array.isArray(c.brandsOff) ? c.brandsOff : before.brandsOff || []).filter((e) => BRANDS[e]))];
  const homes = { claude: home, grok: grokHome, codex: codexHome };
  const using = Object.keys(BRANDS).filter((e) => !brandsOff.includes(e) && homes[e]);
  if (!using.length) return { error: `${name}: keep at least one brand ticked` };
  if (asked && asked !== 'claude' && BRANDS[asked] && !using.includes(asked)) return { error: `${name}: ${BRANDS[asked].name} can only be the default once Use ${BRANDS[asked].name} is ticked, with a ${BRANDS[asked].name} home folder like ${exampleFolder(process.platform, os.homedir(), `${asked}_home`, name)}` };
  const defaultEngine = asked && asked !== 'claude' && using.includes(asked) ? asked : using.includes('claude') ? '' : using[0];
  // color: the company's own main color, set on the Companies screen; none uses the browser's. The wizard does
  // not send it, so it is kept.
  const color = String((c.color !== undefined ? c.color : before.color) || '').trim().toLowerCase();
  if (color && !/^#[0-9a-f]{6}$/.test(color)) return { error: `${name}: the color must be a hex code like #2074a4` };
  // budget: an optional daily budget in dollars at API prices, set on the Companies screen; blank is none.
  // The wizard does not send it, so it is kept.
  const budgetText = String((c.budget !== undefined ? c.budget : before.budget) ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  const budget = budgetText === '' ? 0 : Math.round(Number(budgetText) * 100) / 100;
  if (!Number.isFinite(budget) || budget < 0 ||(budgetText !== '' && !budget)) return { error: `${name}: the daily budget must be an amount in dollars, like 50, or blank for none` };
  // saveBeforeCompact: the share of the auto-compact point where a session is asked to save its state; missing
  // is the default (85), 0 is off. Set on the Companies screen; the wizard does not send it, so it is kept.
  const saveAt = cleanSaveShare(c.saveBeforeCompact !== undefined ? c.saveBeforeCompact : before.saveBeforeCompact);
  if (saveAt?.error) return { error: `${name}: ${saveAt.error}` };
  // links: where its tickets and pull requests live, beside GitHub. Jira's address and project keys (both optional:
  // by default its jira MCP server's address and any key-shaped word), and Azure DevOps' organization and project.
  // The Companies screen sends them as jiraUrl, jiraKeys, adoOrg and adoProject; the wizard does not, so they are kept.
  const flat = ['jiraUrl', 'jiraKeys', 'adoOrg', 'adoProject'].some((k) => c[k] !== undefined);
  const was = c.links !== undefined ? c.links || {} : before.links || {};
  const jiraUrl = String(flat ? c.jiraUrl || '' : was.jira?.url || '').trim().replace(/\/+$/, '');
  const jiraKeys = [...new Set((flat ? String(c.jiraKeys || '').split(/[\s,]+/) : was.jira?.keys || []).map((k) => String(k).trim().toUpperCase()).filter(Boolean))];
  const adoOrg = String(flat ? c.adoOrg || '' : was.azureDevOps?.org || '').trim(), adoProject = String(flat ? c.adoProject || '' : was.azureDevOps?.project || '').trim();
  if (jiraUrl && !/^https:\/\/[^\s/]+/i.test(jiraUrl)) return { error: `${name}: the Jira address must start with https://, like https://example.atlassian.net` };
  const badKey = jiraKeys.find((k) => !/^[A-Z][A-Z0-9_]+$/.test(k));
  if (badKey) return { error: `${name}: ${badKey} is not a Jira project key (letters and digits, like ABC)` };
  if (adoOrg && !adoBase(adoOrg)) return { error: `${name}: the Azure DevOps organization must be its name or address, like https://dev.azure.com/example` };
  if (!adoOrg !== !adoProject) return { error: `${name}: Azure DevOps needs both the organization and the project` };
  // promptCacheTtl: '1h' once the offer's Make it 1 hour is pressed, or picked on the Companies screen; empty is
  // automatic (Claude Code's own choice). The wizard does not send it, so it is kept.
  const cacheTtl = String((c.promptCacheTtl !== undefined ? c.promptCacheTtl : before.promptCacheTtl) || '').trim();
  if (cacheTtl && cacheTtl !== '1h' && cacheTtl !== '5m') return { error: `${name}: the prompt cache is 1h, 5m, or empty for automatic` };
  // startGear: the gear each brand's Shift sessions start on in this company, as { brand: key }; a brand left out
  // starts on its top gear, so the top gear is the one choice not stored and any lower one chosen is kept (#635).
  // The Companies screen sends startGear_<brand>; the wizard sends none, so it is kept.
  const flatGear = Object.keys(BRANDS).some((e) => c['startGear_' + e] !== undefined);
  const startGear = Object.fromEntries(Object.entries(cleanStartGear(flatGear ? Object.fromEntries(Object.keys(BRANDS).map((e) => [e, c['startGear_' + e]]))
    : c.startGear !== undefined ? c.startGear : before.startGear)).filter(([e, key]) => key !== topGearOf(e).key));
  // gateway: a LiteLLM gateway its Claude goes through instead of its own sign-in or an AWS profile. The
  // Companies screen sends it as gatewayUrl, gatewayClaudeRoute, gatewayLogin, gatewayLite and gatewayModel_claude_<gear>;
  // the wizard sends none, so it is kept.
  const sentGateway = c.gateway !== undefined || c.gatewayUrl !== undefined;
  const gw = cleanGateway(sentGateway ? c : { gateway: before.gateway }, { name, aws: !!awsProfile, isAbsolute: (f) => path.isAbsolute(f) });
  if (gw.error) return { error: gw.error };
  // env: the company's own environment variables, set on the Companies screen; the wizard does not send them, so
  // they are kept. copiedFrom and madeFolders are only ever set by Docket (a copy, the wizard), so they are kept as they were.
  const ownEnv = cleanEnv(c.env !== undefined ? c.env : before.env);
  if (ownEnv.error) return { error: `${name}: ${ownEnv.error}` };
  const links = { ...(jiraUrl || jiraKeys.length ? { jira: { ...(jiraUrl ? { url: jiraUrl } : {}), ...(jiraKeys.length ? { keys: jiraKeys } : {}) } } : {}), ...(adoOrg ? { azureDevOps: { org: adoOrg, project: adoProject } } : {}) };
  // A home folder holds that company's sign-in, so it never goes inside the folder Docket runs from, which is a git
  // folder that is pulled and pushed. Windows ignores letter case, so C:\Work\Docket is that folder too.
  for (const [label, dir, sub] of [['Claude home', home, 'claude-home'], ['Grok home', grokHome, 'grok-home'], ['Codex home', codexHome, 'codex-home']]) {
    if (dir && isInside(dir, ROOT)) return { error: `${name}: the ${label} folder ${dir} is inside Docket's own folder (${ROOT}). It holds the sign-in, so it must be somewhere else, like ${path.join(homeRoots().claude, `${name}-desk`, sub)}` };
  }
  return { id, name, home, folder: folder || home, ...(hidden ? { hidden: true } : {}), ...(email ? { email } : {}), ...(defaultEngine ? { defaultEngine } : {}), ...(path.isAbsolute(grokHome) ? { grokHome } : {}), ...(path.isAbsolute(codexHome) ? { codexHome } : {}), ...(brandsOff.length ? { brandsOff } : {}), ...(awsProfile ? { awsProfile } : {}), ...(awsProfile && awsRegion ? { awsRegion } : {}), ...(gw.gateway ? { gateway: gw.gateway } : {}), ...(handoffPattern ? { handoffPattern } : {}), ...(planSystem ? { planSystem } : {}), ...(planFolder ? { planFolder } : {}), ...(planSwitch ? { planSwitch } : {}), ...(docketHooks ? { docketHooks } : {}), ...(settingSources ? { settingSources } : {}), ...(splitWork ? {} : { splitWork: false }), ...(resumeSignIn ? {} : { resumeAfterSignIn: false }), ...(configReload ? { configReload: 'ask' } : {}), ...(color ? { color } : {}), ...(budget ? { budget } : {}), ...(saveAt !== undefined ? { saveBeforeCompact: saveAt } : {}), ...(cacheTtl ? { promptCacheTtl: cacheTtl } : {}), ...(Object.keys(startGear).length ? { startGear } : {}), ...(Object.keys(links).length ? { links } : {}), ...(before.ghDefault ? { ghDefault: before.ghDefault } : {}), ...(Object.keys(ownEnv.env).length ? { env: ownEnv.env } : {}), ...(before.copiedFrom ? { copiedFrom: before.copiedFrom } : {}), ...(before.madeFolders?.length ? { madeFolders: before.madeFolders } : {}) };
}
function saveCompanies(list) {
  for (const c of list) {
    fs.mkdirSync(c.home, { recursive: true }); // a new company's Claude home starts empty
    if (c.grokHome) makeGrokHome(c.grokHome); // a new Grok home starts with Claude's rules and hooks kept out
    if (c.codexHome) makeCodexHome(c.codexHome);
  }
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(list, null, 2) + '\n');
  CLIENTS.splice(0, CLIENTS.length, ...list); // same list object, so everything holding it sees the change
  authCache.clear(); // a company may now sign in somewhere else (another home, or a brand added)
  logEvent('companies changed', list.map((c) => c.name).join(', '));
  broadcast({ t: 'clients' });
}
// ---------- copying a company as a new company (copy-company.mjs) ----------
// What the Copy wizard sends: { source: id, name, home, grokHome, codexHome, folder, conn: { brand: { mode, ... } },
// choices, env }. Worked out into the copy's homes, the plan (a dry run that changes nothing) and what is wrong.
const copying = new Set(); // source ids with a copy under way
const COPY_FIELD = { name: 'The name', folder: 'The working folder', env: 'Environment:', claude: 'The Claude home', grok: 'The Grok home', codex: 'The Codex home' };
function copyRequest(b) {
  const src = clientById(b.source);
  if (!src) return { error: 'Unknown desk' };
  const uses = brandsOf(src);
  const conn = {};
  for (const e of Object.keys(BRANDS)) {
    const m = b.conn?.[e]?.mode;
    conn[e] = { ...(b.conn?.[e] || {}), mode: ['same', 'new', 'off'].includes(m) ? m : uses.includes(e) ? 'same' : 'off' };
  }
  const choices = { ...defaultChoices(), ...Object.fromEntries(Object.entries(b.choices || {}).filter(([k]) => COPY_ITEMS.some((i) => i.key === k)).map(([k, v]) => [k, !!v])), connectionChanged: conn.claude.mode === 'new' };
  const name = String(b.name || '').trim().slice(0, 40);
  const target = { claude: String(b.home || '').trim(), grok: conn.grok.mode !== 'off' ? String(b.grokHome || '').trim() : '', codex: conn.codex.mode !== 'off' ? String(b.codexHome || '').trim() : '' };
  const problems = {};
  if (!name) problems.name = 'is missing';
  else if (CLIENTS.some((c) => c.name.toLowerCase() === name.toLowerCase())) problems.name = `${name} is already a desk`;
  const sources = [src.home, src.grokHome, src.codexHome].filter(Boolean);
  const taken = CLIENTS.flatMap((c) => [c.home, c.grokHome, c.codexHome]).filter(Boolean);
  for (const [e, dir] of Object.entries(target)) {
    if (!dir) { if (e === 'claude') problems.claude = 'needs a Claude home folder (every desk has one, even with Claude off)'; else if (conn[e].mode !== 'off') problems[e] = `needs a ${BRANDS[e].name} home folder`; continue; }
    const twice = Object.entries(target).some(([o, d]) => o !== e && d && path.resolve(d).toLowerCase() === path.resolve(dir).toLowerCase());
    const t = targetProblem(dir, { docket: ROOT, sources })
      || (targetProblem(dir, { sources: taken, exists: () => false }) ? "is inside, or holds, another desk's home" : '')
      || (twice ? 'is the same folder as another of its homes' : '');
    if (t) problems[e] = t;
  }
  const folder = String(b.folder || '').trim() || src.folder;
  if (!path.isAbsolute(folder)) problems.folder = 'must be a full path';
  // Only the brands kept on are copied from the source, and only from a home it has.
  const from = { claude: conn.claude.mode !== 'off' ? src.home : '', grok: target.grok && src.grokHome, codex: target.codex && src.codexHome };
  const plan = copyPlan({ source: from, target, choices, userHome: os.homedir(), sourceDefault: isDefaultHome(src) });
  // The copy's own variables to start with: the source's, with paths into its homes pointed at the copy's.
  const envStart = Object.fromEntries(Object.entries(src.env || {}).map(([k, v]) => [k, plan.homes.reduce((s, [f, t]) => s.split(f).join(t), String(v))]));
  const env = b.env !== undefined ? cleanEnv(b.env) : { env: envStart };
  if (env.error) problems.env = env.error;
  return { src, conn, choices, name, target, folder, plan, problems, env: env.env || {}, envStart };
}
// The plan as the wizard shows it: what each ticked item copies, what is left pointing at the original, warnings.
function copyView(r) {
  const { plan } = r;
  return {
    problems: r.problems, conn: r.conn, envStart: r.envStart, signIn: needsSignIn(r.src, r.conn),
    items: COPY_ITEMS.map((i) => ({ ...i, on: !!r.choices[i.key], count: plan.copy.filter((c) => c.item === i.key).length })),
    copy: plan.copy.map((c) => ({ item: c.item, brand: c.brand, from: c.from, to: c.to, dir: !!c.dir })),
    rewrite: plan.rewrite.length, outside: plan.outside, warnings: plan.warnings, mcp: plan.mcp, memory: plan.memory,
    stripped: plan.stripped.map(({ file, name }) => ({ file, name })),
    groups: r.choices.groups ? groupsOf(r.src.id).filter((g) => !g.archived).map((g) => g.name) : [],
  };
}

// The AWS profiles in ~/.aws/config, with their region, whether they sign in through AWS's single sign-on page, and the
// AWS account each names (sso_account_id or role_arn) and the profile it signs in through (source_profile).
function awsProfiles() {
  let text = '';
  try { text = fs.readFileSync(awsConfigFile(), 'utf8'); } catch { return []; }
  return parseAwsConfig(text);
}
// A program installed after Docket started is not on the PATH Docket started with: look where its installer puts it,
// and add that folder to this process's PATH so sign-in and sessions find it too.
// platform.mjs says where (WinGet\Links on Windows, Homebrew's folders on a Mac).
const TOOL_FOLDERS = toolFolders({ home: os.homedir() });
// Those folders go on the PATH at start too, so a restart (which begins from the old PATH again) keeps finding them.
for (const d of TOOL_FOLDERS) if (fs.existsSync(d) && !process.env.PATH.toLowerCase().split(path.delimiter).includes(d.toLowerCase())) process.env.PATH += path.delimiter + d;
async function findTool(cmd, args) {
  let r = await runCommand(cmd, args, process.env, 20000);
  if (r.code === 0) return r;
  const dir = TOOL_FOLDERS.find((d) => fs.existsSync(path.join(d, path.basename(cmd) + (process.platform === 'win32' ? '.exe' : ''))));
  if (!dir) return r;
  process.env.PATH = dir + path.delimiter + process.env.PATH;
  return runCommand(cmd, args, process.env, 20000);
}
// Where a new company's home folders go by default: home-roots.mjs.
function homeRoots() {
  return homeRootsFor(CLIENTS, ROOT, os.homedir());
}
async function setupCheck() {
  // The setup wizard offers each brand: whether its program is installed, and which version.
  const [claude, aws, grok, codex] = await Promise.all([findTool(CLAUDE_EXE, ['--version']), findTool('aws', ['--version']),
    findTool(...grokCommand(['--version'])), findTool(...codexCommand(findCodexExe(), ['--version']))]);
  const version = (r) => r.code === 0 ? (r.out.match(/\d+\.\d+\.\d+/)?.[0] || '?') : null;
  const roots = homeRoots();
  // Every home folder already in use, of any brand: two companies sharing one would share its sign-in.
  const taken = CLIENTS.flatMap((c) => [c.home, c.grokHome, c.codexHome]).filter(Boolean).map((h) => path.resolve(h).toLowerCase());
  // The setups this person already has, offered for reuse when signed in: each asked of its program, as a company would be.
  const homes = existingHomes({ userHome: os.homedir(), installed: { claude: version(claude), grok: version(grok), codex: version(codex) }, taken });
  const key = { claude: 'home', grok: 'grokHome', codex: 'codexHome' };
  const existing = Object.fromEntries((await Promise.all(Object.entries(homes).map(async ([e, home]) => {
    const a = await authInfo({ id: '_existing', name: '', home: e === 'claude' ? home : DEFAULT_HOME, [key[e]]: home }, true, e).catch(() => null);
    return a?.loggedIn ? [e, { home, email: a.email || '' }] : null;
  }))).filter(Boolean));
  return {
    claude: version(claude), aws: version(aws), grok: version(grok), codex: version(codex),
    awsProfiles: aws.code === 0 ? awsProfiles() : [],
    forced: policyProvider() ? forcedText(policyProvider()) : null,
    root: roots.claude, roots, taken, existing,
    // Where this person already works, read from their own AI history on this computer.
    folders: workFolders({ userHome: os.homedir(), appData: process.env.APPDATA, claudeHomes: [DEFAULT_HOME, ...CLIENTS.map((c) => c.home).filter(Boolean)] }),
  };
}

// ---------- files a session produced ----------
// Outputs: files Claude presented (present_file, or SendUserFile / Artifact in the desktop app),
// files it wrote with its Write tool, browser screenshots, and output-type files that a
// command produced: mentioned in the conversation and changed during the session.
// Edited files (code and the like) are listed separately.
const OUTPUT_EXT = new Set(['html', 'htm', 'pdf', 'markdown', 'xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'docx', 'doc', 'pptx', 'ppt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'md', 'txt', 'json', 'zip', 'mp4', 'mov', 'webm', 'wav', 'mp3']);
// Claude Code's own scratch space (saved tool output, screenshots, temp files) is not output.
const scratchRoots = () => [...CLIENTS.map((c) => path.resolve(c.home)), path.resolve(os.tmpdir())].map((p) => p.toLowerCase() + path.sep);
const isScratch = (p) => scratchRoots().some((r) => p.toLowerCase().startsWith(r));
const RISKY_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msp', 'lnk', 'scr', 'hta', 'jar', 'reg', 'cpl', 'pif', 'url', 'appref-ms']);
const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const PREVIEW_EXT = new Set(['md', 'markdown', 'txt', 'json', 'csv', 'tsv']);
// What the new-tab preview (/view) shows as the file itself rather than as text.
const RAW_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8' };
const viewOf = (e) => PREVIEW_EXT.has(e) ? 'text' : /^(html|htm)$/.test(e) ? 'html' : e === 'pdf' ? 'pdf' : RAW_TYPE[e] ? 'image' : null;
const PATH_RE = pathRe(); // C:\… on Windows, /Users/… on a Mac (platform.mjs)

async function sessionFiles(client, id) {
  const s = live.get(id);
  const events = s ? s.events : await loadTranscript(client, id).catch(() => []);
  const started = s?.createdAt || (await history(client)).find((r) => r.id === id)?.createdAt || 0;
  const found = new Map(); // path -> { kind, rank }
  const published = new Map(); // lower-case path -> the artifact page this session published it to
  const RANK = { presented: 0, written: 1, browser: 1, maybe: 2, edited: 3 };
  const mentioned = (t) => { for (const m of t.matchAll(PATH_RE)) if (OUTPUT_EXT.has(extOf(m[0]))) add(m[0], 'maybe'); };
  const add = (p, kind) => {
    if (!isFullPath(p)) return;
    const full = path.resolve(p);
    if (/[\\/](node_modules|\.git)[\\/]/i.test(full)) return;
    if (kind !== 'presented' && isScratch(full)) return;
    const prev = found.get(full);
    if (!prev || RANK[kind] < RANK[prev.kind]) found.set(full, { kind });
  };
  for (const e of events) {
    if (e.k === 'files') for (const p of e.paths || []) add(p, 'presented');
    if (e.k === 'tool') {
      const inp = e.input || {};
      if (e.name === 'Write') add(inp.file_path, OUTPUT_EXT.has(extOf(inp.file_path || '')) ? 'written' : 'edited');
      else if (['Edit', 'MultiEdit', 'NotebookEdit'].includes(e.name)) add(inp.file_path || inp.notebook_path, 'edited');
      else if (e.name === 'SendUserFile') for (const p of inp.files || []) add(p, 'presented');
      else if (e.name === 'Artifact') {
        for (const p of [inp.file_path, ...(inp.file_paths || [])]) if (p) add(p, 'presented');
        const pub = artifactPublished(inp, e.result, e.status === 'error');
        if (pub && isFullPath(pub.path)) published.set(path.resolve(pub.path).toLowerCase(), pub.url);
      }
      else if (e.name === 'mcp__portal__present_file') for (const p of inp.paths || []) add(p, 'presented');
      const texts = [inp.command, e.result].filter((x) => typeof x === 'string');
      for (const t of texts) mentioned(t);
    }
    if (e.k === 'text') mentioned(e.text || '');
  }
  const browserDirOut = path.join(UPLOADS, id, 'browser');
  if (fs.existsSync(browserDirOut)) for (const n of fs.readdirSync(browserDirOut)) add(path.join(browserDirOut, n), 'browser');
  // The plan this session coordinates, and the plans it holds tasks in (#180), badged "plan" on the page.
  if (plansOn(client)) for (const p of plansOf(client).list()) if (p.coordinator === id || p.tasks.some((t) => t.holder === id)) found.set(path.resolve(p.file), { kind: 'plan' });
  // On a plan folder desk, the plan a marker file says this session holds.
  if (folderOn(client) && client.planFolder?.marker) {
    const t = await folderTree(client).catch(() => null);
    for (const h of folderHolders(client, t)) if (h.session === id) { const p = t.plans.find((x) => x.key === h.key); if (p) found.set(path.resolve(p.file), { kind: 'plan' }); }
  }

  const out = [];
  for (const [p, { kind }] of found) {
    let st = null; try { st = fs.statSync(p); } catch {}
    if (st && !st.isFile()) continue;
    // A path only mentioned counts when the file changed during this session.
    if (kind === 'maybe') { if (!st || st.mtimeMs < started - 60000) continue; }
    out.push({ path: p, name: path.basename(p), folder: path.dirname(p), kind: kind === 'maybe' ? 'made' : kind,
      exists: !!st, size: st?.size || 0, modified: st?.mtimeMs || 0, canOpen: !RISKY_EXT.has(extOf(p)),
      ...artifactOf(client, p, published), ...(canArtifact(client) && ARTIFACT_EXT.has(extOf(p)) ? { canPublish: true } : {}) });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

// ---------- publishing a file as an artifact ----------
// A file on a session's Files list becomes a claude.ai artifact page only when the person picks Publish as
// artifact (artifact-new-guard turns down a session's own new pages). Docket publishes it in a short run of its
// own, so the session's chat is not touched, and keeps the page's link per file in state.artifacts.
// A session's own Artifact publish to a page (a monthly report updating its page) is kept there too (#608).
const ARTIFACT_EXT = new Set(['html', 'htm', 'md', 'markdown']);
const canArtifact = (client) => !!client && !isBedrock(client) && !gatewayFor(client, 'claude');
// The page a file was published to: Docket's own record first, else what a session's Artifact call said.
function artifactOf(client, p, published) {
  const key = path.resolve(p).toLowerCase(), rec = state.artifacts?.[client.id]?.[key];
  if (rec?.gone) return {}; // its page was deleted: the next publish makes a new one
  const url = rec?.url || published?.get(key);
  return url ? { artifact: url } : {};
}
// Keeps the page a file was just published to as that file's link, for every session of the desk.
function keepArtifactLink(client, filePath, url) {
  ((state.artifacts ||= {})[client.id] ||= {})[path.resolve(filePath).toLowerCase()] = { url, at: Date.now() };
  saveState();
}
async function publishArtifact(client, sessionId, filePath) {
  if (!canArtifact(client)) throw new Error('Artifacts need a claude.ai sign-in, so this desk (on Amazon Bedrock or a gateway) cannot publish them');
  const full = path.resolve(filePath);
  const f = (await sessionFiles(client, sessionId)).find((x) => x.path.toLowerCase() === full.toLowerCase());
  if (!f) throw new Error("That file is not on this session's list");
  if (!f.exists) throw new Error('That file no longer exists');
  if (!f.canPublish) throw new Error('Only an HTML or Markdown file can be published as an artifact');
  const url = f.artifact || '';
  const same = (a) => !!a && path.resolve(a).toLowerCase() === f.path.toLowerCase();
  const prompt = url
    // The tool refuses an update until the run has read the live version, so the read comes first, every time.
    ? `Update the artifact ${url} from the file ${f.path}, in two Artifact tool calls: first action "read" with url ${url}; then action "publish" with file_path ${f.path} and url ${url}. The file is the new version, so publish it as it is. If the read says the artifact no longer exists, stop. Do nothing else, and reply with only the artifact's url.`
    : `Publish the file ${f.path} as a new artifact with the Artifact tool (action "publish" with file_path; no url, and no quickstart). Do nothing else, and reply with only the artifact's url.`;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5 * 60000);
  const q = query({ prompt, options: {
    env: { ...artifactEnv(client), ...envFor(client) }, ...claudeSettings(client), cwd: f.folder, model: modelFor(client, 'claude', AUTO_GROUP_MODEL),
    // Read too: the Artifact tool refuses to publish when the run's tool list leaves reading files out.
    tools: ['Artifact', 'Read'], mcpServers: {}, strictMcpConfig: true, settingSources: [], maxTurns: 6, persistSession: false, abortController: abort,
    permissionMode: 'default',
    // Only this file, and only to its own page (or a new one when it has none).
    canUseTool: async (name, input) => {
      const action = input.action || 'publish';
      if (name === 'Artifact' && action === 'publish' && same(input.file_path) && !input.file_paths && (input.url || '') === url) return { behavior: 'allow', updatedInput: input };
      if (name === 'Artifact' && action === 'read' && url && input.url === url) return { behavior: 'allow', updatedInput: input };
      if (name === 'Read' && same(input.file_path)) return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: 'Only the publish described in the request is allowed.' };
    },
  } });
  let got = '', cost = 0, failed = '';
  const publishes = new Set(); // the ids of the run's publish calls: only their results say the page was published
  try {
    for await (const m of q) {
      if (m.type === 'assistant') for (const c of m.message?.content || []) if (c.type === 'tool_use' && c.name === 'Artifact' && (c.input?.action || 'publish') === 'publish') publishes.add(c.id);
      if (m.type === 'user') for (const c of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (c.type !== 'tool_result') continue;
        const t = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
        if (publishes.has(c.tool_use_id) && !c.is_error) got = t.match(ARTIFACT_URL)?.[0] || url || got; else failed = clip(t, 300); // a read can say the page is gone without an error
      }
      if (m.type === 'result') cost = m.total_cost_usd || 0;
    }
  } finally { clearTimeout(timer); q.close(); }
  logEvent('artifact publish', `${sessionId} ${f.path} -> ${got || 'failed: ' + failed} $${cost.toFixed(4)}`);
  const record = ((state.artifacts ||= {})[client.id] ||= {});
  if (!got && url && /^Artifact [\w-]+: artifact not found/.test(failed)) {
    record[f.path.toLowerCase()] = { gone: true, url, at: Date.now() };
    saveState();
    throw new Error('Its artifact page no longer exists. Publish as artifact again to make a new page.');
  }
  if (!got) throw new Error(failed || 'The artifact was not published');
  keepArtifactLink(client, f.path, got);
  return { url: got };
}

// Opens a file in its default program, or shows it in File Explorer (Finder on a Mac). Only files on that session's list.
async function openFile(client, sessionId, filePath, how) {
  const full = path.resolve(filePath);
  const f = (await sessionFiles(client, sessionId)).find((x) => x.path.toLowerCase() === full.toLowerCase());
  if (!f) throw new Error('That file is not on this session\'s list');
  if (!f.exists) throw new Error('That file no longer exists');
  if (how === 'open' && !f.canOpen) throw new Error('Programs and scripts are not opened from the portal; use Show in folder');
  showFile(f.path, how);
}
// The folders a session has worked in: where it is now, where it started, where it moved to, and the worktrees
// its branches were seen in. Only a folder of this session may be opened from the page.
function sessionFolders(client, id) {
  const s = live.get(id), rec = state.sessions[id];
  if (!(s?.client === client.id || rec?.client === client.id || sessionFile(client, id))) return [];
  return [s?.cwd, rec?.cwd, rec?.movedTo, sessionFolder(client, id, true), ...(sessionScan(client, id)?.dirs.values() || [])].filter(Boolean);
}
// Opens one of a session's folders in the file manager (Explorer, Finder), the folder itself, not a file in it.
function openFolder(client, id, dir) {
  const want = path.resolve(dir).toLowerCase();
  if (!sessionFolders(client, id).some((d) => path.resolve(d).toLowerCase() === want)) throw new Error('That folder is not one this session works in');
  if (!fs.existsSync(dir)) throw new Error('That folder no longer exists');
  showFile(path.resolve(dir), 'open', folderOpenCommand(path.resolve(dir)));
}
function showFile(file, how, { cmd, args, opts } = openCommand(file, how)) {
  spawn(cmd, args, { detached: true, ...opts, stdio: 'ignore' }).on('error', (e) => logEvent('could not open a file', `${file}: ${e.message}`)).unref();
}

// The computer's own folder picker, one at a time, starting at the typed folder or the nearest one above it
// that exists. It waits as long as the person takes: { folder }, { cancelled } or { error }.
let folderPicking = false;
function pickFolder(typed, title) {
  const start = folderPickStart(typed, (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const { cmd, args } = folderPickCommand({ start, title });
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 }, (e, out, err) => {
    const r = parseFolderPick({ ok: !e, out, err: err || (e?.code === 'ENOENT' ? `${cmd} is not installed` : '') });
    if (r.error) logEvent('could not open the folder picker', r.error);
    resolve(r);
  }));
}

// Opens a terminal on this computer in a folder, signed in the way that client's sessions are (Claude home, gh
// account, AWS profile), in the shell asked for (terminalShells in platform.mjs), else the one used last.
// Windows Terminal if it is installed, else the shell's own window. Each shell sets the environment itself (the
// scripts are in platform.mjs). Launched through cmd's start so the window gets its own console, shows even when
// Docket runs hidden, and outlives a Docket restart.
// Where a program is on the PATH, or undefined.
const onPath = (exe) => (process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, exe))
  .find((f) => { try { fs.lstatSync(f); return true; } catch { return false; } }); // an app alias, which existsSync misses
const hasWt = () => !!onPath('wt.exe');
// Where pwsh is: '' when on the PATH, its full path where its installer puts it, or null when it is not installed.
function findPwsh() {
  if (onPath('pwsh.exe')) return '';
  const f = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  return fs.existsSync(f) ? f : null;
}
const hasIterm = () => ['/Applications', path.join(os.homedir(), 'Applications')].some((d) => fs.existsSync(path.join(d, 'iTerm.app')));
const shellsHere = () => terminalShells(process.platform, process.platform === 'win32' ? { pwsh: findPwsh() !== null } : { iterm: process.platform === 'darwin' && hasIterm() });
// The AI programs a terminal can start: one per brand the company has set up whose program is on this
// computer, by its full path, as the shell the window opens may not have Docket's PATH. A stand-in written in
// JavaScript (the tests' fake agents) is no program for a person to use.
const fullExe = (exe) => !exe || /\.m?js$/i.test(exe) ? null : path.isAbsolute(exe) ? (fs.existsSync(exe) ? exe : null)
  : exeNames(exe).map(onPath).find(Boolean) || null;
const CLI_EXE = { claude: () => fullExe(CLAUDE_EXE), grok: () => fullExe(GROK_EXE), codex: () => fullExe(findCodexExe()) };
const terminalClis = (client) => brandsOf(client).map((e) => ({ id: e, name: BRANDS[e].name, exe: CLI_EXE[e]() })).filter((c) => c.exe);
// The shells for the Terminal button, the one it opens when none is asked for (the last one used here), and the AI
// programs it can start for that company.
function terminalInfo(client) {
  const shells = shellsHere();
  return { shells, last: (shells.find((s) => s.id === state.terminal?.shell) || shells[0]).id,
    clis: client ? terminalClis(client).map(({ id, name }) => ({ id, name })) : [] };
}
// The folder a session is in now: the last cwd in its log, which follows it into a git worktree it
// made partway through. Null if that folder is gone (unless evenGone).
function sessionFolder(client, id, evenGone = false) {
  const file = sessionFile(client, id);
  if (!file) return null;
  try {
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, n = Math.min(size, 256 * 1024), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n); fs.closeSync(fd);
    const last = [...buf.toString('utf8').matchAll(/"cwd":("(?:[^"\\]|\\.)*")/g)].pop();
    const dir = last && JSON.parse(last[1]);
    return dir && (evenGone || fs.existsSync(dir)) ? dir : null;
  } catch { return null; }
}

// The editors a session's folder opens in: VS Code, and Visual Studio on Windows, each only when found
// (platform.mjs says where to look). Looked for again after five minutes, so an editor installed since shows up.
let editorsFound = null;
async function findEditors() {
  if (editorsFound && Date.now() - editorsFound.at < 300000) return editorsFound.list;
  const list = [];
  const code = vsCodePaths({ home: os.homedir() }).find((f) => fs.existsSync(f));
  if (code) list.push({ id: 'vscode', name: 'VS Code', exe: code });
  if (process.platform === 'win32') {
    const vw = vswhereCommand();
    const exe = fs.existsSync(vw.cmd) ? (await runCommand(vw.cmd, vw.args, process.env, 15000)).out.trim().split(/\r?\n/)[0] : '';
    if (exe && fs.existsSync(exe)) list.push({ id: 'vs', name: 'Visual Studio', exe });
  }
  editorsFound = { at: Date.now(), list };
  return list;
}
// Opens a session's folder in an editor. The page names only the session, so only a folder a session of this
// company works in opens: where it is now (following it into a git worktree), else where it started.
async function openInEditor(client, id, editorId) {
  const ed = (await findEditors()).find((e) => e.id === editorId);
  if (!ed) throw new Error('That editor is not installed on this computer');
  const s = live.get(id), rec = state.sessions[id];
  const known = s?.client === client.id || rec?.client === client.id || sessionFile(client, id);
  if (!known) throw new Error('Unknown session');
  const dir = sessionFolder(client, id, true) || (s?.client === client.id && s.cwd) || (rec?.client === client.id && (rec.movedTo || rec.cwd));
  if (!dir) throw new Error('This session has no folder');
  let st = null; try { st = fs.statSync(dir); } catch {}
  if (!st?.isDirectory()) throw new Error('That folder no longer exists: ' + dir);
  let target = dir;
  if (ed.id === 'vs') { const sln = solutionIn(fs.readdirSync(dir)); if (sln) target = path.join(dir, sln); }
  const { cmd, args } = editorCommand({ exe: ed.exe, target });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // set, Code.exe would run as plain Node
  spawn(cmd, args, { env, cwd: dir, detached: true, stdio: 'ignore' }).on('error', (e) => logEvent('could not open an editor', `${ed.name} on ${target}: ${e.message}`)).unref();
  return target;
}
// cli: an AI program to start in it (terminalClis), with the shell left open when it exits.
// What a terminal for the company sets (empty: unset): its homes, sign-in and connection, then its own variables
//. The same list makes docket-env.ps1 / docket-env.sh and the Use from a terminal blocks.
function terminalVars(client, env = envFor(client)) {
  return { ...Object.fromEntries(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE', 'AWS_REGION', 'GH_CONFIG_DIR', 'GROK_HOME', 'CODEX_HOME', 'CLAUDE_CODE_PROMPT_CACHE_TTL'].map((k) => [k, env[k] || ''])),
    ...Object.fromEntries(Object.entries(client.env || {}).filter(([k]) => !isReserved(k)).map(([k, v]) => [k, String(v)])) };
}
// docket-env.ps1 and docket-env.sh: beside the Claude home when it is a desk folder's claude-home (as the wizard makes
// them), else inside it. Run with ". <file>" in any window to use the company's homes and variables there.
function writeEnvFiles(client) {
  const dir = path.basename(client.home).toLowerCase() === 'claude-home' ? path.dirname(client.home) : client.home;
  const { ps, sh } = envScripts(terminalVars(client), client.name);
  const files = { ps: path.join(dir, 'docket-env.ps1'), sh: path.join(dir, 'docket-env.sh') };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(files.ps, ps.replace(/\n/g, '\r\n'));
  fs.writeFileSync(files.sh, sh, { mode: 0o755 });
  return files;
}
function openTerminal(client, folder, asked, cli) {
  const dir = path.resolve(String(folder || client.folder || os.homedir()));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('That folder does not exist: ' + dir);
  const { shells, last } = terminalInfo();
  if (asked && !shells.some((s) => s.id === asked)) throw new Error('That terminal is not installed here: ' + asked);
  const prog = cli ? terminalClis(client).find((c) => c.id === cli) : null;
  if (cli && !prog) throw new Error(`${BRANDS[cli]?.name || cli} is not set up for ${client.name} or not installed here`);
  const shell = asked || last;
  if (state.terminal?.shell !== shell) { state.terminal = { ...state.terminal, shell }; saveState(); }
  const env = envFor(client, cli || 'claude');
  const vars = terminalVars(client, env);
  const progs = ['claude', client.grokHome && 'grok', client.codexHome && 'codex', 'gh', env.AWS_PROFILE && 'aws'].filter(Boolean);
  const note = `${client.name} terminal. ${progs.slice(0, -1).join(', ')} and ${progs.at(-1)} here use the ${client.name} sign-ins.`;
  const job = { dir, vars, name: client.name, note, run: prog ? { exe: prog.exe, args: [] } : undefined };
  if (process.platform !== 'win32') return openMacTerminal(shell, job);
  let file;
  if (shell === 'cmd') {
    file = path.join(os.tmpdir(), `docket-terminal-${randomUUID()}.cmd`);
    fs.writeFileSync(file, cmdTerminalScript({ ...job, tag: 'Docket ' + randomUUID() }));
  }
  const cmd = windowsTerminalCommand({ shell, file, script: shell === 'cmd' ? '' : psTerminalScript(job), exe: shell === 'pwsh' ? findPwsh() : '', wt: hasWt() });
  spawn('cmd.exe', ['/d', '/c', cmd], { cwd: dir, env, windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
  return dir;
}
// On a Mac: Terminal or iTerm2, which is usually running already and so does not take Docket's environment either.
// The window runs a one-off .command script (platform.mjs) that sets it, and deletes itself once read.
function openMacTerminal(shell, job) {
  const file = path.join(os.tmpdir(), `docket-terminal-${randomUUID()}.command`);
  fs.writeFileSync(file, macTerminalScript(job), { mode: 0o700 });
  const { cmd, args } = macTerminalOpen(shell, file);
  spawn(cmd, args, { cwd: job.dir, detached: true, stdio: 'ignore' }).on('error', (e) => logEvent('could not open a terminal', e.message)).unref();
  return job.dir;
}

// ---------- a Grok or Codex session's chat, kept by Docket ----------
// A chat is read back from its saved conversation after an app restart. Claude saves each conversation in a
// file Docket reads; Grok saves its own in a form Docket does not, so Docket keeps a copy: every message sent
// to the session and every message it gave (with the runner's number for it), one per line, in
// <data>/chats/<id>.jsonl. Before this, a Grok chat came back empty after a restart, reply and all.
const CHATS = path.join(DATA_DIR, 'chats');
const chatFile = (id) => path.join(CHATS, `${id}.jsonl`);
function keepChat(id, msg, seq) {
  try { fs.mkdirSync(CHATS, { recursive: true }); fs.appendFileSync(chatFile(id), JSON.stringify({ seq: seq ?? null, at: Date.now(), msg }) + '\n'); }
  catch (e) { logEvent('could not save to the chat copy', `${id}: ${e.message}`); }
}
// This company's sessions whose chat Docket keeps (any not run by Claude), each with its kept chat file.
function keptChatFiles(client) {
  const map = new Map();
  for (const [id, rec] of Object.entries(state.sessions)) {
    if (rec.client !== client.id || !rec.engine || rec.engine === 'claude' || wasDeleted(id)) continue;
    if (fs.existsSync(chatFile(id))) map.set(id, chatFile(id));
  }
  return map;
}
function readChat(id) {
  let lines = [];
  try { lines = fs.readFileSync(chatFile(id), 'utf8').split('\n'); } catch {}
  return lines.flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
}
// The number of the last message kept from the session's current run in the runner.
function chatSeq(id) {
  let seq = 0;
  for (const x of readChat(id)) seq = x.msg?.type === 'docket_start' ? 0 : Math.max(seq, x.seq || 0);
  return seq;
}
const messageText = (m) => { const c = m?.message?.content; return typeof c === 'string' ? c : (c || []).find((b) => b.type === 'text')?.text || ''; };
const unsentNote = (u) => ({ k: 'error', unsent: true, text: `Docket restarted while this message was being sent (${new Date(u.at).toLocaleTimeString()}), so the session may not have received it. If no reply comes, send it again:\n\n${u.text}` });
// An error in a session's chat (kept in a Grok chat's copy too), marking the session for the person to look at.
function stoppedNote(s, text) {
  addEvent(s, { k: 'error', text });
  setLastError(s, text);
  if (keepsChat(s.engine)) keepChat(s.id, { type: 'docket_error', text });
  setUnread(s, 'error');
}
// A note in a Grok or Codex session's chat that stays in its copy, so it still shows after End and a restart.
function brandNote(s, text) {
  addEvent(s, { k: 'note', text });
  keepChat(s.id, { type: 'docket_note', text });
}
const newConversationNote = (engine) => { const n = BRANDS[engine]?.name || engine; return `${n} could not pick up its earlier conversation, so this is a new one: the chat above is Docket's copy, and ${n} does not remember it.`; };

// The text of a Claude session's transcript file, '' when there is none.
function readTranscript(client, id) {
  try { return fs.readFileSync(sessionFile(client, id), 'utf8'); } catch { return ''; }
}
async function loadTranscript(client, id) {
  const kept = keepsChat(live.get(id)?.engine || state.sessions[id]?.engine) || fs.existsSync(chatFile(id));
  // Each message with the time it was written (UTC ms): a kept chat stores it, a Claude transcript has it on each line.
  const times = kept ? null : transcriptTimes(readTranscript(client, id));
  const rows = kept ? readChat(id) : (await withHome(client, () => getSessionMessages(id, {}))).map((msg) => ({ msg, at: times.get(msg.uuid) }));
  const events = [];
  const s = { id, tasks: new Map() };
  // A Claude transcript has no record of a turn's end, so its Done line is the time of the turn's last reply (no duration).
  let turnAt = 0;
  const endTurn = () => { if (turnAt) { events.push({ k: 'result', at: turnAt }); turnAt = 0; } };
  let inPing = false; // a keep-warm ping and its reply stay out of the chat (keep-warm.mjs)
  for (const { msg: m, at } of rows) {
    if (m.parent_tool_use_id) continue;
    if (m.type === 'user' && !(Array.isArray(m.message?.content) && m.message.content.some((b) => b.type === 'tool_result'))) inPing = isPing(m);
    if (inPing) continue;
    if (m.type === 'docket_note') { events.push({ k: 'note', text: m.text }); continue; }
    if (m.type === 'docket_error' || (m.type === 'result' && (m.is_error || m.subtype !== 'success'))) { events.push({ k: 'error', text: m.text || m.result || m.subtype }); continue; }
    if (m.type === 'result') { events.push({ k: 'result', ms: m.duration_ms, at }); continue; }
    if (m.type === 'assistant' && at && !kept) turnAt = at;
    for (const ev of convertMessage(s, m, { live: false })) {
      if (ev.k === 'tool_result') {
        const tev = [...events].reverse().find((e) => e.k === 'tool' && e.id === ev.id);
        if (tev) { tev.status = ev.error ? 'error' : 'done'; tev.result = ev.text; if (at) tev.endAt = at; }
      } else {
        if (ev.k === 'user' && !kept) endTurn();
        if (at) ev.at = at;
        events.push(ev);
      }
    }
  }
  if (!kept && !live.get(id)) endTurn();
  for (const e of events) if (e.k === 'tool' && e.status === 'running') e.status = 'done';
  const rec = state.sessions[id];
  // A saved session whose last turn failed before Docket kept lastError gets its red ring once opened.
  const lastSaid = [...events].reverse().find((e) => ['user', 'text', 'error'].includes(e.k));
  if (lastSaid?.k === 'error' && rec && !rec.lastError && !live.get(id)) {
    setLastError({ id }, lastSaid.text);
    historyCache.delete(client.id); broadcast({ t: 'history-ready', client: client.id });
  }
  if (rec?.unsent) events.push(unsentNote(rec.unsent));
  markQuiet(events, rec?.quietTurns);
  return weaveCards(events, [...(rec?.handoffs || []), ...(rec?.cards || [])]).slice(-MAX_EVENTS);
}

// ---------- a session's Timeline and a company's profile page (show only; see profile.mjs) ----------
// The texts Docket adds to every session, so the Timeline can pick each one out of the system prompt.
function docketTexts() {
  const dir = path.join(ROOT, 'prompts');
  const md = (d) => { try { return fs.readdirSync(d).filter((n) => n.endsWith('.md')).sort(); } catch { return []; } };
  return [
    { name: 'Docket\'s own instructions', note: 'written in server.mjs', text: APPEND_PROMPT },
    ...md(dir).map((n) => ({ name: `prompts/${n}`, path: path.join(dir, n), note: 'every session', text: fs.readFileSync(path.join(dir, n), 'utf8').trim() })),
    ...md(path.join(dir, 'optional')).map((n) => ({ name: `prompts/optional/${n}`, path: path.join(dir, 'optional', n), note: n === 'model-shifting.md' ? 'only sessions on Shift' : n === 'parent-gear.md' ? 'only Shift child sessions held on a lower gear their parent chose, instead of model-shifting.md' : n === 'split-work.md' ? 'only desks that split work into sessions (Switches)' : n === 'plans.md' ? "only sessions that use a plan, on desks with Docket's own plans" : n === 'setup-slim.md' ? "the first message of a session started from the setup check card, with the desk's numbers in it" : 'only some sessions',
      text: optionalPrompt(n) })),
  ];
}
function newestRecord(client) {
  let best = null, at = 0;
  for (const f of transcriptFiles(client).values()) { try { const t = fs.statSync(f).mtimeMs; if (t > at) { at = t; best = f; } } catch {} }
  return best;
}
const profileCache = new Map(); // clientId -> { at, profile }
// What a running session says a person can type after /. Its skill list also holds skills only Claude may
// call (Claude Code refuses those when typed), and it leaves out Claude Code's own commands (/compact).
// Kept per running session, and per company (in the saved state) for the rest: saved sessions, the
// new-session box, and running sessions after Docket restarts, which do not say it again.
function noteCommands(s, names, skills, terminal) {
  if (!Array.isArray(names)) return;
  s.slashNames = new Set(names);
  if (Array.isArray(terminal)) s.slashTerminal = new Set(terminal);
  const seen = (state.slash ||= {})[s.client] ||= { hidden: [], extra: [] };
  if (Array.isArray(skills)) seen.hidden = [...new Set([...seen.hidden.filter((n) => !s.slashNames.has(n)), ...skills.filter((n) => !s.slashNames.has(n))])];
  seen.extra = names.filter((n) => !n.startsWith('__') && !s.slashTerminal?.has(n));
  saveState();
}
function slashList(client, s, skills) {
  const seen = state.slash?.[client.id];
  const names = s?.slashNames;
  if (names && seen) { // the session's skill list names skills its commands leave out: Claude-only
    const more = skills.filter((k) => !names.has(k.name) && !seen.hidden.includes(k.name)).map((k) => k.name);
    if (more.length) { seen.hidden.push(...more); saveState(); }
  }
  const out = skills.filter((k) => names ? names.has(k.name) : !seen?.hidden.includes(k.name));
  const have = new Set(out.map((k) => k.name));
  const extra = names ? [...names].filter((n) => !n.startsWith('__') && !s.slashTerminal?.has(n)) : seen?.extra || [];
  for (const n of extra) if (!have.has(n)) { have.add(n); out.push({ name: n, detail: 'Claude Code command' }); }
  return out;
}
const mcpChecks = new Map();    // clientId -> the last Check connections result, kept until Docket restarts
// One connected service as a session reports it. Only how it starts, never its keys, headers or environment
// (Docket's own portal server carries its key there).
const mcpRow = (x) => ({ name: x.name, status: x.status, error: x.error || '',
  source: x.name === 'portal' || x.name === 'playwright' ? 'docket' : x.source || x.scope || '',
  target: x.config?.url || [x.config?.command, ...(x.config?.args || [])].filter(Boolean).join(' '), tools: x.tools?.length ?? null });
// ---------- plugin sources (#574): add a marketplace, install from it, update and remove it ----------
// All through the claude program at user scope, so only the desk home changes (its settings.json and plugins folder),
// never a working folder. A marketplace in a repo's subfolder is cloned by Docket (just that folder) into
// <home>/plugin-sources/<folder> and added as a folder source; <folder>.json beside it says where it came from.
const sourceBusy = new Set(); // desk ids with one of these under way
const knownMarkets = (client) => { try { return JSON.parse(fs.readFileSync(path.join(client.home, 'plugins', 'known_marketplaces.json'), 'utf8')) || {}; } catch { return {}; } };
const runGit = (client, args, timeout = 300000) => runClaude(client, args, { exe: 'git', prompts: false, timeout, cwd: client.home });
const runPlugin = (client, args) => runClaude(client, ['plugin', ...args, '--json'], { prompts: false, timeout: 300000, cwd: client.home });
// The line claude printed for --json, or {}.
const jsonLine = (out) => { for (const l of String(out).split(/\r?\n/).reverse()) { try { const j = JSON.parse(l); if (j && typeof j === 'object') return j; } catch {} } return {}; };
async function addPluginSource(client, address, sub) {
  const src = sourceFrom(address, sub);
  let target = src.kind === 'folder' ? src.path : src.url, clone = '';
  if (src.kind === 'folder' && !readMarket(src.path)) throw new Error(`${src.path} has no .claude-plugin${path.sep}marketplace.json. Pick the folder that holds the .claude-plugin folder.`);
  if (src.kind === 'git' && src.sub) {
    const root = path.join(client.home, CLONES), base = src.sub.split('/').pop().replace(/[^\w.-]/g, '-') || 'source';
    fs.mkdirSync(root, { recursive: true });
    clone = path.join(root, base);
    for (let n = 2; fs.existsSync(clone) || fs.existsSync(clone + '.json'); n++) clone = path.join(root, `${base}-${n}`);
    const drop = () => toTrash([clone, clone + '.json'].filter((p) => fs.existsSync(p))).catch(() => {});
    for (const args of cloneCommands(src, clone)) {
      const r = await runGit(client, args);
      if (r.code !== 0) { await drop(); throw new Error(plainError(r.out, src.host)); }
    }
    target = path.join(clone, ...src.sub.split('/'));
    if (!readMarket(target)) { await drop(); throw new Error(`The repo has no ${src.sub}/.claude-plugin/marketplace.json. Check the subfolder.`); }
    fs.writeFileSync(clone + '.json', JSON.stringify({ url: src.url, sub: src.sub }, null, 2) + '\n');
    const r = await runPlugin(client, ['marketplace', 'add', target, '--scope', 'user']);
    if (r.code !== 0) { await drop(); throw new Error(plainError(r.out, src.host)); }
    return jsonLine(r.out).marketplace || '';
  }
  const r = await runPlugin(client, ['marketplace', 'add', target, '--scope', 'user']);
  if (r.code !== 0) throw new Error(plainError(r.out, src.host));
  return jsonLine(r.out).marketplace || '';
}
// kind: install (key plugin@source), source-update or source-remove (key: the source's name). A plain line of what happened.
async function pluginSourceAction(client, kind, key) {
  const known = knownMarkets(client);
  if (kind === 'install') {
    const [name, market] = String(key).split('@');
    if (!name || !known[market]) throw new Error('This desk has no such source');
    const r = await runPlugin(client, ['install', `${name}@${market}`, '--scope', 'user']);
    if (r.code !== 0) throw new Error(plainError(r.out, hostOf(readMarket(known[market].installLocation)?.plugins.find((e) => e?.name === name)?.source)));
    return `Installed ${name} on this desk. It is on; turn it off under Skills > Plugins.`;
  }
  const m = known[key];
  if (!m) throw new Error('This desk has no such source');
  const clone = isClone(m.source?.path || m.installLocation, client.home);
  if (kind === 'source-update') {
    const host = (() => { try { return hostOf(JSON.parse(fs.readFileSync(clone + '.json', 'utf8'))); } catch { return hostOf(m.source); } })();
    if (clone) { const g = await runGit(client, ['-C', clone, 'pull', '--ff-only']); if (g.code !== 0) throw new Error(plainError(g.out, host)); }
    const r = await runPlugin(client, ['marketplace', 'update', key]);
    if (r.code !== 0) throw new Error(plainError(r.out, host));
    // a folder source's plugins are copies, so each installed one is taken in again too
    let installed = {}; try { installed = JSON.parse(fs.readFileSync(path.join(client.home, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {}; } catch {}
    const mine = Object.keys(installed).filter((k) => k.endsWith('@' + key)), failed = [];
    for (const p of mine) { const u = await runPlugin(client, ['update', p, '--scope', 'user']); if (u.code !== 0) failed.push(`${p}: ${plainError(u.out)}`); }
    if (failed.length) throw new Error(`The list was updated, but not every plugin: ${failed.join(' ')}`);
    return `Updated ${key}${mine.length ? ` and its ${mine.length} installed plugin${mine.length === 1 ? '' : 's'}` : ''}.`;
  }
  if (kind === 'source-remove') {
    const r = await runPlugin(client, ['marketplace', 'remove', key, '--scope', 'user']);
    if (r.code !== 0) throw new Error(plainError(r.out));
    if (clone) await toTrash([clone, clone + '.json'].filter((p) => fs.existsSync(p))).catch((e) => logEvent('plugin source clone left', `${clone}: ${e.message}`));
    return String(jsonLine(r.out).message || `Removed ${key}.`).replace(/\n+/g, ' ');
  }
  throw new Error('Unknown plugin source action');
}

function profileFor(client, force) {
  const hit = profileCache.get(client.id);
  if (hit && !force && Date.now() - hit.at < 30000) return hit.profile;
  let docketTools = [];
  try { docketTools = portalToolDefs({}).filter((t) => !t.hidden).map((t) => ({ name: `mcp__portal__${t.name}`, description: t.description })); } catch {}
  docketTools.push({ name: 'mcp__playwright__*', description: 'A private browser with the sign-ins saved for this desk (the Browser button)' });
  const docketMcp = [
    { name: 'portal', detail: `${process.execPath} ${path.join(ROOT, 'tools-helper.mjs')}`, note: 'Docket\'s own tools (sessions, files, schedules)' },
    { name: 'playwright', detail: `${process.execPath} ${PLAYWRIGHT_MCP} --isolated --headless --port <port>`, note: 'the private browser with this desk\'s saved sign-ins: one server for the desk, its own browser for each session' },
  ];
  const profile = buildProfile(client, { isDefaultHome: isDefaultHome(client), docket: docketTexts(), docketTools, docketMcp, docketHooks: hooksFor(client, PLUGIN_DIR), latestFile: newestRecord(client), brands: brandsOf(client), grokHookFile: GROK_HOOK_FILE });
  profileCache.set(client.id, { at: Date.now(), profile });
  return profile;
}
// Answers the timeline and profile-page requests. Returns false when the request is not one of
// them; anything else means it has been answered (json() itself returns nothing, so never test for a value).
async function profileRoutes(req, res, url, p) {
  const tm = p.match(/^\/api\/sessions\/([\w-]+)\/timeline$/);
  if (tm && req.method === 'GET') {
    const client = clientById(url.searchParams.get('client') || live.get(tm[1])?.client || state.sessions[tm[1]]?.client);
    const file = client && sessionFile(client, tm[1]);
    if (!file) return json(res, 404, { error: 'This session has no record file yet' });
    let prices = null; // with no pricing.json the timeline shows no costs
    try { prices = loadPrices(PRICING_FILE); } catch {}
    const t = sessionTimeline(file, { docket: docketTexts(), memoryRoot: path.join(client.home, 'projects'), prices });
    const n = url.searchParams.get('entry');
    if (n !== null) { const e = t.entries[Number(n)]; return e ? json(res, 200, { text: e.text, path: e.path }) : json(res, 404, { error: 'No such entry' }); }
    // since=<v>: only the entries added or changed after the page's copy (a live session asks this way).
    // gen changes when the file is read again from the start, and then the page needs everything.
    const since = Number(url.searchParams.get('since')) || 0;
    return json(res, 200, { file, cats: TIMELINE_CATS, counts: t.counts, v: t.v, gen: t.gen, since,
      entries: (since ? t.entries.filter((e) => e.v > since) : t.entries).map(({ text, result, ...e }) => e) });
  }
  const km = p.match(/^\/api\/sessions\/([\w-]+)\/skills$/);
  if (km && req.method === 'GET') {
    // The skills and slash commands this session was told about, for the / pick list. A session with no
    // record file yet (or the new-session box) gets its profile's: skill folders, commands, and the built-in
    // skills the profile's newest session listed.
    const client = clientById(url.searchParams.get('client') || live.get(km[1])?.client || state.sessions[km[1]]?.client);
    if (!client) return json(res, 404, { error: 'Unknown desk' });
    const file = sessionFile(client, km[1]);
    const skills = file ? sessionSkills(file) : [];
    if (skills.length) return json(res, 200, { from: 'session', skills: slashList(client, live.get(km[1]), skills) });
    const seen = new Set(), out = [];
    const { sections } = profileFor(client);
    const groups = [...(sections.find((s) => s.id === 'skills')?.groups || []).filter((g) => g.brand === 'claude' && (g.title === 'Skills' || g.title === 'Slash commands')),
      ...(sections.find((s) => s.id === 'defaults')?.groups || []).filter((g) => g.title === 'Built-in skills')];
    for (const g of groups) for (const it of g.items) {
      const name = String(it.name || '').replace(/^\//, '');
      if (!name || /\(off\)/.test(it.note || '') || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase()); out.push({ name, detail: String(it.detail || '').split('\n')[0].slice(0, 200) });
    }
    return json(res, 200, { from: 'profile', skills: slashList(client, null, out) });
  }
  const mm = p.match(/^\/api\/sessions\/([\w-]+)\/mcp$/);
  if (mm && req.method === 'GET') {
    // The open session's connected services: asked of the session itself, else as they were when it started.
    const s = live.get(mm[1]);
    if (!s || !s.query) return json(res, 200, { from: 'none', servers: [] });
    try {
      if (s.resting) throw new Error('resting'); // nothing running to ask
      const list = await Promise.race([s.query.mcpServerStatus(), new Promise((_, no) => setTimeout(() => no(new Error('no answer')), 8000))]);
      return json(res, 200, { from: 'live', at: Date.now(), servers: (list || []).map(mcpRow) });
    } catch {
      return json(res, 200, s.mcpAtStart ? { from: 'start', at: s.mcpAtStart.at, servers: s.mcpAtStart.servers.map(mcpRow) } : { from: 'none', servers: [] });
    }
  }
  // Switching a desk's plan system (#700, plan-switch.mjs). GET ?to=: what the switch would leave behind, and whether to
  // warn. POST { to, action }: switch (no conversion), convert (a session carries the old plans over, and the desk stays
  // on its old system until the user presses Finish the switch on the page), finish, or cancel (stays as it is). The
  // setup wizard asks before the desk exists, with the home and folder it is about to save.
  if (p === '/api/plan-switch-check' && req.method === 'POST') {
    const b = await readBody(req);
    if (!path.isAbsolute(String(b.home || ''))) return json(res, 400, { error: 'Give the Claude home as a full path' });
    const desk = { home: path.resolve(b.home), folder: path.isAbsolute(String(b.folder || '')) ? path.resolve(b.folder) : '', planSystem: '' };
    const found = scanPlanSystem(desk);
    return json(res, 200, { from: '', to: b.to || '', ...switchWarning(found, '', b.to || ''), found });
  }
  const sw = p.match(/^\/api\/clients\/(\w+)\/plan-switch$/);
  if (sw) {
    const client = clientById(sw[1]);
    if (!client) return json(res, 404, { error: 'Unknown desk' });
    const from = client.planSystem || '';
    if (req.method === 'GET') {
      const to = url.searchParams.get('to') || '';
      const found = await planSwitchFound(client);
      return json(res, 200, { from, to, ...switchWarning(found, from, to), found, pending: client.planSwitch || null });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    const b = await readBody(req);
    try { return json(res, 200, await planSwitchAction(client, b)); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  const pm = p.match(/^\/api\/clients\/(\w+)\/profile(?:\/(file|show|mcp-check|switch|source|source-action))?$/);
  if (!pm) return false; // not one of these: the main handler carries on
  const client = clientById(pm[1]);
  if (!client) return json(res, 404, { error: 'Unknown desk' });
  if (!pm[2] && req.method === 'GET') { const { allowed, ...out } = profileFor(client, url.searchParams.get('refresh') === '1'); return json(res, 200, { ...out, mcpCheck: mcpChecks.get(client.id) || null }); }
  if (pm[2] === 'mcp-check' && req.method === 'POST') {
    const r = await runClaude(client, ['mcp', 'list'], { timeout: 90000, cwd: client.folder });
    const check = { at: Date.now(), ok: r.code === 0, text: r.out.trim() || (r.code === 0 ? 'No servers.' : 'claude mcp list did not answer'), servers: parseMcpList(r.out) };
    mcpChecks.set(client.id, check);
    return json(res, 200, check);
  }
  if ((pm[2] === 'source' || pm[2] === 'source-action') && req.method === 'POST') {
    // A plugin source: add one ({ address, sub }), or install from, update or remove one ({ kind, key }).
    const b = await readBody(req);
    if (sourceBusy.has(client.id)) return json(res, 409, { error: 'This desk is already adding, installing or updating a plugin source; wait for it to finish.' });
    sourceBusy.add(client.id);
    try {
      let message;
      if (pm[2] === 'source') { const name = await addPluginSource(client, b.address, b.sub); message = `Added the source${name ? ` ${name}` : ''}. Its plugins are listed below.`; }
      else message = await pluginSourceAction(client, b.kind, b.key);
      logEvent('plugin source', `${client.name}: ${pm[2] === 'source' ? 'add' : `${b.kind} ${b.key}`}: ${message}`);
      return json(res, 200, { ok: true, message });
    } catch (e) {
      logEvent('plugin source failed', `${client.name}: ${pm[2] === 'source' ? 'add' : `${b.kind} ${b.key}`}: ${e.message}`);
      return json(res, 400, { error: e.message });
    } finally { sourceBusy.delete(client.id); profileCache.delete(client.id); }
  }
  if (pm[2] === 'switch' && req.method === 'POST') {
    // One checkbox on the profile page: { kind, key, on }. Each changes one setting for sessions started after it.
    const { kind, key, on, value } = await readBody(req);
    const save = (patch) => saveCompanies(CLIENTS.map((c) => {
      if (c.id !== client.id) return c;
      const out = { ...c, ...patch };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete out[k];
      return out;
    }));
    try {
      if (kind === 'docket-hook') {
        if (!hooksFor(client, PLUGIN_DIR).some((h) => h.name === key)) return json(res, 404, { error: 'No such Docket hook' });
        const off = (client.docketHooks?.off || []).filter((n) => n !== key);
        save({ docketHooks: cleanDocketHooks({ off: on ? off : [...off, key] }) });
      } else if (kind === 'layer') {
        if (!LAYERS.includes(key)) return json(res, 404, { error: 'No such settings layer' });
        const now = (client.settingSources || LAYERS).filter((l) => l !== key);
        save({ settingSources: cleanSettingSources(on ? [...now, key] : now) });
      } else if (kind === 'reload') {
        if (!['auto', 'ask'].includes(value)) return json(res, 400, { error: 'Reload is auto or ask' });
        save({ configReload: value === 'ask' ? 'ask' : undefined });
      } else if (kind === 'split') {
        save({ splitWork: on ? undefined : false });
      } else if (kind === 'resume') {
        save({ resumeAfterSignIn: on ? undefined : false });
      } else if (kind === 'plans') {
        // A choice: { value } is the plan system: Docket's own, a plan folder shown read-only (#180 step 3), or none.
        if (!['docket', 'folder', 'none'].includes(value)) return json(res, 400, { error: 'The plan system is docket, folder or none' });
        save({ planSystem: value, planSwitch: undefined });
      } else if (kind === 'plan-folder') {
        // One of the plan folder's two boxes: { key: 'path' | 'marker', value }. Empty clears it.
        const bad = planFolderProblem(key, value);
        if (bad) return json(res, 400, { error: bad });
        save({ planFolder: cleanPlanFolder({ ...(client.planFolder || {}), [key]: String(value ?? '').trim() }) });
        dropFolderReader(client);
      } else if (kind === 'plugin') {
        const installed = profileFor(client, true).sections.find((s) => s.id === 'skills')?.groups.find((g) => g.title === 'Plugins')?.items || [];
        if (!installed.some((it) => it.toggle?.key === key)) return json(res, 404, { error: 'That plugin is not installed on this desk' });
        writePluginOn(path.join(client.home, 'settings.json'), key, !!on);
      } else if (kind === 'grok') {
        if (!client.grokHome) return json(res, 400, { error: 'This desk has no Grok home' });
        if (!GROK_COMPAT.includes(key)) return json(res, 404, { error: 'No such Grok setting' });
        writeGrokCompat(path.join(client.grokHome, 'config.toml'), key, !!on);
      } else return json(res, 400, { error: 'Unknown switch' });
    } catch (e) { return json(res, 400, { error: e.message }); }
    logEvent('profile switch', `${client.name}: ${kind} ${key} ${on ? 'on' : 'off'}`);
    profileCache.delete(client.id);
    return json(res, 200, { ok: true });
  }
  // A file's text, or show it in File Explorer: only files the Inspector lists.
  const want = pm[2] === 'file' ? url.searchParams.get('path') : (await readBody(req)).path;
  const full = typeof want === 'string' && want ? path.resolve(want) : '';
  if (!full || !profileFor(client).allowed.has(full.toLowerCase())) return json(res, 404, { error: 'That file is not in this desk\'s Inspector' });
  if (pm[2] === 'show' && req.method === 'POST') {
    showFile(full, 'folder');
    return json(res, 200, { ok: true });
  }
  if (pm[2] === 'file' && req.method === 'GET') {
    let st; try { st = fs.statSync(full); } catch { return json(res, 404, { error: 'That file no longer exists' }); }
    if (st.isDirectory()) return json(res, 400, { error: 'That is a folder' });
    if (st.size > 3e6) return json(res, 400, { error: 'That file is too large to show here' });
    return json(res, 200, { path: full, name: path.basename(full), modified: st.mtimeMs, markdown: /\.(md|markdown)$/i.test(full), text: fs.readFileSync(full, 'utf8') });
  }
  return json(res, 404, { error: 'Not found' });
}

// ---------- web server ----------
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  // A remote desk check may have read it already (remoteDeskFor).
  if (req.preBody !== undefined) return Promise.resolve(req.preBody);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 80e6) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  });
}
// Only this page may drive sessions: refuse requests from any other website.
function trusted(req) {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return false;
  const origin = req.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

// ---------- remote desks: one desk of this Docket used from another computer on the office network ----------
// This computer (the host) answers on HTTPS, on REMOTE_PORT, only while remote control is on, only to private
// (office network) addresses, only after a code from the authenticator app AND someone clicking Allow here, and
// only for the one desk chosen. The other computer (the guest) keeps nothing but the address and this
// computer's certificate; its connection lives in memory and lasts REMOTE_HOURS.
const REMOTE_PORT = Number(process.env.PORTAL_REMOTE_PORT || PORT + 2);
const remoteCfg = () => (state.remoteControl ||= { on: false, desk: null, secret: null });
// The master switch: while off, nothing of Remote Desks shows or answers and remote control does not run.
// Only the remote_desks tool turns it on, and it is kept in memory only: every start of Docket hides it again.
// The remote setup itself (state.remoteControl, state.remoteDesks) is saved as before and never changed by it.
let remoteShown = false;
const remoteOn = () => remoteShown;
const remoteTokens = new Map(); // token -> { id, name, ip, at, expires }
const remoteAsks = new Map(); // ask id -> { id, name, ip, at, resolve }
const remoteUsedSteps = new Set(); // authenticator codes already used once
const remoteFails = []; // times of wrong codes, for the 5-in-10-minutes lock
const remoteSockets = new Set(); // { ws, token } of connected guests
let remoteHttps = null, remotePendingSecret = null, remoteHostError = '';
function remoteCert() {
  const certFile = path.join(DATA_DIR, 'remote-cert.pem'), keyFile = path.join(DATA_DIR, 'remote-key.pem');
  try { return { cert: fs.readFileSync(certFile, 'utf8'), key: fs.readFileSync(keyFile, 'utf8') }; } catch {}
  const made = makeCertificate(`Docket on ${os.hostname()}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(keyFile, made.key, { mode: 0o600 });
  fs.writeFileSync(certFile, made.cert);
  return made;
}
const deskOfSession = (id) => live.get(id)?.client ?? state.sessions[id]?.client;
async function sessionOnDesk(id, desk) {
  const d = deskOfSession(id);
  if (d !== undefined) return d === desk;
  const c = clientById(desk);
  return !!c && (await history(c)).some((r) => r.id === id);
}
const remoteTokenOf = (req) => {
  const t = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const r = t && remoteTokens.get(t);
  if (r && r.expires > Date.now()) return { token: t, ...r };
  if (r) dropRemote(t);
  return null;
};
function dropRemote(token) {
  if (!remoteTokens.delete(token)) return;
  for (const s of remoteSockets) if (s.token === token) { s.ws.close(4001, 'disconnected'); remoteSockets.delete(s); }
  broadcastRemoteHere();
}
// Who is connected here now, for the remote icon on this computer's pages. Never sent on to a guest (a "remote" message).
const remoteHereView = () => [...remoteTokens.values()].map(({ id, name, ip, at, expires }) => ({ id, name, ip, at, expires }));
const broadcastRemoteHere = () => toPages({ t: 'remote-here', desk: remoteCfg().desk, connections: remoteHereView() });
function relayToRemotes(msg) {
  if (!remoteSockets.size) return;
  if (!relayFor(msg, remoteCfg().desk, deskOfSession)) return;
  const text = JSON.stringify(msg);
  for (const s of remoteSockets) if (s.ws.readyState === 1) s.ws.send(text);
}
setInterval(() => { // connections past their time end, sockets and all
  for (const [t, r] of remoteTokens) if (r.expires <= Date.now()) { logEvent('remote: connection ended (time up)', `${r.name} ${r.ip}`); dropRemote(t); }
  for (const step of remoteUsedSteps) if (step < stepOf() - 4) remoteUsedSteps.delete(step);
}, 60e3).unref();
// Passes an allowed request to this Docket's own page server, as if from this computer's page.
function forwardLocal(method, pathAndQuery, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: pathAndQuery,
      headers: { host: `localhost:${PORT}`, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function remoteHostRequest(req, res) {
  const ip = req.socket.remoteAddress;
  if (!isOfficeAddress(ip)) { req.socket.destroy(); return; }
  const url = new URL(req.url, 'https://remote');
  const p = url.pathname, cfg = remoteCfg();
  const desk = cfg.on && cfg.desk && clientById(cfg.desk);
  if (!desk || !cfg.secret) return json(res, 503, { error: 'Remote control is off on that computer' });
  if (req.method === 'POST' && p === '/remote/hello') {
    const now = Date.now();
    while (remoteFails.length && remoteFails[0] < now - 10 * 60e3) remoteFails.shift();
    if (remoteFails.length >= 5) return json(res, 429, { error: 'Too many wrong codes. Wait 10 minutes and try again.' });
    const b = await readBody(req);
    const step = checkCode(cfg.secret, b.code, now, remoteUsedSteps);
    if (step === null) { remoteFails.push(now); logEvent('remote: wrong code', ip); return json(res, 403, { error: 'That code is not right. Type the code the authenticator app shows now (a code works only once).' }); }
    remoteUsedSteps.add(step);
    if ([...remoteAsks.values()].some((a) => a.ip === ip)) return json(res, 409, { error: 'A connection from this computer is already waiting for Allow' });
    const ask = { id: 'ra_' + randomUUID().slice(0, 8), name: String(b.name || '').slice(0, 60) || 'Another computer', ip, at: now };
    const allowed = await new Promise((resolve) => {
      ask.resolve = resolve; remoteAsks.set(ask.id, ask);
      broadcast({ t: 'remote-ask', ask: { id: ask.id, name: ask.name, ip, at: now, desk: desk.name } });
      setTimeout(() => resolve(null), ASK_WAIT_MS);
      res.on('close', () => resolve(null)); // the other computer gave up waiting
    });
    remoteAsks.delete(ask.id);
    broadcast({ t: 'remote-asked', id: ask.id });
    if (!allowed) {
      logEvent(`remote: connection ${allowed === false ? 'refused' : 'not answered'}`, `${ask.name} ${ip}`);
      return json(res, 403, { error: allowed === false ? 'Someone on that computer clicked Don\'t allow.' : 'Nobody clicked Allow on that computer in time. Try again with a new code.' });
    }
    const token = randomBytes(32).toString('hex');
    const conn = { id: 'rc_' + randomUUID().slice(0, 8), name: ask.name, ip, at: Date.now(), expires: Date.now() + REMOTE_HOURS * 3600e3 };
    remoteTokens.set(token, conn);
    broadcastRemoteHere();
    logEvent('remote: connected', `${conn.name} ${ip}, desk ${desk.name}`);
    return json(res, 200, { token, expires: conn.expires, desk: { id: desk.id, name: desk.name } });
  }
  const who = remoteTokenOf(req);
  if (!who) return json(res, 401, { error: 'Not connected: enter a new code', expired: true });
  if (req.method === 'POST' && p === '/remote/bye') { dropRemote(who.token); logEvent('remote: disconnected by the other computer', who.name); return json(res, 200, { ok: true }); }
  const route = remoteRoute(req.method, p);
  if (!route) return json(res, 403, { error: 'That can\'t be done from another computer' });
  let body = req.method === 'POST' ? await readBody(req) : undefined;
  if (route.kind === 'desk' || route.kind === 'session') {
    const asked = url.searchParams.get('client') || body?.client;
    if (asked && asked !== desk.id) return json(res, 403, { error: 'Only the linked desk can be used from another computer' });
    url.searchParams.set('client', desk.id);
    if (body && (p === '/api/sessions' || p === '/api/keep' || p.startsWith('/api/groups'))) body = { ...body, client: desk.id };
    if (body && p === '/api/groups') delete body.folder; // a start folder is this computer's to choose
  }
  if (route.kind === 'session' && !(await sessionOnDesk(route.id, desk.id))) return json(res, 403, { error: 'That session is not on the linked desk' });
  // A message from the other computer reaches the session with a note saying where it came from.
  if (body && (p === '/api/sessions' || /^\/api\/sessions\/[\w-]+\/send$/.test(p))) body = remoteMessage(body, who.name, os.hostname());
  const r = await forwardLocal(req.method, p + url.search, body);
  if (route.kind === 'clients' && Array.isArray(r.json)) r.json = r.json.filter((c) => c.id === desk.id).map(remoteDeskRow);
  return json(res, r.status, r.json ?? {});
}
function startRemoteHost() {
  if (remoteHttps) return;
  const { cert, key } = remoteCert();
  const srv = https.createServer({ cert, key }, (req, res) => remoteHostRequest(req, res).catch((e) => { if (!res.headersSent) json(res, 500, { error: e.message }); }));
  const wssR = new WebSocketServer({ noServer: true });
  srv.on('upgrade', (req, socket, head) => {
    const who = isOfficeAddress(req.socket.remoteAddress) && new URL(req.url, 'https://remote').pathname === '/remote/ws' && remoteTokenOf(req);
    if (!who || !remoteOn() || !remoteCfg().on) { socket.destroy(); return; }
    wssR.handleUpgrade(req, socket, head, (ws) => { const s = { ws, token: who.token }; remoteSockets.add(s); ws.on('close', () => remoteSockets.delete(s)); });
  });
  srv.on('error', (e) => { remoteHostError = e.code === 'EADDRINUSE' ? `Port ${REMOTE_PORT} is in use by another program` : e.message; logEvent('remote: could not start', e.message); remoteHttps = null; });
  // Every network address of this computer; isOfficeAddress turns away anyone not on a private network.
  srv.listen(REMOTE_PORT, '0.0.0.0', () => { remoteHostError = ''; logEvent(`remote control on: https://*:${REMOTE_PORT}`); });
  remoteHttps = srv;
}
function stopRemoteHost() {
  for (const a of remoteAsks.values()) a.resolve(false);
  for (const t of [...remoteTokens.keys()]) dropRemote(t);
  if (remoteHttps) { remoteHttps.close(); remoteHttps.closeAllConnections?.(); remoteHttps = null; logEvent('remote control off'); }
}
function remoteControlView() {
  const cfg = remoteCfg();
  let check = '';
  try { if (cfg.secret || cfg.on) check = checkCodeOf(fingerprintOf(remoteCert().cert)); } catch {}
  return { on: !!cfg.on, desk: cfg.desk, authenticator: !!cfg.secret, port: REMOTE_PORT, hours: REMOTE_HOURS, running: !!remoteHttps, error: remoteHostError,
    addresses: officeAddresses(os.networkInterfaces()).map((a) => `${a}:${REMOTE_PORT}`), check,
    connections: remoteHereView(),
    asks: [...remoteAsks.values()].map(({ id, name, ip, at }) => ({ id, name, ip, at, desk: clientById(cfg.desk)?.name })) };
}
// The page's controls for this computer's side (☰ > Remote Desks). Returns false when the request is not one of them.
async function remoteControlRoutes(req, res, p) {
  if (!p.startsWith('/api/remote-control')) return false;
  if (!remoteOn()) return json(res, 404, { error: 'Not found' }); // hidden
  const cfg = remoteCfg();
  if (req.method === 'GET' && p === '/api/remote-control') return json(res, 200, remoteControlView());
  if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
  const b = await readBody(req);
  if (p === '/api/remote-control') {
    if (b.desk !== undefined) {
      if (b.desk && !clientById(b.desk)) return json(res, 400, { error: 'Unknown desk' });
      if (b.desk !== cfg.desk) for (const t of [...remoteTokens.keys()]) dropRemote(t); // a new desk means new connections
      cfg.desk = b.desk || null;
    }
    if (b.on !== undefined) {
      if (b.on && !cfg.secret) return json(res, 400, { error: 'Set up the authenticator app first' });
      if (b.on && !cfg.desk) return json(res, 400, { error: 'Choose the desk the other computer may use' });
      cfg.on = !!b.on;
    }
    if (!cfg.desk) cfg.on = false;
    saveState();
    if (cfg.on) startRemoteHost(); else stopRemoteHost();
    return json(res, 200, remoteControlView());
  }
  if (p === '/api/remote-control/authenticator') { // a new secret, shown once as a code to scan; saved only once a code from it checks out
    remotePendingSecret = newSecret();
    const uri = otpUri(remotePendingSecret, os.hostname());
    return json(res, 200, { qr: await QRCode.toString(uri, { type: 'svg', margin: 1 }), key: remotePendingSecret.match(/.{1,4}/g).join(' ') });
  }
  if (p === '/api/remote-control/authenticator/confirm') {
    if (!remotePendingSecret) return json(res, 400, { error: 'Show the code to scan first' });
    if (checkCode(remotePendingSecret, b.code) === null) return json(res, 400, { error: 'That code does not match. Check the app added "Docket" and type the code it shows now.' });
    cfg.secret = remotePendingSecret; remotePendingSecret = null;
    for (const t of [...remoteTokens.keys()]) dropRemote(t); // a new authenticator ends the old connections
    saveState();
    return json(res, 200, remoteControlView());
  }
  if (p === '/api/remote-control/answer') {
    const a = remoteAsks.get(b.id);
    if (!a) return json(res, 404, { error: 'That request has already ended' });
    a.resolve(b.allow === true);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/remote-control/disconnect') {
    for (const [t, r] of remoteTokens) if (r.id === b.id) { dropRemote(t); logEvent('remote: disconnected here', r.name); }
    return json(res, 200, remoteControlView());
  }
  return json(res, 404, { error: 'Not found' });
}

// The guest side: desks on other computers, listed here. state.remoteDesks keeps { id, name, address, pin, cert }
// (the address and the other computer's certificate); the connection itself is only in memory.
const remoteConns = new Map(); // remote desk id -> { token, expires, desk, deskName, row, ws, sessions }
const remoteDesks = () => (state.remoteDesks ||= []);
const remoteDeskById = (id) => remoteDesks().find((d) => d.id === id);
function remoteDeskView(d) {
  const c = remoteConns.get(d.id);
  return { id: d.id, name: d.name, address: d.address, check: checkCodeOf(d.pin), connected: !!c, expires: c?.expires || null, deskName: c?.deskName || d.deskName || '' };
}
function dropRemoteConn(id, why) {
  const c = remoteConns.get(id); if (!c) return;
  remoteConns.delete(id); clearTimeout(c.reopen); clearTimeout(c.end);
  try { c.ws?.close(); } catch {}
  logEvent('remote desk: disconnected', `${remoteDeskById(id)?.name || id}: ${why}`);
  broadcast({ t: 'clients' });
}
function openRemoteSocket(d, conn) {
  const u = new URL(d.address);
  const ws = new WebSocket(`wss://${u.host}/remote/ws`, { ...pinnedTls(d.pin, d.cert), handshakeTimeout: 15000, headers: { authorization: `Bearer ${conn.token}` } });
  conn.ws = ws;
  ws.on('message', (data) => {
    let m; try { m = renameClient(JSON.parse(data), conn.desk, d.id); } catch { return; }
    if (typeof m.id === 'string') conn.sessions.add(m.id);
    if (m.session?.id) conn.sessions.add(m.session.id);
    toPages(m); // to this computer's page only, never on to a computer connected here
  });
  ws.on('error', () => {});
  ws.on('close', (code) => {
    if (remoteConns.get(d.id) !== conn) return;
    if (code === 4001 || conn.expires <= Date.now()) return dropRemoteConn(d.id, 'ended on the other computer');
    // Try again soon. A Docket that restarted there has forgotten the connection: its answer of 401 ends it here.
    conn.reopen = setTimeout(async () => {
      if (remoteConns.get(d.id) !== conn) return;
      let r; try { r = await remoteCall(d, conn, 'GET', '/api/clients', undefined, 15000); } catch {}
      if (remoteConns.get(d.id) !== conn) return;
      if (r?.status === 401) dropRemoteConn(d.id, 'ended on the other computer'); else openRemoteSocket(d, conn);
    }, 5000);
  });
}
const remoteCall = (d, conn, method, pathAndQuery, body, timeout) => pinnedRequest(d.address, { pin: d.pin, cert: d.cert, method, path: pathAndQuery, token: conn?.token, body, timeout });
function remoteRow(d) {
  const c = remoteConns.get(d.id);
  const base = c?.row || { color: '', defaultEngine: 'claude', brands: [], startGears: {} };
  return { ...base, id: d.id, name: d.name, browser: { sites: [], open: false }, remote: remoteDeskView(d) };
}
async function remoteRows(fresh) {
  if (!remoteOn()) return []; // hidden
  if (fresh) await Promise.all(remoteDesks().map(async (d) => {
    const c = remoteConns.get(d.id); if (!c) return;
    try { const r = await remoteCall(d, c, 'GET', '/api/clients', undefined, 15000); if (r.status === 401) dropRemoteConn(d.id, 'time up'); else if (Array.isArray(r.json) && r.json[0]) c.row = r.json[0]; } catch {}
  }));
  return remoteDesks().map(remoteRow);
}
// Which remote desk a page request is about, if any: its client, or a session seen on that desk.
async function remoteDeskFor(req, url, p) {
  if (!remoteOn() || !remoteDesks().length || !p.startsWith('/api/')) return null;
  const q = url.searchParams.get('client');
  if (q && remoteDeskById(q)) return remoteDeskById(q);
  const sm = p.match(/^\/api\/sessions\/([\w-]+)\//);
  if (sm) for (const [id, c] of remoteConns) if (c.sessions.has(sm[1])) return remoteDeskById(id);
  // Requests that name their desk in the body rather than in ?client=.
  if (req.method === 'POST' && (p === '/api/sessions' || p === '/api/keep' || p.startsWith('/api/groups') || sm)) {
    req.preBody = await readBody(req);
    if (req.preBody?.client && remoteDeskById(req.preBody.client)) return remoteDeskById(req.preBody.client);
  }
  return null;
}
async function remoteProxy(d, req, res, url, p) {
  // Typing time is this computer's own measure; for a remote desk it is not kept anywhere.
  if (/^\/api\/sessions\/[\w-]+\/typing$/.test(p)) return json(res, 200, { ok: true });
  const conn = remoteConns.get(d.id);
  if (!conn) return json(res, 409, { error: `${d.name} is not connected. Open ☰ > Remote Desks and connect with a code from your authenticator app.`, remote: 'connect', client: d.id });
  if (url.searchParams.has('client')) url.searchParams.set('client', conn.desk);
  const body = req.method === 'POST' ? renameClient(req.preBody ?? await readBody(req), d.id, conn.desk) : undefined;
  let r;
  try { r = await remoteCall(d, conn, req.method, p + url.search, body, 60000); }
  catch (e) { return json(res, 502, { error: connectError(e, d.name) }); }
  if (r.status === 401) { dropRemoteConn(d.id, 'time up'); return json(res, 409, { error: `The connection to ${d.name} has ended. Connect again with a new code.`, remote: 'connect', client: d.id }); }
  const out = renameClient(r.json ?? {}, conn.desk, d.id);
  if (p === '/api/sessions' && req.method === 'GET') for (const s of [...(out.live || []), ...(out.history || [])]) if (s?.id) conn.sessions.add(s.id);
  if (p === '/api/sessions' && out.id) conn.sessions.add(out.id);
  return json(res, r.status, out);
}
// The page's controls for this computer's remote desks. Returns false when the request is not one of them.
async function remoteDeskRoutes(req, res, p) {
  if (!p.startsWith('/api/remote-desks')) return false;
  if (!remoteOn()) return json(res, 404, { error: 'Not found' }); // hidden
  if (req.method === 'GET' && p === '/api/remote-desks') return json(res, 200, remoteDesks().map(remoteDeskView));
  if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
  const b = await readBody(req);
  if (p === '/api/remote-desks') { // add one: the address and the check code shown on the other computer
    const name = String(b.name || '').trim().slice(0, 40);
    let address = String(b.address || '').trim().replace(/\/+$/, '');
    if (!name) return json(res, 400, { error: 'Give the remote desk a name' });
    address = 'https://' + address.replace(/^\w+:\/\//, '');
    let u; try { u = new URL(address); } catch { return json(res, 400, { error: 'That address is not right. Use the one shown on the other computer, like 192.168.1.20:4402' }); }
    if (!u.port) return json(res, 400, { error: 'Add the port, as shown on the other computer (like 192.168.1.20:4402)' });
    let peer;
    try { peer = await peerCertificate(u.origin); } catch (e) { return json(res, 400, { error: connectError(e, 'That address') }); }
    if (!sameCheck(peer.fingerprint, b.check)) {
      logEvent('remote desk: check code did not match', `${u.origin} sent ${checkCodeOf(peer.fingerprint)}`);
      return json(res, 400, { error: `The check code does not match. That address answered with ${checkCodeOf(peer.fingerprint)}. If the other computer shows a different code, something between the two computers is reading the encrypted traffic (an inspecting proxy such as Zscaler), or another computer has that address. Nothing was saved.` });
    }
    const d = { id: 'r' + randomUUID().replace(/-/g, '').slice(0, 10), name, address: u.origin, pin: peer.fingerprint, cert: peer.pem };
    remoteDesks().push(d); saveState();
    broadcast({ t: 'clients' });
    return json(res, 200, remoteDeskView(d));
  }
  const m = p.match(/^\/api\/remote-desks\/(\w+)\/(connect|disconnect|remove)$/);
  const d = m && remoteDeskById(m[1]);
  if (!d) return json(res, 404, { error: 'Unknown remote desk' });
  const conn = remoteConns.get(d.id);
  if (m[2] === 'connect') {
    if (conn) return json(res, 200, remoteDeskView(d));
    // A quick look first, so the long wait below is only ever for someone clicking Allow there. A Docket that has
    // just started there has Remote Desks hidden and answers nothing; its firewall often drops the request silently.
    let r;
    try { r = await remoteCall(d, null, 'GET', '/remote/hello', undefined, 10000); }
    catch (e) { return json(res, 502, { error: connectError(e, d.name) + (e?.code === 'PIN_MISMATCH' ? '' : ` If Docket on ${d.name} has just started or restarted, Remote Desks may be hidden there: ask a session there to show the remote desk options, then connect again.`) }); }
    if (r.status === 503) return json(res, 400, { error: `${r.json?.error || 'Remote control is off on that computer'}. Turn it on there (☰ > Remote Desks), then connect again.` });
    try { r = await remoteCall(d, null, 'POST', '/remote/hello', { code: String(b.code || ''), name: os.hostname() }, ASK_WAIT_MS + 20e3); }
    catch (e) { return json(res, 502, { error: connectError(e, d.name) }); }
    if (r.status !== 200 || !r.json?.token) return json(res, 400, { error: r.json?.error || `${d.name} refused the connection` });
    const c = { token: r.json.token, expires: r.json.expires, desk: r.json.desk.id, deskName: r.json.desk.name, sessions: new Set(), row: null };
    remoteConns.set(d.id, c);
    c.end = setTimeout(() => dropRemoteConn(d.id, 'time up'), Math.min(c.expires - Date.now(), 2 ** 31 - 1)); // so the page says so when the time runs out
    if (d.deskName !== c.deskName) { d.deskName = c.deskName; saveState(); }
    openRemoteSocket(d, c);
    await remoteRows(true);
    logEvent('remote desk: connected', `${d.name} (${d.address}, desk ${c.deskName})`);
    broadcast({ t: 'clients' });
    return json(res, 200, remoteDeskView(d));
  }
  if (conn) { remoteCall(d, conn, 'POST', '/remote/bye', {}, 5000).catch(() => {}); dropRemoteConn(d.id, m[2] === 'remove' ? 'removed' : 'disconnected here'); }
  if (m[2] === 'remove') { state.remoteDesks = remoteDesks().filter((x) => x.id !== d.id); saveState(); broadcast({ t: 'clients' }); return json(res, 200, { ok: true }); }
  return json(res, 200, remoteDeskView(d));
}

// Shows or hides every part of Remote Desks on this computer, from the remote_desks tool or an Alt+click on
// ☰ > About, until Docket next starts. Showing it starts remote control again if it was left on; hiding it stops
// remote control and ends every connection, both ways. Neither changes the saved setup (authenticator, desk, on or off, remote desks added).
// Docket's own restarts (an update taken in, ☰ > Restart Docket) are not a new start: it stays shown across them, so
// a computer that was connected here finds remote control running and can connect again. A note in the data folder
// carries it over, read once at the next start.
const remoteShownFile = () => path.join(DATA_DIR, 'remote-shown');
function keepRemoteShownOverRestart() {
  if (!remoteShown) return;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(remoteShownFile(), String(Date.now())); } catch {}
}
function remoteShownAfterRestart() {
  let at = 0;
  try { at = Number(fs.readFileSync(remoteShownFile(), 'utf8')); fs.rmSync(remoteShownFile()); } catch {}
  if (at > Date.now() - 10 * 60e3) setRemoteFeatures(true);
}
function setRemoteFeatures(on) {
  const was = remoteOn();
  remoteShown = !!on;
  if (on && remoteCfg().on) startRemoteHost();
  if (!on) {
    stopRemoteHost();
    for (const d of remoteDesks()) { const c = remoteConns.get(d.id); if (c) { remoteCall(d, c, 'POST', '/remote/bye', {}, 5000).catch(() => {}); dropRemoteConn(d.id, 'Remote Desks hidden'); } }
  }
  if (was !== remoteOn()) logEvent(`Remote Desks ${on ? 'shown' : 'hidden'}`);
  toPages({ t: 'remote-features', on: remoteOn() }); // this computer's pages only
  broadcast({ t: 'clients' });
}

const APP_INSTALL_FILES = {
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/shift-savings.mjs': ['shift-savings.mjs', 'text/javascript; charset=utf-8'], // the Usage page's Shift line
  '/activity.mjs': ['activity.mjs', 'text/javascript; charset=utf-8'], // the Usage page's Activity section (#805)
  '/icon/docket-192.png': ['icon/docket-192.png', 'image/png'],
  '/icon/docket-512.png': ['icon/docket-512.png', 'image/png'],
  '/icon/docket-maskable-512.png': ['icon/docket-maskable-512.png', 'image/png'],
};

const server = http.createServer(async (req, res) => {
  try {
    if (!trusted(req)) return json(res, 403, { error: 'Forbidden' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    // Remote desks: this computer's remote control, the remote desks listed here, and requests for one of them.
    // Alt+click on ☰ > About shows or hides them with no AI, the same as the remote_desks tool.
    // You are typing in a session (index.html typingOn): holds an automatic update and the app restart. Kept on this
    // computer whatever desk is shown, since it is this computer's pages an update would reload.
    if (p === '/api/typing-now' && req.method === 'POST') { lastTyping = Date.now(); return json(res, 200, { ok: true }); }
    if (p === '/api/remote-features' && req.method === 'POST') { setRemoteFeatures((await readBody(req)).on === true); return json(res, 200, { on: remoteOn() }); }
    if (await remoteControlRoutes(req, res, p) !== false) return;
    if (await remoteDeskRoutes(req, res, p) !== false) return;
    const remoteDesk = await remoteDeskFor(req, url, p);
    if (remoteDesk) return await remoteProxy(remoteDesk, req, res, url, p); // awaited, so an error is answered below
    if (p === '/api/hooks/shift-up' && req.method === 'POST') { // plugin/hooks/shift-first-edit.mjs
      const b = await readBody(req), s = live.get(b.session);
      if (!b.session || req.headers['x-docket-token'] !== hookToken(String(b.session))) return json(res, 403, { error: 'Forbidden' });
      if (!s) return json(res, 200, {});
      const raised = await shiftUpForWork(s, b.tool, b.input, b.toolUseId);
      await s.shiftingUp?.catch(() => {}); // one the chat stream started: the next step must find the new model
      return json(res, 200, shiftUpReply(s, raised, b.toolUseId, b.subagent));
    }
    if (p === '/api/tools' || p === '/api/tools/call') {
      if (req.headers['x-docket-token'] !== getToolToken()) return json(res, 403, { error: 'Forbidden' });
      const b = req.method === 'POST' ? await readBody(req) : {};
      const sid = url.searchParams.get('session') || b.session;
      // Just after a restart the sessions still running are being picked up again; a call from one waits for that.
      if (!live.has(sid) && !askToolSets.has(sid)) await reattached;
      const parent = live.get(sid);
      if (!parent && !askToolSets.has(sid)) return json(res, 409, { error: 'That session is not running in Docket' });
      const defs = askToolSets.get(sid) || portalToolDefs(parent);
      // Whether this session's tool list has plan_review_done (#661): its list is fixed when its process starts, so a
      // coordinator started before that tool existed is asked to review its plan only after it starts again.
      const reviewTool = defs.some((t) => t.name === 'plan_review_done');
      if (req.method === 'GET' && state.sessions[sid] && !!state.sessions[sid].reviewTool !== reviewTool) { state.sessions[sid].reviewTool = reviewTool; saveState(); }
      if (req.method === 'GET') return json(res, 200, defs.filter((t) => !t.hidden).map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(z.object(t.inputSchema)) })));
      const t = defs.find((x) => x.name === b.name);
      if (!t) return json(res, 404, { error: `No tool named ${b.name}` });
      const args = z.object(t.inputSchema).safeParse(b.args || {});
      if (!args.success) return json(res, 200, { content: [{ type: 'text', text: 'Invalid input: ' + args.error.message }], isError: true });
      try { return json(res, 200, await t.handler(args.data, {})); }
      catch (e) { return json(res, 200, { content: [{ type: 'text', text: e.message }], isError: true }); }
    }
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(pageBody('index.html'));
    }
    if (req.method === 'GET' && p === '/favicon.ico') { // Docket's scroll icon, from icon/
      res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(ROOT, 'icon', 'docket.ico')));
    }
    // Installing Docket as an app: the manifest, its icons, and the service worker, which
    // must come from the top of the site to cover the whole page. The page no longer offers the install;
    // these stay for copies installed before, which still read them.
    if (req.method === 'GET' && APP_INSTALL_FILES[p]) {
      const [file, type] = APP_INSTALL_FILES[p];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(ROOT, file)));
    }
    if (req.method === 'GET' && p === '/api/clients') {
      const force = url.searchParams.get('refresh') === '1';
      // quick=1 (the page starting up): answer now with the sign-in checks already known (null: not
      // checked yet) and start the rest, so the page draws at once and asks again for the full answer.
      const quick = url.searchParams.get('quick') === '1';
      // Each brand the company has set up has its own sign-in; signedIn is false when any of them is signed out.
      const known = (c, e) => { const hit = authCache.get(authKey(c.id, e)); return hit ? hit.loggedIn : null; };
      // account: who it is signed in as, where Docket can tell: the Claude account's email, or the AWS profile.
      // A gateway's: who is signed in to it, and the other companies its one sign-in covers.
      const gwAccount = (c, e, gw) => { const others = onGateway(gw.url).filter((x) => x.client.id !== c.id).map((x) => x.client.name);
        return `${loginOf(gw) === 'key' ? 'the key in LITELLM_PROXY_API_KEY' : authCache.get(authKey(c.id, e))?.email || 'the lite sign-in'} on ${gatewayHost(gw.url)}${others.length ? `, also used by ${[...new Set(others)].join(', ')}` : ''}`; };
      const account = (c, e, signedIn) => !signedIn ? null : gatewayFor(c, e) ? gwAccount(c, e, gatewayFor(c, e)) : e === 'claude' && isBedrock(c) ? `AWS profile ${c.awsProfile}` : authCache.get(authKey(c.id, e))?.email || null;
      if (quick) for (const c of CLIENTS) for (const e of brandsOf(c)) if (known(c, e) === null) authStatus(c, false, e).catch(() => {});
      const rows = await Promise.all(CLIENTS.map(async (c) => {
        const brands = await Promise.all(brandsOf(c).map(async (e) => {
          const signedIn = quick ? known(c, e) : await authStatus(c, force, e);
          return { engine: e, name: BRANDS[e].name, signedIn, account: account(c, e, signedIn), ...(signedIn && !gatewayFor(c, e) && authCache.get(authKey(c.id, e))?.plan ? { plan: authCache.get(authKey(c.id, e)).plan } : {}) };
        }));
        const signedIn = brands.some((x) => x.signedIn === false) ? false : brands.some((x) => x.signedIn === null) ? null : true;
        // startGears: the model a new Shift session starts on, per brand, for the model menu's "Shift (starts ...)".
        const startGears = Object.fromEntries(brandsOf(c).map((e) => [e, usableGear(c, e, startGearOf(e, null, c.startGear?.[e])).name]));
        // planSystem: '' while the desk has not chosen one, which the page offers once (the card after the update, #180).
        return { id: c.id, name: c.name, folder: c.folder, ...(c.hidden ? { hidden: true } : {}), color: c.color || '', defaultEngine: defaultEngineOf(c), planSystem: c.planSystem || '', ...(c.planSwitch ? { planSwitch: { to: c.planSwitch.to, from: c.planSwitch.from, session: c.planSwitch.session } } : {}), brands, startGears,
          bedrock: isBedrock(c), ...(gatewayFor(c, 'claude') ? { gateway: gatewayHost(c.gateway.url) } : {}), signedIn, forced: forcedOf(c), browser: browserStatus(c) };
      }));
      return json(res, 200, [...rows, ...await remoteRows(!quick)]); // remote desks come after this computer's own
    }
    // Edit the company list: the whole list comes back, in order. Ids never change once made.
    // connections: who each brand of the desk is billed to, and the other desks billed to the same connection.
    // gatewayModels: the model names the company's gateway listed at its last sign-in check, to pick from.
    if (req.method === 'GET' && p === '/api/clients/edit') {
      const all = CLIENTS.map((c) => ({ id: c.id, name: c.name, conns: deskConnections(c) }));
      const connections = (c) => all.find((x) => x.id === c.id).conns.map((x) => ({ brand: x.brand, label: x.label, kind: x.kind, detail: x.detail,
        sharedWith: all.filter((o) => o.id !== c.id && o.conns.some((y) => y.key === x.key)).map((o) => o.name) }));
      return json(res, 200, CLIENTS.map((c) => ({ ...c, forced: forcedOf(c), running: [...live.values()].filter((x) => x.client === c.id).length, hookList: hooksFor(c, PLUGIN_DIR), connections: connections(c),
        gatewayModels: (gatewayFor(c, 'claude') && authCache.get(authKey(c.id))?.models) || [] })));
    }
    if (req.method === 'POST' && p === '/api/clients/edit') {
      const b = await readBody(req);
      const list = Array.isArray(b.clients) ? b.clients : [];
      const out = [], ids = new Set();
      for (const c of list) {
        const r = cleanCompany(c, (id) => ids.has(id) || clientById(id) || list.some((x) => x.id === id));
        if (r.error) return json(res, 400, r);
        if (ids.has(r.id)) return json(res, 400, { error: `${r.name} is in the list twice` });
        ids.add(r.id);
        out.push(r);
      }
      if (!out.length) return json(res, 400, { error: 'Keep at least one desk' });
      if (out.every((c) => c.hidden)) return json(res, 400, { error: 'Keep at least one desk shown' });
      const busy = CLIENTS.filter((c) => !ids.has(c.id) && [...live.values()].some((x) => x.client === c.id));
      if (busy.length) return json(res, 400, { error: `${busy.map((c) => c.name).join(', ')} still has sessions running here. End them first.` });
      // trash: the removed companies whose folders go to the Recycle Bin as well (only the ones Docket made).
      const binned = CLIENTS.filter((c) => !ids.has(c.id) && (b.trash || []).includes(c.id));
      const added = out.filter((c) => !clientById(c.id)).map((c) => c.id);
      saveCompanies(out);
      for (const id of added) { const c = clientById(id); if (c) runDeskCheck(c).catch(() => {}); }
      if (!b.trash) return json(res, 200, out);
      const trashed = [];
      for (const c of binned) trashed.push(...await recycleDesk(c));
      return json(res, 200, { clients: out, trashed });
    }
    // The folders a brand's home goes in by default, for the Companies screen's Use boxes.
    if (req.method === 'GET' && p === '/api/clients/home-roots') return json(res, 200, homeRoots());
    if (req.method === 'GET' && p === '/api/gears') return json(res, 200, GEARS); // Shift's gears per brand, for the Companies screen
    // The setup wizard: what this computer has (the claude command, the AWS CLI and its profiles) and the folders to suggest.
    if (req.method === 'GET' && p === '/api/setup/check') return json(res, 200, await setupCheck());
    // The wizard's folder step: whether each home folder in its boxes already holds a setup, and a free folder beside it.
    if (req.method === 'GET' && p === '/api/setup/home-check') {
      const taken = CLIENTS.flatMap((c) => [c.home, c.grokHome, c.codexHome]).filter(Boolean).map((h) => path.resolve(h).toLowerCase());
      const out = {};
      for (const e of ['claude', 'grok', 'codex']) {
        const home = (url.searchParams.get(e) || '').trim(); if (!home || !path.isAbsolute(home)) continue;
        const found = homeInUse(home, e);
        out[e] = { home, found, free: found ? freeHome(home, taken) : null };
      }
      return json(res, 200, out);
    }
    if (req.method === 'GET' && p === '/api/update') return json(res, 200, updateInfo());
    // The 1-hour prompt cache offer: the open offers, and an answer to one ({ client, answer: yes|later|never }).
    if (req.method === 'GET' && p === '/api/cache-offers') return json(res, 200, cacheOffers);
    if (req.method === 'POST' && p === '/api/cache-offers/answer') {
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client) return json(res, 404, { error: 'Unknown desk' });
      if (!['yes', 'later', 'never'].includes(b.answer)) return json(res, 400, { error: 'The answer is yes, later or never' });
      state.cacheOffer[client.id] = { answer: b.answer, at: Date.now() }; saveState();
      if (b.answer === 'yes') saveCompanies(CLIENTS.map((c) => (c.id === client.id ? { ...c, promptCacheTtl: '1h' } : c)));
      cacheOffers = cacheOffers.filter((o) => o.client !== client.id);
      broadcast({ t: 'cache-offers', offers: cacheOffers });
      return json(res, 200, { ok: true });
    }
    // The setup check's card: the open offers, an answer to one ({ client, answer: later|start }), and a check now.
    if (req.method === 'GET' && p === '/api/setup-offers') return json(res, 200, setupOffers);
    if (req.method === 'POST' && p === '/api/setup-offers/answer') {
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client) return json(res, 404, { error: 'Unknown desk' });
      if (!['later', 'start'].includes(b.answer)) return json(res, 400, { error: 'The answer is later or start' });
      let session = null;
      if (b.answer === 'start') { try { session = (await startSetupSession(client)).id; } catch (e) { return json(res, 500, { error: e.message }); } }
      else {
        const last = state.setupCheck[client.id]?.last || {};
        state.setupCheck[client.id] = { ...state.setupCheck[client.id], answer: { answer: 'later', at: Date.now(), slim: last.slim || 0, start: last.start || 0 } };
        saveState();
      }
      setupOffers = setupOffers.filter((o) => o.client !== client.id);
      broadcast({ t: 'setup-offers', offers: setupOffers });
      return json(res, 200, { ok: true, session });
    }
    // The start-cost card: the open offers, and an answer to one ({ client, answer: later|apply }); apply turns splitting off.
    if (req.method === 'GET' && p === '/api/start-offers') return json(res, 200, startOffers);
    if (req.method === 'POST' && p === '/api/start-offers/answer') {
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client) return json(res, 404, { error: 'Unknown desk' });
      if (!['later', 'apply'].includes(b.answer)) return json(res, 400, { error: 'The answer is later or apply' });
      const shortCost = startOffers.find((o) => o.client === client.id)?.shortCost || 0;
      if (b.answer === 'apply') {
        saveCompanies(CLIENTS.map((c) => (c.id === client.id ? { ...c, splitWork: false } : c)));
        logEvent('start check', `${client.name}: splitting turned off from the start-cost card`);
      }
      state.startOffer[client.id] = { answer: b.answer === 'apply' ? 'applied' : 'later', at: Date.now(), shortCost };
      saveState();
      startOffers = startOffers.filter((o) => o.client !== client.id);
      broadcast({ t: 'start-offers', offers: startOffers });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/start-check') return json(res, 200, checkStartOffers()); // look again now
    if (req.method === 'POST' && p === '/api/setup-check') { // ?client=: check that desk in full now
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 404, { error: 'Unknown desk' });
      await checkSetup({ force: client.id });
      return json(res, 200, { ...(state.setupCheck[client.id] || {}), offers: setupOffers });
    }
    // Move sessions' records to another desk, after their files were moved between the desks' Claude homes by hand
    // (move-desk.mjs): { from, to, ids, groupId? }. No files are touched; sessions open in Docket are skipped.
    if (req.method === 'POST' && p === '/api/sessions/move-desk') {
      const b = await readBody(req);
      const from = clientById(b.from), to = clientById(b.to);
      if (!from || !to) return json(res, 404, { error: 'Unknown desk' });
      if (!Array.isArray(b.ids) || !b.ids.length) return json(res, 400, { error: 'Give the session ids' });
      try {
        const r = moveDesk(state, usage, { from: from.id, to: to.id, ids: b.ids, groupId: b.groupId ? String(b.groupId) : '',
          groupIds: groupsOf(to.id).map((g) => g.id), isLive: (id) => live.has(id) });
        if (r.changed) {
          writeState(); saveUsageSoon();
          for (const c of [from, to]) {
            historyCache.delete(c.id);
            history(c, true).then(() => broadcast({ t: 'history-ready', client: c.id })).catch(() => {});
            for (const t of ['keep', 'places', 'groups']) broadcast({ t, client: c.id });
          }
          logEvent('sessions moved to another desk', `${r.results.filter((x) => x.result === 'moved').length} from ${from.id} to ${to.id}`);
        }
        return json(res, 200, r);
      } catch (err) { return json(res, 400, { error: err.message }); }
    }
    // Bring in past sessions: what is found, the copy, the report, and its undo.
    if (p.startsWith('/api/bring-in')) {
      const b = req.method === 'POST' ? await readBody(req) : {};
      const client = clientById(b.client || url.searchParams.get('client'));
      if (!client) return json(res, 404, { error: 'Unknown desk' });
      try {
        if (req.method === 'GET' && p === '/api/bring-in') return json(res, 200, await bringInView(client));
        if (req.method === 'POST' && p === '/api/bring-in/look') { // a folder the person names, kept for next time
          const folder = String(b.folder || '').trim();
          if (!isFullPath(folder)) return json(res, 400, { error: 'Give the full path of the folder' });
          const list = state.bringInHomes ||= [];
          if (!list.some((x) => samePath(x, folder))) { list.push(path.resolve(folder)); saveState(); }
          return json(res, 200, await bringInView(client));
        }
        if (req.method === 'POST' && p === '/api/bring-in/offered') { (state.bringInOffered ||= {})[client.id] = Date.now(); saveState(); return json(res, 200, { ok: true }); }
        if (req.method === 'POST' && p === '/api/bring-in/copy') {
          if (!Array.isArray(b.picked) || !b.picked.length) return json(res, 400, { error: 'Pick at least one folder' });
          return json(res, 200, await bringIn(client, b.picked.map(String)));
        }
        if (req.method === 'GET' && p === '/api/bring-in/report') {
          const html = reportPaths(DATA_DIR, bringInRun(client, url.searchParams.get('run'))).html;
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(fs.readFileSync(html));
        }
        if (req.method === 'GET' && p === '/api/bring-in/check') {
          const run = bringInRun(client, url.searchParams.get('run'));
          return json(res, 200, { run: runView(run), copies: checkCopies(run).map((c) => ({ ...c, open: live.has(c.id) })) });
        }
        if (req.method === 'POST' && p === '/api/bring-in/undo') return json(res, 200, await bringInUndo(client, String(b.run), Array.isArray(b.ids) ? b.ids.map(String) : []));
      } catch (err) { return json(res, 400, { error: err.message }); }
      return json(res, 404, { error: 'Not found' });
    }
    // ☰ > Gauges > Memory and Disk: memory now, and the folder sizes last counted (?fresh=1 counts them again;
    // counting says one is under way). The gauges ask for the same in short, every 15 seconds.
    if (req.method === 'GET' && (p === '/api/machine-use' || p === '/api/machine-gauges')) {
      if (url.searchParams.get('fresh') === '1') diskUse.refresh();
      const use = p === '/api/machine-use';
      const m = await machineNow({ commands: use }), d = diskUse.get(), counting = diskUse.counting();
      if (use) {
        const breakdown = await machineBreakdown(m).catch((err) => { logEvent('memory breakdown failed', err.message); return null; });
        return json(res, 200, { memory: m.memory, memoryError: m.memoryError, breakdown, disk: d, counting, everyMinutes: DISK_EVERY_MS / 60_000 });
      }
      return json(res, 200, { cpu: m.cpu, memory: m.memory && { total: m.memory.total, rows: m.memory.rows }, counting,
        disk: d && { docket: d.docket?.bytes ?? null, copies: d.copies?.bytes ?? null, history: d.history.reduce((a, x) => a + x.bytes, 0), drive: d.drive, at: d.at } });
    }
    // Whether Docket stops a turn whose step is stuck past its limit (checkStalls); on unless turned off.
    if (req.method === 'GET' && p === '/api/pause') return json(res, 200, { paused: pauseView() });
    if (req.method === 'POST' && p === '/api/pause') return json(res, 200, { paused: await pauseAll((await readBody(req)).reason || 'user') });
    if (req.method === 'GET' && p === '/api/reloads') return json(res, 200, reloadsView());
    if (req.method === 'POST' && p === '/api/reload-all') return json(res, 200, reloadAll()); // the top bar's Reload all
    if (req.method === 'POST' && p === '/api/resume') return json(res, 200, await resumeAll((await readBody(req)).reason || 'user'));
    // Whether Docket continues a session cut off by an unplanned stop by itself; on unless turned off.
    if (p === '/api/auto-continue') {
      if (req.method === 'POST') { state.autoContinue = !!(await readBody(req)).on; saveState(); }
      return json(res, 200, { on: autoContinueOn() });
    }
    if (p === '/api/auto-pause') {
      if (req.method === 'POST') { state.autoPause = !!(await readBody(req)).on; saveState(); }
      return json(res, 200, { on: autoPauseOn(), watching: !!powerWatch });
    }
    // Starting Docket after a restart. GET: what is set up (fresh=1 checks again). POST { to: 'signin' |
    // 'shortcut' | 'off' } runs the install or remove script; { choice: 'none' } is the banner's Don't ask again.
    if (p === '/api/startup') {
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (b.choice === 'none') state.startup = { choice: 'none', at: Date.now() };
        else if (['signin', 'shortcut', 'off'].includes(b.to)) {
          try { await setStartup(b.to); } catch (err) { await checkStartup(); return json(res, 500, { error: err.message }); }
          state.startup = { choice: b.to === 'off' ? 'none' : b.to, at: Date.now() }; // turned off on purpose: no banner
        } else return json(res, 400, { error: 'Give to: signin, shortcut or off; or choice: none' });
        saveState(); await checkStartup();
      } else if (url.searchParams.get('fresh') === '1' || !startupNow) await checkStartup();
      return json(res, 200, startupView());
    }
    // { event: 'sleep' | 'wake' | 'shutdown' }: what the helper would say, for testing without sleeping the computer.
    if (req.method === 'POST' && p === '/api/power') {
      const ev = powerEvent((await readBody(req)).event || '');
      if (!ev || ev === 'ready') return json(res, 400, { error: 'Give event: sleep, wake or shutdown' });
      onPower(ev);
      return json(res, 200, { paused: pauseView() });
    }
    // The Suggest a feature button (#552, #563). GET: the repo reports go to (never the token), what Docket adds about
    // itself, and how many this install sent today, for the panel to show. POST: send one ({ description, name, page });
    // the answer always says whether it went (ok) and why not. Only a send GitHub took counts toward the daily limit.
    if (p === '/api/feedback') {
      const install = () => { const had = state.installId, id = installId(state); if (id !== had) saveState(); return id; };
      const facts = () => docketFacts({ version: updateInfo().version, commit: updateStatus.commit, clients: CLIENTS, live: live.values(), state, os: process.platform, install: install() });
      if (req.method === 'GET') return json(res, 200, { destination: destinationInfo(cleanDestination(state.feedback)), docket: facts(), sentToday: sentToday(state.feedbackSent, today()), limit: DAILY_LIMIT });
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (typeof b.description !== 'string' || !b.description.trim()) return json(res, 400, { error: 'Type a message first' });
        const dest = cleanDestination(state.feedback);
        if (dest && limitReached(state.feedbackSent, today())) return json(res, 200, { ok: false, kind: 'limit', message: limitMessage() });
        const report = buildReport({ description: b.description, name: b.name, page: b.page, docket: facts() });
        const r = await sendReport(dest, report);
        if (r.ok) { state.feedbackSent = countSend(state.feedbackSent, today()); saveState(); }
        return json(res, 200, r);
      }
    }
    // Where this computer files feedback: { repo: 'owner/name', token }, or repo '' to turn sending off. An empty token
    // keeps the one saved.
    if (req.method === 'POST' && p === '/api/feedback/destination') {
      const b = await readBody(req), repo = String(b.repo || '').trim();
      if (!repo) { delete state.feedback; saveState(); return json(res, 200, destinationInfo(null)); }
      const d = cleanDestination({ repo, token: String(b.token || '').trim() || state.feedback?.token });
      if (!d) return json(res, 400, { error: 'Give the repo as owner/name, and a GitHub token' });
      state.feedback = d; saveState();
      return json(res, 200, destinationInfo(d));
    }
    if (p === '/api/rest-minutes') {
      if (req.method === 'POST') { state.restMinutes = restMinutes((await readBody(req)).minutes); saveState(); }
      return json(res, 200, { minutes: restMinutesNow() });
    }
    if (p === '/api/stall-stop') {
      if (req.method === 'POST') { state.stallStop = !!(await readBody(req)).on; saveState(); }
      return json(res, 200, { on: stallStopOn() });
    }
    if (req.method === 'POST' && p === '/api/update/check') { await checkForUpdate(); return json(res, 200, updateInfo()); }
    if (req.method === 'POST' && p === '/api/update/restart-now') { restartWait.now(); return json(res, 200, updateInfo()); } // skip the wait for a quiet moment
    // ☰ > Restart Docket: GET says what it would cut off, for the warning; POST does it (the page then waits for the app).
    if (req.method === 'GET' && p === '/api/restart-docket') return json(res, 200, restartRisk());
    if (req.method === 'POST' && p === '/api/restart-docket') {
      if (docketRestarting) return json(res, 409, { error: 'Docket is already restarting' });
      restartDocket().catch((e) => { logEvent('Restart Docket failed', e?.stack || e); keepRemoteShownOverRestart(); setTimeout(() => process.exit(RESTART_CODE), 300); });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/update/now') { // pulls; the restart follows once it is quiet, or at once with { anyway: true }
      updateAnyway = !!(await readBody(req)).anyway;
      await checkForUpdate(true);
      if (updateStatus.result !== 'updated') { if (updateAnyway) restartWait.now(); updateAnyway = false; } // nothing new pulled: an update already waiting goes now
      return json(res, 200, updateInfo());
    }
    if (req.method === 'POST' && p === '/api/update/mode') { // { mode: 'auto' | 'manual' }; auto takes a waiting update at once
      const mode = cleanMode((await readBody(req)).mode);
      if (!mode) return json(res, 400, { error: 'Give mode auto or manual' });
      state.updates = { ...state.updates, mode }; saveState();
      if (mode === 'auto' && updateStatus.waiting) checkForUpdate();
      broadcast({ t: 'update', update: updateInfo() });
      return json(res, 200, updateInfo());
    }
    if (req.method === 'POST' && p === '/api/update/settings') { // { minutes }: how often to check, 0 = never
      const min = Number((await readBody(req)).minutes);
      if (!Number.isFinite(min) || min < 0 || (min > 0 && min < 0.25) || min > 1440) return json(res, 400, { error: 'Give a number of minutes from 0.25 to 1440, or 0 for never' });
      state.updates = { ...state.updates, minutes: min }; saveState(); scheduleUpdates();
      return json(res, 200, updateInfo());
    }
    // The setup wizard saves one company: a new one, or the one it made a step earlier (by id) when the person goes back.
    if (req.method === 'POST' && p === '/api/clients/save-one') {
      const b = await readBody(req);
      const old = b.id ? clientById(b.id) : null;
      const r = cleanCompany({ ...b, id: old ? old.id : null }, (id) => !!clientById(id));
      if (r.error) return json(res, 400, r);
      if (old && [...live.values()].some((x) => x.client === old.id) && (old.home !== r.home || old.awsProfile !== r.awsProfile || old.gateway?.url !== r.gateway?.url)) return json(res, 400, { error: `${old.name} has sessions running. End them before changing its folders or sign-in.` });
      // madeFolders: the home folders Docket makes now, which Remove may later send to the Recycle Bin.
      const made = [...new Set([...(r.madeFolders || []), ...[r.home, r.grokHome, r.codexHome].filter((h) => h && !fs.existsSync(h))])];
      if (made.length) r.madeFolders = made;
      try { fs.mkdirSync(r.folder, { recursive: true }); } catch (err) { return json(res, 400, { error: `Could not make the working folder ${r.folder}: ${err.message}` }); }
      saveCompanies(old ? CLIENTS.map((c) => (c.id === old.id ? r : c)) : [...CLIENTS, r]);
      authCache.delete(r.id); authCache.delete(authKey(r.id)); // a gateway's is keyed by its URL
      return json(res, 200, r);
    }
    // Desk check: the desk's last report, or a fresh one with ?refresh=1 (or when it has none yet).
    const dc = p.match(/^\/api\/clients\/(\w+)\/desk-check$/);
    if (dc && req.method === 'GET') {
      const client = clientById(dc[1]);
      if (!client) return json(res, 404, { error: 'Unknown client' });
      try { return json(res, 200, (!url.searchParams.get('refresh') && deskChecks.get(client.id)) || await runDeskCheck(client)); }
      catch (e) { return json(res, 500, { error: `The check did not finish: ${e.message}` }); }
    }
    // Use from a terminal: the company's homes and variables as blocks to paste (GET), and saved as
    // docket-env.ps1 / docket-env.sh (POST).
    const te = p.match(/^\/api\/clients\/(\w+)\/terminal-env$/);
    if (te && (req.method === 'GET' || req.method === 'POST')) {
      const client = clientById(te[1]);
      if (!client) return json(res, 404, { error: 'Unknown client' });
      const vars = terminalVars(client);
      let files = null;
      if (req.method === 'POST') { try { files = writeEnvFiles(client); } catch (err) { return json(res, 400, { error: `Could not save the files: ${err.message}` }); } }
      return json(res, 200, { vars, ...envScripts(vars, client.name), files });
    }
    // Copy as new desk: the dry run the wizard shows, then the copy itself. Neither ever writes to the source.
    if (req.method === 'POST' && p === '/api/clients/copy-plan') {
      const r = copyRequest(await readBody(req));
      if (r.error) return json(res, 400, r);
      return json(res, 200, copyView(r));
    }
    if (req.method === 'POST' && p === '/api/clients/copy') {
      const b = await readBody(req);
      const r = copyRequest(b);
      if (r.error) return json(res, 400, r);
      const bad = Object.entries(r.problems)[0];
      if (bad) return json(res, 400, { error: `${COPY_FIELD[bad[0]]} ${bad[1]}`, problems: r.problems });
      const entry = copyEntry(r.src, { name: r.name, home: r.target.claude, grokHome: r.target.grok, codexHome: r.target.codex, folder: r.folder, conn: r.conn, env: r.env, choices: r.choices });
      const checked = cleanCompany(entry, (id) => !!clientById(id));
      if (checked.error) return json(res, 400, checked);
      if (copying.has(r.src.id)) return json(res, 409, { error: `A copy of ${r.src.name} is already being made` });
      copying.add(r.src.id);
      try {
        const homes = Object.values(r.target).filter(Boolean);
        const { left } = await runCopy(r.plan, { target: r.target, trash: toTrash, userHome: os.homedir() });
        // A variable pointing at a folder of the original's (a notes folder, say) now points at one of the copy's
        // own: made empty here when it is not there yet, and so one of the folders Docket made.
        const made = [...homes];
        for (const [k, v] of Object.entries(r.env)) {
          const was = r.src.env?.[k];
          if (!v || v === was || !path.isAbsolute(v) || fs.existsSync(v)) continue;
          let dir = false; try { dir = !!was && fs.statSync(was).isDirectory(); } catch {}
          if (dir) { fs.mkdirSync(v, { recursive: true }); made.push(v); }
        }
        const c = { ...cleanCompany(entry, (id) => !!clientById(id)), copiedFrom: entry.copiedFrom, madeFolders: made };
        try { fs.mkdirSync(c.folder, { recursive: true }); } catch {}
        saveCompanies([...CLIENTS, c]);
        if (r.choices.groups) { state.groups[c.id] = copyGroups(groupsOf(r.src.id)); groupChanged(c.id); }
        logEvent('desk copied', `${r.src.name} -> ${c.name}: ${r.plan.copy.length} items, ${r.plan.outside.length} paths outside, ${left.length} still naming the original`);
        return json(res, 200, { client: c, left, signIn: needsSignIn(r.src, r.conn), warnings: r.plan.warnings });
      } catch (err) {
        return json(res, 400, { error: `The copy was not made: ${err.message}` });
      } finally { copying.delete(r.src.id); }
    }
    // A sign-in under way: its link, so a page that reloads in the middle of one can put that step back.
    const ls = p.match(/^\/api\/clients\/(\w+)\/login-state$/);
    if (ls && req.method === 'GET') {
      const client = clientById(ls[1]);
      if (!client) return json(res, 404, { error: 'Unknown client' });
      for (const engine of brandsOf(client)) {
        const l = logins.get(authKey(client.id, engine));
        if (l?.url && !l.closed) return json(res, 200, { engine, url: l.url, code: l.code || null, auto: !!(l.bedrock || l.auto) });
      }
      return json(res, 200, {});
    }
    const lm = p.match(/^\/api\/clients\/(\w+)\/(login|login-code|login-cancel|auth-check|browser-open|browser-done|browser-forget|browser-forget-site)$/);
    if (lm && req.method === 'POST') {
      const client = clientById(lm[1]);
      if (!client) return json(res, 404, { error: 'Unknown client' });
      // ?engine= names which brand's sign-in; Claude when it is left out, as the setup wizard does.
      const engine = url.searchParams.get('engine') || 'claude';
      if (!lm[2].startsWith('browser-') && !brandsOf(client).includes(engine)) return json(res, 400, { error: `${client.name} has no ${BRANDS[engine]?.name || engine} sign-in set up` });
      if (lm[2] === 'auth-check') { const a = await authInfo(client, true, engine); const gw = gatewayFor(client, engine); if (a.loggedIn) for (const x of gw ? onGateway(gw.url) : [{ client, engine }]) signedInAgain(x.client, x.engine, 'user'); return json(res, 200, { signedIn: a.loggedIn, email: a.email, forced: engine === 'claude' ? forcedOf(client) : null }); }
      if (lm[2] === 'login') return json(res, 200, await startLogin(client, false, engine));
      if (lm[2].startsWith('browser-')) {
        const b = await readBody(req);
        if (lm[2] === 'browser-open') await openSignInWindow(client, /^https?:\/\//.test(b.url || '') ? b.url : undefined);
        if (lm[2] === 'browser-done') await closeSignInWindow(client);
        if (lm[2] === 'browser-forget') await forgetBrowser(client);
        if (lm[2] === 'browser-forget-site') {
          if (!browserStatus(client).sites.includes(b.site)) return json(res, 400, { error: 'No sign-ins are saved for that site' });
          await forgetSite(client, b.site);
        }
        return json(res, 200, browserStatus(client));
      }
      if (lm[2] === 'login-code') {
        const b = await readBody(req);
        if (!isBedrock(client) && engine === 'claude' && (!b.code || !String(b.code).trim())) return json(res, 400, { error: 'Paste the code first' });
        const r = await finishLogin(client, String(b.code || ''), engine);
        const gw = gatewayFor(client, engine);
        if (gw) broadcastGateway(gw.url, r.loggedIn); else broadcast({ t: 'auth', client: client.id, engine, signedIn: r.loggedIn });
        if (r.loggedIn) for (const x of gw ? onGateway(gw.url) : [{ client, engine }]) signedInAgain(x.client, x.engine, 'user');
        return json(res, 200, r);
      }
      logins.get(authKey(client.id, engine))?.proc.kill();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/schedules') {
      return json(res, 200, scheduler.list(url.searchParams.get('client')));
    }
    if (req.method === 'POST' && p === '/api/schedules') { // create, from the page
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client) return json(res, 400, { error: 'Unknown client' });
      const base = String(b.title || 'schedule').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'schedule';
      let id = base, n = 2;
      while (scheduler.get(id) || fs.existsSync(path.join(client.home, 'scheduled-tasks', id))) id = `${base}-${n++}`;
      try {
        return json(res, 200, scheduler.add({ id, client: client.id, title: b.title, cron: b.cron || undefined, fireAt: b.fireAt || undefined, folder: b.folder, prompt: b.prompt || '' }));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    const sd = p.match(/^\/api\/schedules\/([a-z0-9-]+)$/);
    const pm = p.match(/^\/api\/proposals\/(prop_[\w]+)\/(start|dismiss)$/);
    if (pm && req.method === 'POST') {
      try {
        if (pm[2] === 'start') return json(res, 200, summary(startProposal(pm[1])));
        return json(res, 200, { ok: settleProposal(pm[1], 'dismissed') });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // Work another company handed over: Start runs it in this company, Dismiss drops it.
    const im = p.match(/^\/api\/inbox\/(inbox_[\w]+)\/(start|dismiss)$/);
    if (im && req.method === 'POST') {
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 400, { error: 'Unknown client' });
      try {
        if (im[2] === 'start') return json(res, 200, summary(startInbox(client.id, im[1])));
        dismissInbox(client.id, im[1]);
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    const hm = p.match(/^\/api\/handoffs\/(handoff_[\w]+)\/(continue|here|archive|keep)$/);
    if (hm && req.method === 'POST') {
      try {
        if (hm[2] === 'continue') return json(res, 200, summary(await continueHandoff(hm[1])));
        if (hm[2] === 'here') keepHandoffHere(hm[1]);
        else archiveAfterHandoff(hm[1], hm[2] === 'archive');
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/places') {
      const b = req.method === 'POST' ? await readBody(req) : {};
      const client = clientById(url.searchParams.get('client') || b.client);
      if (!client) return json(res, 400, { error: 'Unknown client' });
      if (req.method === 'POST') {
        const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x) => typeof x === 'string' && x.length < 100);
        state.places[client.id] = [...new Set(ids)].slice(-5000);
        saveState(); broadcast({ t: 'places', client: client.id });
      }
      return json(res, 200, state.places[client.id] || []);
    }
    if (p === '/api/keep') { // GET: { touched, pins } for the ✦ list. POST { client, id, pinned }: pin or unpin a session.
      const b = req.method === 'POST' ? await readBody(req) : {};
      const client = clientById(url.searchParams.get('client') || b.client);
      if (!client) return json(res, 400, { error: 'Unknown client' });
      if (req.method === 'POST') {
        if (typeof b.id !== 'string' || !/^[\w-]{1,100}$/.test(b.id)) return json(res, 400, { error: 'Which session?' });
        setPinned(client.id, b.id, !!b.pinned);
      }
      return json(res, 200, keepOf(client.id));
    }
    if (p === '/api/groups' || p.startsWith('/api/groups/')) {
      const b = req.method === 'POST' ? await readBody(req) : {};
      const client = clientById(url.searchParams.get('client') || b.client);
      if (!client) return json(res, 400, { error: 'Unknown client' });
      const list = groupsOf(client.id);
      if (req.method === 'GET' && p === '/api/groups') return json(res, 200, list);
      if (req.method === 'POST' && p === '/api/groups') {
        const name = String(b.name || '').trim().slice(0, 60);
        if (!name) return json(res, 400, { error: 'Give the group a name' });
        let folder; try { folder = groupFolder(b); } catch (e) { return json(res, 400, { error: e.message }); }
        const g = { id: 'g_' + randomUUID().slice(0, 8), name, color: GROUP_COLORS[list.length % GROUP_COLORS.length], archived: false, createdAt: Date.now(), ...(folder ? { folder } : {}) };
        list.push(g); groupChanged(client.id);
        return json(res, 200, g);
      }
      if (req.method === 'POST' && p === '/api/groups/order') {
        const ids = Array.isArray(b.ids) ? b.ids : [];
        list.sort((a, c) => (ids.indexOf(a.id) + 1 || 1e9) - (ids.indexOf(c.id) + 1 || 1e9));
        groupChanged(client.id);
        return json(res, 200, list);
      }
      const gm = groupAction(p);
      const g = gm && groupById(client.id, gm[1]);
      if (!g || req.method !== 'POST') return json(res, 404, { error: 'Unknown group' });
      if (gm[2] === 'rename') { const name = String(b.name || '').trim().slice(0, 60); if (name) g.name = name; }
      if (gm[2] === 'folder') {
        try { const folder = groupFolder(b); if (folder) g.folder = folder; else delete g.folder; }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (gm[2] === 'archive') {
        g.archived = true;
        if (b.withSessions) for (const m of await membersOf(client, g.id)) {
          if (m.archived) continue;
          const running = live.get(m.id);
          if (running) { running.input.close(); running.query.close(); live.delete(m.id); markRunning(m.id, false); broadcast({ t: 'ended', id: m.id, client: client.id }); }
          setArchived(client.id, m.id, true);
          state.sessions[m.id].archivedWithGroup = g.id;
        }
      }
      if (gm[2] === 'restore') {
        g.archived = false;
        for (const [sid, rec] of Object.entries(state.sessions)) if (rec.archivedWithGroup === g.id) { delete rec.archivedWithGroup; setArchived(client.id, sid, false); }
      }
      if (gm[2] === 'delete') {
        list.splice(list.indexOf(g), 1);
        for (const rec of Object.values(state.sessions)) if (rec.groupId === g.id) delete rec.groupId;
      }
      groupChanged(client.id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/usage') { // per-day rows for reporting: ?client=&from=YYYY-MM-DD&to=YYYY-MM-DD
      const c = url.searchParams.get('client'), from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '9999';
      const rows = Object.entries(usage).filter(([, u]) => !c || u.client === c).flatMap(([id, u]) => rowsOf(id, u)).map(withGroup).filter((r) => r.Date >= from && r.Date <= to);
      return json(res, 200, rows);
    }
    // Today's spend for one company, for the corner of the main window: ?client=&day=YYYY-MM-DD, the page's own
    // calendar day, as the Usage page's Today uses. The same rows the Usage page reads, so the two numbers match.
    if (req.method === 'GET' && p === '/api/usage/today') {
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 404, { error: 'Unknown client' });
      const asked = url.searchParams.get('day') || '';
      const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : new Date().toLocaleDateString('en-CA');
      let cost = 0, agent = 0, wait = 0, user = 0, added = 0, removed = 0; // and its agent, wait and typing seconds, and lines
      for (const [id, u] of Object.entries(usage)) if (clientById(u.client)) for (const r of rowsOf(id, u)) if (r.Client === client.id && r.Date === day) {
        cost += r.Cost || 0; agent += r.AgentSeconds || 0; wait += r.WaitSeconds || 0; user += r.UserSeconds || 0; added += r.LinesAdded || 0; removed += r.LinesRemoved || 0;
      }
      return json(res, 200, { client: client.id, day, cost, budget: client.budget || null, agent, wait, user, added, removed });
    }
    if (req.method === 'GET' && p === '/api/usage/report') return json(res, 200, usageReport()); // the Usage page
    // Session activity (#805). today: the footer's working line for one desk, from memory (?client=&day=YYYY-MM-DD).
    // Without: the kept slots for the Usage page, with the slot under way (?client= for one desk, &from=&to= days).
    if (req.method === 'GET' && p === '/api/activity/today') {
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 404, { error: 'Unknown client' });
      const asked = url.searchParams.get('day') || '', day = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : localDay(Date.now());
      return json(res, 200, { client: client.id, day, ...activityToday(mergeRebuilt(activityRecent, activityTally.open()).filter((l) => l.d === client.id), day) });
    }
    if (req.method === 'GET' && p === '/api/activity') {
      const c = url.searchParams.get('client') || '', from = url.searchParams.get('from') || '', to = (url.searchParams.get('to') || '9999') + 'T99';
      const lines = mergeRebuilt(activityLines(), activityTally.open()).filter((l) => (!c || l.d === c) && l.t >= from && l.t <= to);
      let meta = null; try { meta = JSON.parse(fs.readFileSync(ACTIVITY_META, 'utf8')); } catch {}
      return json(res, 200, { lines, rebuilt: meta?.rebuilt || null, rebuilding: activityRebuilding });
    }
    if (req.method === 'GET' && p === '/api/terminal/folder') { // ?client=&session=: where that session's terminal starts
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 400, { error: 'Unknown client' });
      return json(res, 200, { folder: sessionFolder(client, url.searchParams.get('session')) });
    }
    if (req.method === 'GET' && p === '/api/terminal/shells') return json(res, 200, terminalInfo(clientById(url.searchParams.get('client')))); // ?client=: the Terminal button's choices
    if (req.method === 'POST' && p === '/api/terminal') { // a terminal window in a folder: { client, folder, shell, cli }, shell and cli from /api/terminal/shells
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client) return json(res, 400, { error: 'Unknown client' });
      try { return json(res, 200, { ok: true, folder: openTerminal(client, b.folder, b.shell, b.cli) }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/editors') { // the editors installed here that a session's folder opens in
      return json(res, 200, { editors: (await findEditors()).map(({ id, name }) => ({ id, name })) });
    }
    if (req.method === 'POST' && p === '/api/editor') { // open a session's folder in an editor: { client, session, editor }
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client) return json(res, 400, { error: 'Unknown client' });
      try { return json(res, 200, { ok: true, opened: await openInEditor(client, String(b.session || ''), b.editor) }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/api/pick-folder') { // the Browse… button beside a folder box: { start, title } -> { folder } or { cancelled }
      if (folderPicking) return json(res, 409, { error: 'A folder picker is already open' });
      const b = await readBody(req);
      folderPicking = true;
      try { return json(res, 200, await pickFolder(String(b.start || ''), String(b.title || '').slice(0, 120) || 'Choose a folder')); }
      finally { folderPicking = false; }
    }
    if (req.method === 'POST' && p === '/api/usage/show') { // show the CSV in File Explorer (Finder on a Mac)
      if (!fs.existsSync(USAGE_CSV)) return json(res, 404, { error: 'The usage file has not been written yet' });
      showFile(USAGE_CSV, 'folder');
      return json(res, 200, { ok: true });
    }
    const tm = p.match(/^\/api\/sessions\/([\w-]+)\/typing$/);
    if (tm && req.method === 'POST') { // typing time measured in the page: { client, day: YYYY-MM-DD, ms }
      const b = await readBody(req);
      const client = clientById(b.client || live.get(tm[1])?.client || state.sessions[tm[1]]?.client);
      const ms = Number(b.ms);
      if (!client || !/^\d{4}-\d{2}-\d{2}$/.test(b.day || '') || !(ms > 0)) return json(res, 400, { error: 'Needs client, day and ms' });
      const u = usageRecord(tm[1], client.id);
      if (u.client !== client.id) return json(res, 400, { error: 'That session belongs to another desk' });
      u.user ||= {};
      u.user[b.day] = (u.user[b.day] || 0) + Math.min(ms, 6 * 3600e3) / 1000;
      saveUsageSoon();
      return json(res, 200, { ok: true });
    }
    const cm = p.match(/^\/api\/sessions\/([\w-]+)\/cost$/);
    if (cm && req.method === 'GET') { // what the session would cost at API prices (pricing.json)
      const client = clientById(url.searchParams.get('client') || live.get(cm[1])?.client || state.sessions[cm[1]]?.client);
      const file = client && sessionFile(client, cm[1]);
      // A Codex or Grok session has no Claude log: its lines changed come from its rows, as on the Usage page.
      if (!file) return usage[cm[1]]?.rows?.length ? json(res, 200, { replies: 0, lines: rowLines(usage[cm[1]].rows) }) : json(res, 404, { error: 'No log for this session yet' });
      try {
        const root = familyRoot(client, cm[1]);
        const family = await familyCost(client, root);
        const rootRow = family && ((await history(client)).find((r) => r.id === root) || live.get(root));
        const gid = effectiveGroup(client, cm[1]);
        const { agent, user } = recordedCost(client, cm[1]); // its times from its rows, as the Usage page shows them
        return json(res, 200, { ...sessionCost(file, cm[1], PRICING_FILE), agent, user, csv: USAGE_CSV,
          family: family && { ...family, rootId: root, rootTitle: rootRow?.title || 'Untitled' },
          group: gid ? await groupCost(client, gid) : null });
      }
      catch (e) { return json(res, 500, { error: 'Could not read prices or logs: ' + e.message }); }
    }
    if (req.method === 'GET' && p === '/api/plans') { // a desk's plans, for the board badges and the Plan section
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 404, { error: 'Unknown desk' });
      return json(res, 200, folderOn(client) ? await folderSummary(client) : plansSummary(client));
    }
    if (req.method === 'GET' && p === '/api/plan-folder') { // a plan folder desk (#180 step 3): ?key= one plan, else the whole tree
      const client = clientById(url.searchParams.get('client'));
      if (!client || !folderOn(client)) return json(res, 404, { error: 'This desk does not use a plan folder' });
      const t = await folderTree(client), key = url.searchParams.get('key');
      const holders = folderHolders(client, t);
      if (key) { const d = folderPlanDetail(t, key); return d ? json(res, 200, { ...d, holders: holders.filter((h) => h.key === key) }) : json(res, 404, { error: 'No such plan in the plan folder' }); }
      const { dirs, ...tree } = t;
      return json(res, 200, { ...tree, desk: client.name, root: client.planFolder?.path || '', marker: client.planFolder?.marker || '', holders });
    }
    if (req.method === 'GET' && p === '/plans') { // the Plan tree, in its own window
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(pageBody('plans.html'));
    }
    const plm = p.match(/^\/api\/plans\/(p-[a-z0-9]+)$/);
    if (plm && req.method === 'GET') {
      const client = clientById(url.searchParams.get('client'));
      const d = client && plansOn(client) && planDetail(client, plm[1]);
      return d ? json(res, 200, d) : json(res, 404, { error: 'No such plan on this desk' });
    }
    const fm = p.match(/^\/api\/sessions\/([\w-]+)\/files$/);
    if (fm && req.method === 'GET') {
      const client = clientById(url.searchParams.get('client') || live.get(fm[1])?.client || state.sessions[fm[1]]?.client);
      if (!client) return json(res, 404, { error: 'Unknown session' });
      return json(res, 200, await sessionFiles(client, fm[1]));
    }
    if (req.method === 'GET' && p === '/usage') { // the Usage page, in its own window
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(pageBody('usage.html'));
    }
    if (req.method === 'GET' && p === '/view') { // pop-out preview window
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(pageBody('view.html'));
    }
    if (req.method === 'GET' && (p === '/api/files/content' || p === '/api/files/raw')) { // a file on a session's list: text as JSON, or the file itself
      const client = clientById(url.searchParams.get('client'));
      const sessionId = url.searchParams.get('sessionId') || '';
      const want = url.searchParams.get('path') || '';
      if (!client || !/^[\w-]+$/.test(sessionId) || !want) return json(res, 400, { error: 'Bad request' });
      const full = path.resolve(want);
      const f = (await sessionFiles(client, sessionId)).find((x) => x.path.toLowerCase() === full.toLowerCase());
      if (!f) return json(res, 404, { error: "That file is not on this session's list" });
      if (!f.exists) return json(res, 404, { error: 'That file no longer exists' });
      const e = extOf(f.path), view = viewOf(e);
      if (p === '/api/files/raw') {
        if (!RAW_TYPE[e]) return json(res, 400, { error: 'This kind of file does not preview here' });
        // Sandboxed so an HTML page or SVG cannot run as Docket and reach its API (the PDF viewer does not work sandboxed).
        res.writeHead(200, { 'content-type': RAW_TYPE[e], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          ...(e === 'pdf' ? {} : { 'content-security-policy': 'sandbox allow-scripts allow-popups allow-forms' }) });
        return fs.createReadStream(f.path).on('error', () => res.end()).pipe(res);
      }
      if (!view) return json(res, 400, { error: 'This kind of file does not preview here' });
      const meta = { name: f.name, path: f.path, modified: f.modified, view, ext: e };
      if (view !== 'text') return json(res, 200, meta);
      if (f.size > 3e6) return json(res, 400, { error: 'That file is too large to preview' });
      return json(res, 200, { ...meta, markdown: /^(md|markdown)$/.test(e), text: fs.readFileSync(f.path, 'utf8') });
    }
    if (req.method === 'POST' && p === '/api/files/publish') { // Publish as artifact, on a file's menu
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client || !/^[\w-]+$/.test(b.sessionId || '') || typeof b.path !== 'string') return json(res, 400, { error: 'Bad request' });
      try { return json(res, 200, await publishArtifact(client, b.sessionId, b.path)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/api/files/open') {
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client || !/^[\w-]+$/.test(b.sessionId || '') || typeof b.path !== 'string') return json(res, 400, { error: 'Bad request' });
      try { await openFile(client, b.sessionId, b.path, b.how === 'folder' ? 'folder' : 'open'); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    const sfo = p.match(/^\/api\/sessions\/([\w-]+)\/folder\/open$/);
    if (sfo && req.method === 'POST') {
      const b = await readBody(req);
      const client = clientById(b.client);
      if (!client || typeof b.path !== 'string') return json(res, 400, { error: 'Bad request' });
      try { openFolder(client, sfo[1], b.path); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    const sc = p.match(/^\/api\/schedules\/([a-z0-9-]+)\/chat$/);
    if (sc && req.method === 'POST') {
      const d = scheduler.detail(sc[1]);
      if (!d) return json(res, 404, { error: 'Unknown schedule' });
      const client = clientById(d.client);
      const b = await readBody(req);
      let target = d.editorSessionId && live.get(d.editorSessionId);
      let context = '';
      if (!target || target.status === 'ended') {
        if (target) live.delete(target.id);
        if (d.editorSessionId && (await history(client)).some((r) => r.id === d.editorSessionId)) {
          target = startSession({ clientId: client.id, cwd: d.folder || client.folder, resumeId: d.editorSessionId, record: { editFor: d.id } });
          target.events = await loadTranscript(client, d.editorSessionId);
        } else {
          target = startSession({ clientId: client.id, cwd: d.folder || client.folder, title: `Editing schedule: ${d.title}`, record: { editFor: d.id } });
          scheduler.setEditor(d.id, target.id);
        }
        context = `(From the session portal: this chat is for editing the scheduled task "${d.title}", id ${d.id}. Read it with mcp__portal__get_schedule and save changes with mcp__portal__update_schedule. Change only what the person asks for. When a change is clear, save it and say in one or two lines what changed; when it is not clear, ask first. The person sees the saved schedule beside this chat.)`;
      }
      sendToSession(target, { text: b.text, attachments: b.attachments || [], context });
      return json(res, 200, summary(target));
    }
    if (sd && req.method === 'GET') { // one schedule with its instructions and recent runs
      const d = scheduler.detail(sd[1]);
      if (!d) return json(res, 404, { error: 'Unknown schedule' });
      const client = clientById(d.client);
      const hist = new Map(client ? (await history(client)).map((r) => [r.id, r]) : []);
      // archived: still opens, from the archive; gone: deleted (or never started), nothing to open
      d.runs = (d.runs || []).map((r) => {
        const l = live.get(r.sessionId), h = hist.get(r.sessionId);
        return { ...r, title: l?.title || h?.title || '', running: !!l && !['idle', 'ended'].includes(l.status), archived: !l && !!h?.archived, gone: !l && !h };
      });
      return json(res, 200, d);
    }
    const sm = p.match(/^\/api\/schedules\/([a-z0-9-]+)\/(run|enable|disable|update|delete)$/);
    if (sm && req.method === 'POST') {
      if (!scheduler.get(sm[1])) return json(res, 404, { error: 'Unknown schedule' });
      if (sm[2] === 'run') return json(res, 200, { sessionId: scheduler.runNow(sm[1]) });
      if (sm[2] === 'delete') return json(res, 200, { ok: scheduler.remove(sm[1]) });
      if (sm[2] === 'update') {
        try { return json(res, 200, scheduler.update(sm[1], await readBody(req))); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      scheduler.setEnabled(sm[1], sm[2] === 'enable');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/prs') {
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 400, { error: 'Unknown client' });
      const ids = (url.searchParams.get('ids') || '').split(',').filter((x) => /^[\w-]+$/.test(x)).slice(0, 120);
      return json(res, 200, await sessionLinks(client, ids)); // id -> { prs, tickets, branches }, for sessions with any
    }
    if (req.method === 'POST' && p === '/api/links') { // { id, ticket? | pr?, unlink }: the × on a ticket or pull request
      const b = await readBody(req);
      if (!/^[\w-]+$/.test(String(b.id || '')) || !(b.ticket || b.pr)) return json(res, 400, { error: 'Say which session, and which ticket or pull request' });
      changeLinks(b.id, { ticket: b.ticket && String(b.ticket), pr: b.pr && String(b.pr), unlink: !!b.unlink });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/ticket-seen') { // { ticket }: the user opened it from Details: a Jira key, AB#id or issue address
      const b = await readBody(req), t = String(b.ticket || ''), key = isTicketKey(t) || isAdoItemKey(t) ? t : parseIssueUrl(t)?.url;
      if (!key) return json(res, 400, { error: 'Say which ticket' });
      markSeen('ticketSeen', key);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/pr-seen') { // { pr }: the user opened a pull request from Details
      const b = await readBody(req), u = String(b.pr || '');
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/i.test(u) && !parseAdoPrUrl(u)) return json(res, 400, { error: 'Say which pull request' });
      markSeen('prSeen', talkKey(u));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/past') { // ?client=&words= or &id=: what ask_desk's question session sees
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 400, { error: 'Unknown client' });
      const sid = url.searchParams.get('id');
      return json(res, 200, { text: sid ? await readPast(client, sid) : await searchPast(client, (url.searchParams.get('words') || '').slice(0, 200)) });
    }
    if (req.method === 'GET' && p === '/api/search') { // ?client=&q=: sessions whose typed conversation holds q
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 400, { error: 'Unknown client' });
      const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
      return json(res, 200, await searchText(client, q));
    }
    if (req.method === 'GET' && p === '/api/sessions') {
      const client = clientById(url.searchParams.get('client'));
      if (!client) return json(res, 400, { error: 'Unknown client' });
      if (!reattachDone) await settledOr(reattached, 20000); // the sessions still working in the runner show as live, not cut off
      // The history can take seconds to build; the live rows are copied after it, so a turn that ended
      // meanwhile is not sent as still running (#647).
      const allHist = await history(client, url.searchParams.get('refresh') === '1');
      const liveRows = [...live.values()].filter((s) => s.client === client.id).map(summary);
      const ids = new Set(liveRows.map((r) => r.id));
      const hist = allHist.filter((r) => !ids.has(r.id));
      // The session list shows all runs of a schedule as one row under the schedule's name.
      const schedules = scheduler.list(client.id).map(({ id, title }) => ({ id, title }));
      return json(res, 200, { live: liveRows, history: hist, schedules, inbox: openInbox(state.inbox?.[client.id]), signinNeeds: signinNeeds(client.id) });
    }
    if (req.method === 'POST' && p === '/api/sessions') {
      const b = await readBody(req);
      const isGroup = (gid) => !!(clientById(b.client) && groupById(b.client, gid));
      const groupId = startGroup(b, isGroup);
      if (b.parentId) { // started by the person under a session: the same path as start_session
        const client = clientById(b.client);
        if (!client) return json(res, 400, { error: 'Unknown client' });
        const known = live.get(b.parentId) || (await history(client)).find((r) => r.id === b.parentId);
        if (!known || known.client && known.client !== client.id) return json(res, 400, { error: "That session is not one of this desk's sessions" });
        if (wasDeleted(b.parentId)) return json(res, 410, { error: 'That session was deleted' });
        const child = startChild({ id: b.parentId, client: client.id, cwd: known.cwd }, { title: b.title, prompt: b.text, cwd: b.cwd || known.cwd, attachments: b.attachments || [], settings: b.settings || {}, byUser: true, engine: b.engine || undefined, note: b.context || '', groupId });
        touchSession(client.id, child.id);
        return json(res, 200, summary(child));
      }
      const group = groupId && groupById(b.client, groupId);
      const cwd = String(b.cwd || '').trim() || group?.folder || '';
      if (cwd) try { checkFolder(cwd); } catch (e) { return json(res, 400, { error: e.message }); }
      const grouped = !!group;
      let s;
      try { s = startSession({ clientId: b.client, cwd: cwd || undefined, title: b.title, settings: b.settings || {}, engine: b.engine || undefined, record: grouped ? { groupId } : {} }); }
      catch (e) { return json(res, 400, { error: e.message }); }
      if (b.title) state.sessions[s.id].titleBy = 'you';
      if (grouped) groupChanged(s.client);
      touchSession(s.client, s.id);
      sendToSession(s, b);
      return json(res, 200, summary(s));
    }
    if (await profileRoutes(req, res, url, p) !== false) return;
    const m = p.match(/^\/api\/sessions\/([\w-]+)\/(events|send|rename|interrupt|seen|end|archive|settings|permission|offer|cross|group|parent|moveto|auto-group|title-suggestion|unread|delete|task-done|reload|use-plan|summary|plan-offer|looked)$/);
    if (m) {
      const [, id, action] = m;
      if (!reattachDone && !live.has(id) && state.sessions[id]?.running) await settledOr(reattached, 20000); // it may be on its way back
      const s = live.get(id);
      const client = clientById(url.searchParams.get('client') || s?.client || state.sessions[id]?.client);
      if (action === 'events') {
        // When the person last looked at it, and where the line went then, for the New since you last looked line (#672)
        const look = { seenAt: state.sessions[id]?.seenAt || null, lineAt: state.sessions[id]?.lineAt || null };
        if (s) { repairTasks(s); return json(res, 200, { session: summary(s), events: s.events, tasks: [...s.tasks.values()], look }); }
        if (!client) return json(res, 404, { error: 'Unknown session' });
        const away = await outsideRow(client, id);
        if (away) return json(res, 200, { session: null, events: [{ k: 'note', text: outsideNote(away) }], tasks: [], cutOff: false });
        const events = await loadTranscript(client, id);
        // A conversation that ends on a command or on the user's message, with no reply after, was cut off.
        const last = [...events].reverse().find((e) => ['user', 'text', 'tool'].includes(e.k));
        return json(res, 200, { session: null, events, tasks: [], cutOff: !!last && last.k !== 'text', look });
      }
      const b = req.method === 'POST' ? await readBody(req) : {};
      if (wasDeleted(id) && !s) return json(res, 410, { error: 'This session was deleted' });
      if (action === 'send') {
        let target = s;
        if (!target || target.status === 'ended') {
          if (!client) return json(res, 404, { error: 'Unknown session' });
          const away = !target && await outsideRow(client, id);
          if (away) return json(res, 400, { error: outsideNote(away) });
          if (target) live.delete(id);
          const row = (await history(client)).find((r) => r.id === id);
          target = startSession({ clientId: client.id, cwd: b.cwd || row?.cwd, title: row?.title, resumeId: id, settings: b.settings || {} });
          if (s) target.events = s.events.slice();
          else target.events = await loadTranscript(client, id);
          addEvent(target, { k: 'note', text: 'Resumed' });
        }
        if (isArchived(clientById(target.client), id)) setArchived(target.client, id, false);
        touchSession(target.client, id);
        sendToSession(target, b);
        return json(res, 200, summary(target));
      }
      if (action === 'auto-group' && req.method === 'POST') {
        if (!client) return json(res, 404, { error: 'Unknown session' });
        const top = groupOwner(client, id);
        if (effectiveGroup(client, top)) return json(res, 400, { error: 'This session is already in a group' });
        try { return json(res, 200, await suggestGroup(client, top)); }
        catch (e) { return json(res, 502, { error: `Could not read the session: ${e.message}` }); }
      }
      if (action === 'use-plan' && req.method === 'POST') { // { card }: Use a plan for this work (the session menu, or the card's button)
        if (!client) return json(res, 404, { error: 'Unknown session' });
        try { await usePlan(client, id, b.card || ''); return json(res, 200, { ok: true }); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (action === 'summary' && req.method === 'POST') { // { mode: 'top' | 'deep' }: the Summary button in the send box
        if (!client) return json(res, 404, { error: 'Unknown session' });
        try { await sendSummary(client, id, b.mode === 'deep' ? 'deep' : 'top'); return json(res, 200, { ok: true }); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (action === 'plan-offer' && req.method === 'POST') { // { card }: Not now on the card that offers a plan
        try { dismissPlanOffer(id, b.card); return json(res, 200, { ok: true }); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (action === 'group') {
        if (!client) return json(res, 404, { error: 'Unknown session' });
        const gid = b.groupId;
        if (gid && !groupById(client.id, gid)) return json(res, 400, { error: 'Unknown group' });
        const rec = (state.sessions[id] ||= { client: client.id });
        if (gid === null || gid === undefined) delete rec.groupId; else rec.groupId = gid;
        groupChanged(client.id);
        if (s) pushSession(s);
        return json(res, 200, { ok: true, groupId: effectiveGroup(client, id) });
      }
      if (action === 'parent' && req.method === 'POST') { // { parentId }: a session id, or null for the top level
        if (!client) return json(res, 404, { error: 'Unknown session' });
        try { return json(res, 200, { ok: true, ...(await setParent(client, id, b.parentId)) }); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (action === 'moveto' && req.method === 'POST') { // { parentId, groupId }: a drag in the session list, family and all
        if (!client) return json(res, 404, { error: 'Unknown session' });
        if (b.groupId && !groupById(client.id, b.groupId)) return json(res, 400, { error: 'Unknown group' });
        try { return json(res, 200, { ok: true, ...(await moveFamily(client, id, b.parentId || null, b.groupId || '')) }); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (action === 'archive') {
        if (!client) return json(res, 404, { error: 'Unknown session' });
        const ids = [id, ...(Array.isArray(b.alsoIds) ? b.alsoIds.filter((x) => /^[\w-]+$/.test(x)) : [])];
        for (const x of ids) archiveSession(client, x, !!b.archived);
        return json(res, 200, { ok: true });
      }
      if (action === 'delete' && req.method === 'POST') {
        if (!client) return json(res, 404, { error: 'Unknown session' });
        await deleteSession(client, id);
        return json(res, 200, { ok: true });
      }
      if (action === 'rename') {
        const title = String(b.title || '').trim().slice(0, 120);
        if (!title || !client) return json(res, 400, { error: 'Title required' });
        setTitle(client, id, title, 'you');
        // A run of a schedule is listed under the schedule's name, so renaming it from the page renames the
        // schedule: later runs start with the new name. A rename Claude makes inside a run does not come here.
        const sid = state.sessions[id]?.scheduleId;
        if (sid && scheduler.get(sid)) scheduler.update(sid, { title });
        const tev = b.suggestion && titleCard(s, id, b.suggestion);
        if (tev) { tev.state = 'applied'; saveState(); updateCard({ id }, tev); }
        return json(res, 200, { ok: true });
      }
      if (action === 'title-suggestion') {
        const ev = titleCard(s, id, b.suggestion);
        if (ev && ev.state === 'open') { ev.state = 'dismissed'; saveState(); updateCard({ id }, ev); }
        return json(res, 200, { ok: true });
      }
      // The person is looking at it: what is on screen now is not new next time. lineAt is where this visit's line is,
      // kept for a page reload in the middle of the visit (#672).
      if (action === 'looked') {
        if (!client) return json(res, 404, { error: 'Unknown session' });
        const rec = state.sessions[id] ||= { client: client.id };
        rec.seenAt = Date.now();
        if (Number.isFinite(b.lineAt)) rec.lineAt = b.lineAt; else delete rec.lineAt;
        saveState();
        return json(res, 200, { ok: true });
      }
      // Mark unread: puts back the orange "needs you" dot, the way it was before you looked
      if (action === 'unread') {
        if (!client) return json(res, 404, { error: 'Unknown session' });
        // Marked from the open chat: the next open draws the New line at the message it was scrolled to (#672)
        if (Number.isFinite(b.at)) { const rec = state.sessions[id] ||= { client: client.id }; rec.seenAt = b.at - 1; delete rec.lineAt; saveState(); }
        // It shows the reason it had before it was read (#771); the log still says Mark unread did it.
        const back = markUnreadReason(state.sessions[id]?.readWhy);
        if (s) {
          if (['running', 'starting'].includes(s.status)) return json(res, 400, { error: 'It is working right now' });
          if (!s.unread) { setUnread(s, 'mark-unread'); s.unreadWhy = back.why; s.unreadSaid = back.said; }
          s.keepPlace = true; pushSession(s);
        } else {
          const rec = state.sessions[id] ||= { client: client.id };
          if (!rec.waiting) { rec.waitingWhy = back; saveState(); }
          setSavedWaiting(id, true, 'mark unread'); historyCache.delete(client.id);
          broadcast({ t: 'waiting', id, client: client.id, waiting: true, why: rec.waitingWhy?.why || null, said: rec.waitingWhy?.said || null });
        }
        return json(res, 200, { ok: true });
      }
      if (action === 'seen' && !s) {
        if (state.sessions[id]?.waiting) {
          logSeen(id, null, b);
          const rec = state.sessions[id], kept = keptReason(rec.waitingWhy?.why, rec.waitingWhy?.said);
          if (kept) rec.readWhy = kept; // Mark unread brings this tag back (#771); setSavedWaiting saves it
        }
        if (setSavedWaiting(id, false, `seen: why ${b.why || 'not given'}`)) historyCache.delete(client?.id);
        // A session Claude Desktop ran: remember when it was opened, so only a newer Desktop reply turns it orange again.
        const file = client && transcriptFiles(client).get(id);
        if (file && transcriptTail(file).desktop) {
          if (desktopWaits(id, file)) logSeen(id, null, b);
          state.sessions[id] = { ...(state.sessions[id] || { client: client.id }), seenAt: Date.now() };
          saveState(); historyCache.delete(client.id);
          try { desktopSeenSets.set(client.id, desktopSet(client)); } catch {}
        }
        return json(res, 200, { ok: true });
      }
      if (action === 'cross') { // the approval card for a crossing into another company
        const crossId = String(b.crossId || '');
        if (answerCrossing(s, crossId, b.send === true)) return json(res, 200, { ok: true });
        if (expireCrossing(id, crossId)) return json(res, 409, { error: 'That request is no longer waiting, so nothing was sent. Ask again in the chat.' });
        return json(res, 404, { error: 'That request is no longer waiting' });
      }
      if (action === 'offer') {
        const offerId = String(b.offerId || '');
        if (s && answerOffer(s, offerId, b.choice)) return json(res, 200, { ok: true });
        if (client && await answerOfferLate(client, id, offerId, b.choice)) return json(res, 200, { ok: true });
        return json(res, 404, { error: 'That offer is no longer waiting' });
      }
      if (!s) return json(res, 404, { error: 'Session is not running' });
      if (action === 'settings') { // works on a running session now, or is used when a saved one resumes
        const ch = cleanSettings(b);
        if (!client) return json(res, 404, { error: 'Unknown session' });
        state.sessions[id] = { ...(state.sessions[id] || { client: client.id }), settings: { ...(state.sessions[id]?.settings || {}), ...ch } };
        saveState();
        if (s) {
          s.settings = { ...s.settings, ...ch };
          try {
            if (ch.model !== undefined) {
              if (ch.model === 'shift') { s.gear = shiftModel(s, client); state.sessions[id].gear = s.gear; saveState(); await s.query.setModel(modelFor(client, s.engine, s.gear)); s.model = s.gear; s.shiftRulesPending = true; }
              else await s.query.setModel(modelFor(client, s.engine, ch.model) || undefined);
            }
            if (ch.effort !== undefined) await s.query.applyFlagSettings({ effortLevel: ch.effort || null });
            if (ch.permissionMode) await s.query.setPermissionMode(ch.permissionMode);
          } catch (e) { return json(res, 400, { error: e.message }); }
          pushSession(s);
        }
        return json(res, 200, { ok: true, settings: s?.settings || state.sessions[id].settings });
      }
      if (action === 'permission') {
        if (!s || !answerPermission(s, String(b.reqId || ''), !!b.allow, !!b.always, b.answers)) return json(res, 404, { error: 'That question is no longer waiting' });
        return json(res, 200, { ok: true });
      }
      // A job the person says is over (its ending was never heard): it stops holding the turn now.
      if (action === 'task-done') {
        const t = s?.tasks.get(String(b.task || ''));
        if (!t || t.status !== 'running') return json(res, 404, { error: 'That job is no longer running' });
        upsertTask(s, t.id, markedDone());
        releaseHold(s);
        return json(res, 200, { ok: true });
      }
      // Reload: start its process again to load changed config, now if it is idle, else when its turn ends.
      if (action === 'reload') { if (!s) return json(res, 404, { error: 'That session is not running' }); s.reloadWanted = true; return json(res, 200, { decision: checkConfig(s) }); }
      if (action === 'interrupt') { await s.query.interrupt().catch(() => {}); return json(res, 200, { ok: true }); }
      if (action === 'seen') {
        if (s.unread) { // Mark unread brings this tag back (#771)
          logSeen(id, s, b);
          const kept = keptReason(s.unreadWhy, s.unreadSaid), rec = state.sessions[id];
          if (kept && rec) { rec.readWhy = kept; saveState(); }
        }
        s.unread = false; s.kidNews = false; pushSession(s); return json(res, 200, { ok: true }); }
      if (action === 'end') {
        s.input.close(); s.query.close(); live.delete(id); markRunning(id, false);
        historyCache.delete(s.client);
        broadcast({ t: 'ended', id, client: s.client });
        return json(res, 200, { ok: true });
      }
    }
    // Backstop: a route that answered and still fell through here is a bug, so record which one instead of answering twice.
    if (res.headersSent) return logEvent('answered twice (a route fell through)', `${req.method} ${p}`);
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    // If the answer had already gone out, the error would otherwise be lost behind "headers already sent".
    if (res.headersSent) { logEvent('error after answering', `${req.method} ${req.url}\n${err?.stack || err}`); if (!res.writableEnded) res.end(); return; }
    json(res, 500, { error: err.message });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!trusted(req) || !req.headers.origin) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { sockets.add(ws); ws.on('close', () => sockets.delete(ws)); ws.send(JSON.stringify({ t: 'version', page: pageVersion() })); ws.send(JSON.stringify({ t: 'remote-features', on: remoteOn() })); });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') { console.log(`The portal is already running at http://localhost:${PORT}`); process.exit(0); }
  throw err;
});
server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => {
  logEvent(`started: http://localhost:${PORT}`);
  remoteShownAfterRestart();
  startupAtStart().catch(() => {});
  reattached = reattachUntilDone();
  // The restart check: paused automatically before a shutdown, so carry on now that Docket is back.
  reattached.then(findCutOffs);
  setTimeout(() => fillAllTouches(), 15000); // once per desk, after the start is over
  setTimeout(() => checkAllDesks(), 20000); // the Desk check, so it is fresh after every update
  reattached.then(() => { if (autoPauseOn() && autoPaused(state.paused)) setTimeout(() => resumeAll('restart').catch((e) => logEvent('resume after restart failed', e.message)), 10000); });
});
