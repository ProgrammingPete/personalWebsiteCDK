/** DNS provider for the root domain */
export type DnsProvider = 'route53' | 'external';

/** Per-repository GitHub source configuration */
export interface RepositoryConfig {
  /** GitHub owner (user or org) */
  owner: string;
  /** Repository name */
  name: string;
  /** Branch to track (default: 'main') */
  branch: string;
  /** CodeStar Connection ARN for GitHub authentication */
  connectionArn: string;
}

/** Website configuration per stage */
export interface WebsiteConfig {
  /** Primary domain (e.g., 'beta.example.com') */
  domainName: string;
  /** www subdomain (e.g., 'www.beta.example.com') */
  wwwSubdomain: string;
  /** API subdomain (e.g., 'api.beta.example.com') */
  apiSubdomain: string;
  /** Route 53 hosted zone ID for the stage subdomain (populated after first deploy) */
  hostedZoneId?: string;
  /** Recipient email for contact form */
  recipientEmail: string;
}

/** Alarm threshold configuration */
export interface AlarmThresholds {
  /** CloudFront 5xx error rate threshold (percentage) */
  cloudFront5xxRate: number;
  /** CloudFront 4xx error rate threshold (percentage) */
  cloudFront4xxRate: number;
  /** Lambda error rate threshold (percentage) */
  lambdaErrorRate: number;
  /** Lambda duration p90 threshold (milliseconds) */
  lambdaDurationP90: number;
  /** API Gateway 5xx error rate threshold (percentage) */
  apiGateway5xxRate: number;
  /** API Gateway latency p90 threshold (milliseconds) */
  apiGatewayLatencyP90: number;
  /** Evaluation periods for the alarm */
  evaluationPeriods: number;
  /** Datapoints to alarm */
  datapointsToAlarm: number;
}

/** Per-stage configuration */
export interface StageConfig {
  /** AWS account ID for this stage */
  accountId: string;
  /** Deployment region (default: 'us-east-2') */
  region: string;
  /** DNS provider for root domain delegation */
  dnsProvider: DnsProvider;
  /** Website configuration */
  website: WebsiteConfig;
  /** CloudFront price class (e.g., 'PriceClass_100') */
  cloudFrontPriceClass: string;
  /** High-severity alarm thresholds */
  highSeverityAlarms: AlarmThresholds;
  /** Low-severity alarm thresholds */
  lowSeverityAlarms: AlarmThresholds;
  /** Bake time in minutes (Prod only, default: 30) */
  bakeTimeMinutes?: number;
  /** Feature flags for regional service availability */
  featureFlags?: Record<string, boolean>;
}

/** Lambda configuration */
export interface LambdaConfig {
  /** Memory size in MB (default: 512) */
  memorySize: number;
  /** Timeout in seconds (default: 30) */
  timeout: number;
  /** Architecture: 'arm64' or 'x86_64' (default: 'arm64') */
  architecture: 'arm64' | 'x86_64';
}

/** Pipeline-level configuration */
export interface PipelineConfig {
  /** Pipeline account ID */
  pipelineAccountId: string;
  /** Pipeline region */
  pipelineRegion: string;
  /** Root domain name (e.g., 'example.com') */
  rootDomainName: string;
  /** Root hosted zone ID in the pipeline account */
  rootHostedZoneId: string;
  /** DNS provider for the root domain */
  rootDnsProvider: DnsProvider;
}

/** Build configuration */
export interface BuildConfig {
  /** Node.js version for frontend build (default: '20') */
  nodeVersion: string;
  /** CodeBuild compute type (default: 'BUILD_GENERAL1_SMALL') */
  computeType: string;
}

/** Time window blocker configuration */
export interface TimeWindowConfig {
  /** Timezone for evaluating windows (default: 'America/Los_Angeles') */
  timezone: string;
  /** Blocked hour start (24h, default: 18 = 6 PM) */
  blockedHourStart: number;
  /** Blocked hour end (24h, default: 6 = 6 AM) */
  blockedHourEnd: number;
  /** Holiday dates in ISO format (YYYY-MM-DD) */
  holidays: string[];
}

/** Top-level application configuration */
export interface ApplicationConfig {
  pipeline: PipelineConfig;
  repositories: {
    cdk: RepositoryConfig;
    lambda: RepositoryConfig;
    frontend: RepositoryConfig;
  };
  build: BuildConfig;
  lambda: LambdaConfig;
  timeWindow: TimeWindowConfig;
  stages: {
    beta: StageConfig;
    prod: StageConfig;
    [key: string]: StageConfig;
  };
}
