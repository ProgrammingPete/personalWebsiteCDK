import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { ICertificateRef } from 'aws-cdk-lib/aws-certificatemanager';
import { AllowedMethods, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_target from 'aws-cdk-lib/aws-route53-targets';
import path = require("path");

interface PersonalWebsiteCdkStackProps extends cdk.StackProps {
  readonly domainName: string;
  readonly certificate: ICertificateRef;
  readonly hostedZone: route53.IHostedZone;
}

export class PersonalWebsiteCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PersonalWebsiteCdkStackProps) {
    super(scope, id, props);

        const hostingBucket = new Bucket(this, 'FrontendBucket', {
            bucketName: 'personal-website-peterparianos-bucket',
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            publicReadAccess: false,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const distribution = new Distribution(this, 'CloudfrontDistribution', {
            defaultBehavior: {
                origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(hostingBucket),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS
            },
            defaultRootObject: 'index.html',
            domainNames: [props.domainName, `www.${props.domainName}`],
            certificate: props.certificate,
            enableLogging: true,
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                },
            ],
            comment: 'CloudFront distribution for personal website',
        });

        const aRecord = new route53.ARecord(this, 'ARecordFrontend', {
          target: route53.RecordTarget.fromAlias(new route53_target.CloudFrontTarget(distribution)),
          zone: props.hostedZone,
          comment: `A Record for Personal Website Frontend`
        });

        new CfnOutput(this, 'ARecord', { value: aRecord.domainName });


        const deploymentSources = [
          s3deploy.Source.asset(path.join(__dirname, "../../personalWebsiteFrontend/build")),
        ];
        
        new s3deploy.BucketDeployment(this, "DeployWebsite", {
          sources: deploymentSources,
          destinationBucket: hostingBucket,
          distribution: distribution
        });
  }
}
