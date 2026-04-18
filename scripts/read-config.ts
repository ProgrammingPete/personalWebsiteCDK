#!/usr/bin/env npx ts-node
/**
 * Reads the Configuration Registry and outputs account/region values as
 * shell-friendly KEY=VALUE pairs. Used by bootstrap.sh to avoid duplicating
 * configuration values.
 *
 * Usage:
 *   npx ts-node scripts/read-config.ts
 */
import { config } from '../lib/config/configuration';

const lines = [
  `PIPELINE_ACCOUNT=${config.pipeline.pipelineAccountId}`,
  `PIPELINE_REGION=${config.pipeline.pipelineRegion}`,
  `BETA_ACCOUNT=${config.stages.beta.accountId}`,
  `BETA_REGION=${config.stages.beta.region}`,
  `PROD_ACCOUNT=${config.stages.prod.accountId}`,
  `PROD_REGION=${config.stages.prod.region}`,
];

process.stdout.write(lines.join('\n') + '\n');
