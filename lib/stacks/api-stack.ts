import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { WebsiteConfig, LambdaConfig } from '../config/configuration.types';

export interface ApiStackProps extends cdk.StackProps {
  /** Website configuration for this stage */
  readonly websiteConfig: WebsiteConfig;
  /** Lambda function configuration */
  readonly lambdaConfig: LambdaConfig;
  /** ACM certificate for API Gateway custom domain (must be in deployment region) */
  readonly certificate: acm.ICertificate;
  /** The Route 53 hosted zone for the stage subdomain */
  readonly hostedZone: route53.IHostedZone;
  /** Path to the Lambda fat JAR artifact from the Lambda build step */
  readonly lambdaJarPath: string;
  /** Allowed origin for CORS (CloudFront custom domain, e.g., 'https://beta.example.com') */
  readonly allowedOrigin: string;
}

/**
 * Deploys the contact form API infrastructure: Lambda function (Java 21, ARM64),
 * API Gateway HTTP API with CORS and custom domain, SES email identity,
 * and Route 53 A record for the API subdomain.
 */
export class ApiStack extends cdk.Stack {
  /** The Lambda function handling contact form submissions */
  public readonly contactFormFunction: lambda.Function;
  /** The API Gateway HTTP API */
  public readonly httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Resolve Lambda architecture from config
    const architecture = props.lambdaConfig.architecture === 'arm64'
      ? lambda.Architecture.ARM_64
      : lambda.Architecture.X86_64;

    // SES email identity for the recipient email
    const emailIdentity = new ses.EmailIdentity(this, 'RecipientEmailIdentity', {
      identity: ses.Identity.email(props.websiteConfig.recipientEmail),
    });

    // IAM execution role with least-privilege permissions
    const lambdaRole = new iam.Role(this, 'ContactFormLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for the contact form Lambda function',
    });

    // CloudWatch Logs permissions (standard Lambda logging)
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );

    // SES send permissions scoped to the verified identity only
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        emailIdentity.emailIdentityArn,
      ],
    }));

    // Lambda function for contact form processing
    const contactFormFunction = new lambda.Function(this, 'ContactFormFunction', {
      runtime: lambda.Runtime.JAVA_21,
      architecture,
      memorySize: props.lambdaConfig.memorySize,
      timeout: cdk.Duration.seconds(props.lambdaConfig.timeout),
      handler: 'com.example.ContactFormHandler::handleRequest',
      code: lambda.Code.fromAsset(props.lambdaJarPath),
      role: lambdaRole,
      environment: {
        RECIPIENT_EMAIL: props.websiteConfig.recipientEmail,
        AWS_SES_REGION: cdk.Stack.of(this).region,
      },
      description: `Contact form handler for ${props.websiteConfig.domainName}`,
    });

    // CloudWatch Logs group for API Gateway access logging
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API Gateway HTTP API with CORS configuration
    const httpApi = new apigatewayv2.HttpApi(this, 'ContactFormApi', {
      apiName: `ContactFormApi-${props.websiteConfig.domainName}`,
      description: `Contact form API for ${props.websiteConfig.domainName}`,
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // POST /contact route with Lambda proxy integration
    httpApi.addRoutes({
      path: '/contact',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2_integrations.HttpLambdaIntegration(
        'ContactFormIntegration',
        contactFormFunction,
      ),
    });

    // Configure access logging on the default stage
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
    if (defaultStage) {
      defaultStage.accessLogSettings = {
        destinationArn: accessLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          requestTime: '$context.requestTime',
          httpMethod: '$context.httpMethod',
          routeKey: '$context.routeKey',
          status: '$context.status',
          protocol: '$context.protocol',
          responseLength: '$context.responseLength',
          integrationError: '$context.integrationErrorMessage',
        }),
      };
    }

    // API Gateway custom domain (e.g., api.beta.example.com)
    const customDomain = new apigatewayv2.DomainName(this, 'ApiCustomDomain', {
      domainName: props.websiteConfig.apiSubdomain,
      certificate: props.certificate,
    });

    // Map the custom domain to the HTTP API default stage
    new apigatewayv2.ApiMapping(this, 'ApiMapping', {
      api: httpApi,
      domainName: customDomain,
    });

    // Route 53 A record for the API subdomain → API Gateway custom domain
    new route53.ARecord(this, 'ApiARecord', {
      zone: props.hostedZone,
      recordName: props.websiteConfig.apiSubdomain,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.ApiGatewayv2DomainProperties(
          customDomain.regionalDomainName,
          customDomain.regionalHostedZoneId,
        ),
      ),
      comment: `A record for ${props.websiteConfig.apiSubdomain}`,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: `API Gateway endpoint for ${props.websiteConfig.apiSubdomain}`,
    });

    new cdk.CfnOutput(this, 'ApiCustomDomainUrl', {
      value: `https://${props.websiteConfig.apiSubdomain}`,
      description: `Custom domain URL for the contact form API`,
    });

    new cdk.CfnOutput(this, 'ContactFormFunctionName', {
      value: contactFormFunction.functionName,
      description: 'Contact form Lambda function name',
    });

    this.contactFormFunction = contactFormFunction;
    this.httpApi = httpApi;
  }
}
