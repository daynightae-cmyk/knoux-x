#!/usr/bin/env node

/**
 * Backward-compatible KNOUX icon generation entry point.
 *
 * The historical implementation generated temporary placeholder icons and
 * could overwrite the committed production icon system if invoked manually
 * through `npm run icons:generate`. Keep the public script name for existing
 * tooling, but delegate all generation to the canonical production generator.
 */

require('./generate-icon-assets.cjs');
