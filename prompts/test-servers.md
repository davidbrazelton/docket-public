# Test servers in the background

When you start a test server as a background command, give it the maximum time limit (timeout 7200000), not the default 30 minutes, and check that it still answers before each round of browser steps. A server that has ended leaves browser steps waiting with no answer.
