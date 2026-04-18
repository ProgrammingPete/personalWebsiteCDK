import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { DnsProvider } from '../config/configuration.types';

export interface DnsStackProps extends cdk.StackProps {
  /** Stage subdomain (e.g., 'beta.example.com') */
  readonly stageDomainName: string;
  /** Root domain name (e.g., 'example.com') */
  readonly rootDomainName: string;
  /** Root hosted zone ID in the pipeline account (used when dnsProvider is 'route53') */
  readonly rootHostedZoneId: string;
  /** DNS provider for the root domain */
  readonly dnsProvider: DnsProvider;
}

/**
 * Creates a Route 53 public hosted zone for the stage subdomain and handles
 * NS delegation based on the DNS provider configuration.
 *
 * When dnsProvider is 'route53': creates NS delegation records in the root hosted zone.
 * When dnsProvider is 'external': outputs NS records via CfnOutput for manual configuration.
 */
export class DnsStack extends cdk.Stack {
  /** The Route 53 hosted zone for the stage subdomain */
  public readonly hostedZone: route53.IHostedZone;
  /** The hosted zone ID for cross-stack references */
  public readonly hostedZoneId: string;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    // Create a public hosted zone for the stage subdomain (e.g., beta.example.com)
    const stageHostedZone = new route53.PublicHostedZone(this, 'StageHostedZone', {
      zoneName: props.stageDomainName,
      comment: `Hosted zone for ${props.stageDomainName}`,
    });

    if (props.dnsProvider === 'route53') {
      // Import the root hosted zone and create NS delegation records
      const rootHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'RootHostedZone', {
        hostedZoneId: props.rootHostedZoneId,
        zoneName: props.rootDomainName,
      });

      // Create NS delegation record in the root zone pointing to the stage zone's name servers
      new route53.NsRecord(this, 'StageDelegationRecord', {
        zone: rootHostedZone,
        recordName: props.stageDomainName,
        values: stageHostedZone.hostedZoneNameServers!,
        comment: `NS delegation for ${props.stageDomainName}`,
      });
    } else {
      // External DNS provider: output NS records for manual configuration
      new cdk.CfnOutput(this, 'NameServers', {
        value: cdk.Fn.join(', ', stageHostedZone.hostedZoneNameServers!),
        description: `NS records for ${props.stageDomainName}. Add these to your external DNS provider (Squarespace, Cloudflare, etc.) as NS records for the subdomain.`,
        exportName: `${this.stackName}-NameServers`,
      });

      new cdk.CfnOutput(this, 'DnsSetupInstructions', {
        value: `Add the following NS records to your external DNS provider for "${props.stageDomainName}": see NameServers output above.`,
        description: 'Instructions for configuring external DNS delegation.',
      });
    }

    // Export hosted zone ID for cross-stack consumption
    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: stageHostedZone.hostedZoneId,
      description: `Hosted zone ID for ${props.stageDomainName}`,
      exportName: `${this.stackName}-HostedZoneId`,
    });

    this.hostedZone = stageHostedZone;
    this.hostedZoneId = stageHostedZone.hostedZoneId;
  }
}
