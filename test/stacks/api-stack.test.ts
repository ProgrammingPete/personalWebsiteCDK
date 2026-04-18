import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { ApiStack, ApiStackProps } from '../../lib/stacks/api-stack';
import { WebsiteConfig, LambdaConfig } from '../../lib/config/configuration.types';

/**
 * CDK assertion tests for ApiStack.
 *
 * Validates: Lambda function configuration (Java 21, ARM64, 512 MB, 30s timeout),
 * IAM least-privilege (ses:SendEmail, ses:SendRawEmail, logs), SES email identity,
 * API Gateway HTTP API with POST /contact route, CORS configuration, custom domain
 * with ACM certificate, Route 53 A record, and access logging.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5, 21.1, 22.2
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

const TEST_LAMBDA_CONFIG: LambdaConfig = {
  memorySize: 512,
  timeout: 30,
  architecture: 'arm64',
};

function createTestStack(overrides?: Partial<ApiStackProps>): {
  stack: ApiStack;
  template: Template;
} {
  const app = new cdk.App();

  // Create a support stack to hold the hosted zone and certificate so they
  // can be referenced cross-stack (mirrors real usage).
  const supportStack = new cdk.Stack(app, 'SupportStack', {
    env: { account: '222222222222', region: 'us-east-2' },
  });

  const hostedZone = new route53.PublicHostedZone(supportStack, 'Zone', {
    zoneName: 'beta.example.com',
  });

  const certificate = new acm.Certificate(supportStack, 'Cert', {
    domainName: 'api.beta.example.com',
  });

  const stack = new ApiStack(app, 'TestApiStack', {
    env: { account: '222222222222', region: 'us-east-2' },
    websiteConfig: TEST_WEBSITE_CONFIG,
    lambdaConfig: TEST_LAMBDA_CONFIG,
    certificate,
    hostedZone,
    lambdaJarPath: './test-assets',
    allowedOrigin: 'https://beta.example.com',
    ...overrides,
  });

  const template = Template.fromStack(stack);
  return { stack, template };
}

// ---------------------------------------------------------------------------
// Lambda Function tests (Requirements 11.1, 22.2)
// ---------------------------------------------------------------------------

describe('Lambda Function', () => {
  test('uses Java 21 runtime', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'java21',
    });
  });

  test('uses ARM64 architecture', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Architectures: ['arm64'],
    });
  });

  test('has 512 MB memory', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
    });
  });

  test('has 30 second timeout', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 30,
    });
  });

  test('has environment variables for recipient email and SES region', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          RECIPIENT_EMAIL: 'contact@example.com',
          AWS_SES_REGION: Match.anyValue(),
        },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// IAM Role tests (Requirements 11.3, 21.1)
// ---------------------------------------------------------------------------

describe('Lambda IAM Role', () => {
  test('has AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        {
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('.*AWSLambdaBasicExecutionRole.*'),
            ]),
          ]),
        },
      ]),
    });
  });

  test('has inline policy with ses:SendEmail and ses:SendRawEmail actions', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['ses:SendEmail', 'ses:SendRawEmail'],
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('Lambda role is assumed by lambda.amazonaws.com service principal', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
          }),
        ]),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// SES Identity tests (Requirement 11.5)
// ---------------------------------------------------------------------------

describe('SES Email Identity', () => {
  test('creates an SES email identity for the recipient email', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'contact@example.com',
    });
  });
});

// ---------------------------------------------------------------------------
// API Gateway HTTP API tests (Requirements 12.1, 12.2)
// ---------------------------------------------------------------------------

describe('API Gateway HTTP API', () => {
  test('creates an HTTP API', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
    });
  });

  test('configures CORS with the CloudFront domain as allowed origin', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['https://beta.example.com'],
        AllowMethods: Match.arrayWith(['POST', 'OPTIONS']),
        AllowHeaders: Match.arrayWith(['Content-Type']),
      }),
    });
  });

  test('creates a POST /contact route', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /contact',
    });
  });

  test('creates a Lambda integration for the route', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      PayloadFormatVersion: '2.0',
    });
  });
});

// ---------------------------------------------------------------------------
// API Gateway Custom Domain tests (Requirement 12.3)
// ---------------------------------------------------------------------------

describe('API Gateway Custom Domain', () => {
  test('creates a custom domain for the API subdomain with ACM certificate', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', {
      DomainName: 'api.beta.example.com',
      DomainNameConfigurations: Match.arrayWith([
        Match.objectLike({
          CertificateArn: Match.anyValue(),
          EndpointType: 'REGIONAL',
        }),
      ]),
    });
  });

  test('creates an API mapping connecting the HTTP API to the custom domain', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', {
      ApiId: Match.anyValue(),
      DomainName: Match.anyValue(),
      Stage: Match.anyValue(),
    });
  });
});

// ---------------------------------------------------------------------------
// Route 53 A Record tests (Requirement 12.4)
// ---------------------------------------------------------------------------

describe('Route 53 A Record', () => {
  test('creates an A record for the API subdomain', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'api.beta.example.com.',
      Type: 'A',
      AliasTarget: Match.objectLike({
        DNSName: Match.anyValue(),
        HostedZoneId: Match.anyValue(),
      }),
    });
  });
});

// ---------------------------------------------------------------------------
// Access Logging tests (Requirement 12.5)
// ---------------------------------------------------------------------------

describe('Access Logging', () => {
  test('creates a CloudWatch log group for API access logs', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 30,
    });
  });

  test('configures access log settings on the default stage', () => {
    const { template } = createTestStack();

    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      AccessLogSettings: Match.objectLike({
        DestinationArn: Match.anyValue(),
        Format: Match.anyValue(),
      }),
    });
  });
});

// ---------------------------------------------------------------------------
// Stack Outputs tests
// ---------------------------------------------------------------------------

describe('Stack Outputs', () => {
  test('outputs the API endpoint', () => {
    const { template } = createTestStack();

    template.hasOutput('ApiEndpoint', {
      Value: Match.anyValue(),
    });
  });

  test('outputs the custom domain URL', () => {
    const { template } = createTestStack();

    template.hasOutput('ApiCustomDomainUrl', {
      Value: 'https://api.beta.example.com',
    });
  });

  test('outputs the Lambda function name', () => {
    const { template } = createTestStack();

    template.hasOutput('ContactFormFunctionName', {
      Value: Match.anyValue(),
    });
  });
});
