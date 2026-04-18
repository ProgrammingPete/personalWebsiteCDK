# Implementation Plan: Open-Source Multi-Region Pipeline

## Overview

This plan implements an open-source, multi-account AWS CDK pipeline deploying a static website (S3 + CloudFront) with a serverless contact form backend (Lambda + API Gateway + SES). The implementation uses only public `aws-cdk-lib` constructs, sources from three GitHub repositories, and deploys through Beta → Prod stages in us-east-2. Tasks are ordered so each builds on the previous, starting with project scaffolding and configuration, then individual stacks, then pipeline wiring, and finally testing and scripts.

## Tasks

- [x] 1. Initialize project structure and dependencies
  - [x] 1.1 Create project scaffolding with package.json, tsconfig.json, cdk.json, and .gitignore
    - Initialize a new CDK TypeScript project in the `personalWebsiteCDK/` directory structure
    - `package.json` must include `aws-cdk-lib`, `constructs`, `fast-check` (dev), `@types/jest`, `ts-jest`, `jest`, `typescript` dependencies
    - `cdk.json` must set `app` to `npx ts-node bin/app.ts`
    - `tsconfig.json` must target ES2020 with strict mode enabled
    - _Requirements: 1.1, 20.1_

  - [x] 1.2 Create Configuration Registry types (`lib/config/configuration.types.ts`)
    - Define all TypeScript interfaces: `ApplicationConfig`, `PipelineConfig`, `StageConfig`, `WebsiteConfig`, `RepositoryConfig`, `AlarmThresholds`, `LambdaConfig`, `BuildConfig`, `TimeWindowConfig`, `DnsProvider` type
    - Types must support per-stage alarm thresholds (high-severity and low-severity), `dnsProvider` flag (`route53` | `external`), feature flags, and bake time
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 14.1_

  - [x] 1.3 Create Configuration Registry values (`lib/config/configuration.ts`)
    - Export a `config` object of type `ApplicationConfig` with placeholder values for pipeline account, three repositories (CDK, Lambda, Frontend), build config, lambda config, time window config, and Beta/Prod stage configs
    - Include alarm thresholds for both severity tiers, `PriceClass_100`, `BUILD_GENERAL1_SMALL`, ARM64 architecture, and external DNS provider defaults
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 22.1, 22.2, 22.6_

- [x] 2. Implement DnsStack and CertificateStack (foundational stacks)
  - [x] 2.1 Implement DnsStack (`lib/stacks/dns-stack.ts`)
    - Create a Route 53 public hosted zone for the stage subdomain (e.g., `beta.example.com`) in the pipeline account
    - When `dnsProvider` is `route53`: create NS delegation records in the root hosted zone
    - When `dnsProvider` is `external`: output NS records via `CfnOutput` for manual external DNS configuration
    - Export the hosted zone ID and hosted zone for use by CertificateStack, WebsiteStack, and ApiStack
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x] 2.2 Implement CertificateStack (`lib/stacks/certificate-stack.ts`)
    - Create an ACM certificate in `us-east-1` for the website domain and www subdomain (for CloudFront)
    - Create a separate ACM certificate in `us-east-2` for the API Gateway custom domain
    - Both certificates must use DNS validation against the stage Route 53 hosted zone from DnsStack
    - Export certificate ARNs for WebsiteStack and ApiStack consumption
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 2.3 Write CDK assertion tests for DnsStack and CertificateStack
    - Test Route 53 hosted zone creation for stage subdomain
    - Test NS delegation records when `dnsProvider` is `route53`
    - Test `CfnOutput` NS records when `dnsProvider` is `external`
    - Test ACM certificate in us-east-1 for CloudFront domain with DNS validation
    - Test ACM certificate in us-east-2 for API Gateway domain with DNS validation
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [x] 3. Implement WebsiteStack (S3 + CloudFront)
  - [x] 3.1 Implement WebsiteStack (`lib/stacks/website-stack.ts`)
    - Create S3 bucket with `blockPublicAccess` set to block all, versioning enabled, and lifecycle rules (expire incomplete multipart uploads after 1 day, transition non-current versions after 30 days)
    - Create CloudFront Origin Access Control (OAC) with SigV4 signing for S3 origin
    - Create CloudFront distribution with: HTTPS redirect, custom domain + www subdomain, ACM cert from CertificateStack, `PriceClass_100` (configurable), default root object `index.html`, custom error responses routing 403/404 to `/index.html` with 200 status, minimum TTL of 86400 for static assets
    - Create S3 bucket policy allowing `s3:GetObject` only from CloudFront OAC
    - Create `BucketDeployment` to upload frontend assets with CloudFront cache invalidation (`/*`)
    - Create Route 53 A records in the stage hosted zone aliased to CloudFront for domain and www subdomain
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 14.4, 21.2, 21.3, 22.1, 22.4, 22.5, 22.7_

  - [x] 3.2 Write CDK assertion tests for WebsiteStack
    - Test S3 bucket has blockPublicAccess all, versioning enabled, lifecycle rules
    - Test CloudFront distribution has HTTPS redirect, OAC, custom error responses, PriceClass_100, default root object
    - Test S3 bucket policy allows only CloudFront OAC
    - Test BucketDeployment with cache invalidation
    - Test Route 53 A records for domain and www subdomain
    - Test no VPC, NAT, or EIP resources exist in the stack
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 22.4, 22.5, 22.7_

- [x] 4. Implement ApiStack (API Gateway + Lambda + SES)
  - [x] 4.1 Implement ApiStack (`lib/stacks/api-stack.ts`)
    - Create Lambda function with Java 21 runtime, ARM64 architecture, 512 MB memory, 30s timeout (all configurable via `LambdaConfig`), code from `lambda.Code.fromAsset()` referencing the Lambda build output
    - Create IAM execution role with least-privilege: only `ses:SendEmail`, `ses:SendRawEmail` to the SES identity, and CloudWatch Logs permissions
    - Create SES email identity for the recipient email from Configuration Registry
    - Create API Gateway HTTP API with `POST /contact` route using Lambda proxy integration
    - Configure CORS allowing the CloudFront custom domain origin with appropriate headers and methods
    - Create API Gateway custom domain (e.g., `api.beta.example.com`) with ACM cert from CertificateStack (us-east-2)
    - Create Route 53 A record aliased to the API Gateway custom domain endpoint
    - Enable API Gateway access logging to CloudWatch Logs
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5, 21.1, 22.2_

  - [x] 4.2 Write CDK assertion tests for ApiStack
    - Test Lambda function has Java 21 runtime, ARM64, 512 MB memory, 30s timeout
    - Test Lambda IAM role has only ses:SendEmail, ses:SendRawEmail, and logs permissions
    - Test SES identity created for recipient email
    - Test API Gateway HTTP API with POST /contact route
    - Test CORS configuration allows CloudFront domain
    - Test API Gateway custom domain with ACM certificate
    - Test Route 53 A record for API subdomain
    - Test access logging enabled
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5, 21.1, 22.2_

- [x] 5. Checkpoint - Verify foundational stacks compile and pass tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement NotificationStack and MonitoringStack
  - [x] 6.1 Implement NotificationStack (`lib/stacks/notification-stack.ts`)
    - Create SNS topic in us-east-2 for alarm and pipeline notifications
    - Support HTTPS endpoint subscriptions for PagerDuty, OpsGenie, Slack, or Discord webhooks
    - Export the SNS topic for use by MonitoringStack and PipelineStack
    - _Requirements: 17.1, 17.3_

  - [x] 6.2 Implement MonitoringStack (`lib/stacks/monitoring-stack.ts`)
    - Create CloudWatch dashboard for CloudFront metrics: request count, 4xx rate, 5xx rate, total error rate, bytes downloaded, cache hit ratio
    - Create CloudWatch dashboard for Lambda metrics: invocation count, error count, duration p50/p90, throttle count, concurrent executions
    - Create CloudWatch dashboard for API Gateway metrics: request count, 4xx count, 5xx count, latency p50/p90, integration latency
    - Create individual CloudWatch alarms with thresholds from Configuration Registry: CloudFront 4xx/5xx rates, Lambda error rate and duration p90, API Gateway 5xx rate and latency p90
    - Support two severity tiers (high and low) with different thresholds and evaluation periods
    - Create Composite Alarm aggregating all child alarms into a single rollback signal
    - Configure SNS alarm actions on all Prod alarms to publish to the notification topic
    - _Requirements: 15.1, 15.2, 15.3, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 17.2, 17.4_

  - [x] 6.3 Write CDK assertion tests for NotificationStack and MonitoringStack
    - Test SNS topic creation with HTTPS subscription support
    - Test three CloudWatch dashboards exist (CloudFront, Lambda, API Gateway)
    - Test individual alarms with correct thresholds from config (both severity tiers)
    - Test Composite Alarm aggregates child alarms
    - Test SNS alarm actions configured on Prod alarms
    - _Requirements: 15.1, 15.2, 15.3, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 17.1, 17.2, 17.3, 17.4_

- [-] 7. Implement WebsiteStage and TimeWindowBlocker
  - [x] 7.1 Implement WebsiteStage (`lib/stages/website-stage.ts`)
    - Create a CDK `Stage` that instantiates all stacks: CertificateStack, DnsStack, WebsiteStack, ApiStack, MonitoringStack, NotificationStack
    - Pass inter-stack dependencies (certificate ARNs, hosted zone IDs, distribution, Lambda function, HTTP API, SNS topic)
    - Accept `WebsiteStageProps` with stage config, pipeline config, lambda config, and build artifact paths
    - _Requirements: 6.1, 6.4_

  - [x] 7.2 Implement TimeWindowBlocker construct and Lambda (`lib/constructs/time-window-blocker.ts` and `lambda/time-window-blocker/index.ts`)
    - Create the `isDeploymentAllowed(timestamp, config)` pure function in `lambda/time-window-blocker/index.ts` that evaluates: blocked weekday hours (between `blockedHourStart` and `blockedHourEnd` in configured timezone), weekends (Saturday/Sunday), and holiday dates
    - Create the Lambda handler that invokes `isDeploymentAllowed` with the current time and returns allow/block result
    - Create the CDK construct (`lib/constructs/time-window-blocker.ts`) that provisions the Lambda and integrates as a pre-Prod pipeline step; when blocked, the pipeline pauses at a manual approval step
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [ ]* 7.3 Write property-based test for TimeWindowBlocker (`test/constructs/time-window-blocker.test.ts`)
    - **Property 1: Time window blocker correctly classifies all timestamps**
    - **Validates: Requirements 19.2, 19.3, 19.4**
    - Use `fast-check` with minimum 100 iterations
    - Generate random timestamps spanning 2024–2030, random `blockedHourStart`/`blockedHourEnd` (0–23), random holiday lists (0–20 dates), random timezones from fixed set (America/Los_Angeles, America/New_York, UTC, Europe/London)
    - Oracle: independently compute expected result by checking day-of-week, hour-of-day in timezone, and date match against holidays
    - Verify `isDeploymentAllowed()` returns `false` if and only if the timestamp falls within blocked hours, on a weekend, or on a holiday

  - [ ]* 7.4 Write unit tests for TimeWindowBlocker
    - Test specific known timestamps: weekday during allowed hours → allowed
    - Test weekday during blocked hours → blocked
    - Test weekend → blocked
    - Test holiday → blocked
    - Test midnight boundary transitions
    - Test CDK construct synthesizes Lambda and manual approval step
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [x] 8. Implement PipelineStack and wire everything together
  - [x] 8.1 Implement PipelineStack (`lib/pipeline/pipeline-stack.ts`)
    - Create three `CodePipelineSource.connection()` sources for CDK, Lambda, and Frontend repositories using CodeStar Connection ARNs from Configuration Registry
    - Create synth step running `npm ci` and `npx cdk synth` with CDK source as primary input, Lambda and Frontend sources as `additionalInputs`
    - Create `CodePipeline` with `selfMutation: true`
    - Add Lambda build step (Gradle → fat JAR) and Frontend build step (`npm ci` + `npm run build`) running in parallel, both using `BUILD_GENERAL1_SMALL` compute type
    - Add Beta stage (`WebsiteStage`) with post-deployment integration test step (CodeBuild shell step running `scripts/integration-test.sh`)
    - Add TimeWindowBlocker as pre-Prod step
    - Add Manual Approval step before Prod
    - Add Prod stage (`WebsiteStage`) with Composite Alarm-based rollback monitoring (configurable bake time, default 30 min)
    - Add pipeline notification rule → SNS topic for failure notifications
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3a.1, 3a.2, 3a.3, 3a.4, 3a.5, 3a.6, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 18.1, 18.4, 18.5, 18.6, 22.3, 22.6, 23.1, 23.2, 23.3_

  - [x] 8.2 Implement CDK app entry point (`bin/app.ts`)
    - Import configuration from Configuration Registry
    - Instantiate `PipelineStack` in the pipeline account/region
    - Pass all configuration to the pipeline stack
    - _Requirements: 1.1, 20.1_

  - [x] 8.3 Write CDK assertion tests for PipelineStack
    - Test three CodePipeline source actions exist (CDK, Lambda, Frontend)
    - Test synth step with correct commands
    - Test selfMutation enabled
    - Test Beta and Prod stages present
    - Test Lambda and Frontend build steps run in parallel
    - Test manual approval step before Prod
    - Test pipeline notification rule to SNS
    - Test BUILD_GENERAL1_SMALL compute type for build steps
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.5, 3a.5, 6.1, 6.2, 6.3, 22.3, 22.6, 23.1, 23.2_

- [x] 9. Checkpoint - Full synthesis and test pass
  - Ensure `npx cdk synth` succeeds and all tests pass, ask the user if questions arise.

- [x] 10. Create helper scripts and snapshot tests
  - [x] 10.1 Create CDK bootstrap script (`scripts/bootstrap.sh`)
    - Automate `cdk bootstrap` for pipeline, Beta, and Prod accounts with consistent qualifier
    - Configure cross-account trust policies allowing pipeline account to assume CDK deployment roles
    - Accept account IDs and regions as parameters or read from Configuration Registry
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 10.2 Create integration test script (`scripts/integration-test.sh`)
    - CloudFront health check: `curl` the CloudFront URL expecting 200 with HTML containing `<div id="root">`
    - API Gateway health check: `POST /contact` with valid payload expecting 200
    - API Gateway error handling: `POST /contact` with empty payload expecting 400
    - Read `CLOUDFRONT_URL`, `API_GATEWAY_URL`, `REGION`, `STAGE` from environment variables
    - Exit with non-zero on any failure
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [ ]* 10.3 Write CDK snapshot test (`test/stacks/snapshot.test.ts`)
    - Synthesize the full pipeline stack and capture a snapshot for regression detection
    - _Requirements: 1.1, 6.1_

  - [ ]* 10.4 Write Configuration Registry validation tests (`test/config/configuration.test.ts`)
    - Validate config object matches type definitions
    - Validate required fields are present (account IDs, regions, domain names, connection ARNs)
    - Validate alarm thresholds are positive numbers
    - Validate time window config has valid hour ranges (0–23)
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

- [x] 11. Final checkpoint - Full build and test verification
  - Ensure `npx cdk synth` succeeds, all unit tests pass, all property tests pass, and snapshot tests pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after major milestones
- Property tests validate the Time Window Blocker logic (the only algorithmic component); all other stacks use CDK assertion tests
- The design uses TypeScript throughout — no language selection needed
- The Lambda contact form function (Java 21) is built externally from the Lambda_Repository; this CDK project only references the built JAR artifact
