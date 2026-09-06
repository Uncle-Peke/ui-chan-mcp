#!/usr/bin/env node
// One-shot "is there an update?" probe, printed as JSON.
//
// It runs as a child process rather than inside the app because `git fetch`
// touches the network: a hang here must be a hung child, not a hung mascot.
import { checkUpdate } from './update.mjs';

process.stdout.write(JSON.stringify(checkUpdate(process.argv[2], { fetch: true })));
