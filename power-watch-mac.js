// Tells Docket when the Mac is about to sleep or power off, and when it wakes.
// Run with: osascript -l JavaScript power-watch-mac.js <parent pid>. Started by server.mjs; prints one word
// per line (to stderr, where osascript's console.log goes): sleep, wake or shutdown. It ends by itself when
// the Docket app that started it is gone.
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  const parent = Number(argv[0] || 0);
  const say = (word) => console.log(word);
  const center = $.NSWorkspace.sharedWorkspace.notificationCenter;
  const watch = (name, word) => center.addObserverForNameObjectQueueUsingBlock(name, $(), $.NSOperationQueue.mainQueue, () => say(word));
  watch('NSWorkspaceWillSleepNotification', 'sleep');
  watch('NSWorkspaceDidWakeNotification', 'wake');
  watch('NSWorkspaceWillPowerOffNotification', 'shutdown');
  say('ready');
  const loop = $.NSRunLoop.currentRunLoop;
  for (;;) {
    loop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(10));
    if (parent && !alive(parent)) return;
  }
}
function alive(pid) {
  const app = Application.currentApplication(); app.includeStandardAdditions = true;
  try { app.doShellScript(`kill -0 ${pid}`); return true; } catch { return false; }
}
