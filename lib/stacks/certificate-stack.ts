import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface CertificateStackProps extends cdk.StackProps {
  /** Primary domain name (e.g., 'beta.example.com') */
  readonly domainName: string;
  /** www subdomain (e.g., 'www.beta.example.com') */
  readonly wwwSubdomain: string;
  /** API subdomain (e.g., 'api.beta.example.com') */
  readonly apiSubdomain: string;
  /** The Route 53 hosted zone for DNS validation */
  readonly hostedZone: route53.IHostedZone;
  /** Deployment region for the API certificate (e.g., 'us-east-2') */
  readonly apiCertificateRegion: string;
}

/**
 * Creates ACM certificates for CloudFront (us-east-1) and API Gateway (deployment region).
 *
 * - CloudFront certificate: created in us-east-1 (CloudFront requirement) for the
 *   website domain and www subdomain.
 * - API Gateway certificate: created in the deployment region for the API custom domain.
 *
 * Both certificates use DNS validation against the stage Route 53 hosted zone from DnsStack.
 */
export class CertificateStack extends cdk.Stack {
  /** ACM certificate ARN for CloudFront (us-east-1) */
  public readonly cloudFrontCertificateArn: string;
  /** ACM certificate for CloudFront (us-east-1) */
  public readonly cloudFrontCertificate: acm.ICertificate;
  /** ACM certificate ARN for API Gateway (deployment region) */
  public readonly apiCertificateArn: string;
  /** ACM certificate for API Gateway (deployment region) */
  public readonly apiCertificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    // CloudFront certificate in us-east-1 for the website domain and www subdomain.
    // CloudFront requires certificates to be in us-east-1 regardless of the deployment region.
    // We use DnsValidatedCertificate to create the cert cross-region while validating
    // against the stage hosted zone.
    const cloudFrontCert = new acm.DnsValidatedCertificate(this, 'CloudFrontCertificate', {
      domainName: props.domainName,
      subjectAlternativeNames: [props.wwwSubdomain],
      hostedZone: props.hostedZone,
      region: 'us-east-1',
      cleanupRoute53Records: true,
    });

    // API Gateway certificate in the deployment region (e.g., us-east-2)
    const apiCert = new acm.Certificate(this, 'ApiCertificate', {
      domainName: props.apiSubdomain,
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    });

    // Export certificate ARNs for downstream stacks
    new cdk.CfnOutput(this, 'CloudFrontCertificateArn', {
      value: cloudFrontCert.certificateArn,
      description: `ACM certificate ARN (us-east-1) for ${props.domainName} and ${props.wwwSubdomain}`,
      exportName: `${this.stackName}-CloudFrontCertArn`,
    });

    new cdk.CfnOutput(this, 'ApiCertificateArn', {
      value: apiCert.certificateArn,
      description: `ACM certificate ARN (${props.apiCertificateRegion}) for ${props.apiSubdomain}`,
      exportName: `${this.stackName}-ApiCertArn`,
    });

    this.cloudFrontCertificateArn = cloudFrontCert.certificateArn;
    this.cloudFrontCertificate = cloudFrontCert;
    this.apiCertificateArn = apiCert.certificateArn;
    this.apiCertificate = apiCert;
  }
}
