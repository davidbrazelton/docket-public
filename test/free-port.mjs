// Ports the computer says are free, for the tests that start a throwaway Docket. Fixed ports are not safe: several
// sessions on one computer run `npm test` at the same time, and a run that stops "its" runner by a fixed port would
// stop another run's, cutting off its turns (#582, #585). All the ports asked for are held open together until each
// is known, so one call never hands out the same port twice.
import net from 'node:net';

export const freePorts = async (n) => {
  const servers = await Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const srv = net.createServer().once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  })));
  const ports = servers.map((s) => s.address().port);
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  return ports;
};
