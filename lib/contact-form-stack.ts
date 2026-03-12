import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { CfnOutput } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ses from 'aws-cdk-lib/aws-ses';
import { ICertificateRef } from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import path = require("path");

export interface ContactFormStackProps extends cdk.StackProps {
    readonly certificate: ICertificateRef;
    readonly domainName: string;
    readonly recipientEmail: string;
    readonly hostedZone: route53.IHostedZone;
}

export class ContactFormStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: ContactFormStackProps) {
    super(scope, id, props);

    const ccEmail = 'pistolpetepcp@gmail.com';

    // Lambda function for processing contact form submissions
    const contactFormHandler = new lambda.Function(this, 'ContactFormHandler', {
      runtime: lambda.Runtime.JAVA_21,
      memorySize: 512,
      handler: 'com.personalwebsite.contact.ContactFormHandler::handleRequest',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../personalWebsiteContactFormLambda/build/libs/contact-form-handler-all.jar')),
      environment: {
        RECIPIENT_EMAIL: props.recipientEmail,
        CC_EMAIL: ccEmail
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Grant SES permissions to the Lambda function
    contactFormHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // API Gateway HTTP API with CORS
    const dn = new apigwv2.DomainName(this, 'HttpApiDomain', {
      domainName: `api.${props.domainName}`,
      certificate: props.certificate,
    });
    
    
    const httpApi = new apigwv2.HttpApi(this, 'ContactFormApi', {
      apiName: 'ContactFormApi',
      corsPreflight: {
        allowOrigins: [`https://${props.domainName}`, `https://www.${props.domainName}`],
        allowHeaders: ['Content-Type'],
        allowMethods: [apigwv2.CorsHttpMethod.POST],
      },
      defaultDomainMapping: {
        domainName: dn,
      }
    });

    const CnameRecord = new route53.CnameRecord(this, 'ApiCnameRecord', {
      zone: props.hostedZone,
      recordName: 'api',
      domainName: dn.regionalDomainName,
    });

    new CfnOutput(this, 'ApiCnameRecordOutput', {
      value: CnameRecord.domainName,
      description: 'The CNAME record for the API Gateway custom domain',
    });

    // POST /contact route with Lambda integration
    const lambdaIntegration = new HttpLambdaIntegration('ContactFormIntegration', contactFormHandler);
    httpApi.addRoutes({
      path: '/contact',
      methods: [apigwv2.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    // SES Email Identity for the recipient email
    const senderEmail = new ses.EmailIdentity(this, 'RecipientEmailIdentity', {
      identity: ses.Identity.email(props.recipientEmail),
    });

    const ccEmailIdentity = new ses.EmailIdentity(this, 'CCEmailIdentity', {
      identity: ses.Identity.email(ccEmail),
    });

    new CfnOutput(this, 'senderEmail.emailIdentityArn', {
      value: senderEmail.emailIdentityArn,
      description: 'The recipient email address for contact form submissions',
    });

    new CfnOutput(this, 'ccEmail.emailIdentityArn', {
      value: ccEmailIdentity.emailIdentityArn,
      description: 'The CC email address for contact form submissions',
    });

    // Output the API Gateway endpoint URL
    new CfnOutput(this, 'ContactFormApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'The endpoint URL for the contact form API',
    });

    new CfnOutput(this, 'ContactFormRegionalApiDomainEndpoint', {
      value: dn.regionalDomainName,
      description: 'The custom domain for the contact form API',
    });
  }
}
