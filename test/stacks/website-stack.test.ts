import * as cdk from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { WebsiteStack, WebsiteStackProps } from '../../lib/stacks/website-stack';
import { WebsiteConfig } from '../../lib/config/configuration.types';

/**
 * CDK assertion tests for WebsiteStack.
 *
 * Validates: S3 bucket security and lifecycle, CloudFront distribution
 * configuration (HTTPS, OAC, SPA error handling, price class), bucket policy,
 * BucketDeployment with cache invalidation, Route 53 A records, and the
 * absence of VPC/NAT/EIP resources.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6,
 *               10.1, 10.2, 22.4, 22.5, 22.7
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_WEBSITE_CONFIG: WebsiteConfig = {
  domainName: 'beta.example.com',
  wwwSubdomain: 'www.beta.example.com',
  apiSubdomain: 'api.beta.example.com',
  recipientEmail: 'contact@example.com',
};

function createTestStack(overrides?: Partial<WebsiteStackProps>): {
  stack: WebsiteStack;
  template: Template;
} {
  const app = new cdk.App();

  // Create a dummy stack to hold the hosted zone and certificate so they
  // can be referenced cross-stack (mirrors real usage).
  const supportStack = new cdk.Stack(app, 'SupportStack', {
    env: { account: '222222222222', region: 'us-east-2' },
  });

  const hostedZone = new route53.PublicHostedZone(supportStack, 'Zone', {
    zoneName: 'beta.example.com',
  });

  const certificate = new acm.Certificate(supportStack, 'Cert', {
    domainName: 'beta.example.com',
  });

  const stack = new WebsiteStack(app, 'TestWebsiteStack', {
    env: { account: '222222222222', region: 'us-east-2' },
    websiteConfig: TEST_WEBSITE_CONFIG,
    cloudFrontPriceClass: 'PriceClass_100',
    certificate,
    hostedZone,
    frontendBuildOutput: './test-assets',
    ...overrides,
  });

  const template = Template.fromStack(stack);
  return { stack, template };
}

// ---------------------------------------------------------------------------
// S3 Bucket tests (Requirements 8.1, 8.5, 22.4)
// ---------------------------------------------------------------------------

describe('S3 Website Bucket', () => {
  test('has blockPublicAccess set to block all', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('has versioning enabled', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    });
  });

  test('has lifecycle rule to expire incomplete multipart uploads after 1 day', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            AbortIncompleteMultipartUpload: {
              DaysAfterInitiation: 1,
            },
            Status: 'Enabled',
          }),
        ]),
      },
    });
  });

  test('has lifecycle rule to expire non-current versions after 30 days', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            NoncurrentVersionExpiration: {
              NoncurrentDays: 30,
            },
            Status: 'Enabled',
          }),
        ]),
      },
    });
  });

  test('uses S3 managed encryption', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          }),
        ]),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// CloudFront Distribution tests (Requirements 9.1–9.6, 22.5, 22.7)
// ---------------------------------------------------------------------------

describe('CloudFront Distribution', () => {
  test('redirects HTTP to HTTPS', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      },
    });
  });

  test('uses Origin Access Control for S3 origin', () => {
    const { template } = createTestStack();

    // OAC resource exists
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    });
  });

  test('has custom error responses for SPA routing (403 and 404 → /index.html)', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
      },
    });
  });

  test('uses PriceClass_100 by default', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        PriceClass: 'PriceClass_100',
      },
    });
  });

  test('sets default root object to index.html', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultRootObject: 'index.html',
      },
    });
  });

  test('includes custom domain names (domain and www subdomain)', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Aliases: Match.arrayWith([
          'beta.example.com',
          'www.beta.example.com',
        ]),
      },
    });
  });

  test('references an ACM certificate', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: Match.anyValue(),
          SslSupportMethod: 'sni-only',
          MinimumProtocolVersion: 'TLSv1.2_2021',
        }),
      },
    });
  });

  test('uses TLS 1.2 minimum protocol version', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        ViewerCertificate: Match.objectLike({
          MinimumProtocolVersion: 'TLSv1.2_2021',
        }),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// S3 Bucket Policy tests (Requirements 8.2, 8.3, 21.2)
// ---------------------------------------------------------------------------

describe('S3 Bucket Policy', () => {
  test('allows s3:GetObject only from CloudFront via OAC (service principal condition)', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 's3:GetObject',
            Effect: 'Allow',
            Principal: {
              Service: 'cloudfront.amazonaws.com',
            },
            Condition: {
              StringEquals: Match.anyValue(),
            },
          }),
        ]),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// BucketDeployment tests (Requirements 8.4, 10.1, 10.2)
// ---------------------------------------------------------------------------

describe('BucketDeployment', () => {
  test('creates a Custom::CDKBucketDeployment resource', () => {
    const { template } = createTestStack();

    // BucketDeployment synthesizes as a Custom::CDKBucketDeployment resource
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DistributionPaths: ['/*'],
    });
  });
});

// ---------------------------------------------------------------------------
// Route 53 A Record tests (Requirements 14.4)
// ---------------------------------------------------------------------------

describe('Route 53 A Records', () => {
  test('creates an A record for the primary domain aliased to CloudFront', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'beta.example.com.',
      Type: 'A',
      AliasTarget: Match.objectLike({
        DNSName: Match.anyValue(),
        HostedZoneId: Match.anyValue(),
      }),
    });
  });

  test('creates an A record for the www subdomain aliased to CloudFront', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'www.beta.example.com.',
      Type: 'A',
      AliasTarget: Match.objectLike({
        DNSName: Match.anyValue(),
        HostedZoneId: Match.anyValue(),
      }),
    });
  });

  test('creates exactly two A records (domain + www)', () => {
    const { template } = createTestStack();

    const aRecords = template.findResources('AWS::Route53::RecordSet', {
      Properties: {
        Type: 'A',
      },
    });

    expect(Object.keys(aRecords).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// No VPC / NAT / EIP resources (Requirement 22.7 — cost optimization)
// ---------------------------------------------------------------------------

describe('No VPC, NAT, or EIP resources', () => {
  test('does not create any VPC', () => {
    const { template } = createTestStack();

    const vpcs = template.findResources('AWS::EC2::VPC');
    expect(Object.keys(vpcs).length).toBe(0);
  });

  test('does not create any NAT Gateway', () => {
    const { template } = createTestStack();

    const nats = template.findResources('AWS::EC2::NatGateway');
    expect(Object.keys(nats).length).toBe(0);
  });

  test('does not create any Elastic IP', () => {
    const { template } = createTestStack();

    const eips = template.findResources('AWS::EC2::EIP');
    expect(Object.keys(eips).length).toBe(0);
  });

  test('does not create any Subnet', () => {
    const { template } = createTestStack();

    const subnets = template.findResources('AWS::EC2::Subnet');
    expect(Object.keys(subnets).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CfnOutput tests
// ---------------------------------------------------------------------------

describe('Stack Outputs', () => {
  test('outputs the CloudFront distribution domain name', () => {
    const { template } = createTestStack();

    template.hasOutput('DistributionDomainName', {
      Value: Match.anyValue(),
    });
  });

  test('outputs the CloudFront distribution ID', () => {
    const { template } = createTestStack();

    template.hasOutput('DistributionId', {
      Value: Match.anyValue(),
    });
  });

  test('outputs the S3 bucket name', () => {
    const { template } = createTestStack();

    template.hasOutput('WebsiteBucketName', {
      Value: Match.anyValue(),
    });
  });
});
