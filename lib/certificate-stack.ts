import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

interface CertificateAndHostedZoneStackProps extends cdk.StackProps {
    readonly domainName: string;
    readonly hostedZoneId: string;
}

export class CertificateAndHostedZoneStack extends cdk.Stack {
    public readonly certificate: cdk.aws_certificatemanager.Certificate;
    public readonly apiCertificate: cdk.aws_certificatemanager.Certificate;
    public readonly hostedZone: cdk.aws_route53.HostedZone;

    constructor(scope: Construct, id: string, props: CertificateAndHostedZoneStackProps) {
        super(scope, id, props);

        const hostedZone = route53.HostedZone.fromHostedZoneId(this, 'PeterParianosHostedZone', props.hostedZoneId);

        this.certificate = new acm.Certificate(this, 'PersonalSiteCertificate', {
            domainName: props.domainName,
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });

        this.apiCertificate = new acm.Certificate(this, 'ApiCertificate', {
            domainName: `api.${props.domainName}`,
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });

        new cdk.CfnOutput(this, 'CertificateArn', {
            value: this.certificate.certificateArn,
            description: 'The ARN of the ACM certificate',
        });
    }
}