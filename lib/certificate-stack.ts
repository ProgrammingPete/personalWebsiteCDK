import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

interface CertificateAndHostedZoneStackProps extends cdk.StackProps {
    readonly domainName: string;
    readonly hostedZoneId: string;
}

export class CertificateAndHostedZoneStack extends cdk.Stack {
    public certificate: acm.ICertificate;
    public apiCertificate: cdk.aws_certificatemanager.ICertificate;
    public hostedZone: cdk.aws_route53.IHostedZone;

    constructor(scope: Construct, id: string, props: CertificateAndHostedZoneStackProps) {
        super(scope, id, props);

        // const hostedZone = route53.HostedZone.fromHostedZoneId(this, 'PeterParianosHostedZone', props.hostedZoneId);
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'PeterParianosHostedZone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.domainName,
        });

        const certificate = acm.Certificate.fromCertificateArn( // needs to be in us-east-1 for Cloudfront
            this, 
            'ImportedCert', 
            "arn:aws:acm:us-east-1:029238154714:certificate/635db137-ab34-4b59-b1f1-e855dbda3f7b"
        );
        
        const apiCertificate = new acm.Certificate(this, 'ApiCertificate', {
            domainName: `api.${props.domainName}`,
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });

        new cdk.CfnOutput(this, 'CertificateArn', {
            value: certificate.certificateArn,
            description: 'The ARN of the ACM certificate',
        });
        new cdk.CfnOutput(this, 'ApiCertificateArn', {
            value: apiCertificate.certificateArn,
            description: 'The ARN of the ACM certificate for API',
        });
        new cdk.CfnOutput(this, 'HostedZoneId', {
            value: hostedZone.hostedZoneId,
            description: 'The ID of the Route 53 hosted zone',
        });
        new cdk.CfnOutput(this, 'HostedZoneName', {
            value: hostedZone.zoneName,
            description: 'The name of the Route 53 hosted zone',
        });

        this.hostedZone = hostedZone;
        this.certificate = certificate;
        this.apiCertificate = apiCertificate;
    }
}