# Requirements Document

## Introduction

This document specifies requirements for an open-source, multi-account AWS CDK pipeline that deploys a static website with a serverless contact form backend. The architecture is modeled after [personalWebsiteCDK](https://github.com/ProgrammingPete/personalWebsiteCDK) and uses only public AWS CDK constructs and standard open-source tooling. The pipeline deploys an S3-hosted static website fronted by CloudFront with a Lambda-backed API Gateway for contact form processing in a single region (us-east-2) through Beta → Prod stages. The website stack includes S3 bucket (with CloudFront OAC), CloudFront distribution (HTTPS, custom domain, SPA routing), Route 53 DNS, ACM certificate (us-east-1 for CloudFront, us-east-2 for API Gateway), a Java 21 Lambda function for contact form processing via SES, and an API Gateway HTTP API with CORS and custom domain. The architecture is designed to be extensible to multiple regions in the future via the Configuration_Registry.

## Glossary

- **Pipeline**: The self-mutating CDK Pipelines construct (`aws-cdk-lib/pipelines.CodePipeline`) that orchestrates build, test, and deployment across stages in us-east-2
- **Stage**: A logical deployment phase (Beta, Prod) deployed to us-east-2
- **Wave**: A group of deployments within a Stage that execute in parallel
- **Account_Vending_Layer**: An AWS Organizations + AWS Control Tower or CDK-based construct set that provisions and configures new AWS accounts for each stage/region combination
- **Bootstrap_Stack**: The CDK bootstrap CloudFormation stack (`CDKToolkit`) deployed to each target account/region to establish cross-account trust with the pipeline account
- **Website_Stack**: The collection of CloudFormation stacks deployed to us-east-2: S3 bucket, CloudFront distribution, ACM certificate, Route 53 records, Lambda function, API Gateway, SES identity, CloudWatch dashboards, and CloudWatch alarms
- **S3_Website_Bucket**: An S3 bucket configured for static website hosting with all public access blocked, accessed exclusively through CloudFront Origin Access Control (OAC)
- **CloudFront_Distribution**: An Amazon CloudFront distribution that serves the static website from the S3_Website_Bucket with HTTPS enforcement, custom domain support, and SPA error handling
- **Origin_Access_Control**: A CloudFront Origin Access Control (OAC) policy that grants the CloudFront_Distribution read access to the S3_Website_Bucket without making the bucket public
- **Contact_Form_Lambda**: An AWS Lambda function (Java 21 runtime) that processes contact form submissions and sends emails via Amazon SES
- **API_Gateway**: An Amazon API Gateway HTTP API with CORS configuration, custom domain (e.g., `api.example.com`), and Lambda proxy integration for the contact form endpoint
- **SES_Identity**: An Amazon SES verified email identity used by the Contact_Form_Lambda to send contact form notification emails
- **Frontend_Build_Step**: A CodeBuild step that runs `npm ci` and `npm run build` using the Frontend_Source input from the Frontend_Repository to produce the static website assets
- **Bucket_Deployment**: An `aws-cdk-lib/aws-s3-deployment.BucketDeployment` construct that uploads built frontend assets from the Frontend_Build_Step output to the S3_Website_Bucket
- **Cache_Invalidation**: A CloudFront cache invalidation (`/*`) triggered after each Bucket_Deployment to ensure visitors receive the latest website content
- **Time_Window_Blocker**: A mechanism using CDK Pipelines manual approval steps combined with a Lambda-based schedule to block deployments during nights, weekends, and holidays
- **CDK_Repository**: The GitHub repository containing the CDK infrastructure code (TypeScript) that defines the pipeline, stacks, and deployment configuration
- **Lambda_Repository**: The GitHub repository containing the Java 21 Lambda function source code for the contact form backend, built with Gradle to produce a fat JAR artifact
- **Frontend_Repository**: The GitHub repository containing the React frontend application source code
- **CDK_Source**: A `CodePipelineSource.connection()` source action that connects to the CDK_Repository and serves as the primary input for the synth step
- **Lambda_Source**: A `CodePipelineSource.connection()` source action that connects to the Lambda_Repository and is provided as an additional input to the pipeline
- **Frontend_Source**: A `CodePipelineSource.connection()` source action that connects to the Frontend_Repository and is provided as an additional input to the pipeline
- **Lambda_Build_Step**: A CodeBuild step that runs the Gradle build in the Lambda_Repository source to produce the fat JAR artifact (e.g., `contact-form-handler-all.jar`) used by the Contact_Form_Lambda
- **GitHub_Source**: A CodeStar Connections or GitHub App-based source action that triggers the pipeline from a GitHub repository (superseded by CDK_Source, Lambda_Source, and Frontend_Source for multi-repo support)
- **Integration_Test_Action**: A CodeBuild-based post-deployment step in the Beta stage that runs HTTP smoke tests against the deployed CloudFront URL and API Gateway endpoint
- **Notification_Channel**: An SNS topic integrated with PagerDuty, OpsGenie, Slack, or Discord for alarm-triggered incident notifications (replacing SIM ticket actions)
- **Cross_Account_DNS**: Route 53 hosted zone management within the pipeline account, with support for delegating from either a Route 53 root zone or an external DNS provider (Squarespace, Cloudflare, etc.) via NS record delegation
- **Configuration_Registry**: A TypeScript module that maps each stage/region to its AWS account ID, region code, domain names, recipient email addresses, hosted zone IDs, alarm thresholds, and feature flags
- **Composite_Alarm**: A CloudWatch CompositeAlarm that aggregates multiple child alarms (CloudFront error rates, Lambda errors, API Gateway latency) into a single rollback signal

## Requirements

### Requirement 1: Self-Mutating CDK Pipeline

**User Story:** As a developer, I want the pipeline to automatically update itself when I push CDK code changes, so that I do not need to manually redeploy the pipeline infrastructure.

#### Acceptance Criteria

1. THE Pipeline SHALL use `aws-cdk-lib/pipelines.CodePipeline` with `selfMutation` enabled
2. WHEN a commit is pushed to any of the three configured GitHub repository branches (CDK_Repository, Lambda_Repository, or Frontend_Repository), THE Pipeline SHALL trigger a new pipeline execution
3. WHEN the CDK code defining the Pipeline changes in the CDK_Repository, THE Pipeline SHALL update its own CloudFormation stack before proceeding to application stages
4. THE Pipeline SHALL use a CodeBuild synth step that runs `npm ci` and `npx cdk synth` in the CDK_Repository source as its primary input, with the Lambda_Repository and Frontend_Repository provided as `additionalInputs`

### Requirement 2: GitHub Multi-Repository Source Integration

**User Story:** As a developer, I want the pipeline to source code from three separate GitHub repositories (CDK, Lambda, and React frontend), so that each codebase can be independently versioned and maintained while triggering a unified deployment pipeline.

#### Acceptance Criteria

1. THE Pipeline SHALL create three separate `pipelines.CodePipelineSource.connection()` source actions: CDK_Source for the CDK_Repository, Lambda_Source for the Lambda_Repository, and Frontend_Source for the Frontend_Repository
2. THE Pipeline SHALL use the CDK_Source as the primary input for the synth step, with Lambda_Source and Frontend_Source provided as `additionalInputs`
3. WHEN a commit is pushed to the configured branch of any of the three repositories, THE Pipeline SHALL trigger a new pipeline execution
4. THE Pipeline SHALL trigger on pushes to a configurable branch per repository (each defaulting to `main`)
5. THE CDK_Source, Lambda_Source, and Frontend_Source SHALL each use an AWS CodeStar Connection ARN provided in the Configuration_Registry to authenticate with GitHub
6. THE GitHub source configuration SHALL support both GitHub.com and GitHub Enterprise Server repositories via the CodeStar Connection ARN provided in the Configuration_Registry

### Requirement 3: Frontend Build Step

**User Story:** As a developer, I want the pipeline to build my React frontend application from the Frontend_Repository using npm, so that the static website assets are compiled and optimized before deployment.

#### Acceptance Criteria

1. THE Pipeline SHALL include a CodeBuild step that runs `npm ci` followed by `npm run build` using the Frontend_Source input from the Frontend_Repository
2. WHEN the Frontend_Build_Step completes successfully, THE Pipeline SHALL produce a build output directory (e.g., `dist/` for Vite-based projects) containing the compiled static website assets (HTML, CSS, JavaScript, images)
3. IF the Frontend_Build_Step fails, THEN THE Pipeline SHALL halt execution and send a notification to the Notification_Channel
4. THE Frontend_Build_Step SHALL use a Node.js runtime environment with a version configurable via the Configuration_Registry (defaulting to Node.js 20)
5. THE Frontend_Build_Step SHALL run in parallel with the Lambda_Build_Step to minimize pipeline execution time

### Requirement 3a: Lambda Build Step

**User Story:** As a developer, I want the pipeline to build the Java 21 Lambda function JAR from the Lambda_Repository using Gradle, so that the contact form backend artifact is compiled and packaged before deployment.

#### Acceptance Criteria

1. THE Pipeline SHALL include a CodeBuild step (Lambda_Build_Step) that runs the Gradle build using the Lambda_Source input from the Lambda_Repository
2. WHEN the Lambda_Build_Step completes successfully, THE Pipeline SHALL produce a fat JAR artifact (e.g., `contact-form-handler-all.jar`) containing the compiled Lambda function and all dependencies
3. IF the Lambda_Build_Step fails, THEN THE Pipeline SHALL halt execution and send a notification to the Notification_Channel
4. THE Lambda_Build_Step SHALL use a Java 21 runtime environment in the CodeBuild project
5. THE Lambda_Build_Step SHALL run in parallel with the Frontend_Build_Step to minimize pipeline execution time
6. THE Lambda_Build_Step output SHALL be referenced by the Website_Stack via `lambda.Code.fromAsset()` to deploy the Contact_Form_Lambda

### Requirement 4: Multi-Account AWS Organizations and Account Vending

**User Story:** As a platform engineer, I want an automated account-vending layer using AWS Organizations, so that I can provision and manage the AWS accounts needed for each stage/region combination.

#### Acceptance Criteria

1. THE Account_Vending_Layer SHALL define an AWS Organizations structure with Organizational Units for Pipeline, Beta, and Prod (no separate DNS Hosting OU; the root hosted zone resides in the pipeline account)
2. THE Account_Vending_Layer SHALL provision separate AWS accounts for each stage/region combination as defined in the Configuration_Registry
3. WHEN a new account is provisioned, THE Account_Vending_Layer SHALL apply a baseline Service Control Policy that restricts usage to the target region and required global services (IAM, Route 53, CloudFront, STS, ACM, SES)
4. THE Account_Vending_Layer SHALL output account IDs that the Configuration_Registry consumes for stack deployment targets

### Requirement 5: CDK Bootstrap Automation for Cross-Account Trust

**User Story:** As a platform engineer, I want CDK bootstrap stacks automatically deployed to all target accounts and regions, so that the pipeline can deploy CloudFormation stacks cross-account without manual setup.

#### Acceptance Criteria

1. THE Bootstrap_Stack SHALL be deployed to every target account/region combination listed in the Configuration_Registry
2. THE Bootstrap_Stack SHALL configure a trust policy that allows the pipeline account to assume the CDK deployment roles (`cdk-deploy-role`, `cdk-file-publishing-role`)
3. WHEN a new account is added to the Configuration_Registry, THE Bootstrap_Stack SHALL be deployable via a single CLI command or automation script targeting that account/region
4. THE Bootstrap_Stack SHALL use a qualifier prefix consistent across all accounts to avoid conflicts with other CDK applications in the same accounts

### Requirement 6: Multi-Stage Deployment (Beta → Prod)

**User Story:** As a developer, I want the pipeline to deploy through Beta and Prod stages with approval gates, so that I can validate changes in a test environment before they reach production.

#### Acceptance Criteria

1. THE Pipeline SHALL define two sequential stages: Beta and Prod
2. WHEN the Beta stage deployment completes successfully, THE Pipeline SHALL require the Integration_Test_Action to pass before promoting to Prod
3. WHEN the Integration_Test_Action passes in Beta, THE Pipeline SHALL require a manual approval step before promoting to Prod
4. BOTH the Beta and Prod stages SHALL deploy to us-east-2 (with ACM certificates for CloudFront created in us-east-1 as required by CloudFront)
5. THE Pipeline architecture SHALL support future expansion to multiple regions via the Configuration_Registry without code changes to stack definitions

### Requirement 7: Production Deployment with Bake Time

**User Story:** As a developer, I want the production deployment to include a bake time with alarm monitoring, so that I can catch regressions before considering the deployment complete.

#### Acceptance Criteria

1. WHEN the Prod stage deployment completes in us-east-2, THE Pipeline SHALL monitor the Composite_Alarm for a configurable bake time (default 30 minutes)
2. IF the Composite_Alarm enters ALARM state during the bake period, THEN THE Pipeline SHALL trigger an automatic CloudFormation rollback of the Prod deployment
3. WHEN the bake period completes without alarm, THE Pipeline SHALL mark the deployment as successful
4. THE bake time duration SHALL be configurable via the Configuration_Registry

### Requirement 8: S3 Static Website Hosting with CloudFront OAC

**User Story:** As a developer, I want the static website hosted in an S3 bucket accessible only through CloudFront, so that the website is served securely and efficiently via a CDN.

#### Acceptance Criteria

1. THE Website_Stack SHALL create an S3_Website_Bucket with `blockPublicAccess` set to block all public access
2. THE Website_Stack SHALL create an Origin_Access_Control that grants the CloudFront_Distribution read-only access to the S3_Website_Bucket
3. THE S3_Website_Bucket SHALL have a bucket policy that allows `s3:GetObject` only from the CloudFront_Distribution via the Origin_Access_Control
4. THE Website_Stack SHALL use `aws-cdk-lib/aws-s3-deployment.BucketDeployment` to deploy the built frontend assets from the Frontend_Build_Step output (sourced from the Frontend_Repository build) to the S3_Website_Bucket
5. THE S3_Website_Bucket SHALL have versioning enabled to support rollback of deployed assets

### Requirement 9: CloudFront Distribution with Custom Domain and SPA Support

**User Story:** As a developer, I want a CloudFront distribution with HTTPS, custom domain support, and SPA error handling, so that visitors access the website securely with friendly URLs and client-side routing works correctly.

#### Acceptance Criteria

1. THE Website_Stack SHALL create a CloudFront_Distribution with the S3_Website_Bucket as its origin using the Origin_Access_Control
2. THE CloudFront_Distribution SHALL redirect all HTTP requests to HTTPS
3. THE CloudFront_Distribution SHALL use the ACM certificate for the custom domain and www subdomain (e.g., `beta.example.com` and `www.beta.example.com`)
4. THE CloudFront_Distribution SHALL configure a custom error response that routes 403 and 404 errors to `/index.html` with a 200 status code to support single-page application (SPA) client-side routing
5. THE CloudFront_Distribution SHALL use `PriceClass_100` for non-Prod stages and a configurable price class for Prod from the Configuration_Registry
6. THE CloudFront_Distribution SHALL set a default root object of `index.html`

### Requirement 10: CloudFront Cache Invalidation After Deployment

**User Story:** As a developer, I want the CloudFront cache invalidated after each deployment, so that visitors immediately see the latest version of the website.

#### Acceptance Criteria

1. WHEN the Bucket_Deployment completes, THE Website_Stack SHALL trigger a CloudFront cache invalidation for the path `/*`
2. THE Cache_Invalidation SHALL be configured as part of the `BucketDeployment` construct using the `distribution` and `distributionPaths` properties
3. IF the Cache_Invalidation fails, THEN THE Website_Stack SHALL surface the failure in the CloudFormation deployment status

### Requirement 11: Contact Form Lambda Function

**User Story:** As a developer, I want a Lambda function that processes contact form submissions and sends emails via SES, so that visitors can reach me through the website without exposing my email address.

#### Acceptance Criteria

1. THE Website_Stack SHALL create a Contact_Form_Lambda using the Java 21 runtime with a configurable memory size (default 512 MB) and timeout (default 30 seconds), with the code asset sourced from the Lambda_Build_Step output (the fat JAR built from the Lambda_Repository) via `lambda.Code.fromAsset()`
2. THE Contact_Form_Lambda SHALL receive contact form data (name, email, subject, message) from the API_Gateway and send a formatted email via SES to the recipient address defined in the Configuration_Registry
3. THE Contact_Form_Lambda SHALL have an IAM execution role with least-privilege permissions granting `ses:SendEmail` and `ses:SendRawEmail` to the verified SES_Identity only
4. THE Contact_Form_Lambda SHALL validate input fields and return appropriate HTTP error codes (400 for invalid input, 500 for SES failures) with descriptive error messages
5. THE Website_Stack SHALL create an SES_Identity for the recipient email address defined in the Configuration_Registry

### Requirement 12: API Gateway HTTP API with CORS and Custom Domain

**User Story:** As a developer, I want an API Gateway HTTP API with CORS support and a custom domain, so that the frontend can securely submit contact form data to the Lambda function.

#### Acceptance Criteria

1. THE Website_Stack SHALL create an API_Gateway HTTP API with a Lambda proxy integration to the Contact_Form_Lambda for the `POST /contact` route
2. THE API_Gateway SHALL configure CORS to allow requests from the CloudFront_Distribution custom domain (e.g., `https://beta.example.com`) with appropriate headers and methods
3. THE API_Gateway SHALL use a custom domain name (e.g., `api.beta.example.com`) with an ACM certificate
4. THE Website_Stack SHALL create a Route 53 A record aliased to the API_Gateway custom domain endpoint
5. THE API_Gateway SHALL enable access logging to CloudWatch Logs for request monitoring

### Requirement 13: ACM Certificate with DNS Validation

**User Story:** As a developer, I want ACM certificates automatically provisioned and validated via DNS, so that CloudFront and API Gateway can terminate TLS without manual certificate management.

#### Acceptance Criteria

1. THE Website_Stack SHALL create an ACM certificate in the `us-east-1` region for the website domain and www subdomain (e.g., `beta.example.com`, `www.beta.example.com`) as required by CloudFront
2. THE Website_Stack SHALL create a separate ACM certificate in us-east-2 for the API Gateway custom domain (e.g., `api.beta.example.com`)
3. THE Website_Stack SHALL validate both ACM certificates using DNS validation against the stage-level Route 53 hosted zone in the pipeline account
4. THE Website_Stack SHALL automatically create DNS validation records in the stage Route 53 hosted zone, which works regardless of whether the root domain uses Route 53 or an external DNS provider

### Requirement 14: DNS Management and External DNS Provider Support

**User Story:** As a developer, I want DNS to work whether my domain is managed in Route 53 or by an external provider like Squarespace or Cloudflare, so that I can use the pipeline regardless of where I purchased my domain.

#### Acceptance Criteria

1. THE Configuration_Registry SHALL include a `dnsProvider` flag per stage with values `route53` or `external` to indicate where the root domain DNS is managed
2. WHEN `dnsProvider` is `route53`, THE Website_Stack SHALL create a public Route 53 hosted zone for the stage subdomain (e.g., `beta.example.com`) in the pipeline account and create NS delegation records in the root domain hosted zone
3. WHEN `dnsProvider` is `external`, THE Website_Stack SHALL create a public Route 53 hosted zone for the stage subdomain in the pipeline account and output the NS records that the user must manually add to their external DNS provider (Squarespace, Cloudflare, etc.)
4. THE Website_Stack SHALL create Route 53 A records within the stage hosted zone aliased to the CloudFront_Distribution for the stage subdomain (e.g., `beta.example.com`) and www subdomain (e.g., `www.beta.example.com`)
5. WHEN `dnsProvider` is `external`, THE Pipeline SHALL output clear instructions (via CloudFormation outputs and pipeline logs) listing the NS records and any CNAME records the user must create in their external DNS provider for certificate validation and subdomain resolution
6. THE Website_Stack SHALL support ACM DNS validation by creating validation records in the stage Route 53 hosted zone regardless of whether the root domain uses Route 53 or an external provider

### Requirement 15: CloudWatch Dashboards

**User Story:** As an operator, I want CloudWatch dashboards for each region showing CloudFront performance, Lambda function health, and API Gateway metrics, so that I can monitor website health at a glance.

#### Acceptance Criteria

1. THE Website_Stack SHALL create a CloudWatch dashboard displaying CloudFront metrics (request count, 4xx error rate, 5xx error rate, total error rate, bytes downloaded, cache hit ratio)
2. THE Website_Stack SHALL create a CloudWatch dashboard displaying Contact_Form_Lambda metrics (invocation count, error count, duration p50, duration p90, throttle count, concurrent executions)
3. THE Website_Stack SHALL create a CloudWatch dashboard displaying API_Gateway metrics (request count, 4xx error count, 5xx error count, latency p50, latency p90, integration latency)

### Requirement 16: CloudWatch Alarms and Composite Alarm for Rollback

**User Story:** As an operator, I want composite CloudWatch alarms that aggregate CloudFront error rates, Lambda errors, and API Gateway latency, so that the pipeline can automatically roll back bad deployments.

#### Acceptance Criteria

1. THE Website_Stack SHALL create CloudWatch alarms for CloudFront 4xx error rate and 5xx error rate with thresholds from the Configuration_Registry
2. THE Website_Stack SHALL create CloudWatch alarms for Contact_Form_Lambda error rate and duration p90 with thresholds from the Configuration_Registry
3. THE Website_Stack SHALL create CloudWatch alarms for API_Gateway 5xx error rate and latency p90 with thresholds from the Configuration_Registry
4. THE Website_Stack SHALL create a Composite_Alarm that enters ALARM state when any child alarm (CloudFront, Lambda, or API Gateway alarms) is in ALARM state
5. WHEN a Composite_Alarm transitions to ALARM state in Prod, THE Website_Stack SHALL trigger an SNS notification to the Notification_Channel
6. THE Website_Stack SHALL support two severity tiers of alarms (high-severity and low-severity) with different thresholds and evaluation periods per the Configuration_Registry

### Requirement 17: Alarm Notification via SNS

**User Story:** As an operator, I want alarm notifications sent to SNS topics integrated with PagerDuty, OpsGenie, Slack, or Discord, so that I receive incident alerts without depending on Amazon-internal SIM ticketing.

#### Acceptance Criteria

1. THE Website_Stack SHALL create an SNS topic in us-east-2 for alarm notifications
2. WHEN a high-severity alarm fires in Prod, THE Website_Stack SHALL publish a notification to the SNS topic with alarm name, description, region, and severity
3. THE Notification_Channel SHALL support HTTPS endpoint subscriptions for integration with PagerDuty, OpsGenie, Slack, or Discord webhooks
4. THE Website_Stack SHALL configure alarm actions on all Prod alarms to publish to the regional SNS topic

### Requirement 18: Integration Tests in Beta Stage

**User Story:** As a developer, I want integration tests to run automatically after Beta deployment, so that I can verify the website and API work end-to-end before promoting to Prod.

#### Acceptance Criteria

1. THE Pipeline SHALL include a post-deployment CodeBuild step in the Beta stage that runs HTTP smoke tests against the deployed CloudFront URL and API Gateway endpoint
2. THE Integration_Test_Action SHALL verify that the CloudFront URL returns a 200 status code with valid HTML content
3. THE Integration_Test_Action SHALL verify that the API Gateway `POST /contact` endpoint returns a successful response for a valid test payload
4. THE Integration_Test_Action SHALL receive the CloudFront URL, API Gateway endpoint URL, region, and stage as environment variables
5. IF the Integration_Test_Action fails, THEN THE Pipeline SHALL halt promotion to Prod and send a notification to the Notification_Channel
6. THE Integration_Test_Action SHALL have a configurable timeout (default 15 minutes)

### Requirement 19: Time Window Deployment Blockers

**User Story:** As an operator, I want production deployments blocked during nights, weekends, and holidays, so that deployments only occur when the team is available to respond to issues.

#### Acceptance Criteria

1. THE Pipeline SHALL include a pre-deployment step before the Prod stage that evaluates whether the current time falls within an allowed deployment window
2. THE Time_Window_Blocker SHALL block deployments between 6 PM and 6 AM Pacific Time on weekdays
3. THE Time_Window_Blocker SHALL block deployments on weekends (Saturday and Sunday, Pacific Time)
4. THE Time_Window_Blocker SHALL block deployments on configurable holiday dates provided via the Configuration_Registry
5. WHEN a deployment is blocked by the Time_Window_Blocker, THE Pipeline SHALL pause at a manual approval step that can be overridden by an authorized operator

### Requirement 20: Configuration Registry

**User Story:** As a developer, I want a centralized configuration module that maps every stage/region to its account ID, domain names, and operational parameters, so that adding a new region requires only a configuration change.

#### Acceptance Criteria

1. THE Configuration_Registry SHALL be a TypeScript module exporting a typed object that maps each Stage (Beta, Prod) to its AWS account ID and deployment region (defaulting to us-east-2)
2. THE Configuration_Registry SHALL include per-repository configuration for all three source repositories (CDK_Repository, Lambda_Repository, Frontend_Repository), each specifying the repository owner, repository name, branch name, and CodeStar Connection ARN
3. THE Configuration_Registry SHALL include per-stage website configuration parameters (domain name, www subdomain, API subdomain, hosted zone ID, recipient email address for contact form)
4. THE Configuration_Registry SHALL include alarm thresholds for CloudFront error rates, Lambda error rates and duration, and API Gateway latency (evaluation periods, threshold values per severity tier)
5. THE Configuration_Registry SHALL include feature flags to handle regional service availability differences
6. THE Configuration_Registry SHALL be structured to support future multi-region expansion by allowing additional regions to be added per stage without code changes to stack definitions

### Requirement 21: IAM and Security

**User Story:** As a developer, I want IAM-based security with least-privilege policies for all resources, so that the website infrastructure follows security best practices.

#### Acceptance Criteria

1. THE Website_Stack SHALL create an IAM execution role for the Contact_Form_Lambda with least-privilege policies granting access only to SES for sending emails and CloudWatch Logs for logging
2. THE Website_Stack SHALL configure the S3_Website_Bucket policy to allow `s3:GetObject` only from the CloudFront_Distribution via the Origin_Access_Control
3. THE Website_Stack SHALL configure the CloudFront_Distribution with an Origin_Access_Control that uses signing protocol version `SigV4` and `s3` origin type
4. THE Website_Stack SHALL create cross-account IAM roles with least-privilege policies for CDK deployment and certificate validation

### Requirement 22: Cost Optimization

**User Story:** As a developer running a personal/small-business website, I want infrastructure costs kept as low as possible, so that the deployment remains affordable without sacrificing reliability.

#### Acceptance Criteria

1. THE Website_Stack SHALL use CloudFront `PriceClass_100` (North America and Europe only) for Beta and as the default for Prod, configurable via the Configuration_Registry
2. THE Website_Stack SHALL configure the Contact_Form_Lambda with the minimum viable memory (512 MB) and use ARM64 (Graviton) architecture to reduce Lambda execution costs
3. THE Pipeline SHALL use a single CodePipeline with shared CodeBuild projects to minimize CodePipeline and CodeBuild charges
4. THE Website_Stack SHALL configure S3_Website_Bucket lifecycle rules to expire incomplete multipart uploads after 1 day and transition non-current object versions to S3 Glacier or deletion after 30 days
5. THE Website_Stack SHALL use CloudFront cache behaviors with a minimum TTL of 86400 seconds (1 day) for static assets to maximize cache hit ratio and reduce S3 GET request costs
6. THE Pipeline SHALL use `BUILD_GENERAL1_SMALL` CodeBuild compute type for the Frontend_Build_Step and Lambda_Build_Step to minimize build costs
7. THE Website_Stack SHALL avoid provisioning NAT Gateways, VPCs, or Elastic IPs since the architecture uses only serverless and edge services (S3, CloudFront, Lambda, API Gateway, SES)
8. BOTH Beta and Prod stages SHALL deploy to a single region (us-east-2) to minimize infrastructure costs, with the architecture supporting future multi-region expansion
9. THE Website_Stack SHALL use on-demand pricing for all services with no reserved capacity commitments, keeping the architecture pay-per-request

### Requirement 23: Pipeline Notification on Failure

**User Story:** As a developer, I want to be notified when any pipeline stage fails, so that I can investigate and fix issues promptly.

#### Acceptance Criteria

1. WHEN any stage of the Pipeline fails (synth, build, deploy, test, or approval timeout), THE Pipeline SHALL send a notification to the Notification_Channel with the stage name, failure reason, and a link to the CodePipeline execution
2. THE Pipeline SHALL use CodePipeline notification rules with an SNS topic to deliver failure notifications
3. THE Notification_Channel SHALL support email, Slack, and webhook subscription types
