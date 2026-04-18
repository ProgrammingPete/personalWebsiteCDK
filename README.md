# Personal Website CDK Pipeline

A self-mutating AWS CDK pipeline that deploys a static website (S3 + CloudFront) with a serverless contact form backend (Lambda + API Gateway + SES) through Beta and Prod stages. Built entirely with public `aws-cdk-lib` constructs — no proprietary dependencies.

## Architecture

```
GitHub (3 repos) → CodePipeline → Synth (build all + cdk synth) → Beta → Integration Tests → Time Window Check → Manual Approval → Prod → Bake Time Monitor
```

The pipeline sources code from three GitHub repositories, builds all artifacts inside the Synth step, and deploys through two stages with safety gates:

- **CDK Repository** — Infrastructure code (this repo, TypeScript)
- **Lambda Repository** — Contact form backend (Java 21, Gradle)
- **Frontend Repository** — React website (Vite/npm)

The Synth step pulls all three repos, builds the Lambda fat JAR (`./gradlew shadowJar`) and Frontend assets (`npm run build`), copies them into the CDK project's placeholder directories, then runs `cdk synth`. This ensures `lambda.Code.fromAsset()` and `s3deploy.Source.asset()` package the real built artifacts into the cloud assembly.

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

## Manual Infrastructure Setup

The following resources must be created manually before deploying the pipeline. Everything else is provisioned by CDK.

### 1. AWS Accounts

Create three separate AWS accounts (or use existing ones):

| Account | Purpose | Config field |
|---|---|---|
| **Pipeline** | Hosts CodePipeline, Route 53 root zone, SNS notifications | `pipeline.pipelineAccountId` |
| **Beta** | Beta stage deployment target | `stages.beta.accountId` |
| **Prod** | Prod stage deployment target | `stages.prod.accountId` |

If you're using AWS Organizations, create these under separate OUs (Pipeline, Beta, Prod). This is optional but recommended for SCP isolation.

### 2. GitHub Repositories

Create two additional GitHub repositories (the CDK repo is this one):

| Repository | Contents | Config field |
|---|---|---|
| **CDK** | This repo — already created | `repositories.cdk` |
| **Lambda** | Java 21 contact form handler (Gradle project producing a fat JAR via `./gradlew shadowJar`) | `repositories.lambda` |
| **Frontend** | React website (Vite or CRA, producing static assets via `npm run build`) | `repositories.frontend` |

### 3. AWS CodeStar Connections

Create a [CodeStar Connection](https://docs.aws.amazon.com/codepipeline/latest/userguide/connections-github.html) in the **Pipeline account** (us-east-2) to authorize CodePipeline to access your GitHub repositories:

1. Go to **AWS Console → Developer Tools → Settings → Connections**
2. Click **Create connection** → select **GitHub** → authorize the GitHub App
3. Copy the Connection ARN (e.g., `arn:aws:codestar-connections:us-east-2:111111111111:connection/xxxxxxxx`)
4. Paste it into `repositories.cdk.connectionArn`, `repositories.lambda.connectionArn`, and `repositories.frontend.connectionArn` in `configuration.ts`

You can use a single connection for all three repos if they're under the same GitHub owner, or create separate connections if they're in different orgs.

> **Important:** The connection must be in the **Available** status. A newly created connection starts as **Pending** until you complete the GitHub App authorization flow in the console.

### 4. Domain Name

You need a registered domain name (e.g., `example.com`). The pipeline supports two DNS setups:

**Option A: Domain managed in Route 53 (`dnsProvider: 'route53'`)**
1. Create a Route 53 public hosted zone for your root domain in the **Pipeline account**
2. Update your domain registrar's nameservers to point to the Route 53 hosted zone NS records
3. Set `pipeline.rootHostedZoneId` to the hosted zone ID
4. The pipeline automatically creates NS delegation records for stage subdomains

**Option B: Domain managed externally (`dnsProvider: 'external'`)**
1. Keep your domain at your current registrar (Squarespace, Cloudflare, GoDaddy, etc.)
2. Create a Route 53 public hosted zone for your root domain in the **Pipeline account** (this is still needed for ACM validation and stage subdomain zones)
3. Set `pipeline.rootHostedZoneId` to that hosted zone ID
4. After deployment, check CloudFormation outputs for NS records and add them to your external DNS provider manually

### 5. SES Email Verification

The contact form Lambda sends emails via Amazon SES. By default, new AWS accounts are in the [SES sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), which means:

1. **Verify the recipient email** — After the first deployment, SES sends a verification email to the address in `website.recipientEmail`. Click the verification link.
2. **Request production access** (optional) — If you want the contact form to accept submissions from anyone (not just verified addresses), request SES production access in the Beta and Prod accounts.

### 6. CDK Bootstrap

Run the bootstrap script to set up cross-account trust between the Pipeline account and the target accounts:

```bash
./scripts/bootstrap.sh
```

This creates the `CDKToolkit` CloudFormation stack in each account/region with trust policies allowing the Pipeline account to deploy. See `./scripts/bootstrap.sh --help` for options like `--profile-pipeline`, `--profile-beta`, `--profile-prod`, and `--dry-run`.

### Summary Checklist

```
[ ] Three AWS accounts created (Pipeline, Beta, Prod)
[ ] Two GitHub repos created and pushed (Lambda, Frontend) — CDK repo is this repo
[ ] CodeStar Connection created and in "Available" status
[ ] Domain name registered
[ ] Route 53 hosted zone created for root domain in Pipeline account
[ ] lib/config/configuration.ts updated with real values
[ ] ./scripts/bootstrap.sh executed successfully
[ ] (After first deploy) SES recipient email verified
[ ] (External DNS only) NS records added to external DNS provider
```

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
│   ├── placeholder/                    # Placeholder for Lambda JAR (real JAR built by Synth step in pipeline)
│   └── time-window-blocker/
│       └── index.ts                    # Time window evaluation logic
├── test-assets/                        # Placeholder for frontend assets (real assets built by Synth step in pipeline)
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
