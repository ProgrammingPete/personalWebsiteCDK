# Personal Website CDK Pipeline

A self-mutating AWS CDK pipeline that deploys a static website (S3 + CloudFront) with a serverless contact form backend (Lambda + API Gateway + SES) through Beta and Prod stages. Built entirely with public `aws-cdk-lib` constructs — no proprietary dependencies.

## Architecture

```
GitHub (3 repos) → CodePipeline → Build (parallel) → Beta → Integration Tests → Time Window Check → Manual Approval → Prod → Bake Time Monitor
```

The pipeline sources code from three GitHub repositories, builds artifacts in parallel, and deploys through two stages with safety gates:

- **CDK Repository** — Infrastructure code (this repo, TypeScript)
- **Lambda Repository** — Contact form backend (Java 21, Gradle)
- **Frontend Repository** — React website (Vite/npm)

### What Gets Deployed

Each stage (Beta, Prod) deploys six CloudFormation stacks:

| Stack | Purpose |
|---|---|
| **DnsStack** | Route 53 hosted zone for the stage subdomain |
| **CertificateStack** | ACM certificates for CloudFront (us-east-1) and API Gateway (us-east-2) |
| **WebsiteStack** | S3 bucket, CloudFront distribution with OAC, BucketDeployment |
| **ApiStack** | API Gateway HTTP API, Lambda function (Java 21, ARM64), SES identity |
| **MonitoringStack** | CloudWatch dashboards, alarms (two severity tiers), composite alarm |
| **NotificationStack** | SNS topic for alarm and pipeline failure notifications |

### Account Structure

```
AWS Organizations
├── Pipeline Account — CodePipeline, Route 53 root zone, SNS notifications
├── Beta Account     — Full website stack (us-east-2)
└── Prod Account     — Full website stack (us-east-2)
```

### Deployment Safety Gates

1. **Integration tests** — Post-Beta smoke tests verify CloudFront returns 200 and the API processes requests
2. **Time window blocker** — Blocks Prod deployments during nights (6 PM–6 AM PT), weekends, and holidays
3. **Manual approval** — Requires human sign-off before Prod deployment
4. **Bake time monitor** — Monitors the composite alarm for 30 minutes after Prod deployment; triggers rollback on alarm

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) (`npm install -g aws-cdk`)
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- Three AWS accounts (Pipeline, Beta, Prod) with appropriate IAM credentials
- Three GitHub repositories connected via [AWS CodeStar Connections](https://docs.aws.amazon.com/codepipeline/latest/userguide/connections-github.html)

## Quick Start

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure your environment

Edit `lib/config/configuration.ts` with your actual values:

```typescript
// Pipeline account
pipeline: {
  pipelineAccountId: '<YOUR_PIPELINE_ACCOUNT_ID>',
  pipelineRegion: 'us-east-2',
  rootDomainName: '<YOUR_DOMAIN>',
  rootHostedZoneId: '<YOUR_HOSTED_ZONE_ID>',
  rootDnsProvider: 'external', // or 'route53'
},

// Repository connections
repositories: {
  cdk: {
    owner: '<GITHUB_USER>',
    name: '<CDK_REPO_NAME>',
    branch: 'main',
    connectionArn: '<CODESTAR_CONNECTION_ARN>',
  },
  // ... lambda and frontend repos
},

// Stage accounts
stages: {
  beta: {
    accountId: '<BETA_ACCOUNT_ID>',
    region: 'us-east-2',
    website: {
      domainName: 'beta.<YOUR_DOMAIN>',
      // ...
    },
  },
  prod: {
    accountId: '<PROD_ACCOUNT_ID>',
    // ...
  },
},
```

See [Configuration Reference](#configuration-reference) for all available options.

### 3. Bootstrap all accounts

```bash
./scripts/bootstrap.sh
```

The script reads account IDs and regions directly from `lib/config/configuration.ts` — no need to pass them as arguments. Use `--profile-*` flags if you have separate AWS CLI profiles per account, and `--dry-run` to preview commands without executing. Run `./scripts/bootstrap.sh --help` for all options.

### 4. Deploy the pipeline

```bash
npx cdk deploy PipelineStack --profile <PIPELINE_PROFILE>
```

After the initial deploy, the pipeline is self-mutating — push changes to any of the three GitHub repos and the pipeline updates itself and deploys automatically.

### 5. Set up DNS (external provider only)

If `dnsProvider` is `external`, check the CloudFormation outputs for NS records and add them to your DNS provider (Squarespace, Cloudflare, etc.). The outputs will look like:

```
Beta-DnsStack.NameServers = ns-123.awsdns-45.com, ns-678.awsdns-90.org, ...
```

Add these as NS records for `beta.yourdomain.com` in your external DNS provider.

## Project Structure

```
├── bin/
│   └── app.ts                          # CDK app entry point
├── lib/
│   ├── config/
│   │   ├── configuration.ts            # Configuration values (edit this)
│   │   └── configuration.types.ts      # TypeScript type definitions
│   ├── pipeline/
│   │   └── pipeline-stack.ts           # CodePipeline + stages + safety gates
│   ├── stacks/
│   │   ├── api-stack.ts                # API Gateway + Lambda + SES
│   │   ├── certificate-stack.ts        # ACM certificates (us-east-1 + us-east-2)
│   │   ├── dns-stack.ts                # Route 53 hosted zones + records
│   │   ├── monitoring-stack.ts         # CloudWatch dashboards + alarms
│   │   ├── notification-stack.ts       # SNS topic for notifications
│   │   └── website-stack.ts            # S3 + CloudFront + BucketDeployment
│   ├── constructs/
│   │   └── time-window-blocker.ts      # Lambda-based deployment window blocker
│   └── stages/
│       └── website-stage.ts            # CDK Stage grouping all stacks
├── lambda/
│   └── time-window-blocker/
│       └── index.ts                    # Time window evaluation logic
├── scripts/
│   ├── bootstrap.sh                    # CDK bootstrap automation
│   └── integration-test.sh             # Beta post-deployment smoke tests
└── test/
    └── stacks/                         # CDK assertion tests
```

## Configuration Reference

All configuration lives in `lib/config/configuration.ts`. The type definitions are in `lib/config/configuration.types.ts`.

### Pipeline Config

| Field | Description | Default |
|---|---|---|
| `pipelineAccountId` | AWS account ID hosting the pipeline | — |
| `pipelineRegion` | Region for the pipeline | `us-east-2` |
| `rootDomainName` | Your root domain (e.g., `example.com`) | — |
| `rootHostedZoneId` | Route 53 hosted zone ID for the root domain | — |
| `rootDnsProvider` | `route53` or `external` | `external` |

### Repository Config (per repo)

| Field | Description | Default |
|---|---|---|
| `owner` | GitHub user or organization | — |
| `name` | Repository name | — |
| `branch` | Branch to track | `main` |
| `connectionArn` | CodeStar Connection ARN | — |

### Stage Config (per stage)

| Field | Description | Default |
|---|---|---|
| `accountId` | AWS account ID for this stage | — |
| `region` | Deployment region | `us-east-2` |
| `dnsProvider` | `route53` or `external` | `external` |
| `website.domainName` | Stage domain (e.g., `beta.example.com`) | — |
| `website.recipientEmail` | Contact form recipient email | — |
| `cloudFrontPriceClass` | `PriceClass_100`, `PriceClass_200`, or `PriceClass_All` | `PriceClass_100` |
| `highSeverityAlarms` | Alarm thresholds for high-severity tier | See defaults |
| `lowSeverityAlarms` | Alarm thresholds for low-severity tier | See defaults |
| `bakeTimeMinutes` | Post-deploy monitoring duration (Prod only) | `30` |

### Lambda Config

| Field | Description | Default |
|---|---|---|
| `memorySize` | Memory in MB | `512` |
| `timeout` | Timeout in seconds | `30` |
| `architecture` | `arm64` or `x86_64` | `arm64` |

### Time Window Config

| Field | Description | Default |
|---|---|---|
| `timezone` | IANA timezone for window evaluation | `America/Los_Angeles` |
| `blockedHourStart` | Start of blocked hours (0–23) | `18` (6 PM) |
| `blockedHourEnd` | End of blocked hours (0–23) | `6` (6 AM) |
| `holidays` | Array of ISO date strings (`YYYY-MM-DD`) | `[]` |

## Commands

| Command | Description |
|---|---|
| `npm ci` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm test` | Run all tests (CDK assertions + property tests) |
| `npx cdk synth` | Synthesize CloudFormation templates |
| `npx cdk deploy PipelineStack` | Deploy the pipeline (first time only) |
| `npx cdk diff` | Compare deployed stack with current state |
| `./scripts/bootstrap.sh` | Bootstrap CDK in all accounts |
| `./scripts/bootstrap.sh --help` | Show bootstrap script options |

## DNS Setup

### Route 53 (managed domain)

Set `dnsProvider: 'route53'` in the stage config. The pipeline automatically creates NS delegation records in your root hosted zone.

### External Provider (Squarespace, Cloudflare, etc.)

Set `dnsProvider: 'external'` in the stage config. After deployment:

1. Check CloudFormation outputs for the `NameServers` value
2. Add NS records for your stage subdomain in your DNS provider
3. Wait for DNS propagation (can take up to 48 hours)

ACM certificate validation records are created automatically in the stage Route 53 hosted zone, so certificate validation works regardless of your root DNS provider.

## Cost Optimization

This pipeline is designed for personal/small-business websites with minimal cost:

- **CloudFront** — `PriceClass_100` (North America + Europe only)
- **Lambda** — ARM64 (Graviton) architecture, 512 MB memory
- **CodeBuild** — `BUILD_GENERAL1_SMALL` compute type
- **S3** — Lifecycle rules expire incomplete uploads (1 day) and non-current versions (30 days)
- **No VPC/NAT** — All services are serverless/edge, avoiding NAT Gateway costs

## Monitoring

Each stage gets three CloudWatch dashboards:

- **CloudFront** — Request count, 4xx/5xx error rates, bytes downloaded, cache hit ratio
- **Lambda** — Invocations, errors, duration (p50/p90), throttles, concurrent executions
- **API Gateway** — Request count, 4xx/5xx counts, latency (p50/p90), integration latency

Alarms are configured in two severity tiers (high and low) with configurable thresholds. In Prod, all alarms publish to the SNS notification topic. The composite alarm aggregates all high-severity alarms into a single rollback signal used during the bake period.

## License

This project is open source. See the LICENSE file for details.
