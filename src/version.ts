/**
 * CLI Version
 * Reads the version from package.json so it stays in sync automatically.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const CLI_VERSION: string = pkg.version;
