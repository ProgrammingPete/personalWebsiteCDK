import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { WebsiteConfig } from '../config/configuration.types';

export interface WebsiteStackProps extends cdk.StackProps {
  /** Website configuration for this stage */
  readonly websiteConfig: WebsiteConfig;
  /** CloudFront price class (e.g., 'PriceClass_100') */
  readonly cloudFrontPriceClass: string;
  /** ACM certificate for CloudFront (must be in us-east-1) */
  readonly certificate: acm.ICertificate;
  /** The Route 53 hosted zone for the stage subdomain */
  readonly hostedZone: route53.IHostedZone;
  /** Path to the built frontend assets directory */
  readonly frontendBuildOutput: string;
}

/**
 * Deploys the static website infrastructure: S3 bucket with CloudFront OAC,
 * CloudFront distribution with HTTPS and SPA support, BucketDeployment with
 * cache invalidation, and Route 53 A records for the domain and www subdomain.
 */
export class WebsiteStack extends cdk.Stack {
  /** The CloudFront distribution serving the website */
  public readonly distribution: cloudfront.Distribution;
  /** The S3 bucket hosting the website assets */
  public readonly websiteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    // S3 bucket for static website assets
    // - Block all public access (served exclusively via CloudFront OAC)
    // - Versioning enabled for rollback support
    // - Lifecycle rules for cost optimization
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          // Expire incomplete multipart uploads after 1 day
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
        {
          // Transition non-current versions after 30 days
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // Resolve the CloudFront price class from the config string
    const priceClass = this.resolvePriceClass(props.cloudFrontPriceClass);

    // CloudFront distribution with OAC for S3 origin
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: [
        props.websiteConfig.domainName,
        props.websiteConfig.wwwSubdomain,
      ],
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      priceClass,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // SPA support: route 403/404 to /index.html with 200 status
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(86400),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(86400),
        },
      ],
      comment: `CloudFront distribution for ${props.websiteConfig.domainName}`,
    });

    // Deploy frontend assets to S3 with CloudFront cache invalidation
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(props.frontendBuildOutput)],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Route 53 A record for the primary domain → CloudFront
    new route53.ARecord(this, 'SiteARecord', {
      zone: props.hostedZone,
      recordName: props.websiteConfig.domainName,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(distribution),
      ),
      comment: `A record for ${props.websiteConfig.domainName}`,
    });

    // Route 53 A record for the www subdomain → CloudFront
    new route53.ARecord(this, 'WwwARecord', {
      zone: props.hostedZone,
      recordName: props.websiteConfig.wwwSubdomain,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(distribution),
      ),
      comment: `A record for ${props.websiteConfig.wwwSubdomain}`,
    });

    // Outputs
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: `CloudFront distribution domain for ${props.websiteConfig.domainName}`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket name for website assets',
    });

    this.distribution = distribution;
    this.websiteBucket = websiteBucket;
  }

  /**
   * Maps a CloudFront price class string from the Configuration Registry
   * to the corresponding CDK enum value.
   */
  private resolvePriceClass(priceClassStr: string): cloudfront.PriceClass {
    const priceClassMap: Record<string, cloudfront.PriceClass> = {
      PriceClass_100: cloudfront.PriceClass.PRICE_CLASS_100,
      PriceClass_200: cloudfront.PriceClass.PRICE_CLASS_200,
      PriceClass_All: cloudfront.PriceClass.PRICE_CLASS_ALL,
    };
    return priceClassMap[priceClassStr] ?? cloudfront.PriceClass.PRICE_CLASS_100;
  }
}
