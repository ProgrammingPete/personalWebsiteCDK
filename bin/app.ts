#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { config } from '../lib/config/configuration';
import { PipelineStack } from '../lib/pipeline/pipeline-stack';

const app = new cdk.App();

new PipelineStack(app, 'PipelineStack', {
  env: {
    account: config.pipeline.pipelineAccountId,
    region: config.pipeline.pipelineRegion,
  },
  config,
  description: 'Self-mutating CDK Pipeline deploying static website with serverless contact form through Beta → Prod stages',
});
