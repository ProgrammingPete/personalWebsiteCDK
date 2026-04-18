# Viewing Your Pipeline in the AWS Console

This guide walks you through finding and monitoring your deployed pipeline and resources in the AWS Management Console.

## Table of Contents

- [Pipeline Overview](#pipeline-overview)
- [Viewing the CodePipeline](#viewing-the-codepipeline)
- [Checking Build Logs](#checking-build-logs)
- [Monitoring CloudFront](#monitoring-cloudfront)
- [Viewing Lambda Functions](#viewing-lambda-functions)
- [Checking API Gateway](#checking-api-gateway)
- [CloudWatch Dashboards and Alarms](#cloudwatch-dashboards-and-alarms)
- [Route 53 DNS Records](#route-53-dns-records)
- [SNS Notifications](#sns-notifications)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)

---

## Pipeline Overview

Your infrastructure spans three AWS accounts. You'll need to sign into the correct account to view each set of resources:

| Account | What's There | Region |
|---|---|---|
| **Pipeline Account** | CodePipeline, CodeBuild projects, Route 53 hosted zones, SNS topic | us-east-2 |
| **Beta Account** | S3 bucket, CloudFront, Lambda, API Gateway, SES, CloudWatch | us-east-2 |
| **Prod Account** | S3 bucket, CloudFront, Lambda, API Gateway, SES, CloudWatch | us-east-2 |

> Make sure you're in the **us-east-2 (Ohio)** region for most resources. CloudFront distributions and their ACM certificates are visible from **us-east-1 (N. Virginia)** or the global CloudFront console.

---

## Viewing the CodePipeline

The pipeline is the central orchestrator. Start here to see the overall deployment status.

### Steps

1. Sign into the **Pipeline Account**
2. Navigate to **CodePipeline** → **Pipelines** (or search "CodePipeline" in the console search bar)
3. Select **WebsitePipeline**

### What You'll See

The pipeline view shows each stage as a horizontal flow:

```
Source → Build → UpdatePipeline → Assets → Beta → BuildArtifacts → Prod
```

Each stage contains one or more actions. Here's what each stage does:

| Stage | Actions | What to Look For |
|---|---|---|
| **Source** | CDK_Source, Lambda_Source, Frontend_Source | Green = all repos connected. Click an action to see the commit that triggered it. |
| **Build** | Synth | Runs `npm ci` + `npx cdk synth`. Check CodeBuild logs if this fails. |
| **UpdatePipeline** | SelfMutate | The pipeline updating its own CloudFormation stack. Usually fast. |
| **Assets** | FileAsset1, FileAsset2, ... | CDK publishing assets to S3. Failures here usually mean bootstrap issues. |
| **Beta** | Deploy, IntegrationTest | Deploys all stacks to Beta, then runs smoke tests. |
| **BuildArtifacts** | Lambda_Build, Frontend_Build | Parallel builds. Lambda runs Gradle, Frontend runs npm. |
| **Prod** | TimeWindowCheck, PromoteToProd (manual), Deploy, ProdBakeMonitor | Time window check → manual approval → deploy → 30-min bake. |

### Checking Execution History

1. On the pipeline page, click the **History** tab
2. Each row is a pipeline execution with its trigger source and status
3. Click an execution to see the detailed timeline of each action

### Approving a Prod Deployment

1. When the pipeline reaches the **PromoteToProd** step, it pauses
2. You'll see a blue **Review** button on that action
3. Click **Review**, add an optional comment, and click **Approve** or **Reject**

---

## Checking Build Logs

When a build step fails, you need to check the CodeBuild logs.

### Steps

1. In the pipeline view, click the failed action (e.g., **Synth**, **Lambda_Build**, or **Frontend_Build**)
2. Click **Details** → this opens the CodeBuild execution
3. Alternatively: navigate to **CodeBuild** → **Build projects** and find the project (named like `PipelineStack-Pipeline-*`)

### Reading Build Logs

- **Phase details** at the top show which phase failed (INSTALL, PRE_BUILD, BUILD, POST_BUILD)
- **Build logs** show the full output. Scroll to the bottom for the error
- Click **Tail logs** for real-time output on in-progress builds

### Common Build Failures

| Symptom | Likely Cause |
|---|---|
| `npm ci` fails | Package-lock.json out of sync, or Node.js version mismatch |
| `npx cdk synth` fails | TypeScript compilation error or CDK construct misconfiguration |
| Gradle build fails | Java compilation error or missing dependencies in Lambda repo |
| `npm run build` fails | Frontend build error (React/Vite) |

---

## Monitoring CloudFront

CloudFront distributions are global resources, but they're easiest to find from us-east-1.

### Steps

1. Sign into the **Beta** or **Prod** account
2. Navigate to **CloudFront** → **Distributions**
3. Find your distribution by the **Alternate domain names** column (e.g., `beta.example.com`)

### Key Tabs

| Tab | What It Shows |
|---|---|
| **General** | Distribution status, domain name, price class, certificate |
| **Origins** | The S3 bucket origin with Origin Access Control (OAC) |
| **Behaviors** | Cache behavior, viewer protocol policy (should be "Redirect HTTP to HTTPS") |
| **Error pages** | Custom error responses (403 → /index.html, 404 → /index.html for SPA routing) |
| **Invalidations** | Cache invalidation history (one per deployment) |

### Checking if Your Site is Live

1. Copy the **Distribution domain name** (e.g., `d1234abcdef.cloudfront.net`)
2. Open it in a browser — you should see your React app
3. Also try your custom domain (e.g., `https://beta.example.com`) if DNS is configured

---

## Viewing Lambda Functions

### Steps

1. Sign into the **Beta** or **Prod** account
2. Navigate to **Lambda** → **Functions**
3. Find the contact form function (named like `Beta-ApiStack-ContactFormFunction*`)

### Key Tabs

| Tab | What It Shows |
|---|---|
| **Code** | The deployed code (Java JAR — you'll see the handler configuration) |
| **Configuration** | Memory (512 MB), timeout (30s), architecture (arm64), environment variables |
| **Monitor** | Invocation count, error count, duration graphs |
| **Permissions** | IAM role with SES and CloudWatch Logs permissions |

### Testing the Lambda

1. Go to the **Test** tab
2. Create a test event with this JSON:
   ```json
   {
     "body": "{\"name\":\"Test\",\"email\":\"test@example.com\",\"subject\":\"Test\",\"message\":\"Hello\"}"
   }
   ```
3. Click **Test** — you should get a 200 response (or 500 if SES identity isn't verified yet)

---

## Checking API Gateway

### Steps

1. Sign into the **Beta** or **Prod** account
2. Navigate to **API Gateway**
3. Find the HTTP API (named like `ContactFormApi-beta.example.com`)

### Key Sections

| Section | What to Check |
|---|---|
| **Routes** | Should show `POST /contact` with Lambda integration |
| **CORS** | Allowed origins should include your CloudFront domain |
| **Custom domain names** | Should show `api.beta.example.com` with the ACM certificate |
| **Stages** | The `$default` stage with access logging enabled |

### Testing the API

You can test directly from the console or use curl:

```bash
# Valid request (should return 200)
curl -X POST https://api.beta.example.com/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","subject":"Test","message":"Hello"}'

# Invalid request (should return 400)
curl -X POST https://api.beta.example.com/contact \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## CloudWatch Dashboards and Alarms

### Viewing Dashboards

1. Sign into the **Beta** or **Prod** account
2. Navigate to **CloudWatch** → **Dashboards**
3. You'll see three dashboards per stage:

| Dashboard | Metrics |
|---|---|
| `beta-CloudFront` | Request count, 4xx/5xx error rates, bytes downloaded, cache hit ratio |
| `beta-Lambda` | Invocations, errors, duration (p50/p90), throttles, concurrent executions |
| `beta-ApiGateway` | Request count, 4xx/5xx counts, latency (p50/p90), integration latency |

### Viewing Alarms

1. Navigate to **CloudWatch** → **Alarms** → **All alarms**
2. Alarms are named with the pattern `<stage>-<severity>-<service>-<metric>`, for example:
   - `prod-high-CloudFront-5xxRate`
   - `prod-low-Lambda-ErrorRate`
   - `prod-high-ApiGateway-LatencyP90`

3. The **Composite Alarm** (`prod-CompositeAlarm`) aggregates all high-severity alarms. This is the alarm the pipeline monitors during the bake period.

### Alarm States

| State | Meaning | Color |
|---|---|---|
| **OK** | Metric is within threshold | Green |
| **ALARM** | Metric exceeded threshold | Red |
| **INSUFFICIENT_DATA** | Not enough data points yet | Gray |

> In Prod, all alarms publish to the SNS notification topic when they transition to ALARM or OK.

---

## Route 53 DNS Records

### Steps

1. Sign into the **Pipeline Account** (DNS is managed here)
2. Navigate to **Route 53** → **Hosted zones**
3. You'll see hosted zones for each stage subdomain:
   - `beta.example.com`
   - `example.com` (or `prod.example.com` depending on your config)

### Records to Verify

| Record | Type | Target |
|---|---|---|
| `beta.example.com` | A (Alias) | CloudFront distribution |
| `www.beta.example.com` | A (Alias) | CloudFront distribution |
| `api.beta.example.com` | A (Alias) | API Gateway custom domain |
| NS records | NS | AWS nameservers (copy these to your external DNS provider) |

### Verifying DNS Propagation

```bash
# Check if NS records are resolving
dig NS beta.example.com

# Check if the A record points to CloudFront
dig A beta.example.com

# Check the API subdomain
dig A api.beta.example.com
```

---

## SNS Notifications

### Steps

1. Sign into the **Pipeline Account**
2. Navigate to **SNS** → **Topics**
3. Find the notification topic (named like `PipelineNotifications-NotificationTopic`)

### Adding Subscribers

To receive notifications via email, Slack, PagerDuty, etc.:

1. Click the topic → **Create subscription**
2. Choose a protocol:
   - **Email** — Enter your email address (you'll need to confirm the subscription)
   - **HTTPS** — Enter a webhook URL (PagerDuty, OpsGenie, Slack incoming webhook, Discord webhook)
3. Click **Create subscription**

### What Triggers Notifications

- Pipeline execution failures (any stage)
- Prod alarm state changes (ALARM or OK)
- Composite alarm transitions

---

## Troubleshooting Common Issues

### Pipeline is stuck at "Assets" stage

**Cause:** CDK bootstrap is missing or misconfigured in the target account.

**Fix:** Run the bootstrap script (it reads accounts from your config automatically):
```bash
./scripts/bootstrap.sh --profile-beta <PROFILE>
```

### ACM certificate stuck in "Pending validation"

**Cause:** DNS validation records can't be verified. Usually means NS records aren't set up in your external DNS provider.

**Fix:**
1. Go to **Route 53** → **Hosted zones** → your stage zone
2. Copy the NS records
3. Add them to your external DNS provider
4. Wait for propagation (up to 48 hours, usually faster)

### CloudFront returns 403

**Cause:** S3 bucket policy doesn't allow CloudFront OAC, or the S3 bucket is empty.

**Fix:**
1. Check the S3 bucket has objects (the frontend build output)
2. Verify the bucket policy allows `s3:GetObject` from the CloudFront OAC
3. Check CloudFront → Origins → the OAC is configured

### Integration tests fail in Beta

**Cause:** The deployed site or API isn't responding correctly.

**Fix:**
1. Check the CodeBuild logs for the IntegrationTest action
2. Verify CloudFront is returning 200: `curl -I https://beta.example.com`
3. Verify the API is responding: `curl -X POST https://api.beta.example.com/contact -H "Content-Type: application/json" -d '{"name":"test","email":"t@t.com","subject":"t","message":"t"}'`
4. Check if SES identity is verified (SES → Verified identities in the Beta account)

### Time window blocker rejects deployment

**Cause:** Current time is outside the allowed deployment window.

**Fix:**
1. Wait for the next allowed window (weekday, 6 AM–6 PM Pacific by default)
2. Or override: in the pipeline view, the TimeWindowCheck step will fail, but you can re-run the pipeline during allowed hours
3. To change the window, edit `timeWindow` in `lib/config/configuration.ts`

### Bake time monitor triggers rollback

**Cause:** The composite alarm entered ALARM state during the 30-minute bake period after Prod deployment.

**Fix:**
1. Check **CloudWatch** → **Alarms** in the Prod account to see which alarm fired
2. Check the specific metric (CloudFront errors, Lambda errors, API Gateway latency)
3. The Prod deployment will have been rolled back automatically
4. Fix the issue and push a new commit to trigger a fresh deployment

### "Need to bootstrap" error

**Cause:** The target account/region hasn't been bootstrapped with CDK.

**Fix:**
```bash
./scripts/bootstrap.sh --help  # See all options
./scripts/bootstrap.sh         # Bootstrap with defaults
```

### CloudFormation stack in ROLLBACK_COMPLETE

**Cause:** A previous deployment failed and the stack rolled back.

**Fix:**
1. Go to **CloudFormation** in the affected account
2. Find the stack in ROLLBACK_COMPLETE state
3. Delete it (this is safe — it contains no resources after rollback)
4. Re-run the pipeline
