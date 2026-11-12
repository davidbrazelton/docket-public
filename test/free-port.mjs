// Ports the computer says are free, for the tests that start a throwaway Docket. Fixed ports are not safe: several
// sessions on one computer run `npm test` at the same time, and a run that stops "its" runner by a fixed port would
// stop another run's, cutting off its turns (#582, #585). All the ports asked for are held open together until each
// is known, so one call never hands out the same port twice.
import net from 'node:net';
import { execFileSync } from 'node:child_process';

export const freePorts = async (n) => {
  const servers = await Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const srv = net.createServer().once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  })));
  const ports = servers.map((s) => s.address().port);
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  return ports;
};

// The environment every throwaway Docket in the tests starts with. PORTAL_TEST_RUN leaves out the helpers no test uses
// (the private browser's server, the power watch, the check of how Docket starts): with every test file starting a
// Docket at once they took the whole computer, and tests timed out waiting for replies. DOCKET_NO_USAGE keeps the
// first-start usage stats window from opening over a page a test drives: it opened at a moment that depended on how
// busy the computer was, and once it stayed open it blocked every click after it.
export const TEST_DOCKET_ENV = { PORTAL_TEST_RUN: '1', DOCKET_NO_USAGE: '1' };

// Stops a test Docket's runner together with what it started (the stand-in agents), at once. Killing the runner
// alone leaves them to notice their input closed, and until they do they keep the test's temp folder in use, so
// removing it fails with EPERM when many test files run at once.
export const stopTree = (pid) => {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid);
  } catch {}
};
