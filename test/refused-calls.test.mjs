// Refused tool calls (#1235): refusal() in hook-notes.mjs reads each kind of refusal from the call's result, with the
// texts Claude Code sends (from its program and from saved transcripts; names made up).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refusal, refusalNoted } from '../hook-notes.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUTO = "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Interfere With Workloads]. If you have other tasks that don't depend on this action, continue working on those. IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, e.g. using head instead of cat. But you *should not* attempt to work around this denial in malicious ways.";

test('the Auto mode check, with each reason', () => {
  assert.deepEqual(refusal(AUTO, true), { source: 'auto', reason: 'Interfere With Workloads', tag: 'Turned down by Auto mode: Interfere With Workloads' });
  assert.equal(refusal(AUTO.replace('Interfere With Workloads', 'Sensitive Information Leakage'), true).reason, 'Sensitive Information Leakage');
  assert.equal(refusal(AUTO.replace('Interfere With Workloads', 'Undermining Oversight'), true).reason, 'Undermining Oversight');
  // An older wording, without the brackets.
  assert.equal(refusal('Permission for this action was denied by the Claude Code auto mode classifier. Reason: Deletes shared files. Try something else.', true).reason, 'Deletes shared files');
  // The meta names the source when the message came live.
  assert.equal(refusal('Denied.', true, { id: 't', permission_decision: { decision: 'reject', source: 'session', reason_type: 'classifier' } }).source, 'auto');
});

test('a deny rule in the settings', () => {
  assert.deepEqual(refusal('Permission to use Bash with command rm -rf build has been denied.', true), { source: 'rule', reason: 'Bash with command rm -rf build', tag: 'Blocked by a settings rule: Bash with command rm -rf build' });
  assert.equal(refusal('Permission to use WebFetch has been denied.', true).reason, 'WebFetch');
  assert.equal(refusal('Permission to edit C:/Work/acme/.env has been denied.', true).reason, 'edit C:/Work/acme/.env');
  assert.equal(refusal('Permission to read /home/sam/.ssh/id_rsa has been denied.', true).reason, 'read /home/sam/.ssh/id_rsa');
  assert.equal(refusal('Permission to use Bash has been denied by your rule Bash(curl:*).', true).reason, 'Bash(curl:*)');
  assert.equal(refusal('<tool_use_error>Permission to use Bash with command git push has been denied.</tool_use_error>', true).source, 'rule');
  assert.equal(refusal('Error', true, { permission_decision: { decision: 'reject', source: 'policySettings', reason_type: 'rule' } }).source, 'rule');
});

test("Don't ask mode, a prompt that could not be shown, and the person or the autopilot saying no", () => {
  assert.equal(refusal("Permission to use Bash has been denied because Claude Code is running in don't ask mode. If you need it, ask.", true).source, 'dontAsk', "Don't ask before the rule pattern");
  const p = refusal("Claude requested permissions to use Bash, but you haven't granted it yet.", true);
  assert.deepEqual(p, { source: 'prompt', reason: 'Bash', tag: 'Needed a permission that could not be asked for: Bash' });
  assert.equal(refusal("Claude requested permissions to write to C:/Work/acme/a.txt, but you haven't granted it yet.", true).reason, 'write to C:/Work/acme/a.txt');
  const no = refusal("The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.", true);
  assert.deepEqual(no, { source: 'person', reason: 'declined', tag: 'Declined by you' });
  assert.equal(refusal('The user declined this.', true).source, 'person', "Docket's own permission card");
  assert.equal(refusal("Docket's autopilot declined this, under the rules the user set for it.", true).source, 'autopilot');
  assert.equal(refusalNoted(no), false, 'the person said no themselves: no extra line in the chat');
  assert.equal(refusalNoted(refusal(AUTO, true)), true);
});

test('hooks, the sandbox and other refusals', () => {
  assert.equal(refusal('PreToolUse:Bash hook error: Bash is off by policy', true).tag, 'Stopped by a hook: Bash is off by policy');
  assert.equal(refusal('Permission for this action has been denied. Reason: The check could not run. If it keeps failing, continue with other tasks.', true).tag, 'Refused: The check could not run');
  assert.equal(refusal('Exit code 1\nsh: /etc/hosts: Operation not permitted', true, { permission_decision: { decision: 'reject', source: 'session', reason_type: 'sandboxOverride' } }).tag, 'Blocked by the sandbox: Exit code 1');
});

test('an ordinary failed step is not a refusal', () => {
  for (const t of ['Exit code 1\nerror: failed to delete build: Permission denied', 'File access denied: C:/Temp/a.png is outside allowed roots.',
    '<tool_use_error>Blocked: standalone sleep 40. To wait for a condition, use Monitor.</tool_use_error>', 'Cannot establish a connection to the service control manager: Access is denied.'])
    assert.equal(refusal(t, true), null, t);
  assert.equal(refusal(AUTO, false), null, 'not an error result');
  assert.equal(refusal('ok', false, { permission_decision: { decision: 'allow', source: 'rule', reason_type: 'rule' } }), null, 'an allowed call');
});

test('the page shows the step tag, the chat line, the Done count, and the switch to Ask', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /case 'refused': \{/);
  assert.match(page, /ev\.source === 'auto' && S\.live\[S\.selected\]\?\.settings\?\.permissionMode === 'auto'/, 'the button only while the session is in Auto');
  assert.match(page, /\{ permissionMode: 'default' \}/, 'it changes this session only, not the desk default (no changeSetting)');
  assert.match(page, /step\$\{ev\.refused > 1 \? 's' : ''\} refused/);
  assert.match(fs.readFileSync(path.join(ROOT, 'prompts', 'turns.md'), 'utf8'), /When something refuses one of your tool calls[^\n]*say so in your reply/);
});
