import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { StageConfig, PipelineConfig, LambdaConfig } from '../config/configuration.types';
import { DnsStack } from '../stacks/dns-stack';
import { CertificateStack } from '../stacks/certificate-stack';
import { WebsiteStack } from '../stacks/website-stack';
import { ApiStack } from '../stacks/api-stack';
import { MonitoringStack } from '../stacks/monitoring-stack';
import { NotificationStack } from '../stacks/notification-stack';

export interface WebsiteStageProps extends cdk.StageProps {
  /** Per-stage configuration (account, region, domain, alarms, etc.) */
  readonly stageConfig: StageConfig;
  /** Pipeline-level configuration (root domain, hosted zone, etc.) */
  readonly pipelineConfig: PipelineConfig;
  /** Lambda function configuration (memory, timeout, architecture) */
  readonly lambdaConfig: LambdaConfig;
  /** Path to built frontend assets from the Frontend Build Step */
  readonly frontendBuildOutput: string;
  /** Path to Lambda fat JAR from the Lambda Build Step */
  readonly lambdaJarPath: string;
  /** Stage name identifier ('beta' or 'prod') */
  readonly stageName: 'beta' | 'prod';
}

/**
 * CDK Stage that groups all stacks for a single deployment target (Beta or Prod).
 *
 * Instantiates DnsStack, CertificateStack, NotificationStack, WebsiteStack,
 * ApiStack, and MonitoringStack with proper inter-stack dependency wiring.
 * Exposes the composite alarm for pipeline rollback monitoring.
 */
export class WebsiteStage extends cdk.Stage {
  /** Composite alarm from MonitoringStack — used by the pipeline for bake-time rollback */
  public readonly compositeAlarm: cloudwatch.CompositeAlarm;

  constructor(scope: Construct, id: string, props: WebsiteStageProps) {
    super(scope, id, props);

    const { stageConfig, pipelineConfig, lambdaConfig, stageName } = props;
    const websiteConfig = stageConfig.website;

    // 1. DnsStack — creates the stage hosted zone (provides hostedZone for other stacks)
    const dnsStack = new DnsStack(this, 'DnsStack', {
      stageDomainName: websiteConfig.domainName,
      rootDomainName: pipelineConfig.rootDomainName,
      rootHostedZoneId: pipelineConfig.rootHostedZoneId,
      dnsProvider: stageConfig.dnsProvider,
    });

    // 2. CertificateStack — creates ACM certs (depends on DnsStack hostedZone)
    const certificateStack = new CertificateStack(this, 'CertificateStack', {
      domainName: websiteConfig.domainName,
      wwwSubdomain: websiteConfig.wwwSubdomain,
      apiSubdomain: websiteConfig.apiSubdomain,
      hostedZone: dnsStack.hostedZone,
      apiCertificateRegion: stageConfig.region,
    });
    certificateStack.addDependency(dnsStack);

    // 3. NotificationStack — creates SNS topic (no dependencies)
    const notificationStack = new NotificationStack(this, 'NotificationStack', {});

    // 4. WebsiteStack — S3 + CloudFront (depends on CertificateStack + DnsStack)
    const websiteStack = new WebsiteStack(this, 'WebsiteStack', {
      websiteConfig,
      cloudFrontPriceClass: stageConfig.cloudFrontPriceClass,
      certificate: certificateStack.cloudFrontCertificate,
      hostedZone: dnsStack.hostedZone,
      frontendBuildOutput: props.frontendBuildOutput,
    });
    websiteStack.addDependency(certificateStack);
    websiteStack.addDependency(dnsStack);

    // 5. ApiStack — API Gateway + Lambda + SES (depends on CertificateStack + DnsStack)
    const apiStack = new ApiStack(this, 'ApiStack', {
      websiteConfig,
      lambdaConfig,
      certificate: certificateStack.apiCertificate,
      hostedZone: dnsStack.hostedZone,
      lambdaJarPath: props.lambdaJarPath,
      allowedOrigin: `https://${websiteConfig.domainName}`,
    });
    apiStack.addDependency(certificateStack);
    apiStack.addDependency(dnsStack);

    // 6. MonitoringStack — dashboards + alarms (depends on WebsiteStack, ApiStack, NotificationStack)
    const monitoringStack = new MonitoringStack(this, 'MonitoringStack', {
      stageName,
      distribution: websiteStack.distribution,
      lambdaFunction: apiStack.contactFormFunction,
      httpApi: apiStack.httpApi,
      highSeverityAlarms: stageConfig.highSeverityAlarms,
      lowSeverityAlarms: stageConfig.lowSeverityAlarms,
      notificationTopic: notificationStack.notificationTopic,
    });
    monitoringStack.addDependency(websiteStack);
    monitoringStack.addDependency(apiStack);
    monitoringStack.addDependency(notificationStack);

    this.compositeAlarm = monitoringStack.compositeAlarm;
  }
}
